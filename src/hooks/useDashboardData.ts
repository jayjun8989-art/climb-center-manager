import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchActiveMemberCounts,
  fetchCenterGoals,
  fetchFocusCareMembers,
  fetchMonthlyTrend,
  fetchWeeklyExpiredMembers,
  fetchWeeklyNewMembers,
  fetchWeeklyReturningMembers,
  getSeoulWeekBounds,
  type ActiveMemberCounts,
  type CenterGoal,
  type FocusCareMember,
  type MonthlyTrendItem,
  type WeeklyMember,
} from "../lib/supabase/dashboard";
import type { Center } from "../types";

export interface DashboardData {
  counts:           ActiveMemberCounts | null;
  weeklyNew:        WeeklyMember[];
  weeklyReturning:  WeeklyMember[];
  weeklyExpired:    WeeklyMember[];
  trend:            MonthlyTrendItem[];
  goals:            CenterGoal | null;
  care:             FocusCareMember[];
  weekStart:        string;
  weekEnd:          string;
  weekOffset:       number;
  loading:          boolean;
  error:            string | null;
  lastRefreshedAt:  Date | null;
  refresh:          () => Promise<void>;
  setWeekOffset:    (offset: number) => void;
}

export function useDashboardData(center: Center, enabled: boolean): DashboardData {
  const [counts,          setCounts]          = useState<ActiveMemberCounts | null>(null);
  const [weeklyNew,       setWeeklyNew]       = useState<WeeklyMember[]>([]);
  const [weeklyReturning, setWeeklyReturning] = useState<WeeklyMember[]>([]);
  const [weeklyExpired,   setWeeklyExpired]   = useState<WeeklyMember[]>([]);
  const [trend,           setTrend]           = useState<MonthlyTrendItem[]>([]);
  const [goals,           setGoals]           = useState<CenterGoal | null>(null);
  const [care,            setCare]            = useState<FocusCareMember[]>([]);
  const [weekOffset,      setWeekOffset]      = useState(0);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { weekStart, weekEnd } = getSeoulWeekBounds(weekOffset);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const [c, wn, wr, we, tr, g, ca] = await Promise.all([
        fetchActiveMemberCounts(center),
        fetchWeeklyNewMembers(center, weekStart, weekEnd),
        fetchWeeklyReturningMembers(center, weekStart, weekEnd),
        fetchWeeklyExpiredMembers(center, weekStart, weekEnd),
        fetchMonthlyTrend(center, 6),
        fetchCenterGoals(center),
        fetchFocusCareMembers(center, 50),
      ]);
      setCounts(c);
      setWeeklyNew(wn);
      setWeeklyReturning(wr);
      setWeeklyExpired(we);
      setTrend(tr);
      setGoals(g);
      setCare(ca);
      setLastRefreshedAt(new Date());
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, center, weekStart, weekEnd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    counts, weeklyNew, weeklyReturning, weeklyExpired, trend, goals, care,
    weekStart, weekEnd, weekOffset,
    loading, error, lastRefreshedAt,
    refresh,
    setWeekOffset,
  };
}
