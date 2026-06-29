use crate::db::{AppState, DbError};
use crate::db::status::now_string;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::test_data::is_test_data;

fn has_remote_id(v: &Option<String>) -> bool {
    v.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Membership item
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagMembershipItem {
    pub local_id: i64,
    pub membership_type: String,
    pub pass_type: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub remaining_count: Option<i64>,
    pub status: String,
    pub member_id: i64,
    pub member_name: String,
    pub member_phone: Option<String>,
    pub member_no: Option<i64>,
    pub member_center: String,
    pub member_remote_id: Option<String>,
    pub member_hidden_locally: bool,
    pub member_deleted_at: Option<String>,
    pub is_test_data: bool,
    /// "SAFE_UPLOAD_CANDIDATE" | "BLOCK_TEST_DATA" | "BLOCK_MEMBER_UNLINKED" | "MANUAL_REVIEW"
    pub classification: String,
    pub classification_reason: String,
}

// ---------------------------------------------------------------------------
// Attendance item
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagAttendanceItem {
    pub local_id: i64,
    pub checkin_at: String,
    pub attendance_type: String,
    pub deducted_count: i64,
    pub member_id: i64,
    pub member_name: String,
    pub member_phone: Option<String>,
    pub member_center: String,
    pub member_remote_id: Option<String>,
    pub membership_id: Option<i64>,
    pub membership_remote_id: Option<String>,
    pub membership_type: Option<String>,
    pub is_test_data: bool,
    /// "SAFE_UPLOAD_CANDIDATE" | "WAIT_MEMBERSHIP_REMOTE_ID" | "BLOCK_TEST_DATA" | "BLOCK_MEMBER_UNLINKED" | "MANUAL_REVIEW"
    pub classification: String,
    pub classification_reason: String,
}

// ---------------------------------------------------------------------------
// Sync queue item
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagSyncQueueItem {
    pub id: i64,
    pub entity_type: String,
    pub operation: String,
    pub entity_local_id: i64,
    pub retry_count: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub member_name: Option<String>,
    pub member_remote_id: Option<String>,
    pub membership_remote_id: Option<String>,
    pub is_test_data: bool,
    /// "RESOLVABLE_MEMBER_QUEUE" | "DUPLICATE_OR_SERVER_EXISTS"
    /// | "MEMBERSHIP_UPLOAD_CANDIDATE" | "ATTENDANCE_UPLOAD_CANDIDATE"
    /// | "BLOCK_TEST_DATA" | "ALREADY_RESOLVED" | "MANUAL_REVIEW"
    pub classification: String,
    pub classification_reason: String,
}

// ---------------------------------------------------------------------------
// Report wrapper types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagSection<T> {
    pub total: usize,
    pub summary: HashMap<String, usize>,
    pub items: Vec<T>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub generated_at: String,
    pub memberships_no_remote_id: DiagSection<DiagMembershipItem>,
    pub attendance_no_remote_id: DiagSection<DiagAttendanceItem>,
    pub sync_queue: DiagSection<DiagSyncQueueItem>,
    pub diag_file_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

pub fn run_diagnostic(state: &AppState) -> Result<DiagnosticReport, DbError> {
    let memberships = diagnose_memberships(state)?;
    let attendance = diagnose_attendance(state)?;
    let queue = diagnose_sync_queue(state)?;

    let mut report = DiagnosticReport {
        generated_at: now_string(),
        memberships_no_remote_id: memberships,
        attendance_no_remote_id: attendance,
        sync_queue: queue,
        diag_file_path: None,
    };

    report.diag_file_path = save_diagnostic_json(state, &report);
    Ok(report)
}

// ---------------------------------------------------------------------------
// Membership diagnosis
// ---------------------------------------------------------------------------

fn diagnose_memberships(state: &AppState) -> Result<DiagSection<DiagMembershipItem>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT ms.id, ms.membership_type, ms.pass_type, ms.start_date, ms.end_date,
                    ms.remaining_count, ms.status, ms.member_id,
                    m.name, m.phone, m.member_no, m.center, m.remote_id,
                    m.hidden_locally, m.deleted_at,
                    EXISTS (
                      SELECT 1 FROM memberships ms2
                      WHERE ms2.member_id = ms.member_id AND ms2.id != ms.id
                        AND ms2.remote_id IS NOT NULL AND ms2.remote_id != ''
                    ) AS member_has_other_ms_with_rid
             FROM memberships ms
             LEFT JOIN members m ON m.id = ms.member_id
             WHERE (ms.remote_id IS NULL OR ms.remote_id = '')
             ORDER BY m.center, m.name",
        )?;

        let items: Vec<DiagMembershipItem> = stmt
            .query_map([], |row| {
                let local_id: i64 = row.get(0)?;
                let membership_type: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let pass_type: Option<String> = row.get(2)?;
                let start_date: Option<String> = row.get(3)?;
                let end_date: Option<String> = row.get(4)?;
                let remaining_count: Option<i64> = row.get(5)?;
                let status: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
                let member_id: i64 = row.get(7)?;
                let member_name: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
                let member_phone: Option<String> = row.get(9)?;
                let member_no: Option<i64> = row.get(10)?;
                let member_center: String = row.get::<_, Option<String>>(11)?.unwrap_or_default();
                let member_remote_id: Option<String> = row.get(12)?;
                let member_hidden_locally: i64 = row.get::<_, Option<i64>>(13)?.unwrap_or(0);
                let member_deleted_at: Option<String> = row.get(14)?;
                let member_has_other_ms: bool = row.get::<_, i64>(15)? != 0;

                let is_test = is_test_data(&member_name, &member_phone);

                let (classification, classification_reason) =
                    if is_test || member_hidden_locally != 0 {
                        (
                            "BLOCK_TEST_DATA".to_string(),
                            format!(
                                "테스트/의심 데이터 — name={:?} phone={:?}",
                                member_name, member_phone
                            ),
                        )
                    } else if !has_remote_id(&member_remote_id) {
                        (
                            "BLOCK_MEMBER_UNLINKED".to_string(),
                            "member remote_id 없음 — 서버 업로드 불가".to_string(),
                        )
                    } else if member_deleted_at.is_some() {
                        (
                            "MANUAL_REVIEW".to_string(),
                            format!(
                                "member soft-deleted (deleted_at={:?}) — 수동 확인 필요",
                                member_deleted_at
                            ),
                        )
                    } else if member_has_other_ms {
                        (
                            "LOCAL_DUPLICATE_MEMBERSHIP".to_string(),
                            "같은 회원에 remote_id 있는 회원권이 이미 존재 — 업로드 불필요, backfill 후보".to_string(),
                        )
                    } else {
                        (
                            "SAFE_UPLOAD_CANDIDATE".to_string(),
                            "member remote_id 있음, 테스트 데이터 아님, deleted_at IS NULL".to_string(),
                        )
                    };

                Ok(DiagMembershipItem {
                    local_id,
                    membership_type,
                    pass_type,
                    start_date,
                    end_date,
                    remaining_count,
                    status,
                    member_id,
                    member_name,
                    member_phone,
                    member_no,
                    member_center,
                    member_remote_id,
                    member_hidden_locally: member_hidden_locally != 0,
                    member_deleted_at,
                    is_test_data: is_test,
                    classification,
                    classification_reason,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let total = items.len();
        let mut summary: HashMap<String, usize> = HashMap::new();
        for item in &items {
            *summary.entry(item.classification.clone()).or_insert(0) += 1;
        }

        Ok(DiagSection { total, summary, items })
    })
}

// ---------------------------------------------------------------------------
// Attendance diagnosis
// ---------------------------------------------------------------------------

fn diagnose_attendance(state: &AppState) -> Result<DiagSection<DiagAttendanceItem>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT al.id, al.checkin_at, al.attendance_type, al.deducted_count,
                    al.member_id, al.membership_id,
                    m.name, m.phone, m.center, m.remote_id as member_remote_id,
                    ms.remote_id as membership_remote_id, ms.membership_type
             FROM attendance_logs al
             LEFT JOIN members m ON m.id = al.member_id
             LEFT JOIN memberships ms ON ms.id = al.membership_id
             WHERE (al.remote_id IS NULL OR al.remote_id = '')
             ORDER BY al.checkin_at",
        )?;

        let items: Vec<DiagAttendanceItem> = stmt
            .query_map([], |row| {
                let local_id: i64 = row.get(0)?;
                let checkin_at: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let attendance_type: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
                let deducted_count: i64 = row.get::<_, Option<i64>>(3)?.unwrap_or(0);
                let member_id: i64 = row.get(4)?;
                let membership_id: Option<i64> = row.get(5)?;
                let member_name: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
                let member_phone: Option<String> = row.get(7)?;
                let member_center: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
                let member_remote_id: Option<String> = row.get(9)?;
                let membership_remote_id: Option<String> = row.get(10)?;
                let membership_type: Option<String> = row.get(11)?;

                let is_test = is_test_data(&member_name, &member_phone);
                let has_member_rid = has_remote_id(&member_remote_id);
                let has_ms_rid = has_remote_id(&membership_remote_id);

                let (classification, classification_reason) = if is_test {
                    (
                        "BLOCK_TEST_DATA".to_string(),
                        format!("테스트/의심 데이터 — name={:?}", member_name),
                    )
                } else if !has_member_rid {
                    (
                        "BLOCK_MEMBER_UNLINKED".to_string(),
                        "member remote_id 없음".to_string(),
                    )
                } else if !has_ms_rid {
                    (
                        "WAIT_MEMBERSHIP_REMOTE_ID".to_string(),
                        "membership remote_id 없음 — 회원권 업로드 후 출석 업로드 가능".to_string(),
                    )
                } else {
                    (
                        "SAFE_UPLOAD_CANDIDATE".to_string(),
                        "member/membership remote_id 모두 있음, 테스트 데이터 아님".to_string(),
                    )
                };

                Ok(DiagAttendanceItem {
                    local_id,
                    checkin_at,
                    attendance_type,
                    deducted_count,
                    member_id,
                    member_name,
                    member_phone,
                    member_center,
                    member_remote_id,
                    membership_id,
                    membership_remote_id,
                    membership_type,
                    is_test_data: is_test,
                    classification,
                    classification_reason,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let total = items.len();
        let mut summary: HashMap<String, usize> = HashMap::new();
        for item in &items {
            *summary.entry(item.classification.clone()).or_insert(0) += 1;
        }

        Ok(DiagSection { total, summary, items })
    })
}

// ---------------------------------------------------------------------------
// Sync queue diagnosis
// ---------------------------------------------------------------------------

fn diagnose_sync_queue(state: &AppState) -> Result<DiagSection<DiagSyncQueueItem>, DbError> {
    state.with_conn(|conn| {
        // Fetch raw queue rows
        let raw: Vec<(i64, String, String, i64, i64, Option<String>, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, entity_type, operation, entity_local_id, retry_count, last_error, created_at
                 FROM sync_queue
                 ORDER BY entity_type, operation, id",
            )?;
            let result = stmt.query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get(3)?,
                    row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    row.get(5)?,
                    row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
            result
        };

        let mut items: Vec<DiagSyncQueueItem> = Vec::new();

        for (id, entity_type, operation, entity_local_id, retry_count, last_error, created_at) in raw {
            let (member_name, member_remote_id, membership_remote_id, member_phone) =
                resolve_queue_member_info(conn, &entity_type, entity_local_id)?;

            let entity_remote_id: Option<String> = match entity_type.as_str() {
                "member" => {
                    conn.query_row("SELECT remote_id FROM members WHERE id = ?1", [entity_local_id], |r| r.get(0)).optional().ok().flatten()
                }
                "attendance" => {
                    conn.query_row("SELECT remote_id FROM attendance_logs WHERE id = ?1", [entity_local_id], |r| r.get(0)).optional().ok().flatten()
                }
                "membership" => {
                    conn.query_row("SELECT remote_id FROM memberships WHERE id = ?1", [entity_local_id], |r| r.get(0)).optional().ok().flatten()
                }
                _ => None,
            };

            let is_test = is_test_data(
                member_name.as_deref().unwrap_or(""),
                &member_phone,
            );

            let (classification, classification_reason) = classify_queue_item(
                &entity_type,
                &operation,
                &last_error,
                &member_remote_id,
                &membership_remote_id,
                &entity_remote_id,
                is_test,
            );

            items.push(DiagSyncQueueItem {
                id,
                entity_type,
                operation,
                entity_local_id,
                retry_count,
                last_error,
                created_at,
                member_name,
                member_remote_id,
                membership_remote_id,
                is_test_data: is_test,
                classification,
                classification_reason,
            });
        }

        let total = items.len();
        let mut summary: HashMap<String, usize> = HashMap::new();
        for item in &items {
            *summary.entry(item.classification.clone()).or_insert(0) += 1;
        }

        Ok(DiagSection { total, summary, items })
    })
}

fn resolve_queue_member_info(
    conn: &rusqlite::Connection,
    entity_type: &str,
    entity_local_id: i64,
) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>), DbError> {
    match entity_type {
        "member" => {
            let row: Option<(String, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT name, remote_id, phone FROM members WHERE id = ?1",
                    [entity_local_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(DbError::from)?;
            Ok(row
                .map(|(n, rid, ph)| (Some(n), rid, None, ph))
                .unwrap_or((None, None, None, None)))
        }
        "membership" => {
            let row: Option<(String, Option<String>, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT m.name, m.remote_id, ms.remote_id, m.phone
                     FROM memberships ms
                     JOIN members m ON m.id = ms.member_id
                     WHERE ms.id = ?1",
                    [entity_local_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(DbError::from)?;
            Ok(row
                .map(|(n, mrid, msrid, ph)| (Some(n), mrid, msrid, ph))
                .unwrap_or((None, None, None, None)))
        }
        "attendance" => {
            let row: Option<(String, Option<String>, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT m.name, m.remote_id, ms.remote_id, m.phone
                     FROM attendance_logs al
                     JOIN members m ON m.id = al.member_id
                     LEFT JOIN memberships ms ON ms.id = al.membership_id
                     WHERE al.id = ?1",
                    [entity_local_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(DbError::from)?;
            Ok(row
                .map(|(n, mrid, msrid, ph)| (Some(n), mrid, msrid, ph))
                .unwrap_or((None, None, None, None)))
        }
        _ => Ok((None, None, None, None)),
    }
}

fn is_duplicate_or_server_exists_error(err: &str) -> bool {
    err.contains("서버에 동일 연락처 후보")
        || err.contains("서버 존재")
        || err.contains("동일 후보")
        || err.contains("중복")
        || err.contains("등록 차단")
}

fn classify_queue_item(
    entity_type: &str,
    _operation: &str,
    last_error: &Option<String>,
    member_remote_id: &Option<String>,
    membership_remote_id: &Option<String>,
    entity_remote_id: &Option<String>,
    is_test: bool,
) -> (String, String) {
    let err = last_error.as_deref().unwrap_or("");

    if err.starts_with("RESOLVED") {
        return (
            "ALREADY_RESOLVED".to_string(),
            "이미 해결됨 — 재시도 불필요".to_string(),
        );
    }

    if has_remote_id(entity_remote_id) {
        return (
            "ALREADY_RESOLVED".to_string(),
            format!("엔티티에 remote_id 있음 — 이미 처리됨 ({})", entity_remote_id.as_deref().unwrap_or("")),
        );
    }

    if is_test {
        return (
            "BLOCK_TEST_DATA".to_string(),
            "테스트/의심 데이터 — 업로드 차단".to_string(),
        );
    }

    if entity_type == "member" && is_duplicate_or_server_exists_error(err) {
        if has_remote_id(member_remote_id) {
            return (
                "RESOLVABLE_MEMBER_QUEUE".to_string(),
                "서버 중복/존재 차단이었으나 remote_id 이미 있음 — resolved 처리 후보".to_string(),
            );
        } else {
            return (
                "DUPLICATE_OR_SERVER_EXISTS".to_string(),
                format!("서버에 동일 후보 존재로 차단됨 — last_error: {}", &err[..err.len().min(80)]),
            );
        }
    }

    if !is_test && (err.contains("테스트") || err.contains("차단")) {
        if entity_type == "member" && has_remote_id(member_remote_id) {
            return (
                "RESOLVABLE_MEMBER_QUEUE".to_string(),
                "차단 에러 있으나 remote_id 이미 있음 — resolved 처리 후보".to_string(),
            );
        }
        if is_duplicate_or_server_exists_error(err) {
            return (
                "DUPLICATE_OR_SERVER_EXISTS".to_string(),
                format!("서버 존재/중복으로 차단됨 — last_error: {}", &err[..err.len().min(80)]),
            );
        }
        return (
            "BLOCK_TEST_DATA".to_string(),
            "테스트/차단 관련 큐 — 업로드 차단".to_string(),
        );
    }

    match entity_type {
        "member" => {
            if has_remote_id(member_remote_id) {
                (
                    "RESOLVABLE_MEMBER_QUEUE".to_string(),
                    "member에 remote_id 있음 — 업로드 불필요, resolved 처리 후보".to_string(),
                )
            } else {
                (
                    "MANUAL_REVIEW".to_string(),
                    "member remote_id 없음 — 수동 확인 필요".to_string(),
                )
            }
        }
        "membership" => {
            if !has_remote_id(member_remote_id) {
                (
                    "MANUAL_REVIEW".to_string(),
                    "member remote_id 없음 — 회원권 업로드 불가".to_string(),
                )
            } else {
                (
                    "MEMBERSHIP_UPLOAD_CANDIDATE".to_string(),
                    "member remote_id 있음 — 회원권 업로드 후보".to_string(),
                )
            }
        }
        "attendance" => {
            if !has_remote_id(member_remote_id) {
                (
                    "MANUAL_REVIEW".to_string(),
                    "member remote_id 없음".to_string(),
                )
            } else if !has_remote_id(membership_remote_id) {
                (
                    "MANUAL_REVIEW".to_string(),
                    "membership remote_id 없음 — 회원권 업로드 선행 필요".to_string(),
                )
            } else {
                (
                    "ATTENDANCE_UPLOAD_CANDIDATE".to_string(),
                    "member/membership remote_id 모두 있음 — 출석 업로드 후보".to_string(),
                )
            }
        }
        _ => ("MANUAL_REVIEW".to_string(), format!("알 수 없는 entity_type: {}", entity_type)),
    }
}

// ---------------------------------------------------------------------------
// JSON save
// ---------------------------------------------------------------------------

fn save_diagnostic_json(state: &AppState, report: &DiagnosticReport) -> Option<String> {
    let app_data_dir = state.db_path.parent()?;
    let path = app_data_dir.join("membership_attendance_queue_diagnostic.json");

    // Build report copy without diag_file_path to avoid self-reference
    let json = serde_json::to_string_pretty(report).unwrap_or_default();

    match std::fs::write(&path, json) {
        Ok(_) => {
            let p = path.to_string_lossy().to_string();
            eprintln!("[diagnostic] saved: {}", p);
            Some(p)
        }
        Err(e) => {
            eprintln!("[diagnostic] save failed: {}", e);
            None
        }
    }
}
