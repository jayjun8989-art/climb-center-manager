use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: i64,
    pub center: String,
    pub name: String,
    pub phone: Option<String>,
    pub membership_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_sessions: Option<i32>,
    pub remaining_sessions: Option<i32>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberInput {
    pub center: String,
    pub name: String,
    pub phone: Option<String>,
    pub membership_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_sessions: Option<i32>,
    pub remaining_sessions: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttendanceRecord {
    pub id: i64,
    pub member_id: i64,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedMembers {
    pub members: Vec<Member>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_members: i64,
    pub active_members: i64,
    pub expiring_soon: i64,
    pub today_attendance: i64,
    pub monthly_count: i64,
    pub session_count: i64,
    pub junior_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub last_backup_at: Option<String>,
    pub backup_count: i64,
    pub json_backup_count: i64,
    pub db_backup_count: i64,
    pub max_backups: i64,
    pub backup_dir: String,
    pub db_path: String,
    pub last_json_path: Option<String>,
    pub last_db_path: Option<String>,
    pub created_on_startup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub json_path: String,
    pub db_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub db_path: String,
    pub backup_dir: String,
    pub journal_mode: String,
    pub integrity_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationResult<T> {
    pub data: T,
    pub backup_warning: Option<String>,
}
