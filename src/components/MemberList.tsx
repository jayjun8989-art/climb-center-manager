import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarCheck2, Pencil, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Member } from "../types";
import {
  formatMembershipLabel,
  getExpiryText,
  getMemberStatus,
  getStatusBadgeClass,
  getStatusLabel,
  MEMBER_GROUP_LABELS,
  phoneFormat,
} from "../utils/member";
import type { MemberGroupFilter } from "../types";

interface MemberListProps {
  members: Member[];
  loading: boolean;
  memberGroup: MemberGroupFilter;
  selectedId: number | null;
  onSelect: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
  onAttendance: (member: Member) => void;
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
    estimateSize: () => 92,
    overscan: 8,
  });

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{MEMBER_GROUP_LABELS[memberGroup]}</h2>
          <p className="text-sm text-[var(--muted)]">
            {memberGroup === "junior"
              ? "주니어 회원만 따로 조회·관리"
              : "가상 스크롤로 대량 회원도 빠르게 조회"}
          </p>
        </div>
        <span className="badge badge-muted">{members.length}명 표시</span>
      </div>

      <div className="mb-3 grid grid-cols-[1.4fr_1fr_1fr_1.2fr_140px] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span>이름</span>
        <span>회원권</span>
        <span>연락처</span>
        <span>만료/잔여</span>
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
              const status = getMemberStatus(member);
              const isSelected = selectedId === member.id;

              return (
                <div
                  key={member.id}
                  className={`absolute left-0 top-0 grid w-full grid-cols-[1.4fr_1fr_1fr_1.2fr_140px] items-center gap-3 border-b border-[var(--border)] px-3 py-4 transition ${
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
                    <span className={getStatusBadgeClass(status)}>{getStatusLabel(status)}</span>
                  </div>
                  <p>{formatMembershipLabel(member)}</p>
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
