pub const TEST_NAMES: &[&str] = &["ddd", "dddd", "dfdfd", "주니어", "주니어 1", "온클", "목요일"];
pub const TEST_PHONES: &[&str] = &["ddd", "ddff", "ㅎㅎㅎㅎ", "ㅈㅈㅈ", "939ㅇ"];

pub fn is_test_data(name: &str, phone: &Option<String>) -> bool {
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

pub fn test_names_sql_not_in() -> String {
    let quoted: Vec<String> = TEST_NAMES.iter().map(|n| format!("'{}'", n)).collect();
    format!("({})", quoted.join(","))
}
