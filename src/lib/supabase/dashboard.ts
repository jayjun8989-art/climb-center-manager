import { getSupabaseClient } from "./client";
import type { Center } from "../../types";
import { centerIdForCode } from "./centers";

// ── Types ─────────────────────────────────────────────────────────
export interface ActiveMemberCounts {
  total_count: number;
  adult_count: number;
  junior_count: number;
  paused_count: number;
}

export interface WeeklyMember {
  member_id: string;
  member_name: string;
  member_type: string;
  membership_type: string;
  start_date?: string;
  end_date?: string | null;
  days_remaining?: number;
  created_at?: string;
}

export interface MonthlyTrendItem {
  month_label: string;
  month_end: string;
  adult_count: number;
  junior_count: number;
}

export interface CenterGoal {
  adult_goal: number;
  junior_goal: number;
  effective_date: string;
  updated_at: string;
  updater_name: string | null;
}

export interface FocusCareMember {
  member_id: string;
  member_name: string;
  member_type: string;
  phone: string | null;
  focus_care_started_at: string | null;
  starter_name: string | null;
  last_care_date: string | null;
  last_care_summary: string | null;
  next_care_date: string | null;
  care_log_count: number;
  today_due: boolean;
}

export interface CareHistoryItem {
  id: string;
  care_date: string;
  care_status: string | null;
  care_goal: string | null;
  care_content: string;
  weak_point: string | null;
  next_action: string | null;
  next_care_date: string | null;
  photo_path: string | null;
  staff_id: string | null;
  staff_name: string | null;
  created_at: string;
}

// ── Seoul timezone week boundaries (Sun–Sat) ──────────────────────
export function getSeoulWeekBounds(offsetWeeks = 0): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const seoulMs = now.getTime() + (9 * 60 * 60 * 1000);
  const seoulDate = new Date(seoulMs);
  const dow = seoulDate.getUTCDay(); // 0=Sun
  const sunday = new Date(seoulMs - dow * 86400000);
  const saturday = new Date(sunday.getTime() + 6 * 86400000);

  if (offsetWeeks !== 0) {
    sunday.setUTCDate(sunday.getUTCDate() + offsetWeeks * 7);
    saturday.setUTCDate(saturday.getUTCDate() + offsetWeeks * 7);
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(sunday), weekEnd: fmt(saturday) };
}

function sb() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase not configured");
  return c;
}

// ── RPCs ──────────────────────────────────────────────────────────
export async function fetchActiveMemberCounts(
  center: Center,
  date?: string,
): Promise<ActiveMemberCounts> {
  const centerId = centerIdForCode(center);
  const params: Record<string, unknown> = { p_center_id: centerId };
  if (date) params.p_date = date;
  const { data, error } = await sb().rpc("rpc_active_member_counts", params);
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_count:  Number(row?.total_count  ?? 0),
    adult_count:  Number(row?.adult_count  ?? 0),
    junior_count: Number(row?.junior_count ?? 0),
    paused_count: Number(row?.paused_count ?? 0),
  };
}

export async function fetchWeeklyNewMembers(
  center: Center,
  weekStart: string,
  weekEnd: string,
): Promise<WeeklyMember[]> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_weekly_new_members", {
    p_center_id: centerId,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  });
  if (error) throw new Error(error.message);
  return (data as WeeklyMember[]) ?? [];
}

export async function fetchWeeklyExpiredMembers(
  center: Center,
  weekStart: string,
  weekEnd: string,
): Promise<WeeklyMember[]> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_weekly_expired_members", {
    p_center_id: centerId,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  });
  if (error) throw new Error(error.message);
  return (data as WeeklyMember[]) ?? [];
}

export async function fetchMonthlyTrend(
  center: Center,
  monthsBack = 6,
): Promise<MonthlyTrendItem[]> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_monthly_trend", {
    p_center_id: centerId,
    p_months_back: monthsBack,
  });
  if (error) throw new Error(error.message);
  return (data as MonthlyTrendItem[]) ?? [];
}

export async function fetchCenterGoals(center: Center): Promise<CenterGoal | null> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_get_center_goals", { p_center_id: centerId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return row as CenterGoal;
}

export async function fetchFocusCareMembers(
  center: Center,
  limit = 50,
): Promise<FocusCareMember[]> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_focus_care_members", {
    p_center_id: centerId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as FocusCareMember[]) ?? [];
}

export async function setCenterGoals(
  center: Center,
  adultGoal: number,
  juniorGoal: number,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_set_center_goals", {
    p_center_id: centerId,
    p_adult_goal: adultGoal,
    p_junior_goal: juniorGoal,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return (data as { ok: boolean; error?: string }) ?? { ok: true };
}

export async function setFocusCare(
  memberId: string,
  isCare: boolean,
  center: Center,
): Promise<{ ok: boolean; error?: string }> {
  const centerId = centerIdForCode(center);
  const { data, error } = await sb().rpc("rpc_set_focus_care", {
    p_member_id: memberId,
    p_is_care: isCare,
    p_center_id: centerId,
  });
  if (error) return { ok: false, error: error.message };
  return (data as { ok: boolean; error?: string }) ?? { ok: true };
}

export async function saveCareLog(params: {
  clientMutationId: string;
  memberId: string;
  center: Center;
  careDate: string;
  careStatus: string;
  careGoal: string;
  careContent: string;
  weakPoint: string;
  nextAction: string;
  nextCareDate: string | null;
  staffId: string | null;
  photoPath: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const centerId = centerIdForCode(params.center);
  const { data, error } = await sb().rpc("rpc_save_care_log", {
    p_client_mutation_id: params.clientMutationId,
    p_member_id:          params.memberId,
    p_center_id:          centerId,
    p_care_date:          params.careDate,
    p_care_status:        params.careStatus || null,
    p_care_goal:          params.careGoal || null,
    p_care_content:       params.careContent || null,
    p_weak_point:         params.weakPoint || null,
    p_next_action:        params.nextAction || null,
    p_next_care_date:     params.nextCareDate || null,
    p_staff_id:           params.staffId || null,
    p_photo_path:         params.photoPath || null,
  });
  if (error) return { ok: false, error: error.message };
  return (data as { ok: boolean; id?: string; error?: string }) ?? { ok: true };
}

export async function fetchCareHistory(
  memberId: string,
  limit = 20,
): Promise<CareHistoryItem[]> {
  const { data, error } = await sb().rpc("rpc_member_care_history", {
    p_member_id: memberId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as CareHistoryItem[]) ?? [];
}
