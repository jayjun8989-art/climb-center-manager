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

export interface PermissionSet {
  role: CenterRole | null;
  hasCenterAccess: boolean;
  canCheckAttendance: boolean;
  canCreateMember: boolean;
  canEditMember: boolean;
  canCancelAttendance: boolean;
  denyReason: string;
}
