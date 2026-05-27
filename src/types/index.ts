export type Center = "ONCLE" | "GRABIT";
export type MembershipType = "monthly_1" | "monthly_3" | "monthly_6" | "session" | "junior";

export interface Member {
  id: number;
  center: Center;
  name: string;
  phone: string | null;
  membership_type: MembershipType;
  start_date: string;
  end_date: string | null;
  total_sessions: number | null;
  remaining_sessions: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberInput {
  center: Center;
  name: string;
  phone?: string | null;
  membership_type: MembershipType;
  start_date: string;
  end_date?: string | null;
  total_sessions?: number | null;
  remaining_sessions?: number | null;
  notes?: string | null;
}

export interface PaginatedMembers {
  members: Member[];
  total: number;
  page: number;
  page_size: number;
}

export interface AttendanceRecord {
  id: number;
  member_id: number;
  checked_at: string;
}

export interface DashboardStats {
  total_members: number;
  active_members: number;
  expiring_soon: number;
  today_attendance: number;
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

export type MemberStatus = "active" | "expiring" | "expired" | "depleted";

export type MembershipCategory = "monthly" | "session" | "junior";
