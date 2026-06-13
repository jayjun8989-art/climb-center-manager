use crate::db::ops::refresh_all_statuses;
use crate::db::status::{normalize_local_member_type, now_string};
use crate::db::{AppState, DbError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

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
    pub total_count: Option<i32>,
    pub used_count: i32,
    pub remaining_count: Option<i32>,
    pub status: String,
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
pub struct PullImportResult {
    pub imported_members: i64,
    pub imported_memberships: i64,
    pub imported_attendance: i64,
    pub imported_lockers: i64,
    pub updated_members: i64,
    pub skipped: i64,
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
    normalize_phone(phone).map(|value| value.replace(|c: char| !c.is_ascii_digit(), ""))
}

fn find_local_member_id(conn: &rusqlite::Connection, remote_id: &str) -> Result<Option<i64>, DbError> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM members WHERE remote_id = ?1",
            [remote_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(DbError::from)?
    {
        return Ok(Some(id));
    }

    // Fallback: the id_map may already have this remote_id mapped to a local
    // member row whose `members.remote_id` column wasn't backfilled (e.g. rows
    // created before the remote_id column existed). Without this fallback,
    // repeated pulls would insert a brand-new duplicate member row every time.
    conn.query_row(
        "SELECT local_id FROM id_map WHERE entity_type = 'member' AND remote_id = ?1",
        [remote_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(DbError::from)
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
) -> Result<(i64, bool), DbError> {
    let member_type = normalize_local_member_type(&row.member_type);
    let phone = normalize_phone(&row.phone);
    let phone_norm = phone_normalized(&row.phone);

    if let Some(local_id) = find_local_member_id(conn, &row.remote_id)? {
        conn.execute(
            "UPDATE members SET
                name = ?1, phone = ?2, phone_normalized = ?3, member_type = ?4, center = ?5,
                parent_name = ?6, parent_phone = ?7, memo = ?8, address = ?9, status = ?10,
                updated_at = ?11, sync_status = 'synced', remote_updated_at = ?11
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
                row.status,
                row.updated_at,
                local_id,
            ],
        )?;
        conn.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            params![local_id, row.remote_id],
        )?;
        return Ok((local_id, false));
    }

    conn.execute(
        "INSERT INTO members (
            name, phone, phone_normalized, member_type, center, parent_name, parent_phone,
            memo, address, status, created_at, updated_at, deleted_at,
            remote_id, sync_status, remote_updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, 'synced', ?12)",
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
            row.status,
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
    Ok((local_id, true))
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

    state.with_conn(|conn| {
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
            let (local_id, inserted) = upsert_member(&tx, row).map_err(|error| {
                DbError::Message(format!("members 저장 실패 ({}/{}): {}", row.remote_id, row.name, error))
            })?;
            member_ids.insert(row.remote_id.clone(), local_id);
            if inserted {
                imported_members += 1;
            } else {
                updated_members += 1;
            }
        }

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
            let (local_id, inserted) = upsert_membership(&tx, row, member_local_id).map_err(|error| {
                DbError::Message(format!(
                    "memberships 저장 실패 ({}): {}",
                    row.remote_id, error
                ))
            })?;
            membership_ids.insert(row.remote_id.clone(), local_id);
            if inserted {
                imported_memberships += 1;
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
        Ok(())
    })?;

    Ok(PullImportResult {
        imported_members,
        imported_memberships,
        imported_attendance,
        imported_lockers,
        updated_members,
        skipped,
    })
}
