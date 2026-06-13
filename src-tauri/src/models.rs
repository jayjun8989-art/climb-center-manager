use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub member_type: String,
    pub center: String,
    pub parent_name: Option<String>,
    pub parent_phone: Option<String>,
    pub memo: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub locker_number: Option<String>,
    #[serde(default)]
    pub locker_status: Option<String>,
    #[serde(default)]
    pub locker_start_date: Option<String>,
    #[serde(default)]
    pub locker_end_date: Option<String>,
    #[serde(default)]
    pub locker_memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    pub id: i64,
    pub member_id: i64,
    pub membership_type: String,
    pub pass_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_count: Option<i32>,
    pub used_count: i32,
    pub remaining_count: Option<i32>,
    pub status: String,
    pub price: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberListItem {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub member_type: String,
    pub center: String,
    pub memo: Option<String>,
    pub status: String,
    pub membership_id: Option<i64>,
    pub membership_type: Option<String>,
    pub pass_type: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub total_count: Option<i32>,
    pub remaining_count: Option<i32>,
    pub membership_status: Option<String>,
    pub display_status: String,
    pub remaining_text: String,
    pub last_visit_at: Option<String>,
    pub pause_remaining_days: Option<i32>,
    #[serde(default)]
    pub latest_membership_end_date: Option<String>,
    #[serde(default)]
    pub latest_membership_type: Option<String>,
    #[serde(default)]
    pub days_since_expired: Option<i32>,
    #[serde(default)]
    pub is_inactive_30_days: bool,
    #[serde(default)]
    pub pause_start_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfCheckinMember {
    pub id: i64,
    pub name: String,
    pub center: String,
    pub membership_type: Option<String>,
    pub pass_type: Option<String>,
    pub remaining_count: Option<i32>,
    pub remaining_text: String,
    pub display_status: String,
    pub membership_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberEditLog {
    pub id: i64,
    pub member_id: i64,
    pub action: String,
    pub editor: Option<String>,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberDetail {
    pub member: Member,
    pub active_membership: Option<Membership>,
    pub memberships: Vec<Membership>,
    pub attendance: Vec<AttendanceLog>,
    pub payments: Vec<Payment>,
    pub pause_logs: Vec<PauseLog>,
    #[serde(default)]
    pub edit_logs: Vec<MemberEditLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberInput {
    pub center: String,
    pub name: String,
    pub phone: Option<String>,
    pub member_type: Option<String>,
    pub parent_name: Option<String>,
    pub parent_phone: Option<String>,
    pub membership_type: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_sessions: Option<i32>,
    pub remaining_sessions: Option<i32>,
    pub notes: Option<String>,
    pub address: Option<String>,
    pub price: Option<f64>,
    pub payment_method: Option<String>,
    pub payment_date: Option<String>,
    pub payment_memo: Option<String>,
    pub locker_number: Option<String>,
    pub locker_start_date: Option<String>,
    pub locker_end_date: Option<String>,
    pub locker_memo: Option<String>,
    #[serde(default)]
    pub edited_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttendanceLog {
    pub id: i64,
    pub member_id: i64,
    pub membership_id: i64,
    pub center: String,
    pub checkin_at: String,
    pub attendance_type: String,
    pub deducted_count: i32,
    pub memo: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub canceled_at: Option<String>,
    #[serde(default)]
    pub cancel_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockerListItem {
    pub id: i64,
    pub locker_number: String,
    pub locker_status: String,
    pub member_name: Option<String>,
    pub locker_start_date: Option<String>,
    pub locker_end_date: Option<String>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: i64,
    pub member_id: i64,
    pub membership_id: Option<i64>,
    pub amount: f64,
    pub payment_method: String,
    pub payment_date: String,
    pub memo: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PauseLog {
    pub id: i64,
    pub member_id: i64,
    pub membership_id: i64,
    pub pause_start_date: String,
    pub pause_end_date: Option<String>,
    pub remaining_days_at_pause: Option<i32>,
    pub reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialMember {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub center: String,
    pub trial_date: String,
    pub trial_price: f64,
    pub converted: bool,
    pub converted_member_id: Option<i64>,
    pub memo: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedMembers {
    pub members: Vec<MemberListItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_members: i64,
    pub active_members: i64,
    pub expiring_soon: i64,
    pub paused_members: i64,
    pub today_attendance: i64,
    pub trial_members: i64,
    pub monthly_count: i64,
    pub session_count: i64,
    pub junior_count: i64,
    pub regular_members: i64,
    pub inactive_30_members: i64,
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
    pub reports_dir: String,
    pub journal_mode: String,
    pub integrity_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationResult<T> {
    pub data: T,
    pub backup_warning: Option<String>,
}
