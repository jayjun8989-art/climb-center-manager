import type { AuditLogRow, Center, LockerRow, RosterRow } from "../types";
import { getSupabase } from "./supabase";

export const GRABON_ADMIN_EMAIL = "grabon@oncle.local";

export async function fetchRoster(center: Center | "ALL"): Promise<RosterRow[]> {
  const supabase = getSupabase();
  let builder = supabase.from("member_roster_view").select("*").order("member_name", { ascending: true });
  if (center !== "ALL") builder = builder.eq("center_code", center);
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? []) as RosterRow[];
}

export function statusCategory(row: RosterRow, today: string): "유효회원" | "만료예정" | "만료소진" | "정지회원" | "회원권없음" {
  if (row.member_status === "paused" || row.membership_status === "paused") return "정지회원";
  if (!row.membership_id) return "회원권없음";
  if (row.membership_status === "finished") return "만료소진";
  if (row.end_date && row.end_date < today) return "만료소진";
  if ((row.remaining_sessions !== null && row.remaining_sessions <= 0) && row.total_sessions !== null) return "만료소진";
  return "유효회원";
}

export function isExpiringSoon(row: RosterRow, today: string, days: number): boolean {
  if (!row.end_date) return false;
  const end = new Date(row.end_date);
  const base = new Date(today);
  const diffDays = Math.floor((end.getTime() - base.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= days;
}

export function daysAgo(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  return diff >= 0 && diff <= days;
}

export async function fetchAuditLogs(filters: {
  center?: Center | "ALL";
  entityType?: AuditLogRow["entity_type"] | "ALL";
  action?: "update" | "delete" | "ALL";
  sinceDays?: number | null;
}): Promise<AuditLogRow[]> {
  const supabase = getSupabase();
  let builder = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (filters.center && filters.center !== "ALL") {
    const { data: centerRow } = await supabase.from("centers").select("id").eq("code", filters.center).maybeSingle();
    if (centerRow) builder = builder.eq("center_id", centerRow.id);
  }
  if (filters.entityType && filters.entityType !== "ALL") builder = builder.eq("entity_type", filters.entityType);
  if (filters.action && filters.action !== "ALL") {
    if (filters.action === "delete") builder = builder.in("action", ["delete", "soft_delete"]);
    else builder = builder.eq("action", filters.action);
  }
  if (filters.sinceDays != null) {
    const since = new Date(Date.now() - filters.sinceDays * 86400000).toISOString();
    builder = builder.gte("created_at", since);
  }
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLogRow[];
}

export async function fetchLockers(center: Center | "ALL"): Promise<LockerRow[]> {
  const supabase = getSupabase();
  let builder = supabase.from("lockers").select("*, members(name, phone)").order("locker_number", { ascending: true });
  if (center !== "ALL") {
    const { data: centerRow } = await supabase.from("centers").select("id").eq("code", center).maybeSingle();
    if (centerRow) builder = builder.eq("center_id", centerRow.id);
  }
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LockerRow[];
}

export interface TodayAttendanceRow {
  id: string;
  checkin_at: string;
  center_code: Center;
  member_name: string;
  member_type_label: string;
  membership_type_label: string | null;
  deducted_count: number | null;
  remaining_sessions: number | null;
}

export async function fetchTodayAttendance(center: Center | "ALL"): Promise<TodayAttendanceRow[]> {
  const supabase = getSupabase();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let builder = supabase
    .from("attendance_logs")
    .select("id, checkin_at, deducted_count, member_id, center_id, centers(code), members(name, member_type)")
    .gte("checkin_at", startOfDay.toISOString())
    .is("canceled_at", null)
    .order("checkin_at", { ascending: false });

  if (center !== "ALL") {
    const { data: centerRow } = await supabase.from("centers").select("id").eq("code", center).maybeSingle();
    if (centerRow) builder = builder.eq("center_id", centerRow.id);
  }

  const { data, error } = await builder;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    checkin_at: string;
    deducted_count: number | null;
    member_id: string;
    centers: { code: Center } | { code: Center }[] | null;
    members: { name: string; member_type: string } | { name: string; member_type: string }[] | null;
  }>;

  const memberIds = rows.map((r) => r.member_id);
  let rosterById = new Map<string, RosterRow>();
  if (memberIds.length > 0) {
    const { data: roster } = await supabase.from("member_roster_view").select("*").in("member_id", memberIds);
    rosterById = new Map((roster ?? []).map((r: any) => [r.member_id, r as RosterRow]));
  }

  return rows.map((r) => {
    const centerInfo = Array.isArray(r.centers) ? r.centers[0] : r.centers;
    const memberInfo = Array.isArray(r.members) ? r.members[0] : r.members;
    const roster = rosterById.get(r.member_id);
    return {
      id: r.id,
      checkin_at: r.checkin_at,
      center_code: centerInfo?.code ?? "ONCLE",
      member_name: memberInfo?.name ?? "-",
      member_type_label: roster?.member_type_label ?? memberInfo?.member_type ?? "-",
      membership_type_label: roster?.membership_type_label ?? null,
      deducted_count: r.deducted_count,
      remaining_sessions: roster?.remaining_sessions ?? null,
    };
  });
}

export async function updateMember(memberId: string, patch: Record<string, unknown>, memo?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("rpc_mobile_update_member", {
    p_member_id: memberId, p_patch: patch, p_memo: memo ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateMembership(membershipId: string, patch: Record<string, unknown>, memo?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("rpc_mobile_update_membership", {
    p_membership_id: membershipId, p_patch: patch, p_memo: memo ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateLocker(lockerId: string, patch: Record<string, unknown>, memo?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("rpc_mobile_update_locker", {
    p_locker_id: lockerId, p_patch: patch, p_memo: memo ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createMember(params: {
  centerCode: Center;
  name: string;
  phone?: string;
  memberType: string;
  memo?: string;
}): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("rpc_mobile_create_member", {
    p_center_code: params.centerCode,
    p_name: params.name,
    p_phone: params.phone ?? null,
    p_member_type: params.memberType,
    p_memo: params.memo ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createMembership(params: {
  memberId: string;
  membershipType: string;
  passType: string;
  startDate: string;
  endDate?: string | null;
  totalSessions?: number | null;
  remainingSessions?: number | null;
}): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("rpc_mobile_create_membership", {
    p_member_id: params.memberId,
    p_membership_type: params.membershipType,
    p_pass_type: params.passType,
    p_start_date: params.startDate,
    p_end_date: params.endDate ?? null,
    p_total_sessions: params.totalSessions ?? null,
    p_remaining_sessions: params.remainingSessions ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function pauseMembership(membershipId: string, reason?: string) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("rpc_pause_membership", {
    p_membership_id: membershipId, p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function resumeMembership(membershipId: string) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("rpc_resume_membership", {
    p_membership_id: membershipId,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMember(memberId: string, memo?: string) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("rpc_mobile_delete_member", {
    p_member_id: memberId, p_memo: memo ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelAttendance(attendanceId: string) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("rpc_mobile_cancel_attendance", {
    p_attendance_id: attendanceId,
  });
  if (error) throw new Error(error.message);
}
