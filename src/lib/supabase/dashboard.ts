import { getSupabaseClient } from "./client";
import type { Center } from "../../types";
import { centerIdForCode } from "./centers";

export interface ActiveMemberCounts {
  total_count: number;
  adult_count: number;
  junior_count: number;
}

export interface WeeklyStats {
  current: ActiveMemberCounts;
  new: { total: number; adult: number; junior: number; members: { id: string; name: string; member_type: string }[] | null };
  expired: { total: number; adult: number; junior: number; members: { id: string; name: string; member_type: string }[] | null };
}

export interface MonthlyTrendItem {
  month_label: string;
  month_end: string;
  adult_count: number;
  junior_count: number;
}

export interface CareGoal {
  adult_target: number;
  junior_target: number;
}

export interface CarePriorityMember {
  care_profile_id: string;
  member_id: string;
  member_name: string;
  phone: string | null;
  member_type: string;
  care_status: string;
  care_reason: string[] | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  next_care_at: string | null;
  injury_flag: boolean;
  dropout_risk_flag: boolean;
  priority_order: number;
  reason_label: string;
  last_log: {
    id: string;
    care_at: string;
    care_summary: string;
    next_task: string | null;
    next_care_at: string | null;
  } | null;
}

export async function fetchActiveMemberCounts(center: Center, date?: string): Promise<ActiveMemberCounts> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
  const centerId = centerIdForCode(center);
  const params: Record<string, unknown> = { p_center_id: centerId };
  if (date) params.p_date = date;
  const { data, error } = await supabase.rpc("rpc_active_member_counts", params);
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_count: Number(row?.total_count ?? 0),
    adult_count: Number(row?.adult_count ?? 0),
    junior_count: Number(row?.junior_count ?? 0),
  };
}

export async function fetchWeeklyStats(center: Center, weekStart: string, weekEnd: string): Promise<WeeklyStats> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
  const centerId = centerIdForCode(center);
  const { data, error } = await supabase.rpc("rpc_weekly_stats", {
    p_center_id: centerId,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  });
  if (error) throw new Error(error.message);
  return data as WeeklyStats;
}

export async function fetchMonthlyTrend(center: Center, monthsBack = 6): Promise<MonthlyTrendItem[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
  const centerId = centerIdForCode(center);
  const { data, error } = await supabase.rpc("rpc_monthly_trend", {
    p_center_id: centerId,
    p_months_back: monthsBack,
  });
  if (error) throw new Error(error.message);
  return (data as MonthlyTrendItem[]) ?? [];
}

export async function fetchCenterGoals(center: Center): Promise<CareGoal> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
  const centerId = centerIdForCode(center);
  const { data, error } = await supabase
    .from("center_goals")
    .select("goal_type,target_value")
    .eq("center_id", centerId)
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  const goals: CareGoal = { adult_target: 0, junior_target: 0 };
  const seen = new Set<string>();
  for (const row of (data ?? []) as { goal_type: string; target_value: number }[]) {
    if (!seen.has(row.goal_type)) {
      seen.add(row.goal_type);
      if (row.goal_type === "adult_members") goals.adult_target = row.target_value;
      if (row.goal_type === "junior_members") goals.junior_target = row.target_value;
    }
  }
  return goals;
}

export async function fetchCarePriority(center: Center, limit = 10): Promise<CarePriorityMember[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
  const centerId = centerIdForCode(center);
  const { data, error } = await supabase.rpc("rpc_care_priority", {
    p_center_id: centerId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as CarePriorityMember[]) ?? [];
}
