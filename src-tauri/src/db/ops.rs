use chrono::Local;
use crate::models::{
    AttendanceLog, Member, MemberDetail, MemberInput, MemberListItem, Membership, PauseLog,
    Payment,
};
use crate::db::status::{
    attendance_type_for_member, compute_member_status, compute_membership_status,
    display_badge, map_legacy_membership, normalize_local_member_type, now_string,
    remaining_text, today_date, today_string,
};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

use super::migration;
use super::status;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("\u{B451}\u{C774}\u{D130}\u{BCA0}\u{C774}\u{C2A4} \u{C624}\u{B958}: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("\u{B451}\u{C774}\u{D130}\u{BCA0}\u{C774}\u{C2A4} \u{C0AC}\u{C6A9} \u{C911}\u{C785}\u{B2C8}\u{B2E4}.")]
    Lock,
    #[error("{0}")]
    Message(String),
}

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub reports_dir: PathBuf,
    pub startup_backup_created: Mutex<bool>,
}

impl AppState {
    pub fn new(db_path: PathBuf, backup_dir: PathBuf, reports_dir: PathBuf) -> Result<Self, DbError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::create_dir_all(&backup_dir).ok();
        // reports_dir: created lazily on export (grabon only) — not at app startup

        let conn = Connection::open(&db_path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -64000;
            PRAGMA encoding = 'UTF-8';
            ",
        )?;

        ensure_legacy_phone_normalized(&conn)?;
        migration::migrate_all(&conn).map_err(DbError::from)?;
        refresh_all_statuses(&conn)?;
        verify_db_integrity(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
            backup_dir,
            reports_dir,
            startup_backup_created: Mutex::new(false),
        })
    }

    pub fn with_conn<F, T>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&mut Connection) -> Result<T, DbError>,
    {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        f(&mut conn)
    }

    pub fn checkpoint_wal(&self) -> Result<(), DbError> {
        self.with_conn(|conn| {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            Ok(())
        })
    }

    pub fn storage_info(&self) -> Result<crate::models::StorageInfo, DbError> {
        self.with_conn(|conn| {
            let journal_mode: String =
                conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
            let integrity_ok = verify_db_integrity(conn).is_ok();
            Ok(crate::models::StorageInfo {
                db_path: self.db_path.to_string_lossy().to_string(),
                backup_dir: self.backup_dir.to_string_lossy().to_string(),
                reports_dir: self.reports_dir.to_string_lossy().to_string(),
                journal_mode,
                integrity_ok,
            })
        })
    }
}

fn verify_db_integrity(conn: &Connection) -> Result<(), DbError> {
    let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result.to_ascii_lowercase() != "ok" {
        return Err(DbError::Message(format!(
            "\u{B451}\u{C774}\u{D130}\u{BCA0}\u{C774}\u{C2A4} \u{BB34}\u{ACB0}\u{C131} \u{AC80}\u{C0AC} \u{C2E4}\u{D328}: {result}"
        )));
    }
    Ok(())
}

fn ensure_legacy_phone_normalized(conn: &Connection) -> Result<(), DbError> {
    let has_members: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='members'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_members {
        return Ok(());
    }

    let schema: String = conn
        .query_row(
            "SELECT IFNULL(sql, '') FROM sqlite_master WHERE type='table' AND name='members'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    if !schema.contains("membership_type") {
        return Ok(());
    }

    let has_column: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('members') WHERE name = 'phone_normalized'",
        [],
        |row| row.get(0),
    )?;

    if has_column == 0 {
        conn.execute_batch(
            "
            ALTER TABLE members ADD COLUMN phone_normalized TEXT;
            CREATE INDEX IF NOT EXISTS idx_members_center_phone_norm ON members(center, phone_normalized);
            ",
        )?;
    }

    let mut stmt = conn.prepare("SELECT id, phone FROM members")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
    })?;

    for row in rows {
        let (id, phone) = row?;
        let normalized = normalize_phone(&phone);
        conn.execute(
            "UPDATE members SET phone_normalized = ?1 WHERE id = ?2",
            params![normalized, id],
        )?;
    }

    Ok(())
}

pub fn normalize_phone(phone: &Option<String>) -> Option<String> {
    phone.as_ref().and_then(|value| {
        let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
        if digits.len() >= 4 {
            Some(digits)
        } else {
            None
        }
    })
}

fn normalize_optional_phone(phone: &Option<String>) -> Option<String> {
    phone
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn assert_phone_unique(
    conn: &Connection,
    center: &str,
    phone_normalized: &Option<String>,
    exclude_id: Option<i64>,
) -> Result<(), DbError> {
    let Some(normalized) = phone_normalized else {
        return Ok(());
    };

    let existing_id: Option<i64> = if let Some(id) = exclude_id {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND phone_normalized = ?2 AND deleted_at IS NULL AND id != ?3
             LIMIT 1",
            params![center, normalized, id],
            |row| row.get(0),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND phone_normalized = ?2 AND deleted_at IS NULL
             LIMIT 1",
            params![center, normalized],
            |row| row.get(0),
        )
        .optional()?
    };

    if existing_id.is_some() {
        return Err(DbError::Message(
            "\u{C774}\u{BBF8} \u{B4F1}\u{B85D}\u{B41C} \u{C804}\u{D654}\u{BC88}\u{D638}\u{C785}\u{B2C8}\u{B2E4}.".into(),
        ));
    }

    Ok(())
}

fn map_input_membership(input: &MemberInput) -> Result<(String, String, String, Option<String>, Option<i32>, Option<i32>, String), DbError> {
    let legacy_type = input.membership_type.as_str();
    let (membership_type, pass_type, total_count, _, _) =
        map_legacy_membership(legacy_type, input.total_sessions);

    let raw_member_type = if legacy_type == "junior" {
        "junior"
    } else {
        input.member_type.as_deref().unwrap_or("regular")
    };
    let member_type = normalize_local_member_type(raw_member_type).to_string();

    let end_date = input.end_date.clone();
    let remaining_count = if pass_type == "count" {
        Some(input.remaining_sessions.or(input.total_sessions).unwrap_or(total_count.unwrap_or(0)))
    } else {
        None
    };

    Ok((
        membership_type,
        pass_type,
        member_type,
        end_date,
        total_count,
        remaining_count,
        legacy_type.to_string(),
    ))
}

/// Picks one representative membership row per member, following this
/// priority:
///   1. Currently valid (paused, or period within start/end, or
///      count/junior with remaining sessions > 0) — among valid rows,
///      the one with the soonest (nearest) end_date wins.
///   2. If none valid, the most recently created/updated row.
///   3. If no memberships at all, NULL ("회원권 없음").
fn active_membership_subquery() -> String {
    let today = today_string();
    format!(
        "(
            SELECT id FROM memberships
            WHERE member_id = m.id
            ORDER BY
                CASE
                    WHEN status = 'paused' THEN 0
                    WHEN pass_type = 'period' AND start_date <= '{today}' AND end_date >= '{today}' THEN 0
                    WHEN pass_type = 'count' AND IFNULL(remaining_count, 0) > 0 THEN 0
                    ELSE 1
                END,
                CASE
                    WHEN status = 'paused'
                        OR (pass_type = 'period' AND start_date <= '{today}' AND end_date >= '{today}')
                        OR (pass_type = 'count' AND IFNULL(remaining_count, 0) > 0)
                    THEN IFNULL(end_date, '9999-99-99')
                    ELSE NULL
                END ASC,
                updated_at DESC,
                id DESC
            LIMIT 1
        )"
    )
}

fn member_group_clause(group: &str, today: &str) -> String {
    super::member_filter::member_group_clause(group, today)
}

fn build_status_clause(status_filter: &str, today: &str) -> String {
    match status_filter {
        "active" => format!(
            " AND m.deleted_at IS NULL AND (
                m.status = 'paused'
                OR ms.status = 'paused'
                OR (ms.pass_type = 'period' AND ms.end_date IS NOT NULL AND ms.end_date >= '{today}')
                OR (ms.pass_type = 'count' AND IFNULL(ms.remaining_count, 0) > 0)
            )"
        ),
        "expired" => format!(
            " AND m.deleted_at IS NULL AND m.status != 'paused' AND ms.status != 'paused' AND (
                ms.id IS NULL
                OR (ms.pass_type = 'period' AND (ms.end_date IS NULL OR ms.end_date < '{today}'))
                OR (ms.pass_type = 'count' AND IFNULL(ms.remaining_count, 0) <= 0)
            )"
        ),
        _ => " AND m.deleted_at IS NULL".to_string(),
    }
}

fn map_list_item(row: &Row<'_>, today: NaiveDate) -> Result<MemberListItem, rusqlite::Error> {
    let member_status: String = row.get(6)?;
    let deleted_at: Option<String> = row.get(7)?;
    let membership_status: Option<String> = row.get(15)?;
    let pass_type: Option<String> = row.get(10)?;
    let end_date: Option<String> = row.get(12)?;
    let total_count: Option<i32> = row.get(13)?;
    let remaining_count: Option<i32> = row.get(14)?;
    let pause_remaining_days: Option<i32> = row.get(17)?;

    let ms_status = membership_status.clone().unwrap_or_else(|| "active".to_string());
    let pass = pass_type.clone().unwrap_or_else(|| "period".to_string());
    let computed_member_status = compute_member_status(
        &member_status,
        &deleted_at,
        membership_status.as_deref(),
    );
    let badge = display_badge(
        &computed_member_status,
        &ms_status,
        &pass,
        &end_date,
        remaining_count,
        pause_remaining_days,
        today,
    );
    let remaining_label = remaining_text(
        &pass,
        &end_date,
        total_count,
        remaining_count,
        pause_remaining_days,
        today,
    );

    let latest_membership_end_date: Option<String> = row.get(20)?;
    let latest_membership_type: Option<String> = row.get(21)?;
    let created_at: String = row.get(18)?;
    let updated_at: String = row.get(19)?;

    let days_since_expired = latest_membership_end_date
        .as_ref()
        .and_then(|value| status::parse_date(value))
        .map(|end| (today - end).num_days() as i32)
        .filter(|days| *days >= 0);

    let is_inactive_30_days = latest_membership_end_date.is_none()
        || days_since_expired.map(|days| days >= 30).unwrap_or(true);

    Ok(MemberListItem {
        id: row.get(0)?,
        name: row.get(1)?,
        phone: row.get(2)?,
        member_type: row.get(3)?,
        center: row.get(4)?,
        memo: row.get(5)?,
        status: computed_member_status,
        membership_id: row.get(8)?,
        membership_type: row.get(9)?,
        pass_type,
        start_date: row.get(11)?,
        end_date,
        total_count,
        remaining_count,
        membership_status,
        display_status: badge,
        remaining_text: remaining_label,
        last_visit_at: row.get(16)?,
        pause_remaining_days,
        latest_membership_end_date,
        latest_membership_type,
        days_since_expired,
        is_inactive_30_days,
        pause_start_date: row.get(22).ok(),
        member_no: row.get(23).ok(),
        remote_id: row.get(24).ok(),
        _duplicate_info: None,
        created_at,
        updated_at,
    })
}

/// Excludes members that have been locally hidden/quarantined as duplicates
/// (local-only flags; never affects Supabase or sync).
const HIDDEN_DUP_FILTER: &str =
    " AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0";

const LIST_SELECT: &str = "
    SELECT
        m.id, m.name, m.phone, m.member_type, m.center, m.memo, m.status, m.deleted_at,
        ms.id, ms.membership_type, ms.pass_type, ms.start_date, ms.end_date,
        ms.total_count, ms.remaining_count, ms.status,
        (SELECT MAX(checkin_at) FROM attendance_logs WHERE member_id = m.id),
        (
            SELECT remaining_days_at_pause FROM pause_logs
            WHERE membership_id = ms.id AND pause_end_date IS NULL
            ORDER BY id DESC LIMIT 1
        ),
        m.created_at, m.updated_at,
        (SELECT MAX(end_date) FROM memberships WHERE member_id = m.id) AS latest_membership_end_date,
        (SELECT lm.membership_type FROM memberships lm WHERE lm.member_id = m.id ORDER BY lm.end_date DESC, lm.id DESC LIMIT 1) AS latest_membership_type,
        (
            SELECT pause_start_date FROM pause_logs
            WHERE membership_id = ms.id AND pause_end_date IS NULL
            ORDER BY id DESC LIMIT 1
        ) AS pause_start_date,
        m.member_no, m.remote_id
    FROM members m
    LEFT JOIN memberships ms ON ms.id = ";

/// Minimal member info for the self-check-in kiosk screen.
/// Looks up a member by id within a specific center only, returning
/// just enough info for self-confirmation (no full roster access).
pub fn lookup_member_for_self_checkin(
    state: &AppState,
    center: &str,
    member_no: i64,
) -> Result<Option<crate::models::SelfCheckinMember>, DbError> {
    state.with_conn(|conn| {
        super::ensure_schema::ensure_local_schema(conn).map_err(DbError::from)?;
        let today_date = today_date();
        let active_sub = active_membership_subquery();
        let sql = format!(
            "{LIST_SELECT}{active_sub}
             WHERE m.member_no = ?1 AND m.center = ?2 AND m.deleted_at IS NULL{HIDDEN_DUP_FILTER}"
        );
        let item = conn
            .query_row(&sql, params![member_no, center], |row| {
                map_list_item(row, today_date)
            })
            .optional()?;

        Ok(item.map(|item| {
            let phone_last4 = item
                .phone
                .as_ref()
                .map(|p| p.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
                .filter(|digits| digits.len() >= 4)
                .map(|digits| digits[digits.len() - 4..].to_string());

            crate::models::SelfCheckinMember {
                id: item.id,
                name: item.name,
                center: item.center,
                membership_type: item.membership_type,
                pass_type: item.pass_type,
                remaining_count: item.remaining_count,
                remaining_text: item.remaining_text,
                display_status: item.display_status,
                membership_id: item.membership_id,
                phone_last4,
            }
        }))
    })
}

/// Returns the next available member_no for a center (max + 1, or 1001 if none).
pub fn get_next_member_no(state: &AppState, center: &str) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        super::ensure_schema::ensure_local_schema(conn).map_err(DbError::from)?;
        let max: Option<i64> = conn.query_row(
            "SELECT MAX(member_no) FROM members WHERE center = ?1",
            params![center],
            |row| row.get(0),
        )?;
        Ok(max.map(|v| v + 1).unwrap_or(1001))
    })
}

/// Ensures member_no is unique within a center (excluding the given member id).
fn assert_member_no_unique(
    conn: &Connection,
    center: &str,
    member_no: Option<i64>,
    exclude_id: Option<i64>,
) -> Result<(), DbError> {
    let Some(no) = member_no else {
        return Ok(());
    };

    let existing_id: Option<i64> = if let Some(id) = exclude_id {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND member_no = ?2 AND deleted_at IS NULL AND id != ?3
             LIMIT 1",
            params![center, no, id],
            |row| row.get(0),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND member_no = ?2 AND deleted_at IS NULL
             LIMIT 1",
            params![center, no],
            |row| row.get(0),
        )
        .optional()?
    };

    if existing_id.is_some() {
        return Err(DbError::Message("이미 사용 중인 회원번호입니다.".into()));
    }

    Ok(())
}

pub fn get_member_list_item_by_id(
    state: &AppState,
    member_id: i64,
) -> Result<MemberListItem, DbError> {
    state.with_conn(|conn| {
        let today_date = today_date();
        let active_sub = active_membership_subquery();
        let sql = format!(
            "{LIST_SELECT}{active_sub}
             WHERE m.id = ?1 AND m.deleted_at IS NULL"
        );
        conn.query_row(&sql, params![member_id], |row| map_list_item(row, today_date))
            .optional()?
            .ok_or_else(|| DbError::Message("회원을 찾을 수 없습니다.".into()))
    })
}

pub fn list_members(
    state: &AppState,
    center: &str,
    search: &str,
    member_group: &str,
    status_filter: &str,
    page: i64,
    page_size: i64,
) -> Result<(Vec<MemberListItem>, i64), DbError> {
    state.with_conn(|conn| {
        super::ensure_schema::ensure_local_schema(conn).map_err(DbError::from)?;
        let today = today_string();
        let today_date = today_date();
        let trimmed_search = search.trim();
        let has_search = !trimmed_search.is_empty();
        let group_clause = member_group_clause(member_group, &today);
        let status_clause = if member_group == "inactive_30" {
            String::new()
        } else {
            build_status_clause(status_filter, &today)
        };
        let active_sub = active_membership_subquery();

        let mut search_clause = String::new();
        let mut search_params: Vec<String> = Vec::new();

        if has_search {
            let digits: String = trimmed_search
                .chars()
                .filter(|ch| ch.is_ascii_digit())
                .collect();
            let non_digit_len = trimmed_search
                .chars()
                .filter(|ch| !ch.is_ascii_digit())
                .count();

            if digits.len() >= 4 && non_digit_len <= 2 {
                search_clause = " AND (m.phone_normalized LIKE ? OR m.name LIKE ? COLLATE NOCASE OR IFNULL(m.memo, '') LIKE ? COLLATE NOCASE)".into();
                search_params.push(format!("{digits}%"));
                search_params.push(format!("%{trimmed_search}%"));
                search_params.push(format!("%{trimmed_search}%"));
            } else {
                search_clause = " AND (m.name LIKE ? COLLATE NOCASE OR IFNULL(m.phone, '') LIKE ? OR IFNULL(m.memo, '') LIKE ? COLLATE NOCASE)".into();
                let pattern = format!("%{trimmed_search}%");
                search_params.push(pattern.clone());
                search_params.push(pattern.clone());
                search_params.push(pattern);
            }
        }

        let count_sql = format!(
            "SELECT COUNT(*) FROM members m
             LEFT JOIN memberships ms ON ms.id = {active_sub}
             WHERE m.center = ?1{group_clause}{status_clause}{search_clause}{HIDDEN_DUP_FILTER}"
        );

        let mut count_bind: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(center.to_string())];
        for value in &search_params {
            count_bind.push(Box::new(value.clone()));
        }
        let count_refs: Vec<&dyn rusqlite::types::ToSql> =
            count_bind.iter().map(|v| v.as_ref()).collect();
        let total: i64 = conn.query_row(&count_sql, count_refs.as_slice(), |row| row.get(0))?;

        let offset = (page - 1).max(0) * page_size;
        let list_sql = format!(
            "{LIST_SELECT}{active_sub}
             WHERE m.center = ?1{group_clause}{status_clause}{search_clause}{HIDDEN_DUP_FILTER}
             ORDER BY m.name COLLATE NOCASE ASC LIMIT ? OFFSET ?"
        );

        let mut list_bind: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(center.to_string())];
        for value in &search_params {
            list_bind.push(Box::new(value.clone()));
        }
        list_bind.push(Box::new(page_size));
        list_bind.push(Box::new(offset));
        let list_refs: Vec<&dyn rusqlite::types::ToSql> =
            list_bind.iter().map(|v| v.as_ref()).collect();

        let mut stmt = conn.prepare(&list_sql)?;
        let rows = stmt.query_map(list_refs.as_slice(), |row| map_list_item(row, today_date))?;
        let mut members = Vec::new();
        for row in rows {
            members.push(row?);
        }

        Ok((members, total))
    })
}

/// A group of members in the same center that share name+phone (or just
/// name when phone is empty) and are therefore candidates for being the
/// same logical person duplicated across local rows (e.g. from repeated
/// pulls before remote_id matching was fixed).
///
/// This is detection-only: no automatic merge/delete is performed. The
/// `member_ids` are ordered with the recommended "best" representative
/// first (currently valid membership, then most recently updated).
#[derive(serde::Serialize)]
pub struct DuplicateMemberCandidateGroup {
    pub center: String,
    pub name: String,
    pub phone: Option<String>,
    pub member_ids: Vec<i64>,
}

/// Finds groups of member rows within a center that look like duplicates of
/// the same logical person (same center + name + phone, or same center +
/// name when phone is blank for both). Does not modify any data.
pub fn find_duplicate_member_candidates(
    state: &AppState,
    center: &str,
) -> Result<Vec<DuplicateMemberCandidateGroup>, DbError> {
    state.with_conn(|conn| {
        super::ensure_schema::ensure_local_schema(conn).map_err(DbError::from)?;

        let mut stmt = conn.prepare(
            "SELECT center, name, IFNULL(phone, '') AS phone_key, GROUP_CONCAT(id) AS ids, COUNT(*) AS cnt
             FROM members
             WHERE center = ?1 AND deleted_at IS NULL
               AND COALESCE(hidden_locally, 0) = 0 AND COALESCE(is_local_duplicate, 0) = 0
             GROUP BY center, name, phone_key
             HAVING cnt > 1",
        )?;

        let today_date = today_date();
        let active_sub = active_membership_subquery();

        let groups = stmt
            .query_map(params![center], |row| {
                let center: String = row.get(0)?;
                let name: String = row.get(1)?;
                let phone_key: String = row.get(2)?;
                let ids_csv: String = row.get(3)?;
                Ok((center, name, phone_key, ids_csv))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut result = Vec::new();
        for (center, name, phone_key, ids_csv) in groups {
            let mut ids: Vec<i64> = ids_csv
                .split(',')
                .filter_map(|s| s.trim().parse::<i64>().ok())
                .collect();

            // Order so the "best" representative (currently-valid membership,
            // then most recently updated) comes first.
            let sql = format!(
                "{LIST_SELECT}{active_sub}
                 WHERE m.id = ?1 AND m.deleted_at IS NULL"
            );
            let mut scored: Vec<(i64, bool, String)> = Vec::new();
            for id in &ids {
                if let Some(item) = conn
                    .query_row(&sql, params![*id], |row| map_list_item(row, today_date))
                    .optional()?
                {
                    let is_valid = matches!(item.status.as_str(), "active" | "paused")
                        || item
                            .end_date
                            .as_ref()
                            .and_then(|d| status::parse_date(d))
                            .map(|d| d >= today_date)
                            .unwrap_or(false);
                    scored.push((*id, is_valid, item.updated_at));
                } else {
                    scored.push((*id, false, String::new()));
                }
            }
            scored.sort_by(|a, b| {
                b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2))
            });
            ids = scored.into_iter().map(|(id, _, _)| id).collect();

            // 중복 후보 진단 로그 (내부용, UI에 노출되지 않음)
            eprintln!(
                "[dedup] 중복 후보 발견: center={center} name={name} phone={phone_key} ids={ids:?}"
            );

            result.push(DuplicateMemberCandidateGroup {
                center,
                name,
                phone: if phone_key.is_empty() { None } else { Some(phone_key) },
                member_ids: ids,
            });
        }

        Ok(result)
    })
}

#[derive(serde::Serialize)]
pub struct LocalDuplicateCleanupSummary {
    pub groups_processed: i64,
    pub rows_hidden: i64,
    pub affected_names: Vec<String>,
}

/// Hides (quarantines) local-only duplicate member rows, keeping exactly one
/// "best" representative per detected duplicate group.
///
/// Two kinds of groups are considered:
///  1. Members sharing the same non-empty `remote_id` (the same Supabase row
///     was pulled into multiple local rows).
///  2. Members sharing the same fingerprint (center + name + phone) per the
///     existing `find_duplicate_member_candidates` detection, for rows
///     without a usable remote_id match.
///
/// For each group, all rows except the representative get
/// `hidden_locally = 1, is_local_duplicate = 1`. No rows are deleted, no
/// sync_queue entries are created, and Supabase is never contacted. This is
/// idempotent: rows already hidden are left as-is and excluded from future
/// group detection.
pub fn cleanup_local_duplicates(
    state: &AppState,
    center: &str,
) -> Result<LocalDuplicateCleanupSummary, DbError> {
    state.with_conn(|conn| {
        super::ensure_schema::ensure_local_schema(conn).map_err(DbError::from)?;

        let today_date = today_date();
        let active_sub = active_membership_subquery();

        // Helper to fetch (updated_at, has_remote_id, has_membership, created_at, name)
        // for scoring representatives.
        struct Candidate {
            id: i64,
            name: String,
            has_remote_id: bool,
            updated_at: String,
            has_membership: bool,
            created_at: String,
        }

        let fetch_candidate = |conn: &Connection, id: i64| -> Result<Option<Candidate>, DbError> {
            let row = conn
                .query_row(
                    "SELECT m.id, m.name, m.remote_id, m.updated_at, m.created_at,
                            EXISTS(SELECT 1 FROM memberships WHERE member_id = m.id) AS has_ms
                     FROM members m
                     WHERE m.id = ?1 AND m.deleted_at IS NULL",
                    params![id],
                    |row| {
                        let remote_id: Option<String> = row.get(2)?;
                        Ok(Candidate {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            has_remote_id: remote_id.map(|s| !s.is_empty()).unwrap_or(false),
                            updated_at: row.get(3)?,
                            created_at: row.get(4)?,
                            has_membership: row.get::<_, i64>(5)? != 0,
                        })
                    },
                )
                .optional()?;
            Ok(row)
        };

        // Picks the index of the best representative within a group of candidates,
        // using the same priority order as normalizeMembers.ts / v1.0.27:
        // remote_id present > most recently updated > has membership rows > created_at (earliest).
        let pick_representative = |candidates: &[Candidate]| -> usize {
            let mut best = 0usize;
            for i in 1..candidates.len() {
                let a = &candidates[i];
                let b = &candidates[best];
                let better = if a.has_remote_id != b.has_remote_id {
                    a.has_remote_id
                } else if a.updated_at != b.updated_at {
                    a.updated_at > b.updated_at
                } else if a.has_membership != b.has_membership {
                    a.has_membership
                } else if a.created_at != b.created_at {
                    a.created_at < b.created_at
                } else {
                    a.id < b.id
                };
                if better {
                    best = i;
                }
            }
            best
        };

        let mut groups_processed: i64 = 0;
        let mut rows_hidden: i64 = 0;
        let mut affected_names: Vec<String> = Vec::new();
        let mut processed_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();

        // --- Pass 1: group by shared remote_id ---
        let mut stmt = conn.prepare(
            "SELECT remote_id, GROUP_CONCAT(id) AS ids, COUNT(*) AS cnt
             FROM members
             WHERE center = ?1 AND deleted_at IS NULL
               AND remote_id IS NOT NULL AND remote_id != ''
               AND COALESCE(hidden_locally, 0) = 0 AND COALESCE(is_local_duplicate, 0) = 0
             GROUP BY remote_id
             HAVING cnt > 1",
        )?;
        let remote_groups: Vec<(String, String)> = stmt
            .query_map(params![center], |row| {
                let remote_id: String = row.get(0)?;
                let ids_csv: String = row.get(1)?;
                Ok((remote_id, ids_csv))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        for (_remote_id, ids_csv) in remote_groups {
            let ids: Vec<i64> = ids_csv
                .split(',')
                .filter_map(|s| s.trim().parse::<i64>().ok())
                .collect();
            if ids.len() < 2 {
                continue;
            }

            let mut candidates = Vec::new();
            for id in &ids {
                if let Some(c) = fetch_candidate(conn, *id)? {
                    candidates.push(c);
                }
            }
            if candidates.len() < 2 {
                continue;
            }

            let rep_idx = pick_representative(&candidates);
            groups_processed += 1;
            for (i, cand) in candidates.iter().enumerate() {
                processed_ids.insert(cand.id);
                if i == rep_idx {
                    continue;
                }
                conn.execute(
                    "UPDATE members SET hidden_locally = 1, is_local_duplicate = 1, updated_at = updated_at
                     WHERE id = ?1",
                    params![cand.id],
                )?;
                rows_hidden += 1;
                affected_names.push(cand.name.clone());
            }
        }

        // --- Pass 2: group by fingerprint (center + name + phone), matching the
        // existing v1.0.26 dedup-candidate definition, for rows not already
        // covered by a remote_id group above ---
        // dedup definition: center+name+phone+member_type+membership type/end_date/status).
        let mut stmt = conn.prepare(
            "SELECT center, name, IFNULL(phone, '') AS phone_key, GROUP_CONCAT(id) AS ids, COUNT(*) AS cnt
             FROM members
             WHERE center = ?1 AND deleted_at IS NULL
               AND COALESCE(hidden_locally, 0) = 0 AND COALESCE(is_local_duplicate, 0) = 0
             GROUP BY center, name, phone_key
             HAVING cnt > 1",
        )?;
        let fingerprint_groups: Vec<Vec<i64>> = stmt
            .query_map(params![center], |row| {
                let ids_csv: String = row.get(3)?;
                let ids: Vec<i64> = ids_csv
                    .split(',')
                    .filter_map(|s| s.trim().parse::<i64>().ok())
                    .collect();
                Ok(ids)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        for ids in fingerprint_groups {
            // Skip any ids already handled in pass 1.
            let ids: Vec<i64> = ids.into_iter().filter(|id| !processed_ids.contains(id)).collect();
            if ids.len() < 2 {
                continue;
            }

            // Further refine using the full membership fingerprint (member_type,
            // membership end_date/status) so we don't merge genuinely distinct
            // people who happen to share name+phone.
            let mut by_fp: std::collections::HashMap<String, Vec<i64>> = std::collections::HashMap::new();
            for id in &ids {
                let sql = format!(
                    "{LIST_SELECT}{active_sub}
                     WHERE m.id = ?1 AND m.deleted_at IS NULL"
                );
                if let Some(item) = conn
                    .query_row(&sql, params![*id], |row| map_list_item(row, today_date))
                    .optional()?
                {
                    let fp = format!(
                        "{}|{}|{}|{}",
                        item.member_type.clone(),
                        item.membership_type.clone().unwrap_or_default(),
                        item.end_date.clone().unwrap_or_default(),
                        item.status.clone()
                    );
                    by_fp.entry(fp).or_default().push(*id);
                }
            }

            for (_fp, group_ids) in by_fp {
                if group_ids.len() < 2 {
                    continue;
                }
                let mut candidates = Vec::new();
                for id in &group_ids {
                    if let Some(c) = fetch_candidate(conn, *id)? {
                        candidates.push(c);
                    }
                }
                if candidates.len() < 2 {
                    continue;
                }

                let rep_idx = pick_representative(&candidates);
                groups_processed += 1;
                for (i, cand) in candidates.iter().enumerate() {
                    if i == rep_idx {
                        continue;
                    }
                    conn.execute(
                        "UPDATE members SET hidden_locally = 1, is_local_duplicate = 1, updated_at = updated_at
                         WHERE id = ?1",
                        params![cand.id],
                    )?;
                    rows_hidden += 1;
                    affected_names.push(cand.name.clone());
                }
            }
        }

        Ok(LocalDuplicateCleanupSummary {
            groups_processed,
            rows_hidden,
            affected_names,
        })
    })
}

fn map_member(row: &Row<'_>) -> Result<Member, rusqlite::Error> {
    Ok(Member {
        id: row.get(0)?,
        name: row.get(1)?,
        phone: row.get(2)?,
        member_type: row.get(3)?,
        center: row.get(4)?,
        parent_name: row.get(5)?,
        parent_phone: row.get(6)?,
        memo: row.get(7)?,
        address: row.get(8).ok(),
        status: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        deleted_at: row.get(12)?,
        locker_number: row.get(13).ok(),
        locker_status: row.get(14).ok(),
        locker_start_date: row.get(15).ok(),
        locker_end_date: row.get(16).ok(),
        locker_memo: row.get(17).ok(),
        member_no: row.get(18).ok(),
    })
}

const MEMBER_SELECT: &str = "
    SELECT id, name, phone, member_type, center, parent_name, parent_phone, memo, address,
           status, created_at, updated_at, deleted_at,
           locker_number, locker_status, locker_start_date, locker_end_date, locker_memo,
           member_no
    FROM members
";

pub fn get_member(state: &AppState, id: i64) -> Result<Option<Member>, DbError> {
    state.with_conn(|conn| {
        conn.query_row(
            &format!("{MEMBER_SELECT} WHERE id = ?1 AND deleted_at IS NULL"),
            params![id],
            map_member,
        )
        .optional()
        .map_err(DbError::from)
    })
}

pub fn get_member_detail(state: &AppState, id: i64) -> Result<Option<MemberDetail>, DbError> {
    let member = match get_member(state, id)? {
        Some(member) => member,
        None => return Ok(None),
    };

    let memberships = get_memberships(state, id)?;
    let active_membership = get_active_membership(state, id)?;
    let attendance = get_attendance_logs(state, id, 30)?;
    let payments = get_payments(state, id)?;
    let pause_logs = get_pause_logs(state, id)?;
    let edit_logs = state.with_conn(|conn| {
        super::member_edit_log::get_member_edit_logs(conn, id, 50).map_err(DbError::from)
    })?;

    Ok(Some(MemberDetail {
        member,
        active_membership,
        memberships,
        attendance,
        payments,
        pause_logs,
        edit_logs,
    }))
}

fn map_membership(row: &Row<'_>) -> Result<Membership, rusqlite::Error> {
    Ok(Membership {
        id: row.get(0)?,
        member_id: row.get(1)?,
        membership_type: row.get(2)?,
        pass_type: row.get(3)?,
        start_date: row.get(4)?,
        end_date: row.get(5)?,
        total_count: row.get(6)?,
        used_count: row.get(7)?,
        remaining_count: row.get(8)?,
        status: row.get(9)?,
        price: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

pub fn get_memberships(state: &AppState, member_id: i64) -> Result<Vec<Membership>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, member_id, membership_type, pass_type, start_date, end_date,
                    total_count, used_count, remaining_count, status, price, created_at, updated_at
             FROM memberships WHERE member_id = ?1 ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![member_id], map_membership)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    })
}

pub fn get_active_membership(
    state: &AppState,
    member_id: i64,
) -> Result<Option<Membership>, DbError> {
    state.with_conn(|conn| {
        conn.query_row(
            "SELECT id, member_id, membership_type, pass_type, start_date, end_date,
                    total_count, used_count, remaining_count, status, price, created_at, updated_at
             FROM memberships
             WHERE member_id = ?1 AND status IN ('active', 'paused')
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC
             LIMIT 1",
            params![member_id],
            map_membership,
        )
        .optional()
        .map_err(DbError::from)
    })
}

pub fn create_member(
    state: &AppState,
    input: MemberInput,
    enqueue_sync: bool,
) -> Result<MemberListItem, DbError> {
    validate_member_input(&input)?;
    let phone_normalized = normalize_phone(&input.phone);
    let (membership_type, pass_type, member_type, end_date, total_count, remaining_count, _) =
        map_input_membership(&input)?;

    let member_id = state.with_conn(|conn| {
        assert_phone_unique(conn, &input.center, &phone_normalized, None)?;
        assert_member_no_unique(conn, &input.center, input.member_no, None)?;
        let now = now_string();
        let tx = conn.transaction()?;

        tx.execute(
            "INSERT INTO members (
                name, phone, phone_normalized, member_type, center, parent_name, parent_phone,
                memo, address, member_no, status, created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?11, NULL)",
            params![
                input.name.trim(),
                normalize_optional_phone(&input.phone),
                phone_normalized,
                member_type,
                input.center,
                input.parent_name,
                input.parent_phone,
                input.notes,
                input.address,
                input.member_no,
                now,
            ],
        )?;
        let member_id = tx.last_insert_rowid();

        tx.execute(
            "INSERT INTO memberships (
                member_id, membership_type, pass_type, start_date, end_date,
                total_count, used_count, remaining_count, status, price, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'active', ?8, ?9, ?9)",
            params![
                member_id,
                membership_type,
                pass_type,
                input.start_date,
                end_date,
                total_count,
                remaining_count,
                input.price,
                now,
            ],
        )?;
        let membership_id = tx.last_insert_rowid();

        if input.price.unwrap_or(0.0) > 0.0 {
            tx.execute(
                "INSERT INTO payments (
                    member_id, membership_id, amount, payment_method, payment_date, memo, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    member_id,
                    membership_id,
                    input.price.unwrap_or(0.0),
                    input.payment_method.as_deref().unwrap_or("cash"),
                    input.payment_date.as_deref().unwrap_or(&input.start_date),
                    input.payment_memo,
                    now,
                ],
            )?;
        }

        tx.commit()?;
        Ok(member_id)
    })?;

    state.with_conn(|conn| {
        let summary = super::member_edit_log::summarize_create(&input);
        super::member_edit_log::insert_member_edit_log(
            conn,
            member_id,
            "create",
            input.edited_by.as_deref(),
            &summary,
        )
        .map_err(DbError::from)
    })?;

    state.with_conn(|conn| {
        super::locker::apply_locker_fields(
            conn,
            member_id,
            &input.center,
            input.locker_number.as_deref(),
            input.locker_start_date.as_deref(),
            input.locker_end_date.as_deref(),
            input.locker_memo.as_deref(),
        )
    })?;

    if enqueue_sync {
        if let Ok(payload_json) = super::sync_local::build_member_sync_payload_json(state, member_id) {
            let _ = super::sync_local::enqueue_sync_item(
                state,
                "member",
                member_id,
                "insert",
                &payload_json,
            );
        }
    }

    refresh_member_status(state, member_id)?;
    get_member_list_item_by_id(state, member_id)
}

pub fn update_member(state: &AppState, id: i64, input: MemberInput) -> Result<MemberListItem, DbError> {
    validate_member_input(&input)?;
    let phone_normalized = normalize_phone(&input.phone);
    let (membership_type, pass_type, member_type, end_date, total_count, remaining_count, _) =
        map_input_membership(&input)?;
    let before_member = get_member(state, id)?;
    let before_membership = get_active_membership(state, id)?;

    state.with_conn(|conn| {
        assert_phone_unique(conn, &input.center, &phone_normalized, Some(id))?;
        assert_member_no_unique(conn, &input.center, input.member_no, Some(id))?;
        let now = now_string();
        let tx = conn.transaction()?;

        let updated = tx.execute(
            "UPDATE members SET
                name = ?1, phone = ?2, phone_normalized = ?3, member_type = ?4, center = ?5,
                parent_name = ?6, parent_phone = ?7, memo = ?8, address = ?9, member_no = ?10, updated_at = ?11
             WHERE id = ?12 AND deleted_at IS NULL",
            params![
                input.name.trim(),
                normalize_optional_phone(&input.phone),
                phone_normalized,
                member_type,
                input.center,
                input.parent_name,
                input.parent_phone,
                input.notes,
                input.address,
                input.member_no,
                now,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(DbError::Message("\u{D68C}\u{C6D0}\u{C744} \u{CC3E}\u{C744} \u{C218} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()));
        }

        if let Some(membership_id) = tx
            .query_row(
                "SELECT id FROM memberships
                 WHERE member_id = ?1 AND status IN ('active', 'paused')
                 ORDER BY id DESC LIMIT 1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
        {
            tx.execute(
                "UPDATE memberships SET
                    membership_type = ?1, pass_type = ?2, start_date = ?3, end_date = ?4,
                    total_count = ?5, remaining_count = ?6, updated_at = ?7
                 WHERE id = ?8",
                params![
                    membership_type,
                    pass_type,
                    input.start_date,
                    end_date,
                    total_count,
                    remaining_count,
                    now,
                    membership_id,
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO memberships (
                    member_id, membership_type, pass_type, start_date, end_date,
                    total_count, used_count, remaining_count, status, price, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'active', ?8, ?9, ?9)",
                params![
                    id,
                    membership_type,
                    pass_type,
                    input.start_date,
                    end_date,
                    total_count,
                    remaining_count,
                    input.price,
                    now,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    })?;

    if let Some(member) = before_member.as_ref() {
        let summary = super::member_edit_log::summarize_update(
            member,
            before_membership.as_ref(),
            &input,
            &membership_type,
        );
        state.with_conn(|conn| {
            super::member_edit_log::insert_member_edit_log(
                conn,
                id,
                "update",
                input.edited_by.as_deref(),
                &summary,
            )
            .map_err(DbError::from)
        })?;
    }

    state.with_conn(|conn| {
        super::locker::apply_locker_fields(
            conn,
            id,
            &input.center,
            input.locker_number.as_deref(),
            input.locker_start_date.as_deref(),
            input.locker_end_date.as_deref(),
            input.locker_memo.as_deref(),
        )
    })?;

    if let Ok(payload_json) = super::sync_local::build_member_sync_payload_json(state, id) {
        let _ = super::sync_local::enqueue_sync_item(state, "member", id, "update", &payload_json);
    }

    refresh_member_status(state, id)?;
    get_member_list_item_by_id(state, id)
}

pub fn delete_member(state: &AppState, id: i64) -> Result<(), DbError> {
    let delete_payload = super::sync_local::build_member_sync_payload_json(state, id).ok();

    state.with_conn(|conn| {
        let now = now_string();
        let updated = conn.execute(
            "UPDATE members SET deleted_at = ?1, status = 'inactive', updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )?;
        if updated == 0 {
            return Err(DbError::Message("\u{D68C}\u{C6D0}\u{C744} \u{CC3E}\u{C744} \u{C218} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()));
        }
        Ok(())
    })?;

    if let Some(mut payload_json) = delete_payload {
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&payload_json) {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("local_id".to_string(), serde_json::json!(id));
            }
            if let Ok(next) = serde_json::to_string(&value) {
                payload_json = next;
            }
        }
        let _ = super::sync_local::enqueue_sync_item(state, "member", id, "soft_delete", &payload_json);
    }
    Ok(())
}

pub fn check_attendance(state: &AppState, member_id: i64) -> Result<MemberListItem, DbError> {
    let member = get_member(state, member_id)?
        .ok_or_else(|| DbError::Message("\u{D68C}\u{C6D0}\u{C744} \u{CC3E}\u{C744} \u{C218} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()))?;
    let membership = get_active_membership(state, member_id)?
        .ok_or_else(|| DbError::Message("\u{D65C}\u{C131} \u{D68C}\u{C6D0}\u{AD8C}\u{C774} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()))?;

    if membership.status == "paused" || member.status == "paused" {
        return Err(DbError::Message("\u{C77C}\u{C2DC}\u{C815}\u{C9C0} \u{C911}\u{C785}\u{B2C8}\u{B2E4}.".into()));
    }

    let today = today_date();
    let computed = compute_membership_status(
        &membership.status,
        &membership.pass_type,
        &membership.end_date,
        membership.remaining_count,
        today,
    );
    if computed != "active" {
        return Err(DbError::Message(
            "\u{C774}\u{C6A9} \u{AC00}\u{B2A5}\u{D55C} \u{D68C}\u{C6D0}\u{AD8C}\u{C774} \u{C544}\u{B2D9}\u{B2C8}\u{B2E4}.".into(),
        ));
    }

    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = now_string();
        let mut deducted = 0;

        if membership.pass_type == "count" {
            let remaining = membership.remaining_count.unwrap_or(0) - 1;
            let used = membership.used_count + 1;
            deducted = 1;
            let new_status = if remaining <= 0 {
                "finished"
            } else {
                "active"
            };
            tx.execute(
                "UPDATE memberships SET used_count = ?1, remaining_count = ?2, status = ?3, updated_at = ?4 WHERE id = ?5",
                params![used, remaining, new_status, now, membership.id],
            )?;
        }

        tx.execute(
            "INSERT INTO attendance_logs (
                member_id, membership_id, center, checkin_at, attendance_type,
                deducted_count, memo, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
            params![
                member_id,
                membership.id,
                member.center,
                now,
                attendance_type_for_member(&member.member_type),
                deducted,
                now,
            ],
        )?;

        tx.commit()?;
        Ok(())
    })?;

    let attendance_payload = serde_json::json!({ "member_id": member_id });
    let _ = super::sync_local::enqueue_entity_op(
        state,
        "attendance",
        member_id,
        "insert",
        &attendance_payload,
    );

    refresh_member_status(state, member_id)?;
    get_member_list_item_by_id(state, member_id)
}

pub fn get_attendance_logs(
    state: &AppState,
    member_id: i64,
    limit: i64,
) -> Result<Vec<AttendanceLog>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, member_id, membership_id, center, checkin_at, attendance_type,
                    deducted_count, memo, created_at, canceled_at, cancel_reason
             FROM attendance_logs WHERE member_id = ?1 ORDER BY checkin_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![member_id, limit], |row| {
            Ok(AttendanceLog {
                id: row.get(0)?,
                member_id: row.get(1)?,
                membership_id: row.get(2)?,
                center: row.get(3)?,
                checkin_at: row.get(4)?,
                attendance_type: row.get(5)?,
                deducted_count: row.get(6)?,
                memo: row.get(7)?,
                created_at: row.get(8)?,
                canceled_at: row.get(9).ok(),
                cancel_reason: row.get(10).ok(),
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    })
}

pub fn get_payments(state: &AppState, member_id: i64) -> Result<Vec<Payment>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, member_id, membership_id, amount, payment_method, payment_date, memo, created_at
             FROM payments WHERE member_id = ?1 ORDER BY payment_date DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![member_id], |row| {
            Ok(Payment {
                id: row.get(0)?,
                member_id: row.get(1)?,
                membership_id: row.get(2)?,
                amount: row.get(3)?,
                payment_method: row.get(4)?,
                payment_date: row.get(5)?,
                memo: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    })
}

pub fn get_pause_logs(state: &AppState, member_id: i64) -> Result<Vec<PauseLog>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, member_id, membership_id, pause_start_date, pause_end_date,
                    remaining_days_at_pause, reason, created_at, updated_at
             FROM pause_logs WHERE member_id = ?1 ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![member_id], |row| {
            Ok(PauseLog {
                id: row.get(0)?,
                member_id: row.get(1)?,
                membership_id: row.get(2)?,
                pause_start_date: row.get(3)?,
                pause_end_date: row.get(4)?,
                remaining_days_at_pause: row.get(5)?,
                reason: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    })
}

pub fn pause_membership(
    state: &AppState,
    membership_id: i64,
    reason: Option<String>,
) -> Result<MemberListItem, DbError> {
    let (member_id, _center) = state.with_conn(|conn| {
        let now = now_string();
        let today = today_string();
        let tx = conn.transaction()?;

        let (member_id, pass_type, end_date, _remaining_count, center): (
            i64,
            String,
            Option<String>,
            Option<i32>,
            String,
        ) = tx.query_row(
            "SELECT m.id, ms.pass_type, ms.end_date, ms.remaining_count, m.center
             FROM memberships ms
             INNER JOIN members m ON m.id = ms.member_id
             WHERE ms.id = ?1 AND m.deleted_at IS NULL",
            params![membership_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;

        let remaining_days = if pass_type == "period" {
            end_date
                .as_ref()
                .and_then(|value| status::parse_date(value))
                .map(|end| (end - today_date()).num_days() as i32)
        } else {
            None
        };

        tx.execute(
            "UPDATE memberships SET status = 'paused', updated_at = ?1 WHERE id = ?2",
            params![now, membership_id],
        )?;
        tx.execute(
            "UPDATE members SET status = 'paused', updated_at = ?1 WHERE id = ?2",
            params![now, member_id],
        )?;
        tx.execute(
            "INSERT INTO pause_logs (
                member_id, membership_id, pause_start_date, pause_end_date,
                remaining_days_at_pause, reason, created_at, updated_at
             ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?6)",
            params![member_id, membership_id, today, remaining_days, reason, now],
        )?;

        tx.commit()?;
        Ok((member_id, center))
    })?;

    refresh_member_status(state, member_id)?;
    get_member_list_item_by_id(state, member_id)
}

pub fn resume_membership(
    state: &AppState,
    membership_id: i64,
) -> Result<MemberListItem, DbError> {
    let (member_id, _center, remaining_days) = state.with_conn(|conn| {
        let now = now_string();
        let today = today_string();
        let tx = conn.transaction()?;

        let (member_id, center, remaining_days): (i64, String, Option<i32>) = tx.query_row(
            "SELECT m.id, m.center, pl.remaining_days_at_pause
             FROM memberships ms
             INNER JOIN members m ON m.id = ms.member_id
             LEFT JOIN pause_logs pl ON pl.membership_id = ms.id AND pl.pause_end_date IS NULL
             WHERE ms.id = ?1 AND ms.status = 'paused' AND m.deleted_at IS NULL
             ORDER BY pl.id DESC LIMIT 1",
            params![membership_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        if let Some(days) = remaining_days {
            let new_end = today_date() + chrono::Duration::days(days as i64);
            tx.execute(
                "UPDATE memberships SET end_date = ?1 WHERE id = ?2",
                params![new_end.format("%Y-%m-%d").to_string(), membership_id],
            )?;
        }

        tx.execute(
            "UPDATE pause_logs SET pause_end_date = ?1, updated_at = ?2
             WHERE membership_id = ?3 AND pause_end_date IS NULL",
            params![today, now, membership_id],
        )?;
        tx.execute(
            "UPDATE memberships SET status = 'active', updated_at = ?1 WHERE id = ?2",
            params![now, membership_id],
        )?;
        tx.execute(
            "UPDATE members SET status = 'active', updated_at = ?1 WHERE id = ?2",
            params![now, member_id],
        )?;

        tx.commit()?;
        Ok((member_id, center, remaining_days))
    })?;

    let _ = remaining_days;
    refresh_member_status(state, member_id)?;
    get_member_list_item_by_id(state, member_id)
}

pub fn get_attendance(
    state: &AppState,
    member_id: i64,
    limit: i64,
) -> Result<Vec<AttendanceLog>, DbError> {
    get_attendance_logs(state, member_id, limit)
}

pub fn get_dashboard_stats(
    state: &AppState,
    center: &str,
) -> Result<crate::models::DashboardStats, DbError> {
    state.with_conn(|conn| {
        let today = today_string();
        let expiring_limit = (Local::now() + chrono::Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();

        let total_members_sql = format!(
            "SELECT COUNT(*) FROM members m WHERE m.center = ?1 AND m.deleted_at IS NULL{HIDDEN_DUP_FILTER}"
        );
        let total_members: i64 = conn.query_row(
            &total_members_sql,
            params![center],
            |r| r.get(0),
        )?;

        let active_members_sql = format!(
            "SELECT COUNT(*) FROM members m
             LEFT JOIN memberships ms ON ms.id = (
                SELECT id FROM memberships WHERE member_id = m.id AND status IN ('active', 'paused')
                ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC LIMIT 1
             )
             WHERE m.center = ?1 AND m.deleted_at IS NULL AND (
                m.status = 'paused' OR ms.status = 'paused'
                OR (ms.pass_type = 'period' AND ms.end_date IS NOT NULL AND ms.end_date >= ?2)
                OR (ms.pass_type = 'count' AND IFNULL(ms.remaining_count, 0) > 0)
             ){HIDDEN_DUP_FILTER}"
        );
        let active_members: i64 = conn.query_row(
            &active_members_sql,
            params![center, today],
            |r| r.get(0),
        )?;

        let paused_members_sql = format!(
            "SELECT COUNT(*) FROM members m WHERE m.center = ?1 AND m.deleted_at IS NULL AND m.status = 'paused'{HIDDEN_DUP_FILTER}"
        );
        let paused_members: i64 = conn.query_row(
            &paused_members_sql,
            params![center],
            |r| r.get(0),
        )?;

        let expiring_soon_sql = format!(
            "SELECT COUNT(*) FROM members m
             INNER JOIN memberships ms ON ms.id = (
                SELECT id FROM memberships WHERE member_id = m.id AND status = 'active'
                ORDER BY id DESC LIMIT 1
             )
             WHERE m.center = ?1 AND m.deleted_at IS NULL AND (
                (ms.pass_type = 'period' AND ms.end_date IS NOT NULL AND ms.end_date >= ?2 AND ms.end_date <= ?3)
                OR (ms.pass_type = 'count' AND IFNULL(ms.remaining_count, 0) > 0 AND IFNULL(ms.remaining_count, 0) <= 2)
             ){HIDDEN_DUP_FILTER}"
        );
        let expiring_soon: i64 = conn.query_row(
            &expiring_soon_sql,
            params![center, today, expiring_limit],
            |r| r.get(0),
        )?;

        let today_attendance: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs WHERE center = ?1 AND checkin_at LIKE ?2",
            params![center, format!("{today}%")],
            |r| r.get(0),
        )?;

        let trial_members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM trial_members WHERE center = ?1 AND converted = 0",
            params![center],
            |r| r.get(0),
        )?;

        let monthly_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             INNER JOIN members m ON m.id = ms.member_id
             WHERE m.center = ?1 AND m.deleted_at IS NULL AND ms.pass_type = 'period'",
            params![center],
            |r| r.get(0),
        )?;

        let session_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships ms
             INNER JOIN members m ON m.id = ms.member_id
             WHERE m.center = ?1 AND m.deleted_at IS NULL AND ms.membership_type = '5times'",
            params![center],
            |r| r.get(0),
        )?;

        let junior_count: i64 = conn.query_row(
            &super::member_filter::count_junior_members_sql(),
            params![center],
            |r| r.get(0),
        )?;

        let regular_members: i64 = conn.query_row(
            &super::member_filter::count_regular_members_sql(),
            params![center],
            |r| r.get(0),
        )?;

        let inactive_30_members: i64 = conn.query_row(
            &super::member_filter::count_inactive_30_members_sql(&today),
            params![center],
            |r| r.get(0),
        )?;

        let no_member_no_count: i64 = conn.query_row(
            super::member_filter::count_no_member_no_sql(),
            params![center],
            |r| r.get(0),
        )?;

        Ok(crate::models::DashboardStats {
            total_members,
            active_members,
            expiring_soon,
            paused_members,
            today_attendance,
            trial_members,
            monthly_count,
            session_count,
            junior_count,
            regular_members,
            inactive_30_members,
            no_member_no_count,
        })
    })
}

pub fn get_expiring_members(
    state: &AppState,
    center: &str,
    days: i64,
) -> Result<Vec<MemberListItem>, DbError> {
    let (members, _) = list_members(state, center, "", "all", "all", 1, 500)?;
    let today = today_date();
    let limit = today + chrono::Duration::days(days);

    Ok(members
        .into_iter()
        .filter(|member| {
            if member.status == "paused" {
                return false;
            }
            if member.pass_type.as_deref() == Some("period") {
                if let Some(end) = member.end_date.as_ref().and_then(|v| status::parse_date(v)) {
                    return end >= today && end <= limit;
                }
                return false;
            }
            member.remaining_count.unwrap_or(0) > 0 && member.remaining_count.unwrap_or(0) <= 2
        })
        .take(100)
        .collect())
}

pub fn export_all_data(state: &AppState) -> Result<serde_json::Value, DbError> {
    state.with_conn(|conn| {
        let members = export_members(conn)?;
        let memberships = export_memberships(conn)?;
        let attendance = export_attendance(conn)?;
        let payments = export_payments(conn)?;
        let pause_logs = export_pause_logs(conn)?;
        let trial_members = export_trial_members(conn)?;

        Ok(serde_json::json!({
            "schema_version": 2,
            "exported_at": now_string(),
            "members": members,
            "memberships": memberships,
            "attendance_logs": attendance,
            "payments": payments,
            "pause_logs": pause_logs,
            "trial_members": trial_members,
        }))
    })
}

pub fn restore_all_data(state: &AppState, payload: serde_json::Value) -> Result<(), DbError> {
    if payload.get("schema_version").and_then(|v| v.as_i64()) == Some(2) {
        restore_v2(state, payload)
    } else {
        restore_v1(state, payload)
    }
}

fn restore_v1(state: &AppState, payload: serde_json::Value) -> Result<(), DbError> {
    let members: Vec<serde_json::Value> = serde_json::from_value(
        payload
            .get("members")
            .cloned()
            .ok_or_else(|| DbError::Message("\u{BC31}\u{C5C5}\u{C5D0} members \u{B370}\u{C774}\u{D130}\u{AC00} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()))?,
    )
    .map_err(|e| DbError::Message(format!("\u{BC31}\u{C5C5} \u{BC0D}\u{C774}\u{D130} \u{D30C}\u{C2F1} \u{C2E4}\u{D328}: {e}")))?;

    let attendance: Vec<serde_json::Value> = serde_json::from_value(
        payload
            .get("attendance")
            .cloned()
            .unwrap_or(serde_json::json!([])),
    )
    .map_err(|e| DbError::Message(format!("\u{BC31}\u{C5C5} \u{BC0D}\u{C774}\u{D130} \u{D30C}\u{C2F1} \u{C2E4}\u{D328}: {e}")))?;

    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        clear_all_tables(&tx)?;

        for value in members {
            let center = value["center"].as_str().unwrap_or("ONCLE");
            let membership_type = value["membership_type"].as_str().unwrap_or("monthly_1");
            let total_sessions = value["total_sessions"].as_i64().map(|v| v as i32);
            let remaining_sessions = value["remaining_sessions"].as_i64().map(|v| v as i32);
            let (new_type, pass_type, total_count, _, _) =
                map_legacy_membership(membership_type, total_sessions);
            let member_type = status::legacy_member_type(membership_type);
            let phone = value["phone"].as_str().map(|s| s.to_string());
            let phone_normalized = normalize_phone(&phone);

            tx.execute(
                "INSERT INTO members (
                    id, name, phone, phone_normalized, member_type, center, parent_name, parent_phone,
                    memo, status, created_at, updated_at, deleted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, 'active', ?8, ?9, NULL)",
                params![
                    value["id"].as_i64().unwrap_or(0),
                    value["name"].as_str().unwrap_or(""),
                    phone,
                    phone_normalized,
                    member_type,
                    center,
                    value["notes"].as_str(),
                    value["created_at"].as_str().unwrap_or(""),
                    value["updated_at"].as_str().unwrap_or(""),
                ],
            )?;

            let used_count = if pass_type == "count" {
                total_count.unwrap_or(0) - remaining_sessions.unwrap_or(total_count.unwrap_or(0))
            } else {
                0
            };

            tx.execute(
                "INSERT INTO memberships (
                    member_id, membership_type, pass_type, start_date, end_date,
                    total_count, used_count, remaining_count, status, price, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', NULL, ?9, ?9)",
                params![
                    value["id"].as_i64().unwrap_or(0),
                    new_type,
                    pass_type,
                    value["start_date"].as_str().unwrap_or(""),
                    value["end_date"].as_str(),
                    total_count,
                    used_count,
                    remaining_sessions.or(total_count),
                    value["created_at"].as_str().unwrap_or(""),
                ],
            )?;
            let membership_id = tx.last_insert_rowid();

            for record in attendance
                .iter()
                .filter(|r| r["member_id"].as_i64() == value["id"].as_i64())
            {
                tx.execute(
                    "INSERT INTO attendance_logs (
                        id, member_id, membership_id, center, checkin_at, attendance_type,
                        deducted_count, memo, created_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'normal', 0, NULL, ?6)",
                    params![
                        record["id"].as_i64().unwrap_or(0),
                        value["id"].as_i64().unwrap_or(0),
                        membership_id,
                        center,
                        record["checked_at"].as_str().unwrap_or(""),
                        record["checked_at"].as_str().unwrap_or(""),
                    ],
                )?;
            }
        }

        tx.commit()?;
        refresh_all_statuses(conn)?;
        Ok(())
    })?;
    Ok(())
}

fn restore_v2(state: &AppState, payload: serde_json::Value) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        clear_all_tables(&tx)?;
        insert_json_rows(&tx, "members", payload.get("members"))?;
        insert_json_rows(&tx, "memberships", payload.get("memberships"))?;
        insert_json_rows(&tx, "attendance_logs", payload.get("attendance_logs"))?;
        insert_json_rows(&tx, "payments", payload.get("payments"))?;
        insert_json_rows(&tx, "pause_logs", payload.get("pause_logs"))?;
        insert_json_rows(&tx, "trial_members", payload.get("trial_members"))?;
        tx.commit()?;
        refresh_all_statuses(conn)?;
        Ok(())
    })?;
    Ok(())
}

fn clear_all_tables(conn: &Connection) -> Result<(), DbError> {
    conn.execute("DELETE FROM member_edit_logs", [])?;
    conn.execute("DELETE FROM attendance_logs", [])?;
    conn.execute("DELETE FROM payments", [])?;
    conn.execute("DELETE FROM pause_logs", [])?;
    conn.execute("DELETE FROM memberships", [])?;
    conn.execute("DELETE FROM trial_members", [])?;
    conn.execute("DELETE FROM members", [])?;
    Ok(())
}

fn insert_json_rows(
    conn: &Connection,
    table: &str,
    values: Option<&serde_json::Value>,
) -> Result<(), DbError> {
    let Some(items) = values.and_then(|v| v.as_array()) else {
        return Ok(());
    };

    for item in items {
        let obj = item
            .as_object()
            .ok_or_else(|| DbError::Message(format!("{table} JSON ?? ??")))?;
        let columns: Vec<&str> = obj.keys().map(String::as_str).collect();
        let placeholders = (0..columns.len())
            .map(|idx| format!("?{}", idx + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            columns.join(", ")
        );
        let values: Vec<serde_json::Value> = columns
            .iter()
            .map(|key| obj.get(*key).cloned().unwrap_or(serde_json::Value::Null))
            .collect();
        conn.execute(
            &sql,
            rusqlite::params_from_iter(values.iter().map(json_to_sql_value)),
        )?;
    }

    Ok(())
}

fn json_to_sql_value(value: &serde_json::Value) -> rusqlite::types::Value {
    match value {
        serde_json::Value::Null => rusqlite::types::Value::Null,
        serde_json::Value::Bool(v) => rusqlite::types::Value::Integer(*v as i64),
        serde_json::Value::Number(v) => {
            if let Some(i) = v.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(f) = v.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        serde_json::Value::String(v) => rusqlite::types::Value::Text(v.clone()),
        _ => rusqlite::types::Value::Text(value.to_string()),
    }
}

fn export_members(conn: &Connection) -> Result<Vec<Member>, DbError> {
    let mut stmt = conn.prepare(MEMBER_SELECT)?;
    let rows = stmt.query_map([], map_member)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn export_memberships(conn: &Connection) -> Result<Vec<Membership>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, membership_type, pass_type, start_date, end_date,
                total_count, used_count, remaining_count, status, price, created_at, updated_at
         FROM memberships ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], map_membership)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn export_attendance(conn: &Connection) -> Result<Vec<AttendanceLog>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, membership_id, center, checkin_at, attendance_type,
                deducted_count, memo, created_at FROM attendance_logs ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AttendanceLog {
            id: row.get(0)?,
            member_id: row.get(1)?,
            membership_id: row.get(2)?,
            center: row.get(3)?,
            checkin_at: row.get(4)?,
            attendance_type: row.get(5)?,
            deducted_count: row.get(6)?,
            memo: row.get(7)?,
            created_at: row.get(8)?,
            canceled_at: None,
            cancel_reason: None,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn export_payments(conn: &Connection) -> Result<Vec<Payment>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, membership_id, amount, payment_method, payment_date, memo, created_at
         FROM payments ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Payment {
            id: row.get(0)?,
            member_id: row.get(1)?,
            membership_id: row.get(2)?,
            amount: row.get(3)?,
            payment_method: row.get(4)?,
            payment_date: row.get(5)?,
            memo: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn export_pause_logs(conn: &Connection) -> Result<Vec<PauseLog>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, membership_id, pause_start_date, pause_end_date,
                remaining_days_at_pause, reason, created_at, updated_at
         FROM pause_logs ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PauseLog {
            id: row.get(0)?,
            member_id: row.get(1)?,
            membership_id: row.get(2)?,
            pause_start_date: row.get(3)?,
            pause_end_date: row.get(4)?,
            remaining_days_at_pause: row.get(5)?,
            reason: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn export_trial_members(conn: &Connection) -> Result<Vec<crate::models::TrialMember>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, phone, center, trial_date, trial_price, converted,
                converted_member_id, memo, created_at
         FROM trial_members ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::TrialMember {
            id: row.get(0)?,
            name: row.get(1)?,
            phone: row.get(2)?,
            center: row.get(3)?,
            trial_date: row.get(4)?,
            trial_price: row.get(5)?,
            converted: row.get::<_, i64>(6)? == 1,
            converted_member_id: row.get(7)?,
            memo: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

pub(crate) fn refresh_member_status(state: &AppState, member_id: i64) -> Result<(), DbError> {
    state.with_conn(|conn| refresh_member_status_conn(conn, member_id))
}

fn refresh_member_status_conn(conn: &Connection, member_id: i64) -> Result<(), DbError> {
    let today = today_date();
    let now = now_string();

    let membership: Option<Membership> = conn
        .query_row(
            "SELECT id, member_id, membership_type, pass_type, start_date, end_date,
                    total_count, used_count, remaining_count, status, price, created_at, updated_at
             FROM memberships
             WHERE member_id = ?1 AND status IN ('active', 'paused', 'expired', 'finished')
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, id DESC
             LIMIT 1",
            params![member_id],
            map_membership,
        )
        .optional()?;

    let member_status = if let Some(ms) = &membership {
        if ms.status == "paused" {
            "paused".to_string()
        } else {
            let computed = compute_membership_status(
                &ms.status,
                &ms.pass_type,
                &ms.end_date,
                ms.remaining_count,
                today,
            );
            match computed.as_str() {
                "expired" | "finished" => "expired".to_string(),
                _ => "active".to_string(),
            }
        }
    } else {
        "inactive".to_string()
    };

    conn.execute(
        "UPDATE members SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![member_status, now, member_id],
    )?;

    if let Some(ms) = membership {
        if ms.status != "paused" {
            let computed = compute_membership_status(
                &ms.status,
                &ms.pass_type,
                &ms.end_date,
                ms.remaining_count,
                today,
            );
            if computed != ms.status {
                conn.execute(
                    "UPDATE memberships SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    params![computed, now, ms.id],
                )?;
            }
        }
    }

    Ok(())
}

pub fn refresh_all_statuses(conn: &Connection) -> Result<(), DbError> {
    let ids: Vec<i64> = conn.prepare("SELECT id FROM members WHERE deleted_at IS NULL")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;

    for id in ids {
        refresh_member_status_conn(conn, id)?;
    }
    Ok(())
}

fn validate_member_input(input: &MemberInput) -> Result<(), DbError> {
    if input.name.trim().is_empty() {
        return Err(DbError::Message("\u{C774}\u{B984}\u{C744} \u{C785}\u{B825}\u{D574}\u{C8FC}\u{C138}\u{C694}.".into()));
    }
    if input.center != "ONCLE" && input.center != "GRABIT" {
        return Err(DbError::Message("\u{C13C}\u{D130}\u{B97C} \u{C120}\u{D0DD}\u{D574}\u{C8FC}\u{C138}\u{C694}.".into()));
    }
    match input.membership_type.as_str() {
        "monthly_1" | "monthly_3" | "monthly_6" => {
            if input.end_date.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(DbError::Message("\u{C885}\u{B8CC}\u{C77C}\u{C744} \u{C785}\u{B825}\u{D574}\u{C8FC}\u{C138}\u{C694}.".into()));
            }
        }
        "session" => {
            let total = input.total_sessions.unwrap_or(0);
            if total < 1 {
                return Err(DbError::Message("\u{CD9D}\u{D69F}\u{C218}\u{B294} 1\u{D69F} \u{C774}\u{C0C1} \u{C785}\u{B825}\u{D574}\u{C8FC}\u{C138}\u{C694}.".into()));
            }
            if let Some(remaining) = input.remaining_sessions {
                if remaining > total {
                    return Err(DbError::Message("\u{C794}\u{C5EC} \u{D69F}\u{C218}\u{B294} \u{CD9D} \u{D69F}\u{C218}\u{B97C} \u{CD08}\u{D2B8}\u{D560} \u{C218} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.".into()));
                }
                if remaining < 0 {
                    return Err(DbError::Message("\u{C794}\u{C5EC} \u{D69F}\u{C218}\u{B294} 0 \u{C774}\u{C0C1}\u{C774}\u{C5B4}\u{C57C} \u{D569}\u{B2C8}\u{B2E4}.".into()));
                }
            }
        }
        "junior" => {
            let total = input.total_sessions.unwrap_or(0);
            if total < 1 {
                return Err(DbError::Message("수업 횟수는 1회 이상 입력해주세요.".into()));
            }
            if let Some(remaining) = input.remaining_sessions {
                if remaining > total {
                    return Err(DbError::Message("잔여 수업 횟수는 총 수업 횟수보다 클 수 없습니다.".into()));
                }
                if remaining < 0 {
                    return Err(DbError::Message("수업 횟수는 1회 이상 입력해주세요.".into()));
                }
            }
        }
        _ => return Err(DbError::Message("\u{C9C0}\u{C6D0}\u{D558}\u{C9C0} \u{C54A}\u{B294} \u{D68C}\u{C6D0}\u{AD8C} \u{C885}\u{B958}\u{C785}\u{B2C8}\u{B2E4}.".into())),
    }
    Ok(())
}