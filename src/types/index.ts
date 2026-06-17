export type Center = "ONCLE" | "GRABIT";
export type CenterRole = "owner" | "admin" | "staff" | "viewer";
/** Login screen account type: owner (admin tab) vs staff tab. */
export type LoginAccountKind = "owner" | "staff";
export type LegacyMembershipType = "monthly_1" | "monthly_2" | "monthly_3" | "monthly_6" | "session" | "junior";
export type MembershipType = LegacyMembershipType;
export type MemberType = "regular" | "general" | "junior" | "trial";
export type PassType = "period" | "count";
export type DbMembershipType =
  | "30days"
  | "60days"
  | "90days"
  | "180days"
  | "5times"
  | "8times"
  | "16times"
  | "junior"
  | "trial";

export interface SelfCheckinMember {
  id: number;
  name: string;
  center: Center;
  membership_type: string | null;
  pass_type: string | null;
  remaining_count: number | null;
  remaining_text: string;
  display_status: string;
  membership_id: number | null;
  phone_last4?: string | null;
}

export interface Member {
  id: number;
  name: string;
  phone: string | null;
  member_type: MemberType;
  center: Center;
  parent_name: string | null;
  parent_phone: string | null;
  memo: string | null;
  address?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  locker_number?: string | null;
  locker_status?: string | null;
  locker_start_date?: string | null;
  locker_end_date?: string | null;
  locker_memo?: string | null;
  member_no?: number | null;
}

export interface Membership {
  id: number;
  member_id: number;
  membership_type: DbMembershipType | string;
  pass_type: PassType | string;
  start_date: string;
  end_date: string | null;
  total_count: number | null;
  used_count: number;
  remaining_count: number | null;
  status: string;
  price: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemberListItem {
  id: number;
  name: string;
  phone: string | null;
  member_type: MemberType | string;
  center: Center;
  memo: string | null;
  status: string;
  membership_id: number | null;
  membership_type: DbMembershipType | string | null;
  pass_type: PassType | string | null;
  start_date: string | null;
  end_date: string | null;
  total_count: number | null;
  remaining_count: number | null;
  membership_status: string | null;
  display_status: string;
  remaining_text: string;
  last_visit_at: string | null;
  pause_remaining_days: number | null;
  latest_membership_end_date?: string | null;
  latest_membership_type?: string | null;
  days_since_expired?: number | null;
  is_inactive_30_days?: boolean;
  pause_start_date?: string | null;
  member_no?: number | null;
  remote_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberDetail {
  member: Member;
  active_membership: Membership | null;
  memberships: Membership[];
  attendance: AttendanceLog[];
  payments: Payment[];
  pause_logs: PauseLog[];
  edit_logs?: MemberEditLog[];
}

export interface MemberEditLog {
  id: number;
  member_id: number;
  action: "create" | "update" | string;
  editor: string | null;
  summary: string;
  created_at: string;
}

export interface MemberInput {
  center: Center;
  name: string;
  phone?: string | null;
  member_type?: MemberType | string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  membership_type: LegacyMembershipType;
  start_date: string;
  end_date?: string | null;
  total_sessions?: number | null;
  remaining_sessions?: number | null;
  notes?: string | null;
  address?: string | null;
  price?: number | null;
  payment_method?: string | null;
  payment_date?: string | null;
  payment_memo?: string | null;
  locker_number?: string | null;
  locker_start_date?: string | null;
  locker_end_date?: string | null;
  locker_memo?: string | null;
  edited_by?: string | null;
  member_no?: number | null;
}

export interface PaginatedMembers {
  members: MemberListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AttendanceLog {
  id: number;
  member_id: number;
  membership_id: number;
  center: Center | string;
  checkin_at: string;
  attendance_type: string;
  deducted_count: number;
  memo: string | null;
  created_at: string;
  canceled_at?: string | null;
  cancel_reason?: string | null;
}

export interface Payment {
  id: number;
  member_id: number;
  membership_id: number | null;
  amount: number;
  payment_method: string;
  payment_date: string;
  memo: string | null;
  created_at: string;
}

export interface PauseLog {
  id: number;
  member_id: number;
  membership_id: number;
  pause_start_date: string;
  pause_end_date: string | null;
  remaining_days_at_pause: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  total_members: number;
  active_members: number;
  expiring_soon: number;
  paused_members: number;
  today_attendance: number;
  trial_members: number;
  monthly_count: number;
  session_count: number;
  junior_count: number;
  regular_members: number;
  inactive_30_members: number;
  no_member_no_count: number;
}

export interface BackupInfo {
  last_backup_at: string | null;
  backup_count: number;
  json_backup_count: number;
  db_backup_count: number;
  max_backups: number;
  backup_dir: string;
  db_path: string;
  last_json_path: string | null;
  last_db_path: string | null;
  created_on_startup: boolean;
}

export interface StorageInfo {
  db_path: string;
  backup_dir: string;
  reports_dir: string;
  journal_mode: string;
  integrity_ok: boolean;
}

export interface ReportInfo {
  reports_dir: string;
  last_report_date: string | null;
  last_report_at: string | null;
  last_report_path: string | null;
}

export interface MutationResult<T> {
  data: T;
  backup_warning: string | null;
}

export type MemberGroupFilter = "all" | "regular" | "junior" | "inactive_30" | "no_member_no";
export type MemberStatusFilter = "all" | "active" | "expired";

export interface BackupResult {
  json_path: string;
  db_path: string;
  created_at: string;
}

export interface SyncQueueItem {
  id: number;
  entity_type: string;
  entity_local_id: number;
  operation: string;
  payload_json: string;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}

export interface SyncStatus {
  pending_count: number;
  failed_count: number;
  last_pull_at: string | null;
  last_push_at: string | null;
  device_id: string | null;
}

export interface SyncDiagnosticMember {
  local_id: number;
  name: string;
  center: string;
  member_no: number | null;
  remote_id: string | null;
  sync_status: string | null;
  last_sync_attempt: string | null;
  last_error: string | null;
}

export interface SyncDiagnostics {
  queue_pending: number;
  queue_failed: number;
  queue_blocked: number;
  members_without_remote_id: number;
  memberships_without_remote_id: number;
  local_only_members: number;
  synced_members: number;
  center_mapping_failed: number;
  hidden_locally_count: number;
  local_duplicate_count: number;
  problem_members: SyncDiagnosticMember[];
}

export interface CenterMappingMember {
  local_id: number;
  name: string;
  center: string;
  remote_id: string;
  member_no: number | null;
  has_pending_insert: boolean;
}

export interface CenterMappingCorrection {
  local_id: number;
  correct_center: string;
}

export interface CenterMappingRepairResult {
  repaired: number;
  skipped: number;
}

export type CenterMappingStatus = "정상" | "불일치" | "확인 필요";

export interface CenterMappingDiagnosticRow {
  local_id: number;
  name: string;
  remote_id: string;
  local_center: string;
  supabase_center_id: string | null;
  supabase_center_code: string | null;
  display_center: string;
  status: CenterMappingStatus;
}

export type MemberStatus = "active" | "expiring" | "expired" | "depleted" | "paused";

export interface UserCenterRoleRow {
  id: string;
  userId: string;
  centerId: string;
  center: Center;
  centerName: string;
  role: CenterRole;
  createdAt: string;
}

export interface StaffRoleAssignment {
  /** Stable key: userId:centerId */
  id: string;
  userId: string;
  centerId: string;
  center: Center;
  centerName: string;
  role: CenterRole;
  email: string;
  createdAt: string;
}

export interface PermissionSet {
  role: CenterRole | null;
  loading: boolean;
  enforced: boolean;
  hasCenterAccess: boolean;
  canCreateMember: boolean;
  canEditMember: boolean;
  canEditMemberMemo: boolean;
  canDeleteMember: boolean;
  canPauseMembership: boolean;
  canResumeMembership: boolean;
  canManageStaff: boolean;
  canViewStats: boolean;
  canCheckAttendance: boolean;
  canCancelAttendance: boolean;
  canManageLocker: boolean;
  canEditMembership: boolean;
  canOpenSettings: boolean;
  canManageAccount: boolean;
  canBackupRestore: boolean;
  canOpenBackupFolder: boolean;
  canCheckUpdate: boolean;
  canSyncPush: boolean;
  canSyncPull: boolean;
  canViewRoster: boolean;
  canExportRoster: boolean;
  denyReason: string;
}

export type MembershipCategory = "monthly" | "session" | "junior";

export interface UploadLocalMember {
  local_id: number;
  name: string;
  center: string;
  member_no: number | null;
  member_type: string;
  sync_status: string;
  remote_id: string | null;
  has_membership: boolean;
  attendance_count: number;
  can_upload: boolean;
  upload_block_reason: string | null;
  last_attempt: string | null;
  last_error: string | null;
}

export interface UploadLocalMembership {
  local_id: number;
  member_local_id: number;
  member_name: string;
  membership_type: string;
  start_date: string;
  end_date: string | null;
  total_count: number | null;
  remaining_count: number | null;
  remote_id: string | null;
  can_upload: boolean;
  upload_block_reason: string | null;
}

export interface UploadLocalAttendance {
  local_id: number;
  member_name: string;
  member_local_id: number;
  member_has_remote_id: boolean;
  checkin_at: string;
  source: string | null;
  deducted_count: number;
  remote_id: string | null;
  can_upload: boolean;
  upload_block_reason: string | null;
}

export interface UploadVerificationReport {
  queue_pending: number;
  queue_failed: number;
  queue_blocked: number;
  members_no_remote_id: number;
  memberships_no_remote_id: number;
  attendance_no_remote_id: number;
  payments_no_remote_id: number;
  pause_logs_no_remote_id: number;
  status_mismatch_count: number;
  uploadable_count: number;
  blocked_upload_count: number;
  local_only_members: UploadLocalMember[];
  local_only_memberships: UploadLocalMembership[];
  local_only_attendance: UploadLocalAttendance[];
}

// ── 서버 회원 매칭 ────────────────────────────────────────────────────────────

export interface LocalMemberForMatch {
  local_id: number;
  name: string;
  center: string;
  member_no: number | null;
  phone: string | null;
  phone_normalized: string | null;
  sync_status: string;
  attendance_count: number;
  has_membership: boolean;
}

export interface LocalCenterCounts {
  members: number;
  memberships: number;
  attendance: number;
  members_no_remote_id: number;
}

export interface ServerMemberCandidate {
  id: string;
  name: string;
  phone: string | null;
  member_no: number | null;
}

export type MemberMatchType = 'member_no' | 'phone' | 'name' | 'none' | 'ambiguous';

export interface MemberMatchEntry {
  local_id: number;
  local_name: string;
  local_member_no: number | null;
  local_phone: string | null;
  local_attendance_count: number;
  local_has_membership: boolean;
  match_type: MemberMatchType;
  candidates: ServerMemberCandidate[];
  auto_linked: boolean;
  remote_id: string | null;
  error?: string;
}

export interface ServerMatchReport {
  center: string;
  auto_linked: MemberMatchEntry[];
  needs_review: MemberMatchEntry[];
  no_match: MemberMatchEntry[];
  errors: string[];
  total_checked: number;
}

// ── PC간 일치 검증 ────────────────────────────────────────────────────────────

export type ConsistencyVerdict = 'ok' | 'warning' | 'error' | 'no_permission';

export interface ServerCenterConsistency {
  center: string;
  server_members: number;
  server_active_members: number;
  server_memberships: number;
  server_attendance: number;
  local_members: number;
  local_memberships: number;
  local_attendance: number;
  local_members_no_remote_id: number;
  local_pending: number;
  local_failed: number;
  last_pull_at: string | null;
  last_push_at: string | null;
  verdict: ConsistencyVerdict;
  verdict_message: string;
}

export interface AttendanceMismatchDiagnostic {
  member_id: number;
  member_name: string;
  membership_id: number | null;
  membership_type: string | null;
  total_count: number | null;
  current_remaining: number | null;
  attendance_deducted_sum: number;
  expected_remaining: number | null;
  mismatch: boolean;
  diff: number;
}

export type LockerStatus = "empty" | "active" | "occupied" | "expiring" | "expired";
export type LockerFilter = "all" | "empty" | "occupied" | "expiring";

export interface DuplicateMemberCandidateGroup {
  center: string;
  name: string;
  phone: string | null;
  member_ids: number[];
}

export interface LocalDuplicateCleanupSummary {
  groups_processed: number;
  rows_hidden: number;
  affected_names: string[];
}

export interface LockerListItem {
  id: number;
  locker_number: string;
  locker_status: LockerStatus | string;
  member_name: string | null;
  locker_start_date: string | null;
  locker_end_date: string | null;
  memo?: string | null;
}
