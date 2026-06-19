use crate::db::{AppState, DbError};
use crate::db::status::now_string;
use serde::{Deserialize, Serialize};

const TEST_NAMES: &[&str] = &["ddd", "dddd", "dfdfd", "주니어", "주니어 1", "온클"];
const TEST_PHONES: &[&str] = &["ddd", "ddff", "ㅎㅎㅎㅎ", "ㅈㅈㅈ", "939ㅇ"];

fn is_test_data(name: &str, phone: &Option<String>) -> bool {
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

// ---------------------------------------------------------------------------
// Dry-run types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeSyncMembershipCandidate {
    pub local_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub member_phone: Option<String>,
    pub member_center: String,
    pub member_remote_id: String,
    pub membership_type: String,
    pub pass_type: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub remaining_count: Option<i64>,
    pub total_count: Option<i64>,
    pub status: String,
    pub price: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeSyncAttendanceCandidate {
    pub local_id: i64,
    pub member_id: i64,
    pub membership_id: Option<i64>,
    pub member_name: String,
    pub member_center: String,
    pub member_remote_id: String,
    pub membership_remote_id: Option<String>,
    pub checkin_at: String,
    pub attendance_type: String,
    pub deducted_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeSyncMemberQueueItem {
    pub queue_id: i64,
    pub entity_local_id: i64,
    pub member_name: String,
    pub member_remote_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeSyncDryRun {
    pub generated_at: String,
    pub member_queue_resolve: Vec<SafeSyncMemberQueueItem>,
    pub membership_candidates: Vec<SafeSyncMembershipCandidate>,
    pub membership_blocked_test: usize,
    pub attendance_candidates_max: usize,
    pub attendance_blocked_test: usize,
    pub manual_review: usize,
}

// ---------------------------------------------------------------------------
// Dry-run: gather candidates
// ---------------------------------------------------------------------------

pub fn safe_sync_dry_run(state: &AppState) -> Result<SafeSyncDryRun, DbError> {
    state.with_conn(|conn| {
        // 1. Member queue resolve candidates
        let member_queue: Vec<SafeSyncMemberQueueItem> = {
            let mut stmt = conn.prepare(
                "SELECT sq.id, sq.entity_local_id, m.name, m.remote_id
                 FROM sync_queue sq
                 JOIN members m ON m.id = sq.entity_local_id
                 WHERE sq.entity_type = 'member'
                   AND (m.remote_id IS NOT NULL AND m.remote_id != '')
                   AND m.deleted_at IS NULL
                   AND NOT (sq.last_error IS NOT NULL AND sq.last_error LIKE 'RESOLVED%')"
            )?;
            let rows: Vec<(i64, i64, String, String)> = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
            rows.into_iter()
                .filter(|(_, _, name, _)| !is_test_data(name, &None))
                .map(|(qid, eid, name, rid)| SafeSyncMemberQueueItem {
                    queue_id: qid,
                    entity_local_id: eid,
                    member_name: name,
                    member_remote_id: rid,
                })
                .collect()
        };

        // 2. Membership candidates (no remote_id, member has remote_id, not test)
        let mut ms_candidates: Vec<SafeSyncMembershipCandidate> = Vec::new();
        let mut ms_blocked_test = 0usize;
        {
            let mut stmt = conn.prepare(
                "SELECT ms.id, ms.membership_type, ms.pass_type, ms.start_date, ms.end_date,
                        ms.remaining_count, ms.total_count, ms.status, ms.member_id, ms.price,
                        m.name, m.phone, m.center, m.remote_id, m.hidden_locally
                 FROM memberships ms
                 JOIN members m ON m.id = ms.member_id
                 WHERE (ms.remote_id IS NULL OR ms.remote_id = '')
                   AND (m.remote_id IS NOT NULL AND m.remote_id != '')
                   AND m.deleted_at IS NULL
                 ORDER BY m.center, m.name"
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    row.get::<_, i64>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(14)?.unwrap_or(0),
                ))
            })?
            .filter_map(|r| r.ok());

            for (id, ms_type, pass_type, start, end, remaining, total, status,
                 member_id, price, name, phone, center, remote_id, hidden) in rows
            {
                if is_test_data(&name, &phone) || hidden != 0 {
                    ms_blocked_test += 1;
                    continue;
                }
                ms_candidates.push(SafeSyncMembershipCandidate {
                    local_id: id,
                    member_id,
                    member_name: name,
                    member_phone: phone,
                    member_center: center,
                    member_remote_id: remote_id,
                    membership_type: ms_type,
                    pass_type,
                    start_date: start,
                    end_date: end,
                    remaining_count: remaining,
                    total_count: total,
                    status,
                    price,
                });
            }
        }

        // 3. Attendance: count candidates vs blocked
        let mut att_candidate_max = 0usize;
        let mut att_blocked_test = 0usize;
        {
            let mut stmt = conn.prepare(
                "SELECT al.id, m.name, m.phone, m.remote_id, ms.remote_id as ms_rid, m.hidden_locally
                 FROM attendance_logs al
                 JOIN members m ON m.id = al.member_id
                 LEFT JOIN memberships ms ON ms.id = al.membership_id
                 WHERE (al.remote_id IS NULL OR al.remote_id = '')
                   AND (m.remote_id IS NOT NULL AND m.remote_id != '')
                   AND m.deleted_at IS NULL"
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                ))
            })?
            .filter_map(|r| r.ok());

            for (name, phone, hidden) in rows {
                if is_test_data(&name, &phone) || hidden != 0 {
                    att_blocked_test += 1;
                } else {
                    att_candidate_max += 1;
                }
            }
        }

        // 4. Manual review count
        let manual_review: usize = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue sq
             LEFT JOIN members m ON sq.entity_type = 'member' AND m.id = sq.entity_local_id
             WHERE (m.remote_id IS NULL OR m.remote_id = '' OR m.id IS NULL)
               AND sq.entity_type = 'member'
               AND NOT (sq.last_error IS NOT NULL AND sq.last_error LIKE 'RESOLVED%')",
            [],
            |row| row.get::<_, usize>(0),
        ).unwrap_or(0);

        Ok(SafeSyncDryRun {
            generated_at: now_string(),
            member_queue_resolve: member_queue,
            membership_candidates: ms_candidates,
            membership_blocked_test: ms_blocked_test,
            attendance_candidates_max: att_candidate_max,
            attendance_blocked_test: att_blocked_test,
            manual_review,
        })
    })
}

// ---------------------------------------------------------------------------
// Resolve member queue items
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMemberQueueResult {
    pub resolved_count: usize,
    pub errors: Vec<String>,
}

pub fn resolve_member_queue_items(state: &AppState, queue_ids: &[i64]) -> Result<ResolveMemberQueueResult, DbError> {
    state.with_conn(|conn| {
        let mut resolved = 0usize;
        let mut errors = Vec::new();

        for &qid in queue_ids {
            let result = conn.execute(
                "UPDATE sync_queue SET last_error = 'RESOLVED: member remote_id already exists; upload no longer needed'
                 WHERE id = ?1 AND entity_type = 'member'",
                [qid],
            );
            match result {
                Ok(n) if n > 0 => resolved += 1,
                Ok(_) => errors.push(format!("queue_id={} not found or not member type", qid)),
                Err(e) => errors.push(format!("queue_id={}: {}", qid, e)),
            }
        }

        Ok(ResolveMemberQueueResult { resolved_count: resolved, errors })
    })
}

// ---------------------------------------------------------------------------
// Backfill membership remote_id
// ---------------------------------------------------------------------------

pub fn backfill_membership_remote_id(state: &AppState, local_id: i64, remote_id: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE memberships SET remote_id = ?1, sync_status = 'synced' WHERE id = ?2",
            rusqlite::params![remote_id, local_id],
        )?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Backfill attendance remote_id
// ---------------------------------------------------------------------------

pub fn backfill_attendance_remote_id(state: &AppState, local_id: i64, remote_id: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE attendance_logs SET remote_id = ?1, sync_status = 'synced' WHERE id = ?2",
            rusqlite::params![remote_id, local_id],
        )?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Get attendance candidates (called after membership processing)
// ---------------------------------------------------------------------------

pub fn get_attendance_candidates(state: &AppState) -> Result<Vec<SafeSyncAttendanceCandidate>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT al.id, al.member_id, al.membership_id, al.checkin_at, al.attendance_type, al.deducted_count,
                    m.name, m.phone, m.center, m.remote_id, m.hidden_locally,
                    ms.remote_id as ms_rid
             FROM attendance_logs al
             JOIN members m ON m.id = al.member_id
             LEFT JOIN memberships ms ON ms.id = al.membership_id
             WHERE (al.remote_id IS NULL OR al.remote_id = '')
               AND (m.remote_id IS NOT NULL AND m.remote_id != '')
               AND (ms.remote_id IS NOT NULL AND ms.remote_id != '')
               AND m.deleted_at IS NULL
             ORDER BY al.checkin_at"
        )?;

        let items: Vec<SafeSyncAttendanceCandidate> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                row.get::<_, Option<i64>>(10)?.unwrap_or(0),
                row.get::<_, Option<String>>(11)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .filter(|(_, _, _, _, _, _, name, phone, _, _, hidden, _)| {
            !is_test_data(name, phone) && *hidden == 0
        })
        .map(|(id, mid, msid, checkin, atype, ded, name, _, center, mrid, _, msrid)| {
            SafeSyncAttendanceCandidate {
                local_id: id,
                member_id: mid,
                membership_id: msid,
                member_name: name,
                member_center: center,
                member_remote_id: mrid,
                membership_remote_id: msrid,
                checkin_at: checkin,
                attendance_type: atype,
                deducted_count: ded,
            }
        })
        .collect();

        Ok(items)
    })
}

// ---------------------------------------------------------------------------
// Save result report JSON
// ---------------------------------------------------------------------------

pub fn save_safe_sync_report(state: &AppState, json: &str) -> Result<String, DbError> {
    let app_data_dir = state.db_path.parent()
        .ok_or_else(|| DbError::Message("앱 데이터 경로를 찾을 수 없습니다".to_string()))?;
    let path = app_data_dir.join("safe_membership_attendance_sync_result.json");

    std::fs::write(&path, json)
        .map_err(|e| DbError::Message(format!("리포트 저장 실패: {}", e)))?;

    let p = path.to_string_lossy().to_string();
    eprintln!("[safe_sync] report saved: {}", p);
    Ok(p)
}
