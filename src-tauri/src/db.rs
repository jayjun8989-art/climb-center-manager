use crate::models::{Member, MemberInput};
use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult, Row};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("데이터베이스 오류: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("데이터베이스가 잠겨 있습니다")]
    Lock,
    #[error("{0}")]
    Message(String),
}

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub startup_backup_created: Mutex<bool>,
}

impl AppState {
    pub fn new(db_path: PathBuf, backup_dir: PathBuf) -> SqlResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::create_dir_all(&backup_dir).ok();

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

            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                center TEXT NOT NULL CHECK(center IN ('ONCLE', 'GRABIT')),
                name TEXT NOT NULL,
                phone TEXT,
                membership_type TEXT NOT NULL CHECK(membership_type IN ('monthly_1', 'monthly_3', 'monthly_6', 'session', 'junior')),
                start_date TEXT NOT NULL,
                end_date TEXT,
                total_sessions INTEGER,
                remaining_sessions INTEGER,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER NOT NULL,
                checked_at TEXT NOT NULL,
                FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_members_center ON members(center);
            CREATE INDEX IF NOT EXISTS idx_members_name ON members(name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
            CREATE INDEX IF NOT EXISTS idx_members_end_date ON members(end_date);
            CREATE INDEX IF NOT EXISTS idx_members_type ON members(membership_type);
            CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance(member_id);
            CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(checked_at);
            ",
        )?;

        migrate_db(&conn)?;
        ensure_phone_normalized(&conn)?;
        backfill_session_members(&conn)?;
        backfill_junior_members(&conn)?;
        verify_db_integrity(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
            backup_dir,
            startup_backup_created: Mutex::new(false),
        })
    }

    fn with_conn<F, T>(&self, f: F) -> Result<T, DbError>
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
                journal_mode,
                integrity_ok,
            })
        })
    }
}

fn verify_db_integrity(conn: &Connection) -> SqlResult<()> {
    let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result.to_ascii_lowercase() != "ok" {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
            Some(format!("데이터베이스 무결성 검사 실패: {result}")),
        ));
    }
    Ok(())
}

fn migrate_db(conn: &Connection) -> SqlResult<()> {
    let schema: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='members'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    if schema.contains("monthly_1") {
        return Ok(());
    }

    if schema.is_empty() {
        return Ok(());
    }

    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;

        CREATE TABLE members_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            center TEXT NOT NULL CHECK(center IN ('ONCLE', 'GRABIT')),
            name TEXT NOT NULL,
            phone TEXT,
            membership_type TEXT NOT NULL CHECK(membership_type IN ('monthly_1', 'monthly_3', 'monthly_6', 'session', 'junior')),
            start_date TEXT NOT NULL,
            end_date TEXT,
            total_sessions INTEGER,
            remaining_sessions INTEGER,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT INTO members_new (
            id, center, name, phone, membership_type, start_date, end_date,
            total_sessions, remaining_sessions, notes, created_at, updated_at
        )
        SELECT
            id, center, name, phone,
            CASE membership_type WHEN 'monthly' THEN 'monthly_1' ELSE membership_type END,
            start_date, end_date, total_sessions, remaining_sessions, notes, created_at, updated_at
        FROM members;

        DROP TABLE members;
        ALTER TABLE members_new RENAME TO members;

        CREATE INDEX IF NOT EXISTS idx_members_center ON members(center);
        CREATE INDEX IF NOT EXISTS idx_members_name ON members(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
        CREATE INDEX IF NOT EXISTS idx_members_end_date ON members(end_date);
        CREATE INDEX IF NOT EXISTS idx_members_type ON members(membership_type);

        COMMIT;
        PRAGMA foreign_keys = ON;
        ",
    )?;

    Ok(())
}

fn backfill_junior_members(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        UPDATE members
        SET total_sessions = 8
        WHERE membership_type = 'junior'
          AND (total_sessions IS NULL OR total_sessions NOT IN (8, 16));

        UPDATE members
        SET remaining_sessions = total_sessions
        WHERE membership_type = 'junior'
          AND remaining_sessions IS NULL;
        ",
    )?;
    Ok(())
}

fn ensure_phone_normalized(conn: &Connection) -> SqlResult<()> {
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
            CREATE INDEX IF NOT EXISTS idx_members_center_name ON members(center, name COLLATE NOCASE);
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

fn normalize_phone(phone: &Option<String>) -> Option<String> {
    phone.as_ref().and_then(|value| {
        let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
        if digits.len() >= 4 {
            Some(digits)
        } else {
            None
        }
    })
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
             WHERE center = ?1 AND phone_normalized = ?2 AND id != ?3
             LIMIT 1",
            params![center, normalized, id],
            |row| row.get(0),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND phone_normalized = ?2
             LIMIT 1",
            params![center, normalized],
            |row| row.get(0),
        )
        .optional()?
    };

    if existing_id.is_some() {
        return Err(DbError::Message(
            "같은 센터에 이미 등록된 전화번호입니다.".into(),
        ));
    }

    Ok(())
}

const ACTIVE_MEMBER_SQL: &str = "(
        (membership_type IN ('monthly_1', 'monthly_3', 'monthly_6') AND end_date IS NOT NULL AND end_date >= ?)
        OR (
            membership_type = 'session'
            AND IFNULL(remaining_sessions, 0) > 0
            AND end_date IS NOT NULL
            AND end_date >= ?
        )
        OR (membership_type = 'junior' AND IFNULL(remaining_sessions, 0) > 0)
    )";

fn status_filter_clause(status_filter: &str) -> String {
    match status_filter {
        "active" => format!(" AND {ACTIVE_MEMBER_SQL}"),
        "expired" => format!(" AND NOT {ACTIVE_MEMBER_SQL}"),
        _ => String::new(),
    }
}

fn member_group_clause(group: &str) -> &'static str {
    match group {
        "general" => " AND membership_type != 'junior'",
        "junior" => " AND membership_type = 'junior'",
        _ => "",
    }
}

fn backfill_session_members(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        UPDATE members
        SET
            end_date = date(start_date, '+2 months', '-1 day'),
            total_sessions = 5
        WHERE membership_type = 'session'
          AND (end_date IS NULL OR end_date = '');

        UPDATE members
        SET remaining_sessions = total_sessions
        WHERE membership_type = 'session'
          AND remaining_sessions IS NULL;
        ",
    )?;
    Ok(())
}

fn map_member(row: &Row<'_>) -> SqlResult<Member> {
    Ok(Member {
        id: row.get(0)?,
        center: row.get(1)?,
        name: row.get(2)?,
        phone: row.get(3)?,
        membership_type: row.get(4)?,
        start_date: row.get(5)?,
        end_date: row.get(6)?,
        total_sessions: row.get(7)?,
        remaining_sessions: row.get(8)?,
        notes: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const MEMBER_SELECT: &str = "
    SELECT id, center, name, phone, membership_type, start_date, end_date,
           total_sessions, remaining_sessions, notes, created_at, updated_at
    FROM members
";

pub fn list_members(
    state: &AppState,
    center: &str,
    search: &str,
    member_group: &str,
    status_filter: &str,
    page: i64,
    page_size: i64,
) -> Result<(Vec<Member>, i64), DbError> {
    state.with_conn(|conn| {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let trimmed_search = search.trim();
        let has_search = !trimmed_search.is_empty();
        let group_clause = member_group_clause(member_group);
        let status_clause = status_filter_clause(status_filter);
        let uses_status_filter = status_filter == "active" || status_filter == "expired";

        let search_clause;
        let phone_prefix;
        let name_pattern;
        let broad_pattern;

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
                phone_prefix = Some(format!("{digits}%"));
                name_pattern = Some(format!("%{trimmed_search}%"));
                search_clause = " AND (phone_normalized LIKE ? OR name LIKE ? COLLATE NOCASE OR IFNULL(notes, '') LIKE ? COLLATE NOCASE)";
                broad_pattern = Some(format!("%{trimmed_search}%"));
            } else {
                phone_prefix = None;
                name_pattern = None;
                broad_pattern = Some(format!("%{trimmed_search}%"));
                search_clause = " AND (name LIKE ? COLLATE NOCASE OR IFNULL(phone, '') LIKE ? OR IFNULL(notes, '') LIKE ? COLLATE NOCASE)";
            }
        } else {
            phone_prefix = None;
            name_pattern = None;
            broad_pattern = None;
            search_clause = "";
        }

        let count_sql = format!(
            "SELECT COUNT(*) FROM members WHERE center = ?1{group_clause}{status_clause}{search_clause}"
        );

        let mut count_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(center.to_string())];
        if uses_status_filter {
            count_params.push(Box::new(today.clone()));
            count_params.push(Box::new(today.clone()));
        }
        if has_search {
            if let Some(prefix) = &phone_prefix {
                count_params.push(Box::new(prefix.clone()));
                count_params.push(Box::new(name_pattern.clone().unwrap_or_default()));
                count_params.push(Box::new(broad_pattern.clone().unwrap_or_default()));
            } else if let Some(pattern) = &broad_pattern {
                count_params.push(Box::new(pattern.clone()));
                count_params.push(Box::new(pattern.clone()));
                count_params.push(Box::new(pattern.clone()));
            }
        }

        let count_refs: Vec<&dyn rusqlite::types::ToSql> =
            count_params.iter().map(|value| value.as_ref()).collect();
        let total: i64 = conn.query_row(&count_sql, count_refs.as_slice(), |row| row.get(0))?;

        let offset = (page - 1).max(0) * page_size;
        let list_sql = format!(
            "{MEMBER_SELECT} WHERE center = ?1{group_clause}{status_clause}{search_clause}
             ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?"
        );

        let mut list_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(center.to_string())];
        if uses_status_filter {
            list_params.push(Box::new(today.clone()));
            list_params.push(Box::new(today.clone()));
        }
        if has_search {
            if let Some(prefix) = &phone_prefix {
                list_params.push(Box::new(prefix.clone()));
                list_params.push(Box::new(name_pattern.clone().unwrap_or_default()));
                list_params.push(Box::new(broad_pattern.clone().unwrap_or_default()));
            } else if let Some(pattern) = &broad_pattern {
                list_params.push(Box::new(pattern.clone()));
                list_params.push(Box::new(pattern.clone()));
                list_params.push(Box::new(pattern.clone()));
            }
        }
        list_params.push(Box::new(page_size));
        list_params.push(Box::new(offset));

        let list_refs: Vec<&dyn rusqlite::types::ToSql> =
            list_params.iter().map(|value| value.as_ref()).collect();
        let mut stmt = conn.prepare(&list_sql)?;
        let rows = stmt.query_map(list_refs.as_slice(), map_member)?;
        let mut members = Vec::new();
        for row in rows {
            members.push(row?);
        }

        Ok((members, total))
    })
}

pub fn get_member(state: &AppState, id: i64) -> Result<Option<Member>, DbError> {
    state.with_conn(|conn| {
        let sql = format!("{MEMBER_SELECT} WHERE id = ?1");
        conn.query_row(&sql, params![id], map_member)
            .optional()
            .map_err(DbError::from)
    })
}

pub fn create_member(state: &AppState, input: MemberInput) -> Result<Member, DbError> {
    validate_member_input(&input)?;
    let phone_normalized = normalize_phone(&input.phone);
    let id = state.with_conn(|conn| {
        assert_phone_unique(conn, &input.center, &phone_normalized, None)?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO members (center, name, phone, phone_normalized, membership_type, start_date, end_date,
             total_sessions, remaining_sessions, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                input.center,
                input.name.trim(),
                normalize_optional_phone(&input.phone),
                phone_normalized,
                input.membership_type,
                input.start_date,
                input.end_date,
                input.total_sessions,
                input.remaining_sessions,
                input.notes,
                now,
                now,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    })?;
    get_member(state, id)?.ok_or_else(|| DbError::Message("회원 생성 후 조회에 실패했습니다.".into()))
}

pub fn update_member(state: &AppState, id: i64, input: MemberInput) -> Result<Member, DbError> {
    validate_member_input(&input)?;
    let phone_normalized = normalize_phone(&input.phone);
    state.with_conn(|conn| {
        assert_phone_unique(conn, &input.center, &phone_normalized, Some(id))?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let updated = conn.execute(
            "UPDATE members SET center = ?1, name = ?2, phone = ?3, phone_normalized = ?4, membership_type = ?5,
             start_date = ?6, end_date = ?7, total_sessions = ?8, remaining_sessions = ?9,
             notes = ?10, updated_at = ?11 WHERE id = ?12",
            params![
                input.center,
                input.name.trim(),
                normalize_optional_phone(&input.phone),
                phone_normalized,
                input.membership_type,
                input.start_date,
                input.end_date,
                input.total_sessions,
                input.remaining_sessions,
                input.notes,
                now,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(DbError::Message("회원을 찾을 수 없습니다.".into()));
        }
        Ok(())
    })?;
    get_member(state, id)?.ok_or_else(|| DbError::Message("회원 수정 후 조회에 실패했습니다.".into()))
}

fn normalize_optional_phone(phone: &Option<String>) -> Option<String> {
    phone
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

pub fn delete_member(state: &AppState, id: i64) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let deleted = conn.execute("DELETE FROM members WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(DbError::Message("회원을 찾을 수 없습니다.".into()));
        }
        Ok(())
    })
}

pub fn check_attendance(state: &AppState, member_id: i64) -> Result<Member, DbError> {
    let member = get_member(state, member_id)?
        .ok_or_else(|| DbError::Message("회원을 찾을 수 없습니다.".into()))?;

    if !is_member_active(&member) {
        return Err(DbError::Message(
            "만료되었거나 이용 가능 횟수가 없는 회원입니다.".into(),
        ));
    }

    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        tx.execute(
            "INSERT INTO attendance (member_id, checked_at) VALUES (?1, ?2)",
            params![member_id, now],
        )?;

        if member.membership_type == "session" || member.membership_type == "junior" {
            let remaining = member.remaining_sessions.unwrap_or(0) - 1;
            tx.execute(
                "UPDATE members SET remaining_sessions = ?1, updated_at = ?2 WHERE id = ?3",
                params![remaining, now, member_id],
            )?;
        }

        tx.commit()?;
        Ok(())
    })?;

    get_member(state, member_id)?.ok_or_else(|| DbError::Message("출석 처리 후 조회에 실패했습니다.".into()))
}

pub fn get_attendance(
    state: &AppState,
    member_id: i64,
    limit: i64,
) -> Result<Vec<crate::models::AttendanceRecord>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, member_id, checked_at FROM attendance
             WHERE member_id = ?1 ORDER BY checked_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![member_id, limit], |row| {
            Ok(crate::models::AttendanceRecord {
                id: row.get(0)?,
                member_id: row.get(1)?,
                checked_at: row.get(2)?,
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    })
}

pub fn get_dashboard_stats(state: &AppState, center: &str) -> Result<crate::models::DashboardStats, DbError> {
    state.with_conn(|conn| {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let expiring_limit = (Local::now() + chrono::Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();

        let total_members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1",
            params![center],
            |r| r.get(0),
        )?;

        let monthly_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1 AND membership_type IN ('monthly_1', 'monthly_3', 'monthly_6')",
            params![center],
            |r| r.get(0),
        )?;

        let session_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1 AND membership_type = 'session'",
            params![center],
            |r| r.get(0),
        )?;

        let junior_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1 AND membership_type = 'junior'",
            params![center],
            |r| r.get(0),
        )?;

        let expiring_soon: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1
             AND (
                (
                    end_date IS NOT NULL
                    AND end_date >= ?2 AND end_date <= ?3
                    AND membership_type IN ('monthly_1', 'monthly_3', 'monthly_6')
                )
                OR (
                    membership_type = 'session'
                    AND IFNULL(remaining_sessions, 0) > 0
                    AND end_date IS NOT NULL
                    AND end_date >= ?2 AND end_date <= ?3
                )
                OR (
                    membership_type = 'junior'
                    AND IFNULL(remaining_sessions, 0) > 0
                    AND IFNULL(remaining_sessions, 0) <= 2
                )
             )",
            params![center, today, expiring_limit],
            |r| r.get(0),
        )?;

        let today_attendance: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance a
             INNER JOIN members m ON m.id = a.member_id
             WHERE m.center = ?1 AND a.checked_at LIKE ?2",
            params![center, format!("{today}%")],
            |r| r.get(0),
        )?;

        let active_members: i64 = conn.query_row(
            "SELECT COUNT(*) FROM members WHERE center = ?1 AND (
                (membership_type IN ('monthly_1', 'monthly_3', 'monthly_6') AND end_date IS NOT NULL AND end_date >= ?2)
                OR (membership_type = 'session' AND IFNULL(remaining_sessions, 0) > 0 AND end_date IS NOT NULL AND end_date >= ?2)
                OR (membership_type = 'junior' AND IFNULL(remaining_sessions, 0) > 0)
            )",
            params![center, today],
            |r| r.get(0),
        )?;

        Ok(crate::models::DashboardStats {
            total_members,
            active_members,
            expiring_soon,
            today_attendance,
            monthly_count,
            session_count,
            junior_count,
        })
    })
}

pub fn get_expiring_members(
    state: &AppState,
    center: &str,
    days: i64,
) -> Result<Vec<Member>, DbError> {
    state.with_conn(|conn| {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let limit = (Local::now() + chrono::Duration::days(days))
            .format("%Y-%m-%d")
            .to_string();
        let sql = format!(
            "{MEMBER_SELECT} WHERE center = ?1
             AND (
                (
                    end_date IS NOT NULL
                    AND end_date >= ?2 AND end_date <= ?3
                    AND membership_type IN ('monthly_1', 'monthly_3', 'monthly_6')
                )
                OR (
                    membership_type = 'session'
                    AND IFNULL(remaining_sessions, 0) > 0
                    AND end_date IS NOT NULL
                    AND end_date >= ?2 AND end_date <= ?3
                )
                OR (
                    membership_type = 'junior'
                    AND IFNULL(remaining_sessions, 0) > 0
                    AND IFNULL(remaining_sessions, 0) <= 2
                )
             )
             ORDER BY
                CASE
                    WHEN membership_type = 'junior' THEN IFNULL(remaining_sessions, 0)
                    ELSE 999
                END ASC,
                end_date ASC
             LIMIT 100"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![center, today, limit], map_member)?;
        let mut members = Vec::new();
        for row in rows {
            members.push(row?);
        }
        Ok(members)
    })
}

pub fn restore_all_data(
    state: &AppState,
    members: Vec<Member>,
    attendance: Vec<crate::models::AttendanceRecord>,
) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM attendance", [])?;
        tx.execute("DELETE FROM members", [])?;

        for member in &members {
            let phone_normalized = normalize_phone(&member.phone);
            tx.execute(
                "INSERT INTO members (
                    id, center, name, phone, phone_normalized, membership_type, start_date, end_date,
                    total_sessions, remaining_sessions, notes, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    member.id,
                    member.center,
                    member.name,
                    member.phone,
                    phone_normalized,
                    member.membership_type,
                    member.start_date,
                    member.end_date,
                    member.total_sessions,
                    member.remaining_sessions,
                    member.notes,
                    member.created_at,
                    member.updated_at,
                ],
            )?;
        }

        for record in &attendance {
            tx.execute(
                "INSERT INTO attendance (id, member_id, checked_at) VALUES (?1, ?2, ?3)",
                params![record.id, record.member_id, record.checked_at],
            )?;
        }

        if let Some(max_member_id) = tx
            .query_row("SELECT MAX(id) FROM members", [], |row| row.get::<_, i64>(0))
            .optional()?
        {
            tx.execute(
                "UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'members'",
                params![max_member_id],
            )
            .ok();
        }

        if let Some(max_attendance_id) = tx
            .query_row("SELECT MAX(id) FROM attendance", [], |row| row.get::<_, i64>(0))
            .optional()?
        {
            tx.execute(
                "UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'attendance'",
                params![max_attendance_id],
            )
            .ok();
        }

        tx.commit()?;
        Ok(())
    })
}

pub fn export_all_data(state: &AppState) -> Result<serde_json::Value, DbError> {
    state.with_conn(|conn| {
        let mut member_stmt = conn.prepare(MEMBER_SELECT)?;
        let member_rows = member_stmt.query_map([], map_member)?;
        let mut members = Vec::new();
        for row in member_rows {
            members.push(row?);
        }

        let mut attendance_stmt =
            conn.prepare("SELECT id, member_id, checked_at FROM attendance ORDER BY checked_at DESC")?;
        let attendance_rows = attendance_stmt.query_map([], |row| {
            Ok(crate::models::AttendanceRecord {
                id: row.get(0)?,
                member_id: row.get(1)?,
                checked_at: row.get(2)?,
            })
        })?;
        let mut attendance = Vec::new();
        for row in attendance_rows {
            attendance.push(row?);
        }

        Ok(serde_json::json!({
            "exported_at": Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            "members": members,
            "attendance": attendance,
        }))
    })
}

fn validate_member_input(input: &MemberInput) -> Result<(), DbError> {
    if input.name.trim().is_empty() {
        return Err(DbError::Message("이름을 입력해주세요.".into()));
    }
    if input.center != "ONCLE" && input.center != "GRABIT" {
        return Err(DbError::Message("센터를 선택해주세요.".into()));
    }
    match input.membership_type.as_str() {
        "monthly_1" | "monthly_3" | "monthly_6" => {
            if input.end_date.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(DbError::Message("만료일을 입력해주세요.".into()));
            }
        }
        "session" => {
            if input.total_sessions.unwrap_or(0) != 5 {
                return Err(DbError::Message("횟수권은 5회 기준입니다.".into()));
            }
            if input.end_date.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(DbError::Message("횟수권 만료일을 확인해주세요.".into()));
            }
        }
        "junior" => {
            let total = input.total_sessions.unwrap_or(0);
            if total != 8 && total != 16 {
                return Err(DbError::Message("주니어권은 8회 또는 16회만 등록할 수 있습니다.".into()));
            }
        }
        _ => return Err(DbError::Message("회원권 종류를 선택해주세요.".into())),
    }
    Ok(())
}

pub fn is_member_active(member: &Member) -> bool {
    let today = Local::now().format("%Y-%m-%d").to_string();
    match member.membership_type.as_str() {
        "monthly_1" | "monthly_3" | "monthly_6" => member
            .end_date
            .as_ref()
            .map(|d| d.as_str() >= today.as_str())
            .unwrap_or(false),
        "junior" => member.remaining_sessions.unwrap_or(0) > 0,
        "session" => {
            let has_sessions = member.remaining_sessions.unwrap_or(0) > 0;
            let not_expired = member
                .end_date
                .as_ref()
                .map(|d| d.as_str() >= today.as_str())
                .unwrap_or(false);
            has_sessions && not_expired
        }
        _ => false,
    }
}

pub fn days_until_expiry(member: &Member) -> Option<i64> {
    if member.membership_type == "session" {
        return None;
    }
    member.end_date.as_ref().and_then(|end| {
        let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok()?;
        let today = Local::now().date_naive();
        Some((end_date - today).num_days())
    })
}
