import { ExternalLink, FolderOpen, RefreshCw, ScrollText, FileSpreadsheet, Archive } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Center, PermissionSet, UserCenterRoleRow } from "../types";
import {
  fetchMemberRoster,
  filterRosterRows,
  summarizeTodayRegistrations,
  type MemberRosterRow,
  type RosterCenterFilter,
  type RosterMemberTypeFilter,
  type RosterMembershipFilter,
  type RosterPeriodFilter,
} from "../lib/roster/fetchRoster";
import { exportRosterReports, ROSTER_MAIN_FILES, sortRosterRows } from "../lib/reports/exportExcel";
import {
  formatDateOnly,
  formatDateTimeSeoul,
  isInSeoulRange,
  isSameSeoulDay,
  seoulMonthEnd,
  seoulMonthStart,
  seoulToday,
} from "../lib/roster/time";
import { hasUnifiedCenterAccess } from "../lib/permissions";
import { isTauriApp } from "../lib/tauri";
import { pullFromSupabase } from "../sync/engine";

interface MemberRosterPanelProps {
  permissions: PermissionSet;
  roles: UserCenterRoleRow[];
  accessibleCenters: Center[];
  onNotify: (message: string) => void;
}

const TABLE_HEADERS = [
  "센터",
  "이름",
  "연락처",
  "주소",
  "회원구분",
  "회원권종류",
  "최초등록일",
  "회원권등록일",
  "등록횟수/총횟수",
  "잔여횟수",
  "시작일",
  "종료일",
  "등록기간",
  "상태",
  "최근방문일",
  "락카번호",
  "메모",
] as const;

export function MemberRosterPanel({
  permissions,
  roles,
  accessibleCenters,
  onNotify,
}: MemberRosterPanelProps) {
  const unifiedAccess = hasUnifiedCenterAccess(roles);
  const [rows, setRows] = useState<MemberRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [centerFilter, setCenterFilter] = useState<RosterCenterFilter>("all");
  const [period, setPeriod] = useState<RosterPeriodFilter>("today");
  const [customStart, setCustomStart] = useState(seoulMonthStart());
  const [customEnd, setCustomEnd] = useState(seoulToday());
  const [memberType, setMemberType] = useState<RosterMemberTypeFilter>("all");
  const [membershipType, setMembershipType] = useState<RosterMembershipFilter>("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const today = seoulToday();
  const monthStart = seoulMonthStart(today);
  const monthEnd = seoulMonthEnd(today);

  const showAllCenterFilter = unifiedAccess || accessibleCenters.length > 1;

  useEffect(() => {
    if (centerFilter !== "all" && !accessibleCenters.includes(centerFilter)) {
      setCenterFilter(showAllCenterFilter ? "all" : accessibleCenters[0] ?? "all");
    }
  }, [accessibleCenters, centerFilter, showAllCenterFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMemberRoster();
      setRows(data);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scopedRows = useMemo(
    () =>
      rows.filter((row) =>
        permissions.enforced ? accessibleCenters.includes(row.center_code) : true,
      ),
    [rows, permissions.enforced, accessibleCenters],
  );

  const visibleRows = useMemo(() => {
    const scoped =
      centerFilter === "all"
        ? scopedRows
        : scopedRows.filter((row) => row.center_code === centerFilter);
    return sortRosterRows(
      filterRosterRows(scoped, {
        center: "all",
        period,
        customStart,
        customEnd,
        memberType,
        membershipType,
        search,
        today,
        monthStart,
        monthEnd,
        isToday: (iso) => isSameSeoulDay(iso, today),
        isInRange: isInSeoulRange,
      }),
    );
  }, [
    scopedRows,
    centerFilter,
    period,
    customStart,
    customEnd,
    memberType,
    membershipType,
    search,
    today,
    monthStart,
    monthEnd,
  ]);

  const todaySummary = useMemo(
    () => summarizeTodayRegistrations(scopedRows, today, (iso) => isSameSeoulDay(iso, today)),
    [scopedRows, today],
  );

  const exportAllowed = permissions.canExportRoster;
  const canOpenOncle = unifiedAccess || accessibleCenters.includes("ONCLE");
  const canOpenGrabit = unifiedAccess || accessibleCenters.includes("GRABIT");
  const canOpenCombined = unifiedAccess || accessibleCenters.length > 1;

  async function handleRefreshExcel() {
    if (!exportAllowed) {
      onNotify("엑셀 갱신 권한이 없습니다. (관리자 export 계정만 가능)");
      return;
    }
    setExporting(true);
    try {
      await pullFromSupabase({ onlyIfEmpty: false });
      const latest = await fetchMemberRoster();
      setRows(latest);
      const scoped = latest.filter((row) =>
        permissions.enforced ? accessibleCenters.includes(row.center_code) : true,
      );
      const result = await exportRosterReports(scoped, {
        accessibleCenters,
        unifiedAccess,
      });
      onNotify(
        `엑셀 갱신 완료 · 운영 ${result.main.length}개 · archive ${result.archive.length}개`,
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  async function handleOpenReport(fileName: string) {
    if (!isTauriApp()) {
      onNotify("데스크톱 앱에서만 파일을 열 수 있습니다.");
      return;
    }
    try {
      await api.openReportFile(fileName);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-[1.5rem] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScrollText size={20} className="text-sky-500" />
            <h2 className="text-lg font-bold">오늘 등록 회원</h2>
            <span className="text-sm text-[var(--muted)]">({today} · KST)</span>
          </div>
          <button className="btn btn-secondary" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="오늘 전체" value={todaySummary.total} />
          <StatCard label="ONCLE" value={todaySummary.oncle} />
          <StatCard label="GRABIT" value={todaySummary.grabit} />
          <StatCard
            label="일반 / 주니어 / 체험"
            value={`${todaySummary.general} / ${todaySummary.junior} / ${todaySummary.trial}`}
          />
          <StatCard
            label="월권 / 횟수권 / 주니어권"
            value={`${todaySummary.monthly} / ${todaySummary.session} / ${todaySummary.juniorMembership}`}
          />
        </div>
      </div>

      <div className="glass-panel rounded-[1.5rem] p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <select
            className="input !w-auto"
            value={centerFilter}
            onChange={(e) => setCenterFilter(e.target.value as RosterCenterFilter)}
          >
            {showAllCenterFilter && <option value="all">센터: 전체</option>}
            {accessibleCenters.includes("ONCLE") && <option value="ONCLE">센터: ONCLE</option>}
            {accessibleCenters.includes("GRABIT") && <option value="GRABIT">센터: GRABIT</option>}
          </select>
          <select
            className="input !w-auto"
            value={period}
            onChange={(e) => setPeriod(e.target.value as RosterPeriodFilter)}
          >
            <option value="today">기간: 오늘</option>
            <option value="month">기간: 이번 달</option>
            <option value="custom">기간: 직접 선택</option>
          </select>
          {period === "custom" && (
            <>
              <input
                className="input !w-auto"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <input
                className="input !w-auto"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </>
          )}
          <select
            className="input !w-auto"
            value={memberType}
            onChange={(e) => setMemberType(e.target.value as RosterMemberTypeFilter)}
          >
            <option value="all">회원구분: 전체</option>
            <option value="regular">일반</option>
            <option value="junior">주니어</option>
            <option value="trial">체험</option>
          </select>
          <select
            className="input !w-auto"
            value={membershipType}
            onChange={(e) => setMembershipType(e.target.value as RosterMembershipFilter)}
          >
            <option value="all">회원권: 전체</option>
            <option value="monthly">월권</option>
            <option value="session">횟수권</option>
            <option value="junior">주니어권</option>
          </select>
          <input
            className="input min-w-[12rem] flex-1"
            placeholder="이름 / 전화 / 주소 / 메모 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {exportAllowed && (
            <>
              <button
                className="btn btn-primary"
                disabled={exporting}
                onClick={() => void handleRefreshExcel()}
              >
                <FileSpreadsheet size={16} />
                {exporting ? "갱신 중..." : "오늘 기준으로 엑셀 갱신"}
              </button>
              {isTauriApp() && (
                <>
                  {canOpenCombined && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => void handleOpenReport(ROSTER_MAIN_FILES.combined)}
                    >
                      <ExternalLink size={16} /> 회원명부_통합.xlsx 열기
                    </button>
                  )}
                  {canOpenOncle && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => void handleOpenReport(ROSTER_MAIN_FILES.oncle)}
                    >
                      <ExternalLink size={16} /> ONCLE_회원명부.xlsx 열기
                    </button>
                  )}
                  {canOpenGrabit && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => void handleOpenReport(ROSTER_MAIN_FILES.grabit)}
                    >
                      <ExternalLink size={16} /> GRABIT_회원명부.xlsx 열기
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={() => void api.openReportsFolder().catch((e) => onNotify(String(e)))}
                  >
                    <FolderOpen size={16} /> 명부 폴더 열기
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      void api.openReportsArchiveFolder().catch((e) => onNotify(String(e)))
                    }
                  >
                    <Archive size={16} /> archive 폴더 열기
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {exportAllowed && (
          <p className="mb-3 text-xs text-[var(--muted)]">
            운영: reports/회원명부_통합.xlsx · 백업: reports/archive/YYYY-MM-DD/
            {unifiedAccess ? " · owner/admin: 양 센터 통합 조회" : " · 권한 센터만 표시"}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-[var(--panel-strong)] text-[var(--muted)]">
              <tr>
                {TABLE_HEADERS.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center text-[var(--muted)]">
                    불러오는 중...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center text-[var(--muted)]">
                    표시할 회원이 없습니다.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={`${row.member_id}-${row.membership_id ?? "none"}`}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2">{row.center_code}</td>
                    <td className="px-3 py-2 font-medium">{row.member_name}</td>
                    <td className="px-3 py-2">{row.phone ?? "-"}</td>
                    <td className="px-3 py-2">{row.address ?? "-"}</td>
                    <td className="px-3 py-2">{row.member_type_label}</td>
                    <td className="px-3 py-2">{row.membership_type_label ?? "-"}</td>
                    <td className="px-3 py-2">{formatDateOnly(row.first_registered_at)}</td>
                    <td className="px-3 py-2">{formatDateTimeSeoul(row.membership_registered_at)}</td>
                    <td className="px-3 py-2">{row.total_sessions ?? "-"}</td>
                    <td className="px-3 py-2">{row.remaining_sessions ?? "-"}</td>
                    <td className="px-3 py-2">{formatDateOnly(row.start_date)}</td>
                    <td className="px-3 py-2">{formatDateOnly(row.end_date)}</td>
                    <td className="px-3 py-2">{row.registration_period_days ?? "-"}</td>
                    <td className="px-3 py-2">{row.membership_status ?? "-"}</td>
                    <td className="px-3 py-2">{formatDateOnly(row.latest_visit_at)}</td>
                    <td className="px-3 py-2">{row.locker_number ?? "-"}</td>
                    <td className="px-3 py-2 max-w-[12rem] truncate">{row.memo ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          총 {visibleRows.length}명 · Supabase member_roster_view · 등록일 최신순
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
