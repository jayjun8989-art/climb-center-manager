import { PauseCircle, PlayCircle, Search } from "lucide-react";
import { api } from "../api/client";
import type { MemberListItem, PermissionSet } from "../types";
import { formatAppError } from "../utils/errors";
import {
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
} from "../utils/member";

interface MembershipManagementPanelProps {
  members: MemberListItem[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  permissions: PermissionSet;
  selectedId: number | null;
  onSelect: (member: MemberListItem) => void;
  onUpdated: (member: MemberListItem) => void;
  onNotify: (message: string) => void;
}

export function MembershipManagementPanel({
  members,
  loading,
  search,
  onSearch,
  permissions,
  selectedId,
  onSelect,
  onUpdated,
  onNotify,
}: MembershipManagementPanelProps) {
  const withMembership = members.filter((m) => m.membership_id != null);

  async function handlePause(member: MemberListItem) {
    if (!member.membership_id) return;
    const reason = window.prompt("일시정지 사유를 입력하세요.", "") ?? undefined;
    try {
      const updated = await api.pauseMembership(member.membership_id, reason);
      onUpdated(updated);
      onNotify("회원권을 일시정지했습니다.");
    } catch (error) {
      onNotify(formatAppError(error));
    }
  }

  async function handleResume(member: MemberListItem) {
    if (!member.membership_id) return;
    try {
      const updated = await api.resumeMembership(member.membership_id);
      onUpdated(updated);
      onNotify("회원권을 재개했습니다.");
    } catch (error) {
      onNotify(formatAppError(error));
    }
  }

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold">회원권 관리</h2>
        <p className="text-sm text-[var(--muted)]">
          회원권 상태를 확인하고 일시정지·재개할 수 있습니다.
        </p>
      </div>

      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          className="input pl-11"
          placeholder="이름, 연락처 검색..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)]">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            불러오는 중...
          </div>
        ) : withMembership.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            회원권 회원이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {withMembership.map((member) => {
              const isSelected = selectedId === member.id;
              const paused = member.status === "paused" || member.membership_status === "paused";
              return (
                <div
                  key={member.id}
                  className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
                    isSelected
                      ? "bg-[var(--brand-soft)]"
                      : "bg-[var(--panel-strong)] hover:bg-[var(--brand-soft)]/60"
                  }`}
                  onClick={() => onSelect(member)}
                >
                  <div className="min-w-0 flex-1 cursor-pointer">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{member.name}</p>
                      <span className={getStatusBadgeClass(member)}>{getStatusLabel(member)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatMembershipLabel(member)} · {getExpiryText(member)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {paused ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!permissions.canResumeMembership}
                        title={
                          !permissions.canResumeMembership ? permissions.denyReason : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleResume(member);
                        }}
                      >
                        <PlayCircle size={18} />
                        재개
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!permissions.canPauseMembership}
                        title={
                          !permissions.canPauseMembership ? permissions.denyReason : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePause(member);
                        }}
                      >
                        <PauseCircle size={18} />
                        일시정지
                      </button>
                    )}
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
