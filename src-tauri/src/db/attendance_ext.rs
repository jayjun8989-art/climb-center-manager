use crate::db::{AppState, DbError};
use crate::models::{AttendanceLog, MemberListItem, Membership};
use rusqlite::{params, OptionalExtension};

use super::ops::{get_active_membership, get_member, get_member_list_item_by_id, refresh_member_status};
use super::status::{attendance_type_for_member, compute_membership_status, now_string, parse_date, today_date, today_string};

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
    has_attendance_on_date(state, member_id, &today_string())
}

pub fn has_attendance_on_date(state: &AppState, member_id: i64, date: &str) -> Result<bool, DbError> {
    state.with_conn(|conn| {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance_logs
             WHERE member_id = ?1 AND date(checkin_at) = ?2 AND canceled_at IS NULL",
            params![member_id, date],
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
    checkin_date: Option<String>,
    editor: Option<&str>,
) -> Result<MemberListItem, DbError> {
    let today_str = today_string();
    let date = checkin_date.unwrap_or_else(|| today_str.clone());
    if date > today_str {
        return Err(DbError::Message("미래 날짜로는 출석 체크할 수 없습니다.".into()));
    }

    if has_attendance_on_date(state, member_id, &date)? {
        return Err(DbError::Message("이미 해당 날짜에 출석 기록이 있습니다.".into()));
    }

    let member = get_member(state, member_id)?
        .ok_or_else(|| DbError::Message("회원을 찾을 수 없습니다.".into()))?;

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
        .ok_or_else(|| DbError::Message("회원권이 없습니다.".into()))?;

    if membership.status == "paused" || member.status == "paused" {
        return Err(DbError::Message("정지된 회원권은 출석할 수 없습니다.".into()));
    }

    let attendance_date = parse_date(&date).unwrap_or_else(today_date);
    let computed = compute_membership_status(
        &membership.status,
        &membership.pass_type,
        &membership.end_date,
        membership.remaining_count,
        attendance_date,
    );
    if computed != "active" {
        if membership.pass_type == "count" && membership.remaining_count.unwrap_or(0) <= 0 {
            return Err(DbError::Message("잔여 수업 횟수가 없습니다.".into()));
        }
        if membership.pass_type == "period" && !force_duplicate {
            return Err(DbError::Message("OUT_OF_PERIOD".into()));
        }
        if membership.pass_type != "period" {
            return Err(DbError::Message(
                "이용 가능한 회원권이 아닙니다.".into(),
            ));
        }
    }

    let result = state.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = now_string();
        let checkin_at = if date == today_str {
            now.clone()
        } else {
            format!("{date} 12:00:00")
        };
        let mut deducted = 0;
        let is_self_checkin = matches!(editor, Some("self-checkin") | Some("self_checkin"));
        let source = if is_self_checkin { "self_checkin" } else { "staff" };
        let memo = if is_self_checkin { Some("회원 셀프 출석") } else { None };

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
                deducted_count, memo, created_at, canceled_at, source
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)",
            params![
                member_id,
                membership.id,
                member.center,
                checkin_at,
                attendance_type_for_member(&member.member_type),
                deducted,
                memo,
                now,
                source,
            ],
        )?;
        let attendance_id = tx.last_insert_rowid();

        let before_remaining = membership.remaining_count;
        let after_remaining = if deducted > 0 {
            Some(before_remaining.unwrap_or(0) - 1)
        } else {
            before_remaining
        };
        let kind_label = if member.member_type == "junior" { "주니어 수업" } else { "횟수" };
        let source_label = if is_self_checkin { " [셀프 출석]" } else { "" };
        let summary = if deducted > 0 {
            format!(
                "출석 기록 ({date}){source_label} · {kind_label} 차감: {} \u{2192} {}",
                before_remaining.unwrap_or(0),
                after_remaining.unwrap_or(0)
            )
        } else if date == today_str {
            format!("출석 기록{source_label}")
        } else {
            format!("과거 날짜 출석 기록 ({date}){source_label}")
        };
        super::member_edit_log::insert_member_edit_log(&*tx, member_id, "update", editor, &summary)?;

        tx.commit()?;
        Ok((attendance_id, checkin_at, deducted, source.to_string(), memo.map(str::to_string)))
    })?;

    let (attendance_id, checkin_at, deducted, source, memo) = result;

    // Push the member/membership (including remaining_count deduction) so
    // other devices receive the updated remaining counts on next pull.
    if let Ok(payload_json) = super::sync_local::build_member_sync_payload_json(state, member_id) {
        if let Ok(payload_value) = serde_json::from_str::<serde_json::Value>(&payload_json) {
            let _ = super::sync_local::enqueue_entity_op(
                state,
                "member",
                member_id,
                "update",
                &payload_value,
            );
        }
    }

    // Push the attendance log itself so it appears on other devices after pull.
    let attendance_payload = serde_json::json!({
        "local_member_id": member_id,
        "local_membership_id": membership.id,
        "center": member.center,
        "checkin_at": checkin_at,
        "attendance_type": attendance_type_for_member(&member.member_type),
        "deducted_count": deducted,
        "memo": memo,
        "source": source,
    });
    let _ = super::sync_local::enqueue_entity_op(
        state,
        "attendance",
        attendance_id,
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
    editor: Option<&str>,
) -> Result<MemberListItem, DbError> {
    let row: Option<(i64, i64, i32, String, String)> = state.with_conn(|conn| {
        conn.query_row(
            "SELECT al.member_id, al.membership_id, al.deducted_count, ms.pass_type, al.checkin_at
             FROM attendance_logs al
             JOIN memberships ms ON ms.id = al.membership_id
             WHERE al.id = ?1 AND al.canceled_at IS NULL",
            params![attendance_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(DbError::from)
    })?;

    let (member_id, membership_id, deducted, pass_type, checkin_at) = row
        .ok_or_else(|| DbError::Message("취소할 출석 기록을 찾을 수 없습니다.".into()))?;

    state.with_conn(|conn| {
        let tx = conn.transaction()?;
        let now = now_string();
        let mut before_remaining: Option<i32> = None;
        let mut after_remaining: Option<i32> = None;

        if deducted > 0 && pass_type == "count" {
            before_remaining = tx.query_row(
                "SELECT remaining_count FROM memberships WHERE id = ?1",
                params![membership_id],
                |row| row.get(0),
            )?;
            tx.execute(
                "UPDATE memberships SET
                    used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END,
                    remaining_count = COALESCE(remaining_count, 0) + 1,
                    status = CASE WHEN status = 'finished' THEN 'active' ELSE status END,
                    updated_at = ?1
                 WHERE id = ?2",
                params![now, membership_id],
            )?;
            after_remaining = Some(before_remaining.unwrap_or(0) + 1);
        }

        tx.execute(
            "UPDATE attendance_logs SET canceled_at = ?1, cancel_reason = ?2 WHERE id = ?3",
            params![now, reason, attendance_id],
        )?;

        let date = checkin_at.get(0..10).unwrap_or(&checkin_at);
        let summary = if let (Some(before), Some(after)) = (before_remaining, after_remaining) {
            format!("출석 취소 ({date}) · 잔여 횟수 복원: {before} \u{2192} {after}")
        } else {
            format!("출석 취소 ({date})")
        };
        super::member_edit_log::insert_member_edit_log(&*tx, member_id, "update", editor, &summary)?;

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
