import type { Center } from "../../types";
import { getSupabaseClient } from "../supabase/client";
import { isSupabaseConfigured } from "../supabase/config";

export interface MemberRosterRow {
  center_id: string;
  center_code: Center;
  member_id: string;
  member_name: string;
  phone: string | null;
  address: string | null;
  member_type: string;
  member_type_label: string;
  first_registered_at: string;
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
  updated_at: string;
}

export async function fetchMemberRoster(): Promise<MemberRosterRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("member_roster_view")
    .select("*")
    .order("center_code", { ascending: true })
    .order("member_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as MemberRosterRow[];
}

export interface TodayRegistrationSummary {
  total: number;
  oncle: number;
  grabit: number;
  general: number;
  junior: number;
  trial: number;
  monthly: number;
  session: number;
  juniorMembership: number;
}

export function summarizeTodayRegistrations(
  rows: MemberRosterRow[],
  _today: string,
  isToday: (iso: string | null | undefined) => boolean,
): TodayRegistrationSummary {
  const todayRows = rows.filter((row) => isToday(row.membership_registered_at));
  return {
    total: todayRows.length,
    oncle: todayRows.filter((r) => r.center_code === "ONCLE").length,
    grabit: todayRows.filter((r) => r.center_code === "GRABIT").length,
    general: todayRows.filter((r) => r.member_type === "regular").length,
    junior: todayRows.filter((r) => r.member_type === "junior").length,
    trial: todayRows.filter((r) => r.member_type === "trial").length,
    monthly: todayRows.filter((r) => r.membership_type === "monthly").length,
    session: todayRows.filter((r) => r.membership_type === "session").length,
    juniorMembership: todayRows.filter((r) => r.membership_type === "junior").length,
  };
}

export type RosterCenterFilter = "all" | Center;
export type RosterPeriodFilter = "today" | "month" | "custom";
export type RosterMemberTypeFilter = "all" | "regular" | "junior" | "trial";
export type RosterMembershipFilter = "all" | "monthly" | "session" | "junior";

export function filterRosterRows(
  rows: MemberRosterRow[],
  options: {
    center: RosterCenterFilter;
    period: RosterPeriodFilter;
    customStart?: string;
    customEnd?: string;
    memberType: RosterMemberTypeFilter;
    membershipType: RosterMembershipFilter;
    search: string;
    today: string;
    monthStart: string;
    monthEnd: string;
    isToday: (iso: string | null | undefined) => boolean;
    isInRange: (iso: string | null | undefined, start: string, end: string) => boolean;
  },
): MemberRosterRow[] {
  const q = options.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (options.center !== "all" && row.center_code !== options.center) return false;
    if (options.memberType !== "all" && row.member_type !== options.memberType) return false;
    if (options.membershipType !== "all" && row.membership_type !== options.membershipType) {
      return false;
    }

    const regAt = row.membership_registered_at ?? row.first_registered_at;
    if (options.period === "today" && !options.isToday(regAt)) return false;
    if (options.period === "month" && !options.isInRange(regAt, options.monthStart, options.monthEnd)) {
      return false;
    }
    if (
      options.period === "custom" &&
      options.customStart &&
      options.customEnd &&
      !options.isInRange(regAt, options.customStart, options.customEnd)
    ) {
      return false;
    }

    if (!q) return true;
    return (
      row.member_name.toLowerCase().includes(q) ||
      (row.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
      (row.address ?? "").toLowerCase().includes(q) ||
      (row.memo ?? "").toLowerCase().includes(q)
    );
  });
}

export function inactiveOver30Days(rows: MemberRosterRow[], cutoff: string): MemberRosterRow[] {
  return rows.filter((row) => {
    const end = row.latest_membership_end_date ?? row.end_date;
    if (!end) return false;
    return end.slice(0, 10) < cutoff;
  });
}
