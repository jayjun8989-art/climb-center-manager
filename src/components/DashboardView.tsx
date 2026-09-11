import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Heart,
  Minus,
  RefreshCw,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useRealtimeUpdates, type RealtimeStatus } from "../hooks/useRealtimeUpdates";
import { centerIdForCode } from "../lib/supabase/centers";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { Center } from "../types";
import type { CarePriorityMember, MonthlyTrendItem } from "../lib/supabase/dashboard";

interface DashboardViewProps {
  center: Center;
  isAuthenticated: boolean;
  onNotify: (msg: string) => void;
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="glass-panel rounded-[1.5rem] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">{label}</span>
        <span className={`rounded-xl p-2 ${color}`}>{icon}</span>
      </div>
      {loading ? (
        <div className="h-8 w-24 animate-pulse rounded-lg bg-[var(--border)]" />
      ) : (
        <span className="text-3xl font-bold tabular-nums">{value}</span>
      )}
      {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
    </div>
  );
}

function WeeklyDelta({ label, value }: { label: string; value: number }) {
  const positive = value > 0;
  const zero = value === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${zero ? "text-[var(--muted)]" : positive ? "text-emerald-500" : "text-red-500"}`}>
      {zero ? <Minus size={14} /> : positive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      {label}: {positive ? "+" : ""}{value}
    </span>
  );
}

function TrendBar({ items }: { items: MonthlyTrendItem[] }) {
  if (!items.length) return null;
  const maxVal = Math.max(...items.map((i) => i.adult_count + i.junior_count), 1);
  return (
    <div className="glass-panel rounded-[1.5rem] p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <TrendingUp size={16} />
        월간 활성회원 추이
      </div>
      <div className="flex items-end gap-2 h-24">
        {items.map((item) => {
          const total = item.adult_count + item.junior_count;
          const pct = Math.round((total / maxVal) * 100);
          const adultPct = Math.round((item.adult_count / Math.max(total, 1)) * pct);
          const juniorPct = pct - adultPct;
          return (
            <div key={item.month_label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted)] tabular-nums">{total}</span>
              <div className="w-full rounded overflow-hidden flex flex-col-reverse" style={{ height: `${Math.max(pct, 4)}%` }}>
                <div className="w-full bg-blue-400/70" style={{ flex: adultPct }} />
                <div className="w-full bg-purple-400/70" style={{ flex: juniorPct }} />
              </div>
              <span className="text-[9px] text-[var(--muted)]">{item.month_label.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[10px] text-[var(--muted)]">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-400/70 mr-1" />일반</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-purple-400/70 mr-1" />주니어</span>
      </div>
    </div>
  );
}

function CareCard({ member }: { member: CarePriorityMember }) {
  const badgeColor =
    member.injury_flag
      ? "bg-red-500/15 text-red-500"
      : member.priority_order <= 2
      ? "bg-amber-500/15 text-amber-600"
      : "bg-blue-500/15 text-blue-500";

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm truncate">{member.member_name}</span>
          <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${badgeColor}`}>
            {member.reason_label}
          </span>
          {member.injury_flag && (
            <span className="text-[10px] rounded-full px-2 py-0.5 font-medium bg-red-500/15 text-red-500">
              부상
            </span>
          )}
        </div>
        {member.last_log && (
          <p className="mt-1 text-xs text-[var(--muted)] line-clamp-1">
            최근: {member.last_log.care_summary}
          </p>
        )}
        {!member.last_log && (
          <p className="mt-1 text-xs text-[var(--muted)]">케어 기록 없음</p>
        )}
        {member.next_care_at && (
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            다음 케어: {member.next_care_at.slice(0, 10)}
          </p>
        )}
      </div>
    </div>
  );
}

function RealtimeStatusDot({ status }: { status: RealtimeStatus }) {
  if (status === "connected") return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
      <Wifi size={12} />실시간 연결됨
    </span>
  );
  if (status === "connecting") return (
    <span className="inline-flex items-center gap-1.5 text-xs text-amber-500 animate-pulse">
      <Activity size={12} />연결 중...
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <WifiOff size={12} />연결 끊김
    </span>
  );
}

export function DashboardView({ center, isAuthenticated, onNotify: _onNotify }: DashboardViewProps) {
  const enabled = isAuthenticated && isSupabaseConfigured();
  const { counts, weekly, trend, goals, care, loading, error, lastRefreshedAt, refresh } = useDashboardData(center, enabled);
  const [centerId, setCenterId] = useState<string | null>(null);

  useEffect(() => {
    setCenterId(centerIdForCode(center));
  }, [center]);

  const handleChange = useCallback(() => {
    void refresh();
  }, [refresh]);

  const realtimeStatus = useRealtimeUpdates({
    enabled,
    centerId,
    onMemberChange: handleChange,
    onMembershipChange: handleChange,
    onAttendanceChange: handleChange,
    onCareChange: handleChange,
  });

  const newCount = weekly?.new?.total ?? 0;
  const expiredCount = weekly?.expired?.total ?? 0;
  const weeklyNet = newCount - expiredCount;
  const totalGoal = (goals?.adult_target ?? 0) + (goals?.junior_target ?? 0);
  const totalCurrent = counts?.total_count ?? 0;
  const goalPct = totalGoal > 0 ? Math.round((totalCurrent / totalGoal) * 100) : null;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">실시간 현황</h2>
          <RealtimeStatusDot status={realtimeStatus} />
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshedAt && (
            <span className="text-xs text-[var(--muted)]">
              {lastRefreshedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 기준
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary text-xs py-1.5 px-3"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="현재 회원"
          value={loading ? "—" : totalCurrent}
          sub={
            counts
              ? `일반 ${counts.adult_count} · 주니어 ${counts.junior_count}${goalPct !== null ? ` · 목표 ${goalPct}%` : ""}`
              : undefined
          }
          icon={<Users size={18} />}
          color="bg-blue-500/15 text-blue-500"
          loading={loading}
        />

        <StatCard
          label="이번 주 변화"
          value={loading ? "—" : `${weeklyNet >= 0 ? "+" : ""}${weeklyNet}`}
          sub={
            weekly
              ? `신규 ${newCount}명 · 만료 ${expiredCount}명`
              : undefined
          }
          icon={
            <span className="flex flex-col gap-0.5">
              {weeklyNet > 0 ? <ArrowUp size={18} /> : weeklyNet < 0 ? <ArrowDown size={18} /> : <Minus size={18} />}
            </span>
          }
          color={weeklyNet > 0 ? "bg-emerald-500/15 text-emerald-500" : weeklyNet < 0 ? "bg-red-500/15 text-red-500" : "bg-[var(--border)] text-[var(--muted)]"}
          loading={loading}
        />

        <StatCard
          label="오늘 케어"
          value={loading ? "—" : care.length}
          sub={care.length > 0 ? `긴급 ${care.filter((c) => c.injury_flag).length}건 포함` : "케어 대상 없음"}
          icon={<Heart size={18} />}
          color="bg-rose-500/15 text-rose-500"
          loading={loading}
        />

        <StatCard
          label="월간 추이"
          value={
            loading ? "—" :
            trend.length >= 2
              ? (() => {
                  const last = trend[trend.length - 1];
                  const prev = trend[trend.length - 2];
                  const lastT = last.adult_count + last.junior_count;
                  const prevT = prev.adult_count + prev.junior_count;
                  const diff = lastT - prevT;
                  return `${diff >= 0 ? "+" : ""}${diff}`;
                })()
              : "—"
          }
          sub={trend.length >= 2 ? `전월 대비 변화` : undefined}
          icon={<TrendingUp size={18} />}
          color="bg-violet-500/15 text-violet-500"
          loading={loading}
        />
      </div>

      {/* Weekly breakdown + trend chart */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Weekly detail */}
        <div className="glass-panel rounded-[1.5rem] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={16} />
            이번 주 신규 · 만료
          </div>
          {weekly ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-emerald-500/10 px-4 py-3">
                <p className="text-xs text-emerald-600 font-medium mb-1">신규</p>
                <p className="text-2xl font-bold text-emerald-600">{newCount}</p>
                <div className="mt-1 flex gap-2">
                  <WeeklyDelta label="일반" value={weekly.new.adult} />
                  <WeeklyDelta label="주니어" value={weekly.new.junior} />
                </div>
                {weekly.new.members && weekly.new.members.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
                    {weekly.new.members.slice(0, 5).map((m) => (
                      <li key={m.id} className="truncate">· {m.name}</li>
                    ))}
                    {weekly.new.members.length > 5 && <li className="text-[var(--muted)]">외 {weekly.new.members.length - 5}명</li>}
                  </ul>
                )}
              </div>
              <div className="rounded-2xl bg-red-500/10 px-4 py-3">
                <p className="text-xs text-red-500 font-medium mb-1">만료</p>
                <p className="text-2xl font-bold text-red-500">{expiredCount}</p>
                <div className="mt-1 flex gap-2">
                  <WeeklyDelta label="일반" value={-weekly.expired.adult} />
                  <WeeklyDelta label="주니어" value={-weekly.expired.junior} />
                </div>
                {weekly.expired.members && weekly.expired.members.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
                    {weekly.expired.members.slice(0, 5).map((m) => (
                      <li key={m.id} className="truncate">· {m.name}</li>
                    ))}
                    {weekly.expired.members.length > 5 && <li className="text-[var(--muted)]">외 {weekly.expired.members.length - 5}명</li>}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="h-24 animate-pulse rounded-2xl bg-[var(--border)]" />
          )}
        </div>

        {/* Trend chart */}
        {trend.length > 0 ? (
          <TrendBar items={trend} />
        ) : (
          <div className="glass-panel rounded-[1.5rem] p-5">
            <div className="h-24 animate-pulse rounded-2xl bg-[var(--border)]" />
          </div>
        )}
      </div>

      {/* Care priority */}
      <div className="glass-panel rounded-[1.5rem] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Heart size={16} />
            집중케어 우선순위
          </div>
          {care.length > 0 && (
            <span className="text-xs text-[var(--muted)]">총 {care.length}명</span>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-[var(--border)]" />
            ))}
          </div>
        ) : care.length === 0 ? (
          <p className="text-sm text-[var(--muted)] py-4 text-center">케어 대상 회원이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {care.map((member) => (
              <CareCard key={member.care_profile_id} member={member} />
            ))}
          </div>
        )}
      </div>

      {/* Goals progress */}
      {goals && (goals.adult_target > 0 || goals.junior_target > 0) && (
        <div className="glass-panel rounded-[1.5rem] p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp size={16} />
            목표 달성률
          </div>
          <div className="space-y-3">
            {goals.adult_target > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--muted)]">일반 회원</span>
                  <span className="font-semibold tabular-nums">{counts?.adult_count ?? 0} / {goals.adult_target}명</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min(Math.round(((counts?.adult_count ?? 0) / goals.adult_target) * 100), 100)}%` }}
                  />
                </div>
                <p className="text-right text-[10px] text-[var(--muted)] mt-0.5">
                  {Math.round(((counts?.adult_count ?? 0) / goals.adult_target) * 100)}%
                </p>
              </div>
            )}
            {goals.junior_target > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--muted)]">주니어 회원</span>
                  <span className="font-semibold tabular-nums">{counts?.junior_count ?? 0} / {goals.junior_target}명</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-500"
                    style={{ width: `${Math.min(Math.round(((counts?.junior_count ?? 0) / goals.junior_target) * 100), 100)}%` }}
                  />
                </div>
                <p className="text-right text-[10px] text-[var(--muted)] mt-0.5">
                  {Math.round(((counts?.junior_count ?? 0) / goals.junior_target) * 100)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
