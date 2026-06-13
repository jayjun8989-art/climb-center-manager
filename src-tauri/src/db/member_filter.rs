/// SQL helpers for member list filters (member_type vs membership_type).

pub fn normalized_member_type_sql() -> &'static str {
    r#"CASE
        WHEN m.member_type = 'trial' THEN 'trial'
        WHEN m.member_type = 'junior' THEN 'junior'
        WHEN m.member_type = 'regular' THEN 'regular'
        WHEN m.member_type = 'general' OR m.member_type IS NULL OR TRIM(m.member_type) = '' THEN
            CASE
                WHEN COALESCE(
                    (SELECT lm.membership_type FROM memberships lm
                     WHERE lm.member_id = m.id
                     ORDER BY lm.end_date DESC, lm.id DESC LIMIT 1),
                    ms.membership_type
                ) IN ('junior', '8times', '16times') THEN 'junior'
                ELSE 'regular'
            END
        ELSE
            CASE
                WHEN COALESCE(ms.membership_type, '') IN ('junior', '8times', '16times') THEN 'junior'
                ELSE 'regular'
            END
    END"#
}

pub fn latest_membership_end_date_sql() -> &'static str {
    "(SELECT MAX(end_date) FROM memberships WHERE member_id = m.id)"
}

pub fn latest_membership_type_sql() -> &'static str {
    r#"(SELECT lm.membership_type FROM memberships lm
        WHERE lm.member_id = m.id
        ORDER BY lm.end_date DESC, lm.id DESC LIMIT 1)"#
}

pub fn member_group_clause(group: &str, today: &str) -> String {
    let normalized = normalized_member_type_sql();
    match group {
        "regular" | "general" => format!(" AND ({normalized}) = 'regular'"),
        "junior" => format!(" AND ({normalized}) = 'junior'"),
        "no_member_no" => " AND (m.member_no IS NULL OR TRIM(m.member_no) = '')
          AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0".to_string(),
        "inactive_30" => inactive_30_clause(today),
        _ => String::new(),
    }
}

pub fn inactive_30_clause(today: &str) -> String {
    let latest_end = latest_membership_end_date_sql();
    format!(
        " AND m.deleted_at IS NULL
          AND m.status != 'paused'
          AND NOT EXISTS (
            SELECT 1 FROM memberships am
            WHERE am.member_id = m.id
              AND am.status IN ('active', 'paused')
              AND (
                (am.pass_type = 'period' AND am.end_date IS NOT NULL AND am.end_date >= '{today}')
                OR (am.pass_type = 'count' AND IFNULL(am.remaining_count, 0) > 0)
              )
          )
          AND (
            {latest_end} IS NULL
            OR {latest_end} < date('{today}', '-30 days')
          )
          AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0"
    )
}

pub fn count_regular_members_sql() -> String {
    format!(
        "SELECT COUNT(*) FROM members m
         LEFT JOIN memberships ms ON ms.id = (
            SELECT id FROM memberships
            WHERE member_id = m.id AND status IN ('active', 'paused')
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC LIMIT 1
         )
         WHERE m.center = ?1 AND m.deleted_at IS NULL AND ({}) = 'regular'
           AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0",
        normalized_member_type_sql()
    )
}

pub fn count_junior_members_sql() -> String {
    format!(
        "SELECT COUNT(*) FROM members m
         LEFT JOIN memberships ms ON ms.id = (
            SELECT id FROM memberships
            WHERE member_id = m.id AND status IN ('active', 'paused')
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC LIMIT 1
         )
         WHERE m.center = ?1 AND m.deleted_at IS NULL AND ({}) = 'junior'
           AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0",
        normalized_member_type_sql()
    )
}

pub fn count_no_member_no_sql() -> &'static str {
    "SELECT COUNT(*) FROM members m
     WHERE m.center = ?1 AND m.deleted_at IS NULL
       AND (m.member_no IS NULL OR TRIM(m.member_no) = '')
       AND COALESCE(m.hidden_locally, 0) = 0 AND COALESCE(m.is_local_duplicate, 0) = 0"
}

pub fn count_inactive_30_members_sql(today: &str) -> String {
    let latest_end = latest_membership_end_date_sql();
    format!(
        "SELECT COUNT(*) FROM members m
         WHERE m.center = ?1 AND m.deleted_at IS NULL
           AND m.status != 'paused'
           AND NOT EXISTS (
             SELECT 1 FROM memberships am
             WHERE am.member_id = m.id
               AND am.status IN ('active', 'paused')
               AND (
                 (am.pass_type = 'period' AND am.end_date IS NOT NULL AND am.end_date >= '{today}')
                 OR (am.pass_type = 'count' AND IFNULL(am.remaining_count, 0) > 0)
               )
           )
           AND (
             {latest_end} IS NULL
             OR {latest_end} < date('{today}', '-30 days')
           )"
    )
}
