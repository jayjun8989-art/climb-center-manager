use crate::models::{Member, MemberEditLog, MemberInput, Membership};
use rusqlite::{params, Connection, Row, Result as SqlResult};

use super::status::now_string;

pub fn migrate_to_v5(conn: &Connection) -> rusqlite::Result<()> {
    let version = super::migration::current_schema_version(conn)?;
    if version >= 5 {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS member_edit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            action TEXT NOT NULL CHECK(action IN ('create', 'update')),
            editor TEXT,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_member_edit_logs_member
            ON member_edit_logs(member_id, created_at DESC);
        ",
    )?;

    super::migration::set_schema_version(conn, 5)?;
    Ok(())
}

fn map_edit_log(row: &Row<'_>) -> Result<MemberEditLog, rusqlite::Error> {
    Ok(MemberEditLog {
        id: row.get(0)?,
        member_id: row.get(1)?,
        action: row.get(2)?,
        editor: row.get(3)?,
        summary: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn insert_member_edit_log(
    conn: &Connection,
    member_id: i64,
    action: &str,
    editor: Option<&str>,
    summary: &str,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO member_edit_logs (member_id, action, editor, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![member_id, action, editor, summary, now_string()],
    )?;
    Ok(())
}

pub fn get_member_edit_logs(
    conn: &Connection,
    member_id: i64,
    limit: i64,
) -> SqlResult<Vec<MemberEditLog>> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, action, editor, summary, created_at
         FROM member_edit_logs
         WHERE member_id = ?1
         ORDER BY created_at DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![member_id, limit], map_edit_log)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

pub fn summarize_create(input: &MemberInput) -> String {
    format!(
        "\u{D68C}\u{C6D0} \u{B4F1}\u{B85D}: {}",
        input.name.trim()
    )
}

pub fn summarize_update(
    member: &Member,
    membership: Option<&Membership>,
    input: &MemberInput,
    mapped_membership_type: &str,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let next_name = input.name.trim();

    if member.name != next_name {
        parts.push(format!(
            "\u{C774}\u{B984}: {} \u{2192} {}",
            member.name, next_name
        ));
    }

    let next_phone = input.phone.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let current_phone = member.phone.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if current_phone != next_phone {
        parts.push("\u{C5F0}\u{B77D}\u{CC98} \u{BCC0}\u{ACBD}".into());
    }

    let next_memo = input.notes.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let current_memo = member.memo.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if current_memo != next_memo {
        parts.push("\u{BA54}\u{AA8C} \u{BC18}\u{C601}".into());
    }

    if let Some(ms) = membership {
        if ms.start_date != input.start_date {
            parts.push("\u{C2DC}\u{C791}\u{C77C} \u{BCC0}\u{ACBD}".into());
        }
        if ms.end_date.as_deref() != input.end_date.as_deref() {
            parts.push("\u{C885}\u{B8CC}\u{C77C} \u{BCC0}\u{ACBD}".into());
        }
        if ms.membership_type != mapped_membership_type {
            parts.push("\u{D68C}\u{C6D0}\u{AD8C} \u{C885}\u{B958} \u{BCC0}\u{ACBD}".into());
        }
        if ms.pass_type == "count" {
            let next_remaining = input.remaining_sessions.or(input.total_sessions);
            if ms.remaining_count != next_remaining {
                parts.push("\u{C794}\u{C5EC} \u{D68C}\u{C218} \u{BC18}\u{C601}".into());
            }
        }
    }

    if input.locker_number.is_some()
        || input.locker_start_date.is_some()
        || input.locker_end_date.is_some()
        || input.locker_memo.is_some()
    {
        if member.locker_number.as_deref() != input.locker_number.as_deref().map(str::trim)
            || member.locker_start_date.as_deref() != input.locker_start_date.as_deref()
            || member.locker_end_date.as_deref() != input.locker_end_date.as_deref()
            || member.locker_memo.as_deref() != input.locker_memo.as_deref().map(str::trim)
        {
            parts.push("\u{B77D}\u{CE74} \u{C815}\u{BCF4} \u{BC18}\u{C601}".into());
        }
    }

    if parts.is_empty() {
        "\u{D68C}\u{C6D0} \u{C815}\u{BCF4} \u{C218}\u{AC15}".into()
    } else {
        parts.join(", ")
    }
}
