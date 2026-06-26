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

// ---------------------------------------------------------------------------
// Cleanup dry-run
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupDryRun {
    pub generated_at: String,
    pub resolvable_member_queue: usize,
    pub resolvable_attendance_queue: usize,
    pub test_members_to_hide: Vec<TestMemberToHide>,
    pub local_dup_members_to_hide: Vec<TestMemberToHide>,
    pub local_dup_memberships: usize,
    pub block_test_data: usize,
    pub manual_review: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestMemberToHide {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
}

pub fn cleanup_dry_run(state: &AppState) -> Result<CleanupDryRun, DbError> {
    state.with_conn(|conn| {
        // Resolvable member queue: entity_type=member, member has remote_id, not already resolved
        let resolvable_member: usize = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue sq
             JOIN members m ON m.id = sq.entity_local_id
             WHERE sq.entity_type = 'member'
               AND (m.remote_id IS NOT NULL AND m.remote_id != '')
               AND NOT (sq.last_error IS NOT NULL AND sq.last_error LIKE 'RESOLVED%')",
            [],
            |row| row.get::<_, usize>(0),
        )?;

        // Resolvable attendance queue: entity_type=attendance, attendance has remote_id
        let resolvable_att: usize = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue sq
             JOIN attendance_logs al ON al.id = sq.entity_local_id
             WHERE sq.entity_type = 'attendance'
               AND (al.remote_id IS NOT NULL AND al.remote_id != '')
               AND NOT (sq.last_error IS NOT NULL AND sq.last_error LIKE 'RESOLVED%')",
            [],
            |row| row.get::<_, usize>(0),
        )?;

        // Test members to hide
        let mut stmt = conn.prepare(
            "SELECT id, name, phone FROM members
             WHERE COALESCE(hidden_locally, 0) = 0
               AND deleted_at IS NULL
               AND (
                 (name = 'ddd' AND phone = 'ddd')
                 OR (name = 'dddd' AND phone = 'ddd')
                 OR (name = 'dfdfd' AND phone = 'ddff')
               )"
        )?;
        let test_members: Vec<TestMemberToHide> = stmt.query_map([], |row| {
            Ok(TestMemberToHide {
                id: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                phone: row.get(2)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        // Local-only duplicate members to hide (no remote_id, same name+center has remote_id)
        let mut dup_stmt = conn.prepare(
            "SELECT m.id, m.name, m.phone FROM members m
             WHERE m.deleted_at IS NULL
               AND COALESCE(m.hidden_locally, 0) = 0
               AND (m.remote_id IS NULL OR m.remote_id = '')
               AND EXISTS (
                 SELECT 1 FROM members m2
                 WHERE UPPER(m2.center) = UPPER(m.center) AND TRIM(m2.name) = TRIM(m.name)
                   AND m2.deleted_at IS NULL AND m2.id != m.id
                   AND m2.remote_id IS NOT NULL AND m2.remote_id != ''
               )"
        )?;
        let local_dup_members: Vec<TestMemberToHide> = dup_stmt.query_map([], |row| {
            Ok(TestMemberToHide {
                id: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                phone: row.get(2)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        // Local duplicate memberships (no remote_id, same member has membership with remote_id)
        let local_dup_ms: usize = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE (ms.remote_id IS NULL OR ms.remote_id = '')
               AND m.deleted_at IS NULL
               AND COALESCE(m.hidden_locally, 0) = 0
               AND EXISTS (
                 SELECT 1 FROM memberships ms2
                 WHERE ms2.member_id = ms.member_id AND ms2.id != ms.id
                   AND ms2.remote_id IS NOT NULL AND ms2.remote_id != ''
               )",
            [],
            |row| row.get::<_, usize>(0),
        )?;

        // BLOCK_TEST_DATA count
        let block_test: usize = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue sq
             JOIN members m ON m.id = sq.entity_local_id AND sq.entity_type = 'member'
             WHERE sq.last_error LIKE '%테스트%' OR sq.last_error LIKE '%차단%'",
            [],
            |row| row.get::<_, usize>(0),
        ).unwrap_or(0);

        // MANUAL_REVIEW count (member queue with no remote_id, not resolved, not test-blocked)
        let manual_review: usize = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue sq
             LEFT JOIN members m ON m.id = sq.entity_local_id AND sq.entity_type = 'member'
             WHERE sq.entity_type = 'member'
               AND (m.remote_id IS NULL OR m.remote_id = '')
               AND NOT (sq.last_error IS NOT NULL AND sq.last_error LIKE 'RESOLVED%')
               AND NOT (sq.last_error IS NOT NULL AND (sq.last_error LIKE '%테스트%' OR sq.last_error LIKE '%차단%'))",
            [],
            |row| row.get::<_, usize>(0),
        ).unwrap_or(0);

        Ok(CleanupDryRun {
            generated_at: now_string(),
            resolvable_member_queue: resolvable_member,
            resolvable_attendance_queue: resolvable_att,
            test_members_to_hide: test_members,
            local_dup_members_to_hide: local_dup_members,
            local_dup_memberships: local_dup_ms,
            block_test_data: block_test,
            manual_review,
        })
    })
}

// ---------------------------------------------------------------------------
// Execute cleanup
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub member_queue_resolved: usize,
    pub attendance_queue_resolved: usize,
    pub test_members_hidden: usize,
    pub local_dup_members_hidden: usize,
    pub local_dup_memberships_backfilled: usize,
    pub errors: Vec<String>,
}

pub fn execute_cleanup(state: &AppState) -> Result<CleanupResult, DbError> {
    state.with_conn(|conn| {
        let mut errors = Vec::new();

        // 1. Resolve member queue items where member already has remote_id
        let member_resolved = conn.execute(
            "UPDATE sync_queue SET last_error = 'RESOLVED: member remote_id already exists; upload no longer needed'
             WHERE entity_type = 'member'
               AND NOT (last_error IS NOT NULL AND last_error LIKE 'RESOLVED%')
               AND entity_local_id IN (
                 SELECT id FROM members WHERE remote_id IS NOT NULL AND remote_id != ''
               )",
            [],
        ).unwrap_or_else(|e| { errors.push(format!("member queue resolve: {}", e)); 0 });

        // 2. Resolve attendance queue items where attendance already has remote_id
        let att_resolved = conn.execute(
            "UPDATE sync_queue SET last_error = 'RESOLVED: attendance remote_id already exists; upload no longer needed'
             WHERE entity_type = 'attendance'
               AND NOT (last_error IS NOT NULL AND last_error LIKE 'RESOLVED%')
               AND entity_local_id IN (
                 SELECT id FROM attendance_logs WHERE remote_id IS NOT NULL AND remote_id != ''
               )",
            [],
        ).unwrap_or_else(|e| { errors.push(format!("attendance queue resolve: {}", e)); 0 });

        // 3. Hide test members
        let hidden = conn.execute(
            "UPDATE members SET hidden_locally = 1
             WHERE COALESCE(hidden_locally, 0) = 0
               AND deleted_at IS NULL
               AND (
                 (name = 'ddd' AND phone = 'ddd')
                 OR (name = 'dddd' AND phone = 'ddd')
                 OR (name = 'dfdfd' AND phone = 'ddff')
               )",
            [],
        ).unwrap_or_else(|e| { errors.push(format!("test member hide: {}", e)); 0 });

        // 4. Hide local-only duplicate members (no remote_id, same name+center has remote_id)
        let dup_hidden = conn.execute(
            "UPDATE members SET hidden_locally = 1
             WHERE COALESCE(hidden_locally, 0) = 0
               AND deleted_at IS NULL
               AND (remote_id IS NULL OR remote_id = '')
               AND EXISTS (
                 SELECT 1 FROM members m2
                 WHERE UPPER(m2.center) = UPPER(members.center) AND TRIM(m2.name) = TRIM(members.name)
                   AND m2.deleted_at IS NULL AND m2.id != members.id
                   AND m2.remote_id IS NOT NULL AND m2.remote_id != ''
               )",
            [],
        ).unwrap_or_else(|e| { errors.push(format!("local dup hide: {}", e)); 0 });

        // 5. Backfill local duplicate memberships — copy remote_id from matching membership
        let ms_backfilled = conn.execute(
            "UPDATE memberships SET
               remote_id = (
                 SELECT ms2.remote_id FROM memberships ms2
                 WHERE ms2.member_id = memberships.member_id AND ms2.id != memberships.id
                   AND ms2.remote_id IS NOT NULL AND ms2.remote_id != ''
                 ORDER BY ms2.id DESC LIMIT 1
               ),
               sync_status = 'synced'
             WHERE (remote_id IS NULL OR remote_id = '')
               AND member_id IN (
                 SELECT m.id FROM members m WHERE m.deleted_at IS NULL AND COALESCE(m.hidden_locally, 0) = 0
               )
               AND EXISTS (
                 SELECT 1 FROM memberships ms2
                 WHERE ms2.member_id = memberships.member_id AND ms2.id != memberships.id
                   AND ms2.remote_id IS NOT NULL AND ms2.remote_id != ''
               )",
            [],
        ).unwrap_or_else(|e| { errors.push(format!("membership backfill: {}", e)); 0 });

        // 6. Resolve sync_queue for hidden local-only members
        conn.execute(
            "UPDATE sync_queue SET last_error = 'RESOLVED: local duplicate hidden; server member exists'
             WHERE entity_type = 'member'
               AND NOT (last_error IS NOT NULL AND last_error LIKE 'RESOLVED%')
               AND entity_local_id IN (
                 SELECT id FROM members WHERE COALESCE(hidden_locally, 0) = 1
               )",
            [],
        ).ok();

        Ok(CleanupResult {
            member_queue_resolved: member_resolved,
            attendance_queue_resolved: att_resolved,
            test_members_hidden: hidden,
            local_dup_members_hidden: dup_hidden,
            local_dup_memberships_backfilled: ms_backfilled,
            errors,
        })
    })
}

pub fn save_cleanup_report(state: &AppState, json: &str) -> Result<String, DbError> {
    let app_data_dir = state.db_path.parent()
        .ok_or_else(|| DbError::Message("앱 데이터 경로를 찾을 수 없습니다".to_string()))?;
    let path = app_data_dir.join("cleanup_queue_result.json");
    std::fs::write(&path, json)
        .map_err(|e| DbError::Message(format!("리포트 저장 실패: {}", e)))?;
    Ok(path.to_string_lossy().to_string())
}

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
