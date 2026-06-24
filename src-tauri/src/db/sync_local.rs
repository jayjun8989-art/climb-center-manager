use crate::db::{AppState, DbError};
use crate::models::MemberInput;
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CENTER_UUID_ONCLE: &str = "11111111-1111-1111-1111-111111111001";
const CENTER_UUID_GRABIT: &str = "11111111-1111-1111-1111-111111111002";

const SYNC_TABLES: &[&str] = &[
    "members",
    "memberships",
    "attendance_logs",
    "payments",
    "pause_logs",
    "trial_members",
];

pub fn migrate_to_v3(conn: &Connection) -> SqlResult<()> {
    let version = super::migration::current_schema_version(conn)?;
    if version >= 3 {
        return Ok(());
    }

    for table in SYNC_TABLES {
        add_column_if_missing(conn, table, "remote_id", "TEXT")?;
        add_column_if_missing(conn, table, "sync_status", "TEXT NOT NULL DEFAULT 'pending'")?;
        add_column_if_missing(conn, table, "remote_updated_at", "TEXT")?;
    }

    conn.execute_batch(
        "
        UPDATE members SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE memberships SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE attendance_logs SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE payments SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE pause_logs SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE trial_members SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';

        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_local_id INTEGER NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('insert', 'update', 'soft_delete')),
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS id_map (
            entity_type TEXT NOT NULL,
            local_id INTEGER NOT NULL,
            remote_id TEXT NOT NULL,
            PRIMARY KEY (entity_type, local_id)
        );

        CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
        ",
    )?;

    super::migration::set_schema_version(conn, 3)?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqlResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |row| row.get(0),
    )?;

    if count == 0 {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
    }
    Ok(())
}

pub fn center_uuid_for_code(center: &str) -> Option<&'static str> {
    match center {
        "ONCLE" => Some(CENTER_UUID_ONCLE),
        "GRABIT" => Some(CENTER_UUID_GRABIT),
        _ => None,
    }
}

fn db_membership_to_legacy_type(membership_type: &str) -> String {
    match membership_type {
        "30days" => "monthly_1".into(),
        "90days" => "monthly_3".into(),
        "180days" => "monthly_6".into(),
        "5times" => "session".into(),
        "8times" | "16times" | "junior" => "junior".into(),
        _ => "monthly_1".into(),
    }
}

/// Supabase 동기화용 JSON — center, name, center_id 필수 포함.
pub fn member_sync_payload_from_input(input: &MemberInput) -> Result<String, DbError> {
    let mut value =
        serde_json::to_value(input).map_err(|error| DbError::Message(error.to_string()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| DbError::Message("회원 데이터 형식 변환에 실패했습니다.".into()))?;
    if let Some(center_id) = center_uuid_for_code(&input.center) {
        obj.insert("center_id".to_string(), Value::String(center_id.to_string()));
    }
    serde_json::to_string(&value).map_err(|error| DbError::Message(error.to_string()))
}

pub fn build_member_sync_payload_json(state: &AppState, member_id: i64) -> Result<String, DbError> {
    state.with_conn(|conn| build_member_sync_payload_json_conn(conn, member_id))
}

fn build_member_sync_payload_json_conn(conn: &Connection, member_id: i64) -> Result<String, DbError> {
    let (name, phone, member_type, center, parent_name, parent_phone, memo, address, member_no): (
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
    ) = conn
        .query_row(
            "SELECT name, phone, member_type, center, parent_name, parent_phone, memo, address, member_no
             FROM members WHERE id = ?1",
            [member_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .map_err(|_| DbError::Message(format!("로컬 회원 #{member_id}을 찾을 수 없습니다.")))?;

    let membership = conn
        .query_row(
            "SELECT id, membership_type, start_date, end_date, total_count, remaining_count, price
             FROM memberships
             WHERE member_id = ?1
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, id DESC
             LIMIT 1",
            [member_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i32>>(4)?,
                    row.get::<_, Option<i32>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                ))
            },
        )
        .optional()?;

    let (
        local_membership_id,
        membership_type,
        start_date,
        end_date,
        total_sessions,
        remaining_sessions,
        price,
    ) = membership.unwrap_or((
        0_i64,
        "30days".to_string(),
        Local::now().format("%Y-%m-%d").to_string(),
        None,
        None,
        None,
        None,
    ));

    let legacy_membership_type = db_membership_to_legacy_type(&membership_type);
    let center_id = center_uuid_for_code(&center).map(str::to_string);

    let payload = json!({
        "center": center,
        "name": name,
        "center_id": center_id,
        "phone": phone,
        "member_type": member_type,
        "parent_name": parent_name,
        "parent_phone": parent_phone,
        "membership_type": legacy_membership_type,
        "local_membership_id": if local_membership_id > 0 {
            json!(local_membership_id)
        } else {
            json!(null)
        },
        "start_date": start_date,
        "end_date": end_date,
        "total_sessions": total_sessions,
        "remaining_sessions": remaining_sessions,
        "notes": memo,
        "address": address,
        "price": price,
        "member_no": member_no,
    });

    serde_json::to_string(&payload).map_err(|error| DbError::Message(error.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairSyncQueueResult {
    pub repaired: i64,
    pub removed: i64,
    pub failed: i64,
}

pub fn repair_member_sync_queue(state: &AppState) -> Result<RepairSyncQueueResult, DbError> {
    let items = list_sync_queue(state, 500)?;
    let mut repaired = 0_i64;
    let mut failed = 0_i64;

    // Reset blocked/failed attendance items whose member already has a remote_id
    // so they get retried on the next push (un-sticks items like #3/#21).
    for item in &items {
        if item.entity_type != "attendance" {
            continue;
        }
        let is_blocked_attendance = item
            .last_error
            .as_deref()
            .map(|err| err.contains("동기화되지") || err.contains("회원이 아직"))
            .unwrap_or(false);
        if !is_blocked_attendance {
            continue;
        }

        let local_member_id: Option<i64> = serde_json::from_str::<Value>(&item.payload_json)
            .ok()
            .and_then(|v| v.get("local_member_id").and_then(|n| n.as_i64()));

        let has_remote_id = match local_member_id {
            Some(member_id) => get_remote_id(state, "member", member_id)?.is_some(),
            None => false,
        };

        if has_remote_id {
            state.with_conn(|conn| {
                conn.execute(
                    "UPDATE sync_queue SET last_error = NULL WHERE id = ?1",
                    rusqlite::params![item.id],
                )?;
                Ok(())
            })?;
            repaired += 1;
        }
    }

    for item in items {
        if item.entity_type != "member" {
            continue;
        }
        if item.operation != "insert" && item.operation != "update" && item.operation != "soft_delete"
        {
            continue;
        }

        match build_member_sync_payload_json(state, item.entity_local_id) {
            Ok(mut payload_json) => {
                if item.operation == "soft_delete" {
                    if let Ok(mut value) = serde_json::from_str::<Value>(&payload_json) {
                        if let Some(obj) = value.as_object_mut() {
                            obj.insert("local_id".to_string(), json!(item.entity_local_id));
                        }
                        payload_json = serde_json::to_string(&value)
                            .map_err(|error| DbError::Message(error.to_string()))?;
                    }
                }
                state.with_conn(|conn| {
                    conn.execute(
                        "UPDATE sync_queue SET payload_json = ?1, last_error = NULL WHERE id = ?2",
                        rusqlite::params![payload_json, item.id],
                    )?;
                    Ok(())
                })?;
                repaired += 1;
            }
            Err(_) => failed += 1,
        }
    }

    Ok(RepairSyncQueueResult {
        repaired,
        removed: 0,
        failed,
    })
}

pub fn purge_unsupported_sync_queue(state: &AppState) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        let removed = conn.execute(
            "DELETE FROM sync_queue
             WHERE entity_type NOT IN ('member', 'attendance') OR last_error IS NOT NULL",
            [],
        )?;
        Ok(removed as i64)
    })
}

pub fn enqueue_entity_op(
    state: &AppState,
    entity_type: &str,
    entity_local_id: i64,
    operation: &str,
    payload: &impl Serialize,
) -> Result<i64, DbError> {
    let payload_json =
        serde_json::to_string(payload).map_err(|error| DbError::Message(error.to_string()))?;
    enqueue_sync_item(
        state,
        entity_type,
        entity_local_id,
        operation,
        &payload_json,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub entity_type: String,
    pub entity_local_id: i64,
    pub operation: String,
    pub payload_json: String,
    pub created_at: String,
    pub retry_count: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub pending_count: i64,
    pub failed_count: i64,
    pub last_pull_at: Option<String>,
    pub last_push_at: Option<String>,
    pub device_id: Option<String>,
}

pub fn fetch_sync_status(state: &AppState) -> Result<SyncStatus, DbError> {
    state.with_conn(|conn| {
        let pending_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE NOT (last_error IS NOT NULL AND last_error LIKE 'RESOLVED:%')",
            [],
            |row| row.get(0),
        )?;

        let failed_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%')",
            [],
            |row| row.get(0),
        )?;

        let read_state = |key: &str| -> Result<Option<String>, DbError> {
            conn.query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(DbError::from)
        };

        Ok(SyncStatus {
            pending_count,
            failed_count,
            last_pull_at: read_state("last_pull_at")?,
            last_push_at: read_state("last_push_at")?,
            device_id: read_state("device_id")?,
        })
    })
}

pub fn enqueue_sync_item(
    state: &AppState,
    entity_type: &str,
    entity_local_id: i64,
    operation: &str,
    payload_json: &str,
) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "UPDATE members SET sync_status = 'pending' WHERE id = ?1 AND ?2 = 'member'",
            rusqlite::params![entity_local_id, entity_type],
        )
        .ok();

        conn.execute(
            "INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![entity_type, entity_local_id, operation, payload_json, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn list_sync_queue(state: &AppState, limit: i64) -> Result<Vec<SyncQueueItem>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, entity_local_id, operation, payload_json, created_at,
                    retry_count, last_error
             FROM sync_queue ORDER BY id ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(SyncQueueItem {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_local_id: row.get(2)?,
                operation: row.get(3)?,
                payload_json: row.get(4)?,
                created_at: row.get(5)?,
                retry_count: row.get(6)?,
                last_error: row.get(7)?,
            })
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    })
}

pub fn remove_sync_queue_item(state: &AppState, id: i64) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM sync_queue WHERE id = ?1", [id])?;
        Ok(())
    })
}

pub fn get_remote_id(
    state: &AppState,
    entity_type: &str,
    local_id: i64,
) -> Result<Option<String>, DbError> {
    state.with_conn(|conn| {
        if entity_type == "member" {
            if let Some(remote_id) = conn
                .query_row(
                    "SELECT remote_id FROM members WHERE id = ?1 AND remote_id IS NOT NULL",
                    [local_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            {
                return Ok(Some(remote_id));
            }
        }

        conn.query_row(
            "SELECT remote_id FROM id_map WHERE entity_type = ?1 AND local_id = ?2",
            rusqlite::params![entity_type, local_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(DbError::from)
    })
}

pub fn complete_member_push(
    state: &AppState,
    queue_id: i64,
    local_member_id: i64,
    remote_id: &str,
    remote_updated_at: Option<&str>,
) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let updated_at = remote_updated_at.unwrap_or(&now);
        let tx = conn.transaction()?;

        tx.execute(
            "UPDATE members
             SET remote_id = ?1, sync_status = 'synced', remote_updated_at = ?2, updated_at = updated_at
             WHERE id = ?3",
            rusqlite::params![remote_id, updated_at, local_member_id],
        )?;

        tx.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            rusqlite::params![local_member_id, remote_id],
        )?;

        tx.execute("DELETE FROM sync_queue WHERE id = ?1", [queue_id])?;
        tx.commit()?;
        Ok(())
    })
}

pub fn mark_sync_queue_error(state: &AppState, id: i64, error: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let (entity_type, entity_local_id): (String, i64) = conn.query_row(
            "SELECT entity_type, entity_local_id FROM sync_queue WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        conn.execute(
            "UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ?1 WHERE id = ?2",
            rusqlite::params![error, id],
        )?;

        if entity_type == "member" {
            conn.execute(
                "UPDATE members SET sync_status = 'error' WHERE id = ?1",
                [entity_local_id],
            )?;
        }

        Ok(())
    })
}

pub fn set_sync_state(state: &AppState, key: &str, value: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDiagnosticMember {
    pub local_id: i64,
    pub name: String,
    pub center: String,
    pub member_no: Option<i64>,
    pub remote_id: Option<String>,
    pub sync_status: Option<String>,
    pub last_sync_attempt: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDiagnostics {
    pub queue_pending: i64,
    pub queue_failed: i64,
    pub queue_blocked: i64,
    pub members_without_remote_id: i64,
    pub memberships_without_remote_id: i64,
    pub local_only_members: i64,
    pub synced_members: i64,
    pub center_mapping_failed: i64,
    pub hidden_locally_count: i64,
    pub local_duplicate_count: i64,
    pub problem_members: Vec<SyncDiagnosticMember>,
}

pub fn get_sync_diagnostics(state: &AppState) -> Result<SyncDiagnostics, DbError> {
    state.with_conn(|conn| {
        let queue_pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NULL",
            [],
            |row| row.get(0),
        )?;
        let queue_failed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%') AND retry_count < 5",
            [],
            |row| row.get(0),
        )?;
        let queue_blocked: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%') AND retry_count >= 5",
            [],
            |row| row.get(0),
        )?;

        let members_without_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members
             WHERE deleted_at IS NULL AND status = 'active'
               AND (remote_id IS NULL OR remote_id = '')",
            [],
            |row| row.get(0),
        )?;

        let memberships_without_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships m
             JOIN members mm ON mm.id = m.member_id
             WHERE mm.deleted_at IS NULL AND m.status = 'active'
               AND (m.remote_id IS NULL OR m.remote_id = '')",
            [],
            |row| row.get(0),
        )?;

        let local_only_members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members
             WHERE deleted_at IS NULL AND (remote_id IS NULL OR remote_id = '')",
            [],
            |row| row.get(0),
        )?;

        let synced_members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members
             WHERE deleted_at IS NULL AND remote_id IS NOT NULL AND remote_id != ''",
            [],
            |row| row.get(0),
        )?;

        let center_mapping_failed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members
             WHERE deleted_at IS NULL AND (center IS NULL OR center NOT IN ('ONCLE', 'GRABIT'))",
            [],
            |row| row.get(0),
        )?;

        let hidden_locally_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE COALESCE(hidden_locally, 0) = 1",
            [],
            |row| row.get(0),
        )?;

        let local_duplicate_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE COALESCE(is_local_duplicate, 0) = 1",
            [],
            |row| row.get(0),
        )?;

        let mut stmt = conn.prepare(
            "SELECT m.id, m.name, m.center, m.member_no, m.remote_id, m.sync_status,
                    sq.created_at, sq.last_error
             FROM members m
             LEFT JOIN sync_queue sq ON sq.entity_type = 'member' AND sq.entity_local_id = m.id
             WHERE m.deleted_at IS NULL
               AND (
                 (m.remote_id IS NULL OR m.remote_id = '')
                 OR sq.last_error IS NOT NULL
               )
             GROUP BY m.id
             ORDER BY m.id DESC
             LIMIT 200",
        )?;
        let problem_members = stmt
            .query_map([], |row| {
                Ok(SyncDiagnosticMember {
                    local_id: row.get(0)?,
                    name: row.get(1)?,
                    center: row.get(2)?,
                    member_no: row.get(3)?,
                    remote_id: row.get(4)?,
                    sync_status: row.get(5)?,
                    last_sync_attempt: row.get(6)?,
                    last_error: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(SyncDiagnostics {
            queue_pending,
            queue_failed,
            queue_blocked,
            members_without_remote_id,
            memberships_without_remote_id,
            local_only_members,
            synced_members,
            center_mapping_failed,
            hidden_locally_count,
            local_duplicate_count,
            problem_members,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CenterMappingMember {
    pub local_id: i64,
    pub name: String,
    pub center: String,
    pub remote_id: String,
    pub member_no: Option<i64>,
    pub has_pending_insert: bool,
}

/// Members with a remote_id, for cross-checking against Supabase `members.center_id`.
/// Excludes members with a pending (unsynced) insert in sync_queue, since those
/// haven't been verified against the server yet.
pub fn list_members_with_remote_id(state: &AppState) -> Result<Vec<CenterMappingMember>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.name, m.center, m.remote_id, m.member_no,
                    EXISTS(
                        SELECT 1 FROM sync_queue sq
                        WHERE sq.entity_type = 'member'
                          AND sq.entity_local_id = m.id
                          AND sq.operation = 'insert'
                          AND sq.last_error IS NULL
                    ) AS has_pending_insert
             FROM members m
             WHERE m.deleted_at IS NULL
               AND m.remote_id IS NOT NULL AND m.remote_id != ''",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CenterMappingMember {
                    local_id: row.get(0)?,
                    name: row.get(1)?,
                    center: row.get(2)?,
                    remote_id: row.get(3)?,
                    member_no: row.get(4)?,
                    has_pending_insert: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CenterMappingCorrection {
    pub local_id: i64,
    pub correct_center: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CenterMappingRepairResult {
    pub repaired: i64,
    pub skipped: i64,
}

/// Repairs local `members.center` for members confirmed mismatched vs Supabase.
/// Skips members with a pending unsynced insert (no remote verification yet) and
/// any center value that isn't a known code ('ONCLE'/'GRABIT').
pub fn repair_center_mapping(
    state: &AppState,
    corrections: &[CenterMappingCorrection],
) -> Result<CenterMappingRepairResult, DbError> {
    let mut repaired = 0_i64;
    let mut skipped = 0_i64;

    state.with_conn(|conn| {
        for correction in corrections {
            if correction.correct_center != "ONCLE" && correction.correct_center != "GRABIT" {
                skipped += 1;
                continue;
            }

            let has_pending_insert: bool = conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sync_queue sq
                    JOIN members m ON m.id = sq.entity_local_id
                    WHERE sq.entity_type = 'member'
                      AND sq.entity_local_id = ?1
                      AND sq.operation = 'insert'
                      AND sq.last_error IS NULL
                 )
                 OR (
                    (SELECT remote_id FROM members WHERE id = ?1) IS NULL
                    OR (SELECT remote_id FROM members WHERE id = ?1) = ''
                 )",
                rusqlite::params![correction.local_id],
                |row| row.get::<_, i64>(0).map(|v| v != 0),
            )?;

            if has_pending_insert {
                skipped += 1;
                continue;
            }

            let updated = conn.execute(
                "UPDATE members SET center = ?1 WHERE id = ?2 AND deleted_at IS NULL",
                rusqlite::params![correction.correct_center, correction.local_id],
            )?;
            if updated > 0 {
                repaired += 1;
            } else {
                skipped += 1;
            }
        }
        Ok(())
    })?;

    Ok(CenterMappingRepairResult { repaired, skipped })
}

pub fn upsert_id_map(
    state: &AppState,
    entity_type: &str,
    local_id: i64,
    remote_id: &str,
) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            rusqlite::params![entity_type, local_id, remote_id],
        )?;
        Ok(())
    })
}

// ── Upload Verification Report ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct UploadLocalMember {
    pub local_id: i64,
    pub name: String,
    pub center: String,
    pub member_no: Option<i64>,
    pub member_type: String,
    pub sync_status: String,
    pub remote_id: Option<String>,
    pub has_membership: bool,
    pub attendance_count: i64,
    pub can_upload: bool,
    pub upload_block_reason: Option<String>,
    pub last_attempt: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadLocalMembership {
    pub local_id: i64,
    pub member_local_id: i64,
    pub member_name: String,
    pub membership_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_count: Option<i64>,
    pub remaining_count: Option<i64>,
    pub remote_id: Option<String>,
    pub can_upload: bool,
    pub upload_block_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadLocalAttendance {
    pub local_id: i64,
    pub member_name: String,
    pub member_local_id: i64,
    pub member_has_remote_id: bool,
    pub checkin_at: String,
    pub source: Option<String>,
    pub deducted_count: i64,
    pub remote_id: Option<String>,
    pub can_upload: bool,
    pub upload_block_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadVerificationReport {
    pub queue_pending: i64,
    pub queue_failed: i64,
    pub queue_blocked: i64,
    pub members_no_remote_id: i64,
    pub memberships_no_remote_id: i64,
    pub attendance_no_remote_id: i64,
    pub payments_no_remote_id: i64,
    pub pause_logs_no_remote_id: i64,
    pub status_mismatch_count: i64,
    pub uploadable_count: i64,
    pub blocked_upload_count: i64,
    pub local_only_members: Vec<UploadLocalMember>,
    pub local_only_memberships: Vec<UploadLocalMembership>,
    pub local_only_attendance: Vec<UploadLocalAttendance>,
}

pub fn get_upload_verification_report(state: &AppState) -> Result<UploadVerificationReport, DbError> {
    state.with_conn(|conn| {
        let queue_pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NULL",
            [], |row| row.get(0),
        )?;
        let queue_failed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%') AND retry_count < 5",
            [], |row| row.get(0),
        )?;
        let queue_blocked: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%') AND retry_count >= 5",
            [], |row| row.get(0),
        )?;
        let members_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL
             AND (remote_id IS NULL OR remote_id = '')
             AND COALESCE(hidden_locally, 0) = 0",
            [], |row| row.get(0),
        )?;
        let memberships_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE m.deleted_at IS NULL AND (ms.remote_id IS NULL OR ms.remote_id = '')",
            [], |row| row.get(0),
        )?;
        let attendance_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs al
             JOIN members m ON m.id = al.member_id
             WHERE m.deleted_at IS NULL AND al.canceled_at IS NULL
               AND (al.remote_id IS NULL OR al.remote_id = '')",
            [], |row| row.get(0),
        )?;
        let payments_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM payments p
             JOIN members m ON m.id = p.member_id
             WHERE m.deleted_at IS NULL AND (p.remote_id IS NULL OR p.remote_id = '')",
            [], |row| row.get(0),
        ).unwrap_or(0);
        let pause_logs_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pause_logs pl
             JOIN members m ON m.id = pl.member_id
             WHERE m.deleted_at IS NULL AND (pl.remote_id IS NULL OR pl.remote_id = '')",
            [], |row| row.get(0),
        ).unwrap_or(0);
        let status_mismatch_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL
             AND (remote_id IS NULL OR remote_id = '') AND sync_status = 'synced'",
            [], |row| row.get(0),
        )?;

        // Local-only members
        let mut stmt = conn.prepare(
            "SELECT m.id, m.name, m.center, m.member_no,
                    COALESCE(m.member_type, 'general'),
                    COALESCE(m.sync_status, 'pending'),
                    m.remote_id,
                    (SELECT COUNT(*) FROM memberships ms2 WHERE ms2.member_id = m.id) AS has_ms,
                    (SELECT COUNT(*) FROM attendance_logs al2
                     WHERE al2.member_id = m.id AND al2.canceled_at IS NULL) AS att_count,
                    sq.created_at, sq.last_error
             FROM members m
             LEFT JOIN sync_queue sq
               ON sq.entity_type = 'member' AND sq.entity_local_id = m.id
             WHERE m.deleted_at IS NULL AND (m.remote_id IS NULL OR m.remote_id = '')
               AND COALESCE(m.hidden_locally, 0) = 0
             GROUP BY m.id
             ORDER BY m.id DESC
             LIMIT 50",
        )?;
        let local_only_members: Vec<UploadLocalMember> = stmt.query_map([], |row| {
            let has_ms: i64 = row.get(7)?;
            let last_error: Option<String> = row.get(10)?;
            let sync_status: String = row.get(5)?;
            let (can_upload, upload_block_reason) = if last_error.is_some() {
                (false, last_error.clone().map(|e| format!("동기화 오류: {e}")))
            } else if sync_status == "error" {
                (false, Some("동기화 상태 오류".to_string()))
            } else {
                (true, None)
            };
            Ok(UploadLocalMember {
                local_id: row.get(0)?,
                name: row.get(1)?,
                center: row.get(2)?,
                member_no: row.get(3)?,
                member_type: row.get(4)?,
                sync_status,
                remote_id: row.get(6)?,
                has_membership: has_ms > 0,
                attendance_count: row.get(8)?,
                can_upload,
                upload_block_reason,
                last_attempt: row.get(9)?,
                last_error,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        // Local-only memberships
        let mut stmt2 = conn.prepare(
            "SELECT ms.id, ms.member_id, m.name, COALESCE(ms.membership_type, ''),
                    ms.start_date, ms.end_date, ms.total_count, ms.remaining_count, ms.remote_id,
                    m.remote_id AS member_remote_id
             FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE m.deleted_at IS NULL AND (ms.remote_id IS NULL OR ms.remote_id = '')
             ORDER BY ms.id DESC
             LIMIT 50",
        )?;
        let local_only_memberships: Vec<UploadLocalMembership> = stmt2.query_map([], |row| {
            let member_remote_id: Option<String> = row.get(9)?;
            let (can_upload, upload_block_reason) = match member_remote_id.as_deref() {
                None | Some("") => (false, Some("연결 회원 remote_id 없음 — 회원 업로드 먼저 필요".to_string())),
                _ => (true, None),
            };
            Ok(UploadLocalMembership {
                local_id: row.get(0)?,
                member_local_id: row.get(1)?,
                member_name: row.get(2)?,
                membership_type: row.get(3)?,
                start_date: row.get(4)?,
                end_date: row.get(5)?,
                total_count: row.get(6)?,
                remaining_count: row.get(7)?,
                remote_id: row.get(8)?,
                can_upload,
                upload_block_reason,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        // Local-only attendance
        let mut stmt3 = conn.prepare(
            "SELECT al.id, m.name, al.member_id, m.remote_id,
                    al.checkin_at, al.source, al.deducted_count, al.remote_id
             FROM attendance_logs al
             JOIN members m ON m.id = al.member_id
             WHERE m.deleted_at IS NULL AND al.canceled_at IS NULL
               AND (al.remote_id IS NULL OR al.remote_id = '')
             ORDER BY al.id DESC
             LIMIT 50",
        )?;
        let local_only_attendance: Vec<UploadLocalAttendance> = stmt3.query_map([], |row| {
            let member_remote_id: Option<String> = row.get(3)?;
            let member_has_remote_id = !matches!(member_remote_id.as_deref(), None | Some(""));
            let (can_upload, upload_block_reason) = if !member_has_remote_id {
                (false, Some("연결 회원 remote_id 없음".to_string()))
            } else {
                (true, None)
            };
            Ok(UploadLocalAttendance {
                local_id: row.get(0)?,
                member_name: row.get(1)?,
                member_local_id: row.get(2)?,
                member_has_remote_id,
                checkin_at: row.get(4)?,
                source: row.get(5)?,
                deducted_count: row.get(6)?,
                remote_id: row.get(7)?,
                can_upload,
                upload_block_reason,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        let uploadable_count = local_only_members.iter().filter(|m| m.can_upload).count() as i64
            + local_only_memberships.iter().filter(|m| m.can_upload).count() as i64
            + local_only_attendance.iter().filter(|a| a.can_upload).count() as i64;
        let blocked_upload_count = local_only_members.iter().filter(|m| !m.can_upload).count() as i64
            + local_only_memberships.iter().filter(|m| !m.can_upload).count() as i64
            + local_only_attendance.iter().filter(|a| !a.can_upload).count() as i64;

        Ok(UploadVerificationReport {
            queue_pending,
            queue_failed,
            queue_blocked,
            members_no_remote_id,
            memberships_no_remote_id,
            attendance_no_remote_id,
            payments_no_remote_id,
            pause_logs_no_remote_id,
            status_mismatch_count,
            uploadable_count,
            blocked_upload_count,
            local_only_members,
            local_only_memberships,
            local_only_attendance,
        })
    })
}

/// Fix members that have remote_id IS NULL but sync_status = 'synced' → reset to 'pending'
pub fn repair_status_mismatch(state: &AppState) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        let count = conn.execute(
            "UPDATE members SET sync_status = 'pending'
             WHERE deleted_at IS NULL
               AND (remote_id IS NULL OR remote_id = '')
               AND sync_status = 'synced'",
            [],
        )?;
        Ok(count as i64)
    })
}

/// Link a local member to an existing server member (sets remote_id without uploading).
/// Clears member queue items and unblocks related attendance/membership items.
pub fn link_member_remote_id(state: &AppState, local_id: i64, remote_id: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let tx = conn.transaction()?;

        tx.execute(
            "UPDATE members SET remote_id = ?1, sync_status = 'synced', updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![remote_id, now, local_id],
        )?;

        tx.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            rusqlite::params![local_id, remote_id],
        )?;

        // Remove queued member operations — this member is now linked to a server record
        tx.execute(
            "DELETE FROM sync_queue WHERE entity_type = 'member' AND entity_local_id = ?1",
            [local_id],
        )?;

        // Unblock attendance queue items for this member so they can retry
        tx.execute(
            "UPDATE sync_queue SET last_error = NULL, retry_count = 0
             WHERE entity_type = 'attendance'
               AND last_error IS NOT NULL
               AND json_extract(payload_json, '$.local_member_id') = ?1",
            [local_id],
        )?;

        tx.commit()?;
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalMemberForMatch {
    pub local_id: i64,
    pub name: String,
    pub center: String,
    pub member_no: Option<i64>,
    pub phone: Option<String>,
    pub phone_normalized: Option<String>,
    pub sync_status: String,
    pub attendance_count: i64,
    pub has_membership: bool,
}

/// Returns local members without remote_id for a given center (for server matching).
pub fn get_local_members_for_matching(state: &AppState, center: &str) -> Result<Vec<LocalMemberForMatch>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.name, m.center, m.member_no, m.phone,
                    REPLACE(REPLACE(REPLACE(COALESCE(m.phone,''), '-', ''), ' ', ''), '+82', '0'),
                    COALESCE(m.sync_status, 'pending'),
                    (SELECT COUNT(*) FROM attendance_logs al WHERE al.member_id = m.id AND al.canceled_at IS NULL),
                    (SELECT COUNT(*) FROM memberships ms WHERE ms.member_id = m.id) > 0
             FROM members m
             WHERE m.deleted_at IS NULL
               AND (m.remote_id IS NULL OR m.remote_id = '')
               AND UPPER(m.center) = UPPER(?1)
             ORDER BY m.id DESC",
        )?;
        let rows = stmt.query_map([center], |row| {
            let phone_normalized: String = row.get(5)?;
            let has_ms: i64 = row.get(8)?;
            Ok(LocalMemberForMatch {
                local_id: row.get(0)?,
                name: row.get(1)?,
                center: row.get(2)?,
                member_no: row.get(3)?,
                phone: row.get(4)?,
                phone_normalized: if phone_normalized.is_empty() { None } else { Some(phone_normalized) },
                sync_status: row.get(6)?,
                attendance_count: row.get(7)?,
                has_membership: has_ms > 0,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalCenterCounts {
    pub members: i64,
    pub members_display: i64,
    pub memberships: i64,
    pub attendance: i64,
    pub members_no_remote_id: i64,
    pub memberships_no_remote_id: i64,
    pub attendance_no_remote_id: i64,
    pub blocked: i64,
}

/// Returns local DB counts for a given center (for PC consistency check).
pub fn get_local_center_counts(state: &AppState, center: &str) -> Result<LocalCenterCounts, DbError> {
    state.with_conn(|conn| {
        // A/B: total non-deleted members for this center
        let members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND UPPER(center) = UPPER(?1)",
            [center], |row| row.get(0),
        )?;
        // C: display-filtered members (not hidden, not local duplicate)
        let members_display: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND UPPER(center) = UPPER(?1)
             AND COALESCE(hidden_locally, 0) = 0 AND COALESCE(is_local_duplicate, 0) = 0",
            [center], |row| row.get(0),
        )?;
        // G: all memberships linked to center members
        let memberships: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE m.deleted_at IS NULL AND UPPER(m.center) = UPPER(?1)",
            [center], |row| row.get(0),
        )?;
        let attendance: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs al
             JOIN members m ON m.id = al.member_id
             WHERE m.deleted_at IS NULL AND al.canceled_at IS NULL AND UPPER(m.center) = UPPER(?1)",
            [center], |row| row.get(0),
        )?;
        // D: members without remote_id
        let members_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL
             AND UPPER(center) = UPPER(?1) AND (remote_id IS NULL OR remote_id = '')",
            [center], |row| row.get(0),
        )?;
        // H: memberships without remote_id
        let memberships_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE m.deleted_at IS NULL AND UPPER(m.center) = UPPER(?1) AND ms.remote_id IS NULL",
            [center], |row| row.get(0),
        )?;
        // I: attendance_logs without remote_id
        let attendance_no_remote_id: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs al
             JOIN members m ON m.id = al.member_id
             WHERE m.deleted_at IS NULL AND UPPER(m.center) = UPPER(?1) AND al.remote_id IS NULL",
            [center], |row| row.get(0),
        )?;
        let blocked: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL AND NOT (last_error LIKE 'RESOLVED:%')",
            [], |row| row.get(0),
        )?;
        Ok(LocalCenterCounts {
            members,
            members_display,
            memberships,
            attendance,
            members_no_remote_id,
            memberships_no_remote_id,
            attendance_no_remote_id,
            blocked,
        })
    })
}

/// Re-create a fresh 'insert' queue item for a local-only member so the next push will upload them.
/// Removes any existing non-error member queue items for this member first to avoid duplicates.
pub fn requeue_member_for_upload(state: &AppState, member_id: i64) -> Result<i64, DbError> {
    let payload_json = build_member_sync_payload_json(state, member_id)?;
    state.with_conn(|conn| {
        conn.execute(
            "DELETE FROM sync_queue WHERE entity_type = 'member' AND entity_local_id = ?1 AND last_error IS NULL",
            [member_id],
        )?;
        conn.execute(
            "UPDATE members SET sync_status = 'pending' WHERE id = ?1",
            [member_id],
        )?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload_json, created_at)
             VALUES ('member', ?1, 'insert', ?2, ?3)",
            rusqlite::params![member_id, payload_json, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

/// Mark a member as local-only (excluded from sync): removes member queue items and sets sync_status = 'local_only'.
pub fn exclude_member_from_upload(state: &AppState, member_id: i64) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        let removed = conn.execute(
            "DELETE FROM sync_queue WHERE entity_type = 'member' AND entity_local_id = ?1",
            [member_id],
        )?;
        conn.execute(
            "UPDATE members SET sync_status = 'local_only' WHERE id = ?1",
            [member_id],
        )?;
        Ok(removed as i64)
    })
}

/// Set hidden_locally = 1 for a member so they are hidden from the main list.
pub fn set_member_hidden_locally(state: &AppState, member_id: i64) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE members SET hidden_locally = 1 WHERE id = ?1",
            [member_id],
        )?;
        Ok(())
    })
}
