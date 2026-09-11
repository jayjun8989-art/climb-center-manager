import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Heart,
  RefreshCw,
  Target,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  Activity,
} from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useRealtimeUpdates, type RealtimeStatus } from "../hooks/useRealtimeUpdates";
import { centerIdForCode } from "../lib/supabase/centers";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { setCenterGoals, setFocusCare, type FocusCareMember, type MonthlyTrendItem, type WeeklyMember } from "../lib/supabase/dashboard";
import { CareLogModal } from "./CareLogModal";
import type { Center, PermissionSet } from "../types";

interface DashboardViewProps {
  center: Center;
  isAuthenticated: boolean;
  permissions: PermissionSet;
  onNotify: (msg: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${parseInt(m)}.${parseInt(day)}`;
}
function weekDow(d: string) {
  const dow = ["일","월","화","수","목","금","토"];
  return dow[new Date(d + "T00:00:00").getDay()];
}
function weekRangeLabel(start: string, end: string) {
  return `${fmtDate(start)}(${weekDow(start)})~${fmtDate(end)}(${weekDow(end)})`;
}

// ── Sub-components ────────────────────────────────────────────────
function RealtimeStatusDot({ status }: { status: RealtimeStatus }) {
  if (status === "connected") return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
      <Wifi size={11} />실시간
    </span>
  );
  if (status === "connecting") return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-500 animate-pulse">
      <Activity size={11} />연결중
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
      <WifiOff size={11} />오프라인
    </span>
  );
}

function MemberListModal({
  title,
  members,
  onClose,
}: {
  title: string;
  members: WeeklyMember[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-[var(--surface)] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <h3 className="font-bold text-sm">{title}</h3>
          <span className="text-xs text-[var(--muted)]">{members.length}명</span>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-1">
          {members.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-6">해당 회원이 없습니다.</p>
          )}
          {members.map((m) => (
            <div key={m.member_id} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${
                  m.member_type === "junior" ? "bg-orange-500/15 text-orange-600" : "bg-blue-500/15 text-blue-600"
                }`}>
                  {m.member_type === "junior" ? "주니어" : "성인"}
                </span>
                <span className="text-sm font-medium">{m.member_name}</span>
              </div>
              <div className="text-right text-xs text-[var(--muted)]">
                {m.start_date && <span>{fmtDate(m.start_date)} 시작</span>}
                {m.end_date && <span>{fmtDate(m.end_date)} 만료</span>}
                {m.days_remaining !== undefined && (
                  <span className={m.days_remaining < 0 ? " text-red-500" : ""}>
                    {" "}({m.days_remaining < 0 ? `${Math.abs(m.days_remaining)}일 경과` : `D-${m.days_remaining}`})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)]">
          <button type="button" className="btn btn-secondary w-full" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function GoalBar({
  label,
  current,
  goal,
  color,
}: {
  label: string;
  current: number;
  goal: number;
  color: string;
}) {
  const pct = goal > 0 ? Math.min(Math.round((current / goal) * 100), 100) : null;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-semibold tabular-nums">
          {current}명 / {goal > 0 ? `${goal}명` : "—"}
          {pct !== null && <span className="ml-2 text-[var(--muted)]">{pct}%</span>}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-[var(--border)] overflow-hidden">
        {pct !== null ? (
          <div className={`h-full rounded-full transition-all duration-500 ${color}`}
               style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full rounded-full bg-[var(--border)] w-full" />
        )}
      </div>
      {pct === null && (
        <p className="text-right text-[10px] text-[var(--muted)] mt-0.5">목표 미설정</p>
      )}
    </div>
  );
}

function TrendChart({ items }: { items: MonthlyTrendItem[] }) {
  if (!items.length) return null;
  const maxVal = Math.max(...items.map((i) => i.adult_count + i.junior_count), 1);
  return (
    <div>
      <div className="flex items-end gap-1.5 h-36">
        {items.map((item) => {
          const adultH  = Math.round((item.adult_count  / maxVal) * 100);
          const juniorH = Math.round((item.junior_count / maxVal) * 100);
          return (
            <div key={item.month_label} className="flex-1 flex flex-col items-center gap-0.5">
              {/* adult count */}
              <span className="text-[8px] text-blue-500 tabular-nums font-medium leading-tight">{item.adult_count}</span>
              {/* junior count */}
              <span className="text-[8px] text-orange-500 tabular-nums font-medium leading-tight">{item.junior_count}</span>
              <div className="w-full flex flex-col-reverse rounded overflow-hidden"
                   style={{ height: `${Math.max(adultH + juniorH, 4)}%` }}>
                <div className="w-full bg-blue-500/70"   style={{ flex: adultH }} />
                <div className="w-full bg-orange-400/70" style={{ flex: juniorH }} />
              </div>
              <span className="text-[9px] text-[var(--muted)]">{item.month_label.slice(5)}월</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-[10px] text-[var(--muted)]">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500/70 mr-1" />성인</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-400/70 mr-1" />주니어</span>
      </div>
    </div>
  );
}

function CareRow({
  member,
  onClickName,
}: {
  member: FocusCareMember;
  onClickName: (m: FocusCareMember) => void;
}) {
  const typeLabel = member.member_type === "junior" ? "주니어" : "성인";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="font-semibold text-sm text-[var(--accent)] hover:underline"
            onClick={() => onClickName(member)}
          >
            {member.member_name}
          </button>
          <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${
            member.member_type === "junior"
              ? "bg-orange-500/15 text-orange-600"
              : "bg-blue-500/15 text-blue-600"
          }`}>
            {typeLabel}
          </span>
          {member.today_due && (
            <span className="text-[10px] rounded-full px-2 py-0.5 font-medium bg-red-500/15 text-red-500">
              오늘 확인
            </span>
          )}
        </div>
        {member.last_care_date && (
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            최근: {member.last_care_date}
            {member.last_care_summary && ` · ${member.last_care_summary.slice(0, 30)}`}
          </p>
        )}
        {!member.last_care_date && (
          <p className="mt-0.5 text-xs text-[var(--muted)]">케어 기록 없음</p>
        )}
      </div>
      {member.next_care_date && (
        <span className={`text-[10px] shrink-0 ${member.today_due ? "text-red-500 font-semibold" : "text-[var(--muted)]"}`}>
          {member.next_care_date}
        </span>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────
export function DashboardView({ center, isAuthenticated, permissions, onNotify }: DashboardViewProps) {
  const enabled = isAuthenticated && isSupabaseConfigured();
  const isAdmin = permissions.role === "owner" || permissions.role === "admin";
  const {
    counts, weeklyNew, weeklyExpired, trend, goals, care,
    weekStart, weekEnd, weekOffset,
    loading, error, lastRefreshedAt,
    refresh, setWeekOffset,
  } = useDashboardData(center, enabled);

  const [centerId, setCenterId] = useState<string | null>(null);
  const [showNewList,     setShowNewList]     = useState(false);
  const [showExpiredList, setShowExpiredList] = useState(false);
  const [careModal,       setCareModal]       = useState<FocusCareMember | null>(null);
  const [editingGoal,     setEditingGoal]     = useState(false);
  const [goalAdult,       setGoalAdult]       = useState<number | "">(0);
  const [goalJunior,      setGoalJunior]      = useState<number | "">(0);
  const [goalSaving,      setGoalSaving]      = useState(false);

  useEffect(() => { setCenterId(centerIdForCode(center)); }, [center]);

  const handleChange = useCallback(() => { void refresh(); }, [refresh]);

  const realtimeStatus = useRealtimeUpdates({
    enabled,
    centerId,
    onMemberChange:     handleChange,
    onMembershipChange: handleChange,
    onAttendanceChange: handleChange,
    onCareChange:       handleChange,
  });

  // Derived counts
  const newAdult   = weeklyNew.filter((m) => m.member_type === "regular").length;
  const newJunior  = weeklyNew.filter((m) => m.member_type === "junior").length;
  const expAdult   = weeklyExpired.filter((m) => m.member_type === "regular").length;
  const expJunior  = weeklyExpired.filter((m) => m.member_type === "junior").length;
  const careAdult  = care.filter((m) => m.member_type === "regular").length;
  const careJunior = care.filter((m) => m.member_type === "junior").length;
  const careDue    = care.filter((m) => m.today_due).length;

  const handleOpenGoalEdit = () => {
    setGoalAdult(goals?.adult_goal ?? 0);
    setGoalJunior(goals?.junior_goal ?? 0);
    setEditingGoal(true);
  };

  const handleSaveGoal = async () => {
    setGoalSaving(true);
    const result = await setCenterGoals(
      center,
      typeof goalAdult  === "number" ? goalAdult  : 0,
      typeof goalJunior === "number" ? goalJunior : 0,
    );
    setGoalSaving(false);
    if (!result.ok) {
      onNotify(`목표 저장 실패: ${result.error}`);
      return;
    }
    onNotify("목표 인원이 저장되었습니다.");
    setEditingGoal(false);
    void refresh();
  };

  const handleFocusCareToggle = async (member: FocusCareMember) => {
    const result = await setFocusCare(member.member_id, false, center);
    if (result.ok) {
      onNotify(`${member.member_name} 집중케어 해제`);
      void refresh();
    } else {
      onNotify(`오류: ${result.error}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">대시보드</h2>
          <RealtimeStatusDot status={realtimeStatus} />
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshedAt && (
            <span className="text-xs text-[var(--muted)]">
              {lastRefreshedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary text-xs py-1.5 px-3"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* ── 1. 현재 유효회원 ───────────────────────────────── */}
      <div className="glass-panel rounded-[1.5rem] p-5">
        <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
          <Users size={16} />
          현재 유효회원
        </div>
        {loading && !counts ? (
          <div className="h-16 animate-pulse rounded-2xl bg-[var(--border)]" />
        ) : (
          <>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-4xl font-bold tabular-nums">{counts?.total_count ?? 0}</span>
              <span className="text-base text-[var(--muted)] mb-1">명</span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-blue-500">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                성인 <strong>{counts?.adult_count ?? 0}명</strong>
              </span>
              <span className="text-[var(--muted)]">·</span>
              <span className="flex items-center gap-1.5 text-orange-500">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                주니어 <strong>{counts?.junior_count ?? 0}명</strong>
              </span>
              {(counts?.paused_count ?? 0) > 0 && (
                <>
                  <span className="text-[var(--muted)]">·</span>
                  <span className="text-amber-500">정지 중 {counts?.paused_count}명</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 2+3. 이번 주 신규 / 만료 ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* 신규 */}
        <button
          type="button"
          className="glass-panel rounded-[1.5rem] p-5 text-left hover:border-emerald-500/30 transition-colors"
          onClick={() => setShowNewList(true)}
          disabled={loading}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
              <UserPlus size={14} />이번 주 신규
            </div>
            <span className="rounded-xl p-1.5 bg-emerald-500/15 text-emerald-500">
              <UserPlus size={14} />
            </span>
          </div>
          {loading ? (
            <div className="h-8 animate-pulse rounded-lg bg-[var(--border)]" />
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums text-emerald-600">{weeklyNew.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                성인 {newAdult} · 주니어 {newJunior}
              </p>
            </>
          )}
        </button>

        {/* 만료 */}
        <button
          type="button"
          className="glass-panel rounded-[1.5rem] p-5 text-left hover:border-red-500/30 transition-colors"
          onClick={() => setShowExpiredList(true)}
          disabled={loading}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
              <UserMinus size={14} />이번 주 만료
            </div>
            <span className="rounded-xl p-1.5 bg-red-500/15 text-red-500">
              <UserMinus size={14} />
            </span>
          </div>
          {loading ? (
            <div className="h-8 animate-pulse rounded-lg bg-[var(--border)]" />
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums text-red-500">{weeklyExpired.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                성인 {expAdult} · 주니어 {expJunior}
              </p>
            </>
          )}
        </button>
      </div>

      {/* 주간 기간 네비게이션 */}
      <div className="glass-panel rounded-[1.5rem] px-5 py-3 flex items-center justify-between">
        <button
          type="button"
          className="p-1.5 rounded-xl hover:bg-[var(--border)]"
          onClick={() => setWeekOffset(weekOffset - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <p className="text-xs font-medium">
            {weekOffset === 0 ? "이번 주" : weekOffset === -1 ? "지난 주" : `${weekOffset < 0 ? Math.abs(weekOffset) + "주 전" : weekOffset + "주 후"}`}
          </p>
          <p className="text-[10px] text-[var(--muted)]">{weekRangeLabel(weekStart, weekEnd)}</p>
        </div>
        <button
          type="button"
          className="p-1.5 rounded-xl hover:bg-[var(--border)]"
          onClick={() => setWeekOffset(weekOffset + 1)}
          disabled={weekOffset >= 0}
        >
          <ChevronRight size={16} className={weekOffset >= 0 ? "opacity-30" : ""} />
        </button>
      </div>

      {/* ── 4. 목표 달성률 ─────────────────────────────────── */}
      <div className="glass-panel rounded-[1.5rem] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target size={16} />
            목표 달성률
          </div>
          {isAdmin && !editingGoal && (
            <button
              type="button"
              className="btn btn-secondary text-xs !py-1.5 !px-3"
              onClick={handleOpenGoalEdit}
            >
              목표 설정
            </button>
          )}
        </div>

        {editingGoal && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <p className="text-xs font-medium text-[var(--muted)]">목표 인원 설정 (관리자)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-[var(--muted)]">성인 목표</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    className="input flex-1 text-sm"
                    min={0}
                    value={goalAdult}
                    onChange={(e) => setGoalAdult(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  <span className="text-sm text-[var(--muted)]">명</span>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1 text-[var(--muted)]">주니어 목표</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    className="input flex-1 text-sm"
                    min={0}
                    value={goalJunior}
                    onChange={(e) => setGoalJunior(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  <span className="text-sm text-[var(--muted)]">명</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1 text-sm"
                onClick={() => setEditingGoal(false)}
                disabled={goalSaving}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1 text-sm"
                onClick={() => void handleSaveGoal()}
                disabled={goalSaving}
              >
                {goalSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted)]">
                <th className="text-left pb-2 font-medium">구분</th>
                <th className="text-right pb-2 font-medium">현재</th>
                <th className="text-right pb-2 font-medium">목표</th>
                <th className="text-right pb-2 font-medium">달성률</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--border)]">
                <td className="py-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />성인
                </td>
                <td className="text-right tabular-nums font-semibold">{counts?.adult_count ?? 0}명</td>
                <td className="text-right tabular-nums text-[var(--muted)]">
                  {goals && goals.adult_goal > 0 ? `${goals.adult_goal}명` : "—"}
                </td>
                <td className="text-right tabular-nums">
                  {goals && goals.adult_goal > 0
                    ? <span className="font-semibold text-blue-500">{Math.round(((counts?.adult_count ?? 0) / goals.adult_goal) * 100)}%</span>
                    : <span className="text-xs text-[var(--muted)]">목표 미설정</span>}
                </td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="py-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />주니어
                </td>
                <td className="text-right tabular-nums font-semibold">{counts?.junior_count ?? 0}명</td>
                <td className="text-right tabular-nums text-[var(--muted)]">
                  {goals && goals.junior_goal > 0 ? `${goals.junior_goal}명` : "—"}
                </td>
                <td className="text-right tabular-nums">
                  {goals && goals.junior_goal > 0
                    ? <span className="font-semibold text-orange-500">{Math.round(((counts?.junior_count ?? 0) / goals.junior_goal) * 100)}%</span>
                    : <span className="text-xs text-[var(--muted)]">목표 미설정</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {goals && (goals.adult_goal > 0 || goals.junior_goal > 0) && (
          <div className="space-y-3 pt-1">
            <GoalBar
              label="성인 유효회원"
              current={counts?.adult_count ?? 0}
              goal={goals.adult_goal}
              color="bg-blue-500"
            />
            <GoalBar
              label="주니어 유효회원"
              current={counts?.junior_count ?? 0}
              goal={goals.junior_goal}
              color="bg-orange-400"
            />
          </div>
        )}
      </div>

      {/* ── 5. 집중케어 ──────────────────────────────────────── */}
      <div className="glass-panel rounded-[1.5rem] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Heart size={16} />
            집중케어
          </div>
          {care.length > 0 && (
            <div className="flex gap-2 text-xs text-[var(--muted)]">
              <span>전체 {care.length}명</span>
              <span>·</span>
              <span>성인 {careAdult}</span>
              <span>·</span>
              <span>주니어 {careJunior}</span>
              {careDue > 0 && (
                <>
                  <span>·</span>
                  <span className="text-red-500 font-medium">오늘 확인 {careDue}명</span>
                </>
              )}
            </div>
          )}
        </div>
        {loading && care.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-[var(--border)]" />
            ))}
          </div>
        ) : care.length === 0 ? (
          <p className="text-sm text-[var(--muted)] py-4 text-center">
            집중케어 지정 회원이 없습니다.
            <br />
            <span className="text-xs">회원명단에서 회원을 선택해 지정하세요.</span>
          </p>
        ) : (
          <div className="space-y-2">
            {care.map((member) => (
              <div key={member.member_id} className="relative">
                <CareRow member={member} onClickName={setCareModal} />
                <button
                  type="button"
                  className="absolute top-2 right-2 text-[10px] text-[var(--muted)] hover:text-red-400 px-1.5 py-0.5 rounded"
                  title="집중케어 해제"
                  onClick={() => void handleFocusCareToggle(member)}
                >
                  해제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 6. 월간 추이 ──────────────────────────────────────── */}
      <div className="glass-panel rounded-[1.5rem] p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp size={16} />
          월간 유효회원 추이
          {trend.length > 0 && (
            <span className="text-xs font-normal text-[var(--muted)] ml-1">최근 {trend.length}개월</span>
          )}
        </div>
        {loading && trend.length === 0 ? (
          <div className="h-28 animate-pulse rounded-2xl bg-[var(--border)]" />
        ) : trend.length === 0 ? (
          <p className="text-sm text-[var(--muted)] py-4 text-center">데이터 없음</p>
        ) : (
          <TrendChart items={trend} />
        )}
        {trend.length >= 2 && (() => {
          const last = trend[trend.length - 1];
          const prev = trend[trend.length - 2];
          const adultDiff  = last.adult_count  - prev.adult_count;
          const juniorDiff = last.junior_count - prev.junior_count;
          return (
            <div className="pt-2 border-t border-[var(--border)] flex gap-4 text-xs text-[var(--muted)]">
              <span>성인 전월 대비 <strong className={adultDiff >= 0 ? "text-blue-500" : "text-red-500"}>{adultDiff >= 0 ? "+" : ""}{adultDiff}명</strong></span>
              <span>주니어 전월 대비 <strong className={juniorDiff >= 0 ? "text-orange-500" : "text-red-500"}>{juniorDiff >= 0 ? "+" : ""}{juniorDiff}명</strong></span>
            </div>
          );
        })()}
      </div>

      {/* ── Weekly list modals ────────────────────────────────── */}
      {showNewList && (
        <MemberListModal
          title={`이번 주 신규 ${weeklyNew.length}명 · ${weekRangeLabel(weekStart, weekEnd)}`}
          members={weeklyNew}
          onClose={() => setShowNewList(false)}
        />
      )}
      {showExpiredList && (
        <MemberListModal
          title={`이번 주 만료 ${weeklyExpired.length}명 · ${weekRangeLabel(weekStart, weekEnd)}`}
          members={weeklyExpired}
          onClose={() => setShowExpiredList(false)}
        />
      )}

      {/* ── Care log modal ────────────────────────────────────── */}
      {careModal && (
        <CareLogModal
          member={careModal}
          center={center}
          onClose={() => setCareModal(null)}
          onSaved={() => {
            setCareModal(null);
            onNotify("케어 기록이 저장되었습니다.");
            void refresh();
          }}
        />
      )}

      {/* Care icon legend */}
      <div className="text-center">
        <p className="text-xs text-[var(--muted)]">
          <UserCheck size={10} className="inline mr-1" />
          회원 이름을 누르면 케어 기록을 바로 작성할 수 있습니다
        </p>
      </div>
    </div>
  );
}
