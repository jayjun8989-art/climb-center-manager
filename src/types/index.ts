export type Center = "ONCLE" | "GRABIT";
export type LegacyMembershipType = "monthly_1" | "monthly_3" | "monthly_6" | "session" | "junior";
export type MembershipType = LegacyMembershipType;
export type MemberType = "general" | "junior" | "trial";
export type PassType = "period" | "count";
export type DbMembershipType =
  | "30days"
  | "90days"
  | "180days"
  | "5times"
  | "8times"
  | "16times"
  | "junior"
  | "trial";

export interface Member {
  id: number;
  name: string;
  phone: string | null;
  member_type: MemberType;
  center: Center;
  parent_name: string | null;
  parent_phone: string | null;
  memo: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
  price?: number | null;
  payment_method?: string | null;
  payment_date?: string | null;
  payment_memo?: string | null;
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
  journal_mode: string;
  integrity_ok: boolean;
}

export interface MutationResult<T> {
  data: T;
  backup_warning: string | null;
}

export type MemberGroupFilter = "all" | "general" | "junior";
export type MemberStatusFilter = "all" | "active" | "expired";

export interface BackupResult {
  json_path: string;
  db_path: string;
  created_at: string;
}

export type MemberStatus = "active" | "expiring" | "expired" | "depleted" | "paused";

export type MembershipCategory = "monthly" | "session" | "junior";
