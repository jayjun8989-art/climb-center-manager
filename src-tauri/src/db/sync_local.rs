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
            "SELECT COUNT(*) FROM sync_queue",
            [],
            |row| row.get(0),
        )?;

        let failed_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE last_error IS NOT NULL",
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
