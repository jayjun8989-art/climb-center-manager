import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarCheck2, Pencil, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { MemberGroupFilter, MemberListItem, PermissionSet } from "../types";
import {
  formatInactivePeriodText,
  formatLatestExpiryLabel,
  formatLatestMembershipTypeLabel,
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
  MEMBER_GROUP_LABELS,
  MEMBER_TYPE_LABELS,
  normalizeMemberType,
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
  permissions: PermissionSet;
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
  permissions,
}: MemberListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isInactiveView = memberGroup === "inactive_30";
  const rowHeight = isInactiveView ? 88 : 96;
  const rowVirtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{MEMBER_GROUP_LABELS[memberGroup]}</h2>
          <p className="text-sm text-[var(--muted)]">
            {isInactiveView
              ? "최근 회원권 만료 후 30일 이상 미등록 회원"
              : "회원 / 회원권 / 출석 / 결제 / 정지 기록 분리 구조"}
          </p>
        </div>
        <span className="badge badge-muted">{members.length}명 표시</span>
      </div>

      {isInactiveView ? (
        <div className="mb-3 grid grid-cols-[1fr_1fr_0.7fr_0.8fr_1fr_0.9fr_1fr_120px] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          <span>이름</span>
          <span>연락처</span>
          <span>회원 구분</span>
          <span>마지막 회원권</span>
          <span>마지막 만료일</span>
          <span>미등록 기간</span>
          <span>메모</span>
          <span className="text-right">관리</span>
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-[1.2fr_1fr_0.8fr_1fr_1.1fr_140px] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          <span>이름</span>
          <span>회원권</span>
          <span>구분</span>
          <span>연락처</span>
          <span>남은 기간/횟수</span>
          <span className="text-right">관리</span>
        </div>
      )}

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
              const memberTypeLabel =
                MEMBER_TYPE_LABELS[normalizeMemberType(member.member_type, member.membership_type)] ??
                normalizeMemberType(member.member_type, member.membership_type);

              return (
                <div
                  key={member.id}
                  className={`absolute left-0 top-0 grid w-full items-center gap-3 border-b border-[var(--border)] px-3 py-4 transition ${
                    isInactiveView
                      ? "grid-cols-[1fr_1fr_0.7fr_0.8fr_1fr_0.9fr_1fr_120px]"
                      : "grid-cols-[1.2fr_1fr_0.8fr_1fr_1.1fr_140px]"
                  } ${isSelected ? "bg-[var(--brand-soft)]" : "bg-[var(--panel-strong)] hover:bg-[var(--brand-soft)]/60"}`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => onSelect(member)}
                >
                  {isInactiveView ? (
                    <>
                      <p className="font-semibold">{member.name}</p>
                      <p className="text-sm text-[var(--muted)]">
                        {member.phone ? phoneFormat(member.phone) : "-"}
                      </p>
                      <p className="text-sm text-[var(--muted)]">{memberTypeLabel}</p>
                      <p className="text-sm">
                        {formatLatestMembershipTypeLabel(
                          member.latest_membership_type ?? member.membership_type,
                        )}
                      </p>
                      <p className="text-sm">
                        {formatLatestExpiryLabel(member.latest_membership_end_date ?? member.end_date)}
                      </p>
                      <p className="text-sm font-medium text-[var(--warning)]">
                        {formatInactivePeriodText(member)}
                      </p>
                      <p className="truncate text-sm text-[var(--muted)]" title={member.memo ?? undefined}>
                        {member.memo?.trim() || "-"}
                      </p>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="font-semibold">
                          {member.name}
                          {member.member_no != null && (
                            <span className="ml-2 rounded bg-[var(--panel-strong)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                              #{member.member_no}
                            </span>
                          )}
                        </p>
                        <span className={getStatusBadgeClass(member)}>{getStatusLabel(member)}</span>
                      </div>
                      <p className="text-sm">{formatMembershipLabel(member)}</p>
                      <p className="text-sm text-[var(--muted)]">{memberTypeLabel}</p>
                      <p className="text-sm text-[var(--muted)]">
                        {member.phone ? phoneFormat(member.phone) : "-"}
                      </p>
                      <p className="text-sm">{getExpiryText(member)}</p>
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn btn-secondary !px-3 !py-2"
                      disabled={!permissions.canCheckAttendance}
                      title={!permissions.canCheckAttendance ? permissions.denyReason : "출석 체크"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAttendance(member);
                      }}
                    >
                      <CalendarCheck2 size={16} />
                    </button>
                    <button
                      className="btn btn-secondary !px-3 !py-2"
                      disabled={!permissions.canEditMember && !permissions.canEditMemberMemo}
                      title={
                        !permissions.canEditMember && !permissions.canEditMemberMemo
                          ? permissions.denyReason
                          : "수정"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(member);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn btn-danger !px-3 !py-2"
                      title={!permissions.canDeleteMember ? "이 작업은 관리자 권한이 필요합니다." : "삭제"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(member);
                      }}
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
