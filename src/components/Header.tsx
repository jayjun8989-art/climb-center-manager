import {
  AlertTriangle,
  CalendarCheck2,
  DatabaseBackup,
  Moon,
  Plus,
  Search,
  Sun,
  Users,
} from "lucide-react";
import { GrabonLogo, GrabonMark } from "./GrabonLogo";
import type { ReactNode } from "react";
import type { Center, DashboardStats, BackupInfo, MemberGroupFilter, MemberStatusFilter, PermissionSet } from "../types";
import { MEMBER_GROUP_LABELS, MEMBER_STATUS_LABELS, getMemberGroupCount } from "../utils/member";

interface HeaderProps {
  center: Center;
  onCenterChange: (center: Center) => void;
  memberGroup: MemberGroupFilter;
  onMemberGroupChange: (group: MemberGroupFilter) => void;
  statusFilter: MemberStatusFilter;
  onStatusFilterChange: (filter: MemberStatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onAddMember: () => void;
  stats: DashboardStats | null;
  backupInfo: BackupInfo | null;
  permissions: PermissionSet;
  accessibleCenters: Center[];
  showMemberFilters?: boolean;
  showStats?: boolean;
}

export function Header({
  center,
  onCenterChange,
  memberGroup,
  onMemberGroupChange,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  dark,
  onToggleTheme,
  onAddMember,
  stats,
  backupInfo,
  permissions,
  accessibleCenters,
  showMemberFilters = true,
  showStats = true,
}: HeaderProps) {
  return (
    <header className="glass-panel rounded-[1.5rem] p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <GrabonMark className="h-14 w-14 shrink-0 object-contain" />
          <div>
            <GrabonLogo className="h-8 w-auto max-w-[220px] object-contain" />
            <h1 className="mt-2 text-2xl font-bold">클라이밍 센터 회원관리</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {accessibleCenters.length > 1
                ? "ONCLE / GRABIT 통합 회원·출석·만료 관리"
                : `${accessibleCenters[0] ?? center} 회원·출석·만료 관리`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {accessibleCenters.length > 1 ? (
            accessibleCenters.map((item) => (
              <button
                key={item}
                className={`btn ${center === item ? "btn-primary" : "btn-secondary"}`}
                onClick={() => onCenterChange(item)}
              >
                {item}
              </button>
            ))
          ) : (
            <span className="btn btn-primary cursor-default">{center}</span>
          )}
          <button className="btn btn-secondary" onClick={onToggleTheme}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            {dark ? "라이트" : "다크"}
          </button>
          <button
            className="btn btn-primary"
            disabled={!permissions.canCreateMember}
            title={!permissions.canCreateMember ? "권한이 없습니다" : undefined}
            onClick={onAddMember}
          >
            <Plus size={18} />
            회원 등록
          </button>
        </div>
      </div>

      {showMemberFilters && (
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(MEMBER_GROUP_LABELS) as MemberGroupFilter[]).map((group) => (
          <button
            key={group}
            className={`btn ${memberGroup === group ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onMemberGroupChange(group)}
          >
            {MEMBER_GROUP_LABELS[group]} {getMemberGroupCount(group, stats)}
          </button>
        ))}
      </div>
      )}

      {showMemberFilters && (
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(MEMBER_STATUS_LABELS) as MemberStatusFilter[]).map((filter) => (
          <button
            key={filter}
            className={`btn ${statusFilter === filter ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onStatusFilterChange(filter)}
          >
            {MEMBER_STATUS_LABELS[filter]}
          </button>
        ))}
      </div>
      )}

      {showStats && permissions.canViewStats && (
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Users size={18} />}
          label="전체 회원"
          value={stats?.total_members ?? 0}
          hint={`활성 ${stats?.active_members ?? 0}명`}
        />
        <StatCard
          icon={<CalendarCheck2 size={18} />}
          label="오늘 출석"
          value={stats?.today_attendance ?? 0}
          hint="금일 체크인"
        />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label="7일 내 만료"
          value={stats?.expiring_soon ?? 0}
          hint={`정지 ${stats?.paused_members ?? 0} · 체험 ${stats?.trial_members ?? 0}`}
          accent="warning"
        />
        <StatCard
          icon={<DatabaseBackup size={18} />}
          label="자동 백업"
          value={backupInfo?.last_backup_at ?? "아직 없음"}
          hint={
            backupInfo
              ? `JSON ${backupInfo.json_backup_count} · DB ${backupInfo.db_backup_count} · ${backupInfo.backup_count}/${backupInfo.max_backups}개 유지`
              : "백업 정보 불러오는 중..."
          }
          compact
        />
      </div>
      )}

      {showMemberFilters && (
      <div className="relative mt-5">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          className="input pl-11"
          placeholder="이름, 전화번호, 메모로 검색..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      )}
    </header>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  accent,
  compact,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  hint: string;
  accent?: "warning";
  compact?: boolean;
}) {
  return (
    <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] p-4">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p
        className={`mt-3 font-bold ${compact ? "text-sm leading-6" : "text-3xl"} ${
          accent === "warning" ? "text-[var(--warning)]" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}
