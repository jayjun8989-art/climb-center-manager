use crate::db::ops::refresh_all_statuses;
use crate::db::status::{normalize_local_member_type, now_string};
use crate::db::{AppState, DbError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Deserializer, Serialize};

// Flexible deserializers: accept both JSON numbers and numeric strings.
// Supabase (or the JS runtime) sometimes serialises numeric columns as strings.

fn deser_opt_i64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    match v {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64()),
        Some(serde_json::Value::String(s)) if s.is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s.parse::<i64>().map(Some).map_err(serde::de::Error::custom),
        Some(other) => Err(serde::de::Error::custom(format!("expected i64 or numeric string, got {other}"))),
    }
}

fn deser_i32<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    let v: serde_json::Value = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Number(n) => n.as_i64().map(|x| x as i32).ok_or_else(|| serde::de::Error::custom("number out of i32 range")),
        serde_json::Value::String(s) if s.is_empty() => Ok(0),
        serde_json::Value::String(s) => s.parse::<i32>().map_err(serde::de::Error::custom),
        serde_json::Value::Null => Ok(0),
        other => Err(serde::de::Error::custom(format!("expected i32 or numeric string, got {other}"))),
    }
}

fn deser_opt_i32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i32>, D::Error> {
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    match v {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64().map(|x| x as i32)),
        Some(serde_json::Value::String(s)) if s.is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s.parse::<i32>().map(Some).map_err(serde::de::Error::custom),
        Some(other) => Err(serde::de::Error::custom(format!("expected i32 or numeric string, got {other}"))),
    }
}

fn deser_opt_f64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    match v {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => Ok(n.as_f64()),
        Some(serde_json::Value::String(s)) if s.is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s.parse::<f64>().map(Some).map_err(serde::de::Error::custom),
        Some(other) => Err(serde::de::Error::custom(format!("expected f64 or numeric string, got {other}"))),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullMemberRow {
    #[serde(alias = "remote_id")]
    pub remote_id: String,
    pub center: String,
    pub name: String,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub member_type: String,
    pub parent_name: Option<String>,
    pub parent_phone: Option<String>,
    pub memo: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, deserialize_with = "deser_opt_i64")]
    pub member_no: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullMembershipRow {
    #[serde(alias = "remote_id")]
    pub remote_id: String,
    #[serde(alias = "member_remote_id")]
    pub member_remote_id: String,
    pub membership_type: String,
    pub pass_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(default, deserialize_with = "deser_opt_i32")]
    pub total_count: Option<i32>,
    #[serde(deserialize_with = "deser_i32")]
    pub used_count: i32,
    #[serde(default, deserialize_with = "deser_opt_i32")]
    pub remaining_count: Option<i32>,
    pub status: String,
    #[serde(default, deserialize_with = "deser_opt_f64")]
    pub price: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullAttendanceRow {
    #[serde(alias = "remote_id")]
    pub remote_id: String,
    #[serde(alias = "member_remote_id")]
    pub member_remote_id: String,
    #[serde(alias = "membership_remote_id")]
    pub membership_remote_id: String,
    pub center: String,
    pub checkin_at: String,
    pub attendance_type: String,
    #[serde(deserialize_with = "deser_i32")]
    pub deducted_count: i32,
    pub memo: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullLockerRow {
    #[serde(alias = "member_remote_id")]
    pub member_remote_id: String,
    pub center: String,
    pub locker_number: String,
    pub locker_start_date: Option<String>,
    pub locker_end_date: Option<String>,
    pub locker_memo: Option<String>,
    pub locker_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullSnapshot {
    pub members: Vec<PullMemberRow>,
    pub memberships: Vec<PullMembershipRow>,
    #[serde(alias = "attendance_logs")]
    pub attendance_logs: Vec<PullAttendanceRow>,
    pub lockers: Vec<PullLockerRow>,
}

fn has_remote_id(value: &str) -> bool {
    !value.trim().is_empty()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullMissingMemberSample {
    pub remote_id: String,
    pub name: String,
    pub member_no: Option<i64>,
    pub phone: Option<String>,
    pub phone_normalized_val: Option<String>,
    pub center: String,
    pub status: String,
    pub is_test_data: bool,
    pub fail_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullImportResult {
    pub imported_members: i64,
    pub imported_memberships: i64,
    pub imported_attendance: i64,
    pub imported_lockers: i64,
    pub updated_members: i64,
    pub skipped: i64,
    pub failed_members: i64,
    pub failed_memberships: i64,
    pub first_error: Option<String>,
    // Diagnostics — populated after commit
    pub server_total: i64,
    pub local_total_after: i64,
    pub local_with_remote_id: i64,
    pub missing_remote_id_count: i64,
    pub missing_remote_id_sample: Vec<PullMissingMemberSample>,
    pub conflict_count: i64,
    pub diag_file_path: Option<String>,
}

/// Backfill members.remote_id from id_map for rows where remote_id is NULL.
/// Called automatically after every pull to repair rows that slipped through
/// the UPDATE path without getting their remote_id written to the members column.
/// Returns (backfilled_count, conflict_count).
pub fn backfill_member_remote_ids_from_id_map(state: &AppState) -> Result<(i64, i64), DbError> {
    state.with_conn(|conn| {
        let tx = conn.transaction()?;

        // Find members whose remote_id is NULL but id_map has a mapping
        let rows: Vec<(i64, String)> = {
            let mut stmt = tx.prepare(
                "SELECT m.id, i.remote_id
                 FROM members m
                 JOIN id_map i ON i.entity_type = 'member' AND i.local_id = m.id
                 WHERE m.deleted_at IS NULL
                   AND (m.remote_id IS NULL OR m.remote_id = '')
                   AND i.remote_id IS NOT NULL AND i.remote_id != ''",
            )?;
            let collected: Vec<(i64, String)> = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            collected
        };

        let mut backfilled: i64 = 0;
        let mut conflicts: i64 = 0;

        for (local_id, remote_id) in &rows {
            // Double-check that members.remote_id is still NULL (race-free inside tx)
            let current: Option<String> = tx
                .query_row(
                    "SELECT remote_id FROM members WHERE id = ?1",
                    [local_id],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();

            if current.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
                // Was filled between our SELECT and this point — skip
                conflicts += 1;
                continue;
            }

            tx.execute(
                "UPDATE members SET remote_id = ?1, sync_status = 'synced' WHERE id = ?2",
                params![remote_id, local_id],
            )?;

            // Mark pending member insert/update queue items as resolved (remote_id now set).
            // Use UPDATE not DELETE so records are preserved for audit.
            tx.execute(
                "UPDATE sync_queue SET last_error = 'RESOLVED: remote_id 복구됨 — 재시도 불필요',
                    retry_count = 0
                 WHERE entity_type = 'member' AND entity_local_id = ?1
                   AND operation IN ('insert', 'update')
                   AND (last_error IS NULL OR last_error NOT LIKE 'RESOLVED:%')",
                [local_id],
            )?;

            // Unblock attendance items that were waiting for this member's remote_id
            tx.execute(
                "UPDATE sync_queue SET last_error = NULL, retry_count = 0
                 WHERE entity_type = 'attendance' AND last_error IS NOT NULL
                   AND json_extract(payload_json, '$.local_member_id') = ?1",
                [local_id],
            )?;

            eprintln!(
                "[backfill] local_id={} remote_id={} — remote_id restored from id_map",
                local_id, remote_id
            );
            backfilled += 1;
        }

        tx.commit()?;
        eprintln!(
            "[backfill] complete: backfilled={} conflicts={}",
            backfilled, conflicts
        );
        Ok((backfilled, conflicts))
    })
}

/// Normalise member status from server to a value accepted by the local CHECK constraint.
/// Server may send values like "trial", "left", "quit" that are not in the allowed list.
fn normalize_member_status(status: &str) -> &str {
    match status {
        "active" | "paused" | "expired" | "inactive" => status,
        _ => "inactive",
    }
}

pub fn count_active_members(state: &AppState) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(DbError::from)
    })
}

fn normalize_phone(phone: &Option<String>) -> Option<String> {
    phone
        .as_ref()
        .map(|value| value.replace([' ', '-'], "").trim().to_string())
        .filter(|value| !value.is_empty())
}

fn phone_normalized(phone: &Option<String>) -> Option<String> {
    normalize_phone(phone)
        .map(|value| value.replace(|c: char| !c.is_ascii_digit(), ""))
        .filter(|value| value.len() >= 7) // non-numeric / placeholder phones → None
}

fn is_test_data_member(name: &str, phone: &Option<String>) -> bool {
    const TEST_NAMES: &[&str] = &["ddd", "dddd", "dfdfd", "주니어", "주니어 1"];
    const TEST_PHONES: &[&str] = &["ddd", "ddff", "ㅎㅎㅎㅎ", "ㅈㅈㅈ"];
    if TEST_NAMES.iter().any(|&n| n == name.trim()) {
        return true;
    }
    if let Some(p) = phone {
        if TEST_PHONES.iter().any(|&tp| tp == p.trim()) {
            return true;
        }
    }
    false
}

fn find_local_member_id(
    conn: &rusqlite::Connection,
    row: &PullMemberRow,
) -> Result<Option<i64>, DbError> {
    let remote_id = &row.remote_id;

    // Priority 1: remote_id exact match
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM members WHERE remote_id = ?1",
            [remote_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(DbError::from)?
    {
        return Ok(Some(id));
    }

    // Priority 2: id_map lookup (covers rows whose members.remote_id wasn't backfilled)
    if let Some(id) = conn
        .query_row(
            "SELECT local_id FROM id_map WHERE entity_type = 'member' AND remote_id = ?1",
            [remote_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(DbError::from)?
    {
        return Ok(Some(id));
    }

    // Priority 3: center + member_no — only when unique AND only pre-existing local rows
    // (remote_id IS NULL check prevents matching rows already inserted in this same pull)
    if let Some(member_no) = row.member_no {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM members
                 WHERE center = ?1 AND member_no = ?2 AND deleted_at IS NULL
                   AND (remote_id IS NULL OR remote_id = '')",
                params![row.center, member_no],
                |r| r.get(0),
            )
            .map_err(DbError::from)?;
        if count == 1 {
            if let Some(id) = conn
                .query_row(
                    "SELECT id FROM members
                     WHERE center = ?1 AND member_no = ?2 AND deleted_at IS NULL
                       AND (remote_id IS NULL OR remote_id = '')",
                    params![row.center, member_no],
                    |r| r.get(0),
                )
                .optional()
                .map_err(DbError::from)?
            {
                return Ok(Some(id));
            }
        }
    }

    // Priority 4: center + phone_normalized — only when ≥7 digits AND unique AND pre-existing.
    // phone_normalized() already filters out non-numeric / short strings.
    // remote_id IS NULL check prevents within-pull collapse (same phone → same row).
    if let Some(phone_norm) = phone_normalized(&row.phone) {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM members
                 WHERE center = ?1 AND phone_normalized = ?2 AND deleted_at IS NULL
                   AND (remote_id IS NULL OR remote_id = '')",
                params![row.center, phone_norm],
                |r| r.get(0),
            )
            .map_err(DbError::from)?;
        if count == 1 {
            if let Some(id) = conn
                .query_row(
                    "SELECT id FROM members
                     WHERE center = ?1 AND phone_normalized = ?2 AND deleted_at IS NULL
                       AND (remote_id IS NULL OR remote_id = '')",
                    params![row.center, phone_norm],
                    |r| r.get(0),
                )
                .optional()
                .map_err(DbError::from)?
            {
                return Ok(Some(id));
            }
        }
    }

    // Priority 5: INSERT — no name-only fallback (too loose, causes collapse)
    Ok(None)
}

fn find_local_membership_id(
    conn: &rusqlite::Connection,
    remote_id: &str,
) -> Result<Option<i64>, DbError> {
    conn.query_row(
        "SELECT id FROM memberships WHERE remote_id = ?1",
        [remote_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(DbError::from)
}

fn upsert_member(
    conn: &rusqlite::Connection,
    row: &PullMemberRow,
) -> Result<(i64, bool, bool, Option<String>), DbError> { // (local_id, inserted, had_conflict, conflict_existing_remote_id)
    let member_type = normalize_local_member_type(&row.member_type);
    let status = normalize_member_status(&row.status);
    let phone = normalize_phone(&row.phone);
    let phone_norm = phone_normalized(&row.phone);

    if let Some(local_id) = find_local_member_id(conn, row)? {
        // Check existing remote_id to detect conflicts before overwriting
        let existing_remote_id: Option<String> = conn
            .query_row(
                "SELECT remote_id FROM members WHERE id = ?1",
                [local_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(DbError::from)?
            .flatten();

        let has_conflict = existing_remote_id
            .as_deref()
            .map(|s| !s.is_empty() && s != row.remote_id.as_str())
            .unwrap_or(false);

        if has_conflict {
            eprintln!(
                "[pull_import] remote_id conflict: local_id={} name={} existing={} incoming={} — keeping existing",
                local_id, row.name,
                existing_remote_id.as_deref().unwrap_or(""),
                row.remote_id
            );
        }

        conn.execute(
            "UPDATE members SET
                name = ?1, phone = ?2, phone_normalized = ?3, member_type = ?4, center = ?5,
                parent_name = ?6, parent_phone = ?7, memo = ?8, address = ?9, status = ?10,
                member_no = COALESCE(member_no, ?13),
                updated_at = ?11, sync_status = 'synced', remote_updated_at = ?11,
                hidden_locally = 0, is_local_duplicate = 0,
                remote_id = CASE WHEN (remote_id IS NULL OR remote_id = '') THEN ?14 ELSE remote_id END
             WHERE id = ?12",
            params![
                row.name.trim(),
                phone,
                phone_norm,
                member_type,
                row.center,
                row.parent_name,
                row.parent_phone,
                row.memo,
                row.address,
                status,
                row.updated_at,
                local_id,
                row.member_no,
                row.remote_id,
            ],
        )?;
        conn.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            params![local_id, row.remote_id],
        )?;
        if is_test_data_member(row.name.trim(), &row.phone) {
            conn.execute(
                "UPDATE members SET hidden_locally = 1 WHERE id = ?1",
                [local_id],
            )?;
        }
        let conflict_remote_id = if has_conflict { existing_remote_id.clone() } else { None };
        return Ok((local_id, false, has_conflict, conflict_remote_id));
    }

    conn.execute(
        "INSERT INTO members (
            name, phone, phone_normalized, member_type, center, parent_name, parent_phone,
            memo, address, member_no, status, created_at, updated_at, deleted_at,
            remote_id, sync_status, remote_updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14, 'synced', ?13)",
        params![
            row.name.trim(),
            phone,
            phone_norm,
            member_type,
            row.center,
            row.parent_name,
            row.parent_phone,
            row.memo,
            row.address,
            row.member_no,
            status,
            row.created_at,
            row.updated_at,
            row.remote_id,
        ],
    )?;
    let local_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
         ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
        params![local_id, row.remote_id],
    )?;
    if is_test_data_member(row.name.trim(), &row.phone) {
        conn.execute(
            "UPDATE members SET hidden_locally = 1 WHERE id = ?1",
            [local_id],
        )?;
    }
    Ok((local_id, true, false, None))
}

fn upsert_membership(
    conn: &rusqlite::Connection,
    row: &PullMembershipRow,
    member_local_id: i64,
) -> Result<(i64, bool), DbError> {
    if let Some(local_id) = find_local_membership_id(conn, &row.remote_id)? {
        conn.execute(
            "UPDATE memberships SET
                member_id = ?1, membership_type = ?2, pass_type = ?3, start_date = ?4, end_date = ?5,
                total_count = ?6, used_count = ?7, remaining_count = ?8, status = ?9, price = ?10,
                updated_at = ?11, remote_id = ?12, sync_status = 'synced', remote_updated_at = ?11
             WHERE id = ?13",
            params![
                member_local_id,
                row.membership_type,
                row.pass_type,
                row.start_date,
                row.end_date,
                row.total_count,
                row.used_count,
                row.remaining_count,
                row.status,
                row.price,
                row.updated_at,
                row.remote_id,
                local_id,
            ],
        )?;
        conn.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('membership', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            params![local_id, row.remote_id],
        )?;
        return Ok((local_id, false));
    }

    conn.execute(
        "INSERT INTO memberships (
            member_id, membership_type, pass_type, start_date, end_date,
            total_count, used_count, remaining_count, status, price, created_at, updated_at,
            remote_id, sync_status, remote_updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'synced', ?12)",
        params![
            member_local_id,
            row.membership_type,
            row.pass_type,
            row.start_date,
            row.end_date,
            row.total_count,
            row.used_count,
            row.remaining_count,
            row.status,
            row.price,
            row.created_at,
            row.updated_at,
            row.remote_id,
        ],
    )?;
    let local_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('membership', ?1, ?2)
         ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
        params![local_id, row.remote_id],
    )?;
    Ok((local_id, true))
}

pub fn import_pull_snapshot(state: &AppState, snapshot: PullSnapshot) -> Result<PullImportResult, DbError> {
    let mut imported_members = 0_i64;
    let mut updated_members = 0_i64;
    let mut imported_memberships = 0_i64;
    let mut imported_attendance = 0_i64;
    let mut imported_lockers = 0_i64;
    let mut skipped = 0_i64;
    let mut failed_members = 0_i64;
    let mut failed_memberships = 0_i64;
    let mut conflict_count = 0_i64;
    let mut first_error: Option<String> = None;
    let mut local_total_after = 0_i64;
    let mut local_with_remote_id = 0_i64;
    let mut local_remote_id_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut failure_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let server_total = snapshot.members.len() as i64;

    state.with_conn(|conn| {
        // ensure_local_schema adds phone_normalized and other missing columns
        // before any upsert is attempted — this is the fix for 0-member upsert.
        crate::db::ensure_local_schema(conn).map_err(DbError::from)?;

        let tx = conn.transaction()?;

        let mut member_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        let mut membership_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

        for row in &snapshot.members {
            if !has_remote_id(&row.remote_id) {
                eprintln!(
                    "[pull_import] skip members row: missing remoteId (name={})",
                    row.name
                );
                skipped += 1;
                continue;
            }
            match upsert_member(&tx, row) {
                Ok((local_id, inserted, had_conflict, conflict_existing)) => {
                    member_ids.insert(row.remote_id.clone(), local_id);
                    if inserted {
                        imported_members += 1;
                    } else {
                        updated_members += 1;
                    }
                    if had_conflict {
                        conflict_count += 1;
                        // Record conflict so it appears as fail_reason in missing sample
                        failure_map.entry(row.remote_id.clone()).or_insert_with(|| {
                            format!(
                                "CONFLICT: local_id={} already bound to remote_id={} — incoming remote_id not written to members",
                                local_id,
                                conflict_existing.as_deref().unwrap_or("?")
                            )
                        });
                    }
                }
                Err(error) => {
                    let err_str = error.to_string();
                    let msg = format!(
                        "members 저장 실패 (remote_id={} name={} center={} status={}): {}",
                        row.remote_id, row.name, row.center, row.status, err_str
                    );
                    eprintln!("[pull_import] {}", msg);
                    failure_map.insert(row.remote_id.clone(), err_str);
                    if first_error.is_none() {
                        first_error = Some(msg);
                    }
                    failed_members += 1;
                }
            }
        }

        eprintln!(
            "[pull_import] members: imported={} updated={} failed={} skipped={} conflicts={}",
            imported_members, updated_members, failed_members, skipped, conflict_count
        );

        for row in &snapshot.memberships {
            if !has_remote_id(&row.remote_id) {
                eprintln!("[pull_import] skip memberships row: missing remoteId");
                skipped += 1;
                continue;
            }
            if !has_remote_id(&row.member_remote_id) {
                eprintln!(
                    "[pull_import] skip memberships row: missing memberRemoteId (remoteId={})",
                    row.remote_id
                );
                skipped += 1;
                continue;
            }
            let Some(member_local_id) = member_ids.get(&row.member_remote_id).copied() else {
                eprintln!(
                    "[pull_import] skip memberships row: unknown memberRemoteId={} (remoteId={})",
                    row.member_remote_id, row.remote_id
                );
                skipped += 1;
                continue;
            };
            match upsert_membership(&tx, row, member_local_id) {
                Ok((local_id, inserted)) => {
                    membership_ids.insert(row.remote_id.clone(), local_id);
                    if inserted {
                        imported_memberships += 1;
                    }
                }
                Err(error) => {
                    let msg = format!(
                        "memberships 저장 실패 (remote_id={}): {}",
                        row.remote_id, error
                    );
                    eprintln!("[pull_import] {}", msg);
                    if first_error.is_none() {
                        first_error = Some(msg);
                    }
                    failed_memberships += 1;
                }
            }
        }

        for row in &snapshot.attendance_logs {
            if !has_remote_id(&row.remote_id) {
                eprintln!("[pull_import] skip attendance_logs row: missing remoteId");
                skipped += 1;
                continue;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM attendance_logs WHERE remote_id = ?1",
                    [&row.remote_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if exists {
                skipped += 1;
                continue;
            }

            let Some(member_local_id) = member_ids.get(&row.member_remote_id).copied() else {
                eprintln!(
                    "[pull_import] skip attendance_logs row: unknown memberRemoteId={} (remoteId={})",
                    row.member_remote_id, row.remote_id
                );
                skipped += 1;
                continue;
            };
            let Some(membership_local_id) = membership_ids.get(&row.membership_remote_id).copied() else {
                eprintln!(
                    "[pull_import] skip attendance_logs row: unknown membershipRemoteId={} (remoteId={})",
                    row.membership_remote_id, row.remote_id
                );
                skipped += 1;
                continue;
            };

            tx.execute(
                "INSERT INTO attendance_logs (
                    member_id, membership_id, center, checkin_at, attendance_type,
                    deducted_count, memo, created_at, remote_id, sync_status, remote_updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'synced', ?8)",
                params![
                    member_local_id,
                    membership_local_id,
                    row.center,
                    row.checkin_at,
                    row.attendance_type,
                    row.deducted_count,
                    row.memo,
                    row.created_at,
                    row.remote_id,
                ],
            )?;
            imported_attendance += 1;
        }

        for row in &snapshot.lockers {
            if !has_remote_id(&row.member_remote_id) {
                eprintln!("[pull_import] skip lockers row: missing memberRemoteId");
                skipped += 1;
                continue;
            }
            let Some(member_local_id) = member_ids.get(&row.member_remote_id).copied() else {
                eprintln!(
                    "[pull_import] skip lockers row: unknown memberRemoteId={}",
                    row.member_remote_id
                );
                skipped += 1;
                continue;
            };
            if tx
                .execute(
                    "UPDATE members SET
                    locker_number = ?1, locker_status = ?2, locker_start_date = ?3,
                    locker_end_date = ?4, locker_memo = ?5, updated_at = ?6
                 WHERE id = ?7",
                    params![
                        row.locker_number,
                        row.locker_status,
                        row.locker_start_date,
                        row.locker_end_date,
                        row.locker_memo,
                        now_string(),
                        member_local_id,
                    ],
                )
                .is_err()
            {
                eprintln!(
                    "[pull_import] lockers UPDATE skipped for member {}",
                    row.member_remote_id
                );
                skipped += 1;
                continue;
            }
            imported_lockers += 1;
        }

        tx.commit()?;
        refresh_all_statuses(conn)?;

        // Post-commit diagnostics (run after commit so counts reflect committed state)
        local_total_after = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL",
            [], |r| r.get(0),
        ).unwrap_or(0);
        local_with_remote_id = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE deleted_at IS NULL AND remote_id IS NOT NULL AND remote_id != ''",
            [], |r| r.get(0),
        ).unwrap_or(0);

        if let Ok(mut stmt) = conn.prepare(
            "SELECT remote_id FROM members WHERE deleted_at IS NULL AND remote_id IS NOT NULL AND remote_id != ''"
        ) {
            if let Ok(iter) = stmt.query_map([], |r| r.get::<_, String>(0)) {
                iter.filter_map(|r| r.ok()).for_each(|id| { local_remote_id_set.insert(id); });
            }
        }

        Ok(())
    })?;

    // After transaction commits, backfill any members whose remote_id is still NULL
    // but whose id_map entry was just written (covers the UPDATE fallback path).
    let (backfilled, _) = backfill_member_remote_ids_from_id_map(state)
        .unwrap_or_else(|e| { eprintln!("[pull_import] backfill failed: {}", e); (0, 0) });

    eprintln!("[pull_import] post-pull backfill: {}", backfilled);

    // Compute missing remote_ids (server rows not found in local DB)
    let missing_rows: Vec<&PullMemberRow> = snapshot.members.iter()
        .filter(|m| !local_remote_id_set.contains(&m.remote_id))
        .collect();
    let missing_remote_id_count = missing_rows.len() as i64;
    let missing_remote_id_sample: Vec<PullMissingMemberSample> = missing_rows.iter()
        .take(50)
        .map(|m| PullMissingMemberSample {
            remote_id: m.remote_id.clone(),
            name: m.name.clone(),
            member_no: m.member_no,
            phone: m.phone.clone(),
            phone_normalized_val: phone_normalized(&m.phone),
            center: m.center.clone(),
            status: m.status.clone(),
            is_test_data: is_test_data_member(m.name.trim(), &m.phone),
            fail_reason: failure_map.get(&m.remote_id).cloned(),
        })
        .collect();

    // Log each missing member for server-side debugging
    for s in &missing_remote_id_sample {
        eprintln!(
            "[pull_import] missing: remote_id={} name={} center={} status={} phone={:?} norm={:?} test={} fail={:?}",
            s.remote_id, s.name, s.center, s.status,
            s.phone, s.phone_normalized_val, s.is_test_data, s.fail_reason
        );
    }

    eprintln!(
        "[pull_import] diagnostics: server={} local_after={} local_with_remote_id={} missing={} conflicts={}",
        server_total, local_total_after, local_with_remote_id, missing_remote_id_count, conflict_count
    );

    // Save diagnostic JSON to AppData for inspection when UI is insufficient
    let diag_file_path = save_diag_json(
        state,
        server_total,
        local_total_after,
        local_with_remote_id,
        missing_remote_id_count,
        &missing_remote_id_sample,
    );

    Ok(PullImportResult {
        imported_members,
        imported_memberships,
        imported_attendance,
        imported_lockers,
        updated_members,
        skipped,
        failed_members,
        failed_memberships,
        first_error,
        server_total,
        local_total_after,
        local_with_remote_id,
        missing_remote_id_count,
        missing_remote_id_sample,
        conflict_count,
        diag_file_path,
    })
}

fn save_diag_json(
    state: &AppState,
    server_total: i64,
    local_total: i64,
    local_with_remote_id: i64,
    missing_count: i64,
    missing_members: &[PullMissingMemberSample],
) -> Option<String> {
    let app_data_dir = state.db_path.parent()?;
    let path = app_data_dir.join("last_pull_missing_members.json");

    let payload = serde_json::json!({
        "serverTotal": server_total,
        "localTotal": local_total,
        "localWithRemoteId": local_with_remote_id,
        "missingRemoteIdCount": missing_count,
        "missingMembers": missing_members
            .iter()
            .map(|m| serde_json::json!({
                "remoteId": m.remote_id,
                "name": m.name,
                "memberNo": m.member_no,
                "phone": m.phone,
                "phoneNormalizedVal": m.phone_normalized_val,
                "center": m.center,
                "status": m.status,
                "isTestData": m.is_test_data,
                "failReason": m.fail_reason,
            }))
            .collect::<Vec<_>>()
    });

    match std::fs::write(&path, serde_json::to_string_pretty(&payload).unwrap_or_default()) {
        Ok(_) => {
            let p = path.to_string_lossy().to_string();
            eprintln!("[pull_import] diag JSON saved: {}", p);
            Some(p)
        }
        Err(e) => {
            eprintln!("[pull_import] diag JSON save failed: {}", e);
            None
        }
    }
}
