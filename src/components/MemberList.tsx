import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarCheck2, Pencil, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { MemberGroupFilter, MemberListItem } from "../types";
import {
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
  MEMBER_GROUP_LABELS,
  MEMBER_TYPE_LABELS,
  phoneFormat,
} from "../utils/member";

interface MemberListProps {
  members: MemberListItem[];
  loading: boolean;
  memberGroup: MemberGroupFilter;
  selectedId: number | null;
  onSelect: (member: MemberListItem) => void;
  onEdit: (member: MemberListItem) => void;
  onDelete: (member: MemberListItem) => void;
  onAttendance: (member: MemberListItem) => void;
}

export function MemberList({
  members,
  loading,
  memberGroup,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAttendance,
}: MemberListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{MEMBER_GROUP_LABELS[memberGroup]}</h2>
          <p className="text-sm text-[var(--muted)]">
            회원 / 회원권 / 출석 / 결제 / 정지 기록 분리 구조
          </p>
        </div>
        <span className="badge badge-muted">{members.length}명 표시</span>
      </div>

      <div className="mb-3 grid grid-cols-[1.2fr_1fr_0.8fr_1fr_1.1fr_140px] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span>이름</span>
        <span>회원권</span>
        <span>구분</span>
        <span>연락처</span>
        <span>남은 기간/횟수</span>
        <span className="text-right">관리</span>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            불러오는 중...
          </div>
        ) : members.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            등록된 회원이 없습니다.
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const member = members[virtualRow.index];
              const isSelected = selectedId === member.id;

              return (
                <div
                  key={member.id}
                  className={`absolute left-0 top-0 grid w-full grid-cols-[1.2fr_1fr_0.8fr_1fr_1.1fr_140px] items-center gap-3 border-b border-[var(--border)] px-3 py-4 transition ${
                    isSelected ? "bg-[var(--brand-soft)]" : "bg-[var(--panel-strong)] hover:bg-[var(--brand-soft)]/60"
                  }`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => onSelect(member)}
                >
                  <div>
                    <p className="font-semibold">{member.name}</p>
                    <span className={getStatusBadgeClass(member)}>{getStatusLabel(member)}</span>
                  </div>
                  <p className="text-sm">{formatMembershipLabel(member)}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {MEMBER_TYPE_LABELS[member.member_type] ?? member.member_type}
                  </p>
                  <p className="text-sm text-[var(--muted)]">
                    {member.phone ? phoneFormat(member.phone) : "-"}
                  </p>
                  <p className="text-sm">{getExpiryText(member)}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn btn-secondary !px-3 !py-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAttendance(member);
                      }}
                      title="출석 체크"
                    >
                      <CalendarCheck2 size={16} />
                    </button>
                    <button
                      className="btn btn-secondary !px-3 !py-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(member);
                      }}
                      title="수정"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn btn-danger !px-3 !py-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(member);
                      }}
                      title="삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
