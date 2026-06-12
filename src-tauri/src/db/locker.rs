use crate::db::{AppState, DbError};
use crate::models::LockerListItem;
use rusqlite::{params, OptionalExtension};

use super::status::{parse_date, today_date};

pub fn migrate_to_v4(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let version = super::migration::current_schema_version(conn)?;
    if version >= 4 {
        return Ok(());
    }

    add_column_if_missing(conn, "members", "locker_number", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_status", "TEXT NOT NULL DEFAULT 'empty'")?;
    add_column_if_missing(conn, "members", "locker_start_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_end_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_memo", "TEXT")?;

    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_members_locker ON members(center, locker_number);
        UPDATE members SET locker_status = 'empty' WHERE locker_status IS NULL OR locker_status = '';
        ",
    )?;

    super::migration::set_schema_version(conn, 4)?;
    Ok(())
}

fn add_column_if_missing(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), rusqlite::Error> {
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

fn compute_locker_status(
    locker_number: &Option<String>,
    locker_end_date: &Option<String>,
) -> String {
    if locker_number.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        return "empty".to_string();
    }
    if let Some(end) = locker_end_date {
        if let Some(end_d) = parse_date(end) {
            let today = today_date();
            if end_d < today {
                return "expired".to_string();
            }
            if let Some(warn) = today.checked_add_signed(chrono::Duration::days(7)) {
                if end_d <= warn {
                    return "expiring".to_string();
                }
            }
        }
        return "active".to_string();
    }
    "active".to_string()
}

pub fn assert_locker_unique(
    conn: &rusqlite::Connection,
    center: &str,
    locker_number: &str,
    exclude_member_id: Option<i64>,
) -> Result<(), DbError> {
    let trimmed = locker_number.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let existing: Option<i64> = if let Some(id) = exclude_member_id {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND locker_number = ?2 AND deleted_at IS NULL AND id != ?3
             LIMIT 1",
            params![center, trimmed, id],
            |row| row.get(0),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT id FROM members
             WHERE center = ?1 AND locker_number = ?2 AND deleted_at IS NULL
             LIMIT 1",
            params![center, trimmed],
            |row| row.get(0),
        )
        .optional()?
    };
    if existing.is_some() {
        return Err(DbError::Message(
            "같은 센터에서 이미 사용 중인 락카 번호입니다.".into(),
        ));
    }
    Ok(())
}

pub fn list_center_lockers(state: &AppState, center: &str) -> Result<Vec<LockerListItem>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, locker_number, locker_status, name, locker_start_date, locker_end_date, locker_memo
             FROM members
             WHERE center = ?1 AND deleted_at IS NULL AND locker_number IS NOT NULL AND trim(locker_number) != ''
             ORDER BY locker_number COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([center], |row| {
            let id: i64 = row.get(0)?;
            let locker_number: String = row.get(1)?;
            let locker_status: String = row.get(2)?;
            let member_name: Option<String> = row.get(3)?;
            let locker_start_date: Option<String> = row.get(4)?;
            let locker_end_date: Option<String> = row.get(5)?;
            let memo: Option<String> = row.get(6)?;
            Ok(LockerListItem {
                id,
                locker_number,
                locker_status,
                member_name,
                locker_start_date,
                locker_end_date,
                memo,
            })
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    })
}

pub fn apply_locker_fields(
    conn: &rusqlite::Connection,
    member_id: i64,
    center: &str,
    locker_number: Option<&str>,
    locker_start: Option<&str>,
    locker_end: Option<&str>,
    locker_memo: Option<&str>,
) -> Result<(), DbError> {
    let number = locker_number.map(str::trim).filter(|s| !s.is_empty());
    if let Some(num) = number {
        assert_locker_unique(conn, center, num, Some(member_id))?;
    }
    let status = compute_locker_status(
        &number.map(|s| s.to_string()),
        &locker_end.map(|s| s.to_string()),
    );
    conn.execute(
        "UPDATE members SET locker_number = ?1, locker_status = ?2,
         locker_start_date = ?3, locker_end_date = ?4, locker_memo = ?5
         WHERE id = ?6",
        params![
            number,
            status,
            locker_start,
            locker_end,
            locker_memo,
            member_id
        ],
    )?;
    Ok(())
}
