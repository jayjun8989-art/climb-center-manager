import { CalendarCheck2, Search } from "lucide-react";
import type { MemberListItem, PermissionSet } from "../types";
import {
  formatMembershipLabel,
  getStatusBadgeClass,
  getStatusLabel,
  phoneFormat,
} from "../utils/member";

interface AttendanceCheckPanelProps {
  members: MemberListItem[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onAttendance: (member: MemberListItem, checkinDate: string) => void;
  permissions: PermissionSet;
  selectedId: number | null;
  onSelect: (member: MemberListItem) => void;
  checkinDate: string;
  onCheckinDateChange: (value: string) => void;
}

export function AttendanceCheckPanel({
  members,
  loading,
  search,
  onSearch,
  onAttendance,
  permissions,
  selectedId,
  onSelect,
  checkinDate,
  onCheckinDateChange,
}: AttendanceCheckPanelProps) {
  const today = new Date().toISOString().slice(0, 10);
  const isPastDate = checkinDate !== today;

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold">출석 체크</h2>
        <p className="text-sm text-[var(--muted)]">이름 또는 전화번호로 회원을 찾아 출석 처리합니다.</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-[var(--muted)] shrink-0">출석 날짜</label>
        <input
          type="date"
          className="input"
          value={checkinDate}
          max={today}
          onChange={(event) => onCheckinDateChange(event.target.value || today)}
        />
        {isPastDate && (
          <span className="text-xs font-semibold text-[var(--brand)]">지난 날짜로 출석 처리됩니다</span>
        )}
      </div>

      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          className="input pl-11"
          placeholder="이름, 전화번호 검색..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)]">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            불러오는 중...
          </div>
        ) : members.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            검색 결과가 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {members.map((member) => {
              const isSelected = selectedId === member.id;
              return (
                <div
                  key={member.id}
                  className={`flex cursor-pointer items-center justify-between gap-4 px-4 py-4 transition ${
                    isSelected
                      ? "bg-[var(--brand-soft)]"
                      : "bg-[var(--panel-strong)] hover:bg-[var(--brand-soft)]/60"
                  }`}
                  onClick={() => onSelect(member)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{member.name}</p>
                      <span className={getStatusBadgeClass(member)}>{getStatusLabel(member)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatMembershipLabel(member)}
                      {member.phone ? ` · ${phoneFormat(member.phone)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    disabled={!permissions.canCheckAttendance}
                    title={
                      !permissions.canCheckAttendance ? permissions.denyReason : "출석 체크"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onAttendance(member, checkinDate);
                    }}
                  >
                    <CalendarCheck2 size={18} />
                    출석 체크
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
