export type Center = "ONCLE" | "GRABIT";
export type CenterRole = "owner" | "admin" | "staff" | "viewer";

export interface UserCenterRoleRow {
  id: string;
  userId: string;
  centerId: string;
  center: Center;
  centerName: string;
  role: CenterRole;
}

export interface MemberListRow {
  id: string;
  center_code: Center;
  name: string;
  phone: string | null;
  member_type: string;
  memo: string | null;
  status: string;
  membership_id: string | null;
  membership_type: string | null;
  pass_type: string | null;
  start_date: string | null;
  end_date: string | null;
  total_count: number | null;
  remaining_count: number | null;
  membership_status: string | null;
  last_visit_at: string | null;
}

export interface RosterRow {
  center_id: string;
  center_code: Center;
  member_id: string;
  member_name: string;
  phone: string | null;
  address: string | null;
  member_type: string;
  member_type_label: string;
  first_registered_at: string | null;
  membership_id: string | null;
  membership_type: string | null;
  membership_type_label: string | null;
  membership_registered_at: string | null;
  start_date: string | null;
  end_date: string | null;
  registration_period_days: number | null;
  total_sessions: number | null;
  remaining_sessions: number | null;
  membership_status: string | null;
  latest_visit_at: string | null;
  locker_number: string | null;
  latest_membership_end_date: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string | null;
  member_status: string;
}

export interface AuditLogRow {
  id: string;
  center_id: string | null;
  entity_type: "member" | "membership" | "attendance" | "locker";
  entity_id: string | null;
  entity_name: string | null;
  action: "update" | "delete" | "soft_delete" | "restore" | "clear_locker";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor_email: string | null;
  actor_role: string | null;
  memo: string | null;
  created_at: string;
}

export interface LockerRow {
  id: string;
  center_id: string;
  locker_number: string;
  member_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  memo: string | null;
  members?: { name: string | null; phone: string | null } | null;
}

export interface PermissionSet {
  role: CenterRole | null;
  hasCenterAccess: boolean;
  canCheckAttendance: boolean;
  canCreateMember: boolean;
  canEditMember: boolean;
  canCancelAttendance: boolean;
  canDeleteMember: boolean;
  denyReason: string;
}
