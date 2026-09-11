import { useCallback, useEffect, useRef, useState } from "react";
import type { Center } from "../types";
import {
  fetchActiveMemberCounts,
  fetchWeeklyStats,
  fetchMonthlyTrend,
  fetchCenterGoals,
  fetchCarePriority,
  type ActiveMemberCounts,
  type WeeklyStats,
  type MonthlyTrendItem,
  type CareGoal,
  type CarePriorityMember,
} from "../lib/supabase/dashboard";
import { isSupabaseConfigured } from "../lib/supabase/config";

export interface DashboardData {
  counts: ActiveMemberCounts | null;
  weekly: WeeklyStats | null;
  trend: MonthlyTrendItem[];
  goals: CareGoal | null;
  care: CarePriorityMember[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: Date | null;
}

function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

export function useDashboardData(center: Center, enabled: boolean): DashboardData & { refresh: () => void } {
  const [counts, setCounts] = useState<ActiveMemberCounts | null>(null);
  const [weekly, setWeekly] = useState<WeeklyStats | null>(null);
  const [trend, setTrend] = useState<MonthlyTrendItem[]>([]);
  const [goals, setGoals] = useState<CareGoal | null>(null);
  const [care, setCare] = useState<CarePriorityMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const { weekStart, weekEnd } = getWeekBounds();
      const [c, w, t, g, p] = await Promise.all([
        fetchActiveMemberCounts(center),
        fetchWeeklyStats(center, weekStart, weekEnd),
        fetchMonthlyTrend(center, 6),
        fetchCenterGoals(center),
        fetchCarePriority(center, 10),
      ]);
      if (ctrl.signal.aborted) return;
      setCounts(c);
      setWeekly(w);
      setTrend(t);
      setGoals(g);
      setCare(p);
      setLastRefreshedAt(new Date());
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [center, enabled]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { counts, weekly, trend, goals, care, loading, error, lastRefreshedAt, refresh: load };
}
