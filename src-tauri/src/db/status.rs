use chrono::{Local, NaiveDate};

pub fn today_date() -> NaiveDate {
    Local::now().date_naive()
}

pub fn today_string() -> String {
    today_date().format("%Y-%m-%d").to_string()
}

pub fn now_string() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub fn days_until(end_date: &str, today: NaiveDate) -> Option<i64> {
    parse_date(end_date).map(|end| (end - today).num_days())
}

pub fn compute_membership_status(
    db_status: &str,
    pass_type: &str,
    end_date: &Option<String>,
    remaining_count: Option<i32>,
    today: NaiveDate,
) -> String {
    if db_status == "paused" {
        return "paused".to_string();
    }

    if pass_type == "period" {
        if let Some(end) = end_date.as_ref().and_then(|value| parse_date(value)) {
            if end < today {
                return "expired".to_string();
            }
        }
        return "active".to_string();
    }

    if remaining_count.unwrap_or(0) <= 0 {
        return "finished".to_string();
    }

    "active".to_string()
}

pub fn compute_member_status(
    db_status: &str,
    deleted_at: &Option<String>,
    membership_status: Option<&str>,
) -> String {
    if deleted_at.is_some() {
        return "inactive".to_string();
    }
    if db_status == "paused" || membership_status == Some("paused") {
        return "paused".to_string();
    }
    if membership_status == Some("expired") || membership_status == Some("finished") {
        return "expired".to_string();
    }
    if db_status == "inactive" {
        return "inactive".to_string();
    }
    "active".to_string()
}

pub fn display_badge(
    member_status: &str,
    membership_status: &str,
    pass_type: &str,
    end_date: &Option<String>,
    remaining_count: Option<i32>,
    pause_remaining_days: Option<i32>,
    today: NaiveDate,
) -> String {
    if member_status == "paused" || membership_status == "paused" {
        if let Some(days) = pause_remaining_days {
            return format!("\u{c815}\u{c9c0}\u{c911} / \u{b09a}\u{c740}\u{ae30}\u{ac04} {days}\u{c77c}");
        }
        return "\u{c815}\u{c9c0}\u{c911}".to_string();
    }

    if membership_status == "finished" {
        return "\u{d69f}\u{c218} \u{c18c}\u{c9c4}".to_string();
    }

    if membership_status == "expired" {
        return "\u{b9cc}\u{b8cc}".to_string();
    }

    if pass_type == "period" {
        if let Some(end) = end_date.as_ref() {
            if let Some(days) = days_until(end, today) {
                if days < 0 {
                    return "\u{b9cc}\u{b8cc}".to_string();
                }
                if days <= 7 {
                    return "\u{b9cc}\u{b8cc} \u{c784}\u{bc15}".to_string();
                }
            }
        }
        return "\u{c774}\u{c6a9} \u{ac00}\u{b2a5}".to_string();
    }

    let remaining = remaining_count.unwrap_or(0);
    if remaining <= 0 {
        return "\u{c18c}\u{c9c4}".to_string();
    }
    if remaining <= 2 {
        return "\u{c18c}\u{c9c4} \u{c784}\u{bc15}".to_string();
    }
    "\u{c774}\u{c6a9} \u{ac00}\u{b2a5}".to_string()
}

pub fn remaining_text(
    pass_type: &str,
    end_date: &Option<String>,
    total_count: Option<i32>,
    remaining_count: Option<i32>,
    pause_remaining_days: Option<i32>,
    today: NaiveDate,
) -> String {
    if let Some(days) = pause_remaining_days {
        return format!("\u{c815}\u{c9c0} / \u{b0a8}\u{c740} {days}\u{c77c}");
    }

    if pass_type == "period" {
        if let Some(end) = end_date.as_ref() {
            if let Some(days) = days_until(end, today) {
                if days < 0 {
                    return format!("\u{b9cc}\u{b8cc} ({end})");
                }
                if days == 0 {
                    return "\u{c624}\u{b298} \u{b9cc}\u{b8cc}".to_string();
                }
                return format!("D-{days} ({end})");
            }
        }
        return "\u{b9cc}\u{b8cc}\u{c77c} \u{c5c6}\u{c74c}".to_string();
    }

    let remaining = remaining_count.unwrap_or(0);
    let total = total_count.unwrap_or(remaining);
    format!("\u{c794}\u{c5ec} {remaining}\u{d68c} / {total}\u{d68c}")
}

pub fn attendance_type_for_member(member_type: &str) -> &'static str {
    match member_type {
        "junior" => "junior",
        "trial" => "trial",
        _ => "normal",
    }
}

pub fn map_legacy_membership(
    membership_type: &str,
    total_sessions: Option<i32>,
) -> (String, String, Option<i32>, Option<i32>, Option<i32>) {
    match membership_type {
        "monthly_1" => (
            "30days".into(),
            "period".into(),
            None,
            None,
            None,
        ),
        "monthly_3" => (
            "90days".into(),
            "period".into(),
            None,
            None,
            None,
        ),
        "monthly_6" => (
            "180days".into(),
            "period".into(),
            None,
            None,
            None,
        ),
        "session" => {
            let total = total_sessions.unwrap_or(5);
            (
                "5times".into(),
                "count".into(),
                Some(total),
                None,
                None,
            )
        }
        "junior" => {
            let total = total_sessions.filter(|&v| v >= 1).unwrap_or(8);
            (
                "junior".into(),
                "count".into(),
                Some(total),
                None,
                None,
            )
        }
        _ => (
            "30days".into(),
            "period".into(),
            None,
            None,
            None,
        ),
    }
}

pub fn legacy_member_type(membership_type: &str) -> &'static str {
    if membership_type == "junior" {
        "junior"
    } else {
        "general"
    }
}

/// SQLite `members.member_type` CHECK allows general/junior/trial only.
pub fn normalize_local_member_type(value: &str) -> &'static str {
    match value {
        "junior" => "junior",
        "trial" => "trial",
        "regular" | "general" => "general",
        _ => "general",
    }
}
