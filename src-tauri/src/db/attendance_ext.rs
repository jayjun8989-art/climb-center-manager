use crate::db::{AppState, DbError};
use crate::models::{AttendanceLog, MemberListItem, Membership};
use rusqlite::{params, OptionalExtension};

use super::ops::{get_active_membership, get_member, get_member_list_item_by_id, refresh_member_status};
use super::status::{attendance_type_for_member, compute_membership_status, now_string, today_date, today_string};

pub fn migrate_attendance_cancel(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let add = |col: &str, def: &str| -> Result<(), rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('attendance_logs') WHERE name = ?1",
            [col],
            |row| row.get(0),
        )?;
        if count == 0 {
            conn.execute_batch(&format!(
                "ALTER TABLE attendance_logs ADD COLUMN {col} {def};"
            ))?;
        }
        Ok(())
    };
    add("canceled_at", "TEXT")?;
    add("canceled_by", "TEXT")?;
    add("cancel_reason", "TEXT")?;
    Ok(())
}

pub fn has_attendance_today(state: &AppState, member_id: i64) -> Result<bool, DbError> {
    let today = today_string();
    state.with_conn(|conn| {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs
             WHERE member_id = ?1 AND date(checkin_at) = ?2 AND canceled_at IS NULL",
            params![member_id, today],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    })
}

fn map_membership_row(row: &rusqlite::Row<'_>) -> Result<Membership, rusqlite::Error> {
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

pub fn check_attendance_with_options(
    state: &AppState,
    member_id: i64,
    membership_id: Option<i64>,
    force_duplicate: bool,
) -> Result<MemberListItem, DbError> {
    if !force_duplicate && has_attendance_today(state, member_id)? {
        return Err(DbError::Message("DUPLICATE_TODAY".into()));
    }

    let member = get_member(state, member_id)?
        .ok_or_else(|| DbError::Message("??? ?? ? ????.".into()))?;

    let membership = if let Some(mid) = membership_id {
        state.with_conn(|conn| {
            conn.query_row(
                "SELECT id, member_id, membership_type, pass_type, start_date, end_date,
                        total_count, used_count, remaining_count, status, price, created_at, updated_at
                 FROM memberships WHERE id = ?1 AND member_id = ?2",
                params![mid, member_id],
                map_membership_row,
            )
            .optional()
            .map_err(DbError::from)
        })?
    } else {
        get_active_membership(state, member_id)?
    };

    let membership = membership
        .ok_or_else(|| DbError::Message("?? ???? ????.".into()))?;

    if membership.status == "paused" || member.status == "paused" {
        return Err(DbError::Message("??? ???? ??? ? ????.".into()));
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
        if member.member_type == "junior"
            && membership.pass_type == "count"
            && membership.remaining_count.unwrap_or(0) <= 0
        {
            return Err(DbError::Message("잔여 수업 횟수가 없습니다.".into()));
        }
        return Err(DbError::Message(
            "이용 가능한 회원권이 아닙니다.".into(),
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
            let new_status = if remaining <= 0 { "finished" } else { "active" };
            tx.execute(
                "UPDATE memberships SET used_count = ?1, remaining_count = ?2, status = ?3, updated_at = ?4 WHERE id = ?5",
                params![used, remaining, new_status, now, membership.id],
            )?;
        }

        tx.execute(
            "INSERT INTO attendance_logs (
                member_id, membership_id, center, checkin_at, attendance_type,
                deducted_count, memo, created_at, canceled_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, NULL)",
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

pub fn cancel_attendance(
    state: &AppState,
    attendance_id: i64,
    reason: Option<&str>,
) -> Result<MemberListItem, DbError> {
    let row: Option<(i64, i64, i32, String)> = state.with_conn(|conn| {
        conn.query_row(
            "SELECT al.member_id, al.membership_id, al.deducted_count, ms.pass_type
             FROM attendance_logs al
             JOIN memberships ms ON ms.id = al.membership_id
             WHERE al.id = ?1 AND al.canceled_at IS NULL",
            params![attendance_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(DbError::from)
    })?;

    let (member_id, membership_id, deducted, pass_type) = row
        .ok_or_else(|| DbError::Message("??? ?? ??? ?? ? ????.".into()))?;

    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = now_string();

        if deducted > 0 && pass_type == "count" {
            tx.execute(
                "UPDATE memberships SET
                    used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END,
                    remaining_count = COALESCE(remaining_count, 0) + 1,
                    status = CASE WHEN status = 'finished' THEN 'active' ELSE status END,
                    updated_at = ?1
                 WHERE id = ?2",
                params![now, membership_id],
            )?;
        }

        tx.execute(
            "UPDATE attendance_logs SET canceled_at = ?1, cancel_reason = ?2 WHERE id = ?3",
            params![now, reason, attendance_id],
        )?;
        tx.commit()?;
        Ok(())
    })?;

    refresh_member_status(state, member_id)?;
    get_member_list_item_by_id(state, member_id)
}

pub fn map_attendance_row(row: &rusqlite::Row<'_>) -> Result<AttendanceLog, rusqlite::Error> {
    let canceled_at: Option<String> = row.get(9).ok();
    let cancel_reason: Option<String> = row.get(10).ok();
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
        canceled_at,
        cancel_reason,
    })
}
