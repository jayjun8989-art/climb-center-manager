import { AlertTriangle } from "lucide-react";
import type { Member } from "../types";
import { getExpiryText, formatMembershipLabel } from "../utils/member";

interface ExpiringPanelProps {
  members: Member[];
}

export function ExpiringPanel({ members }: ExpiringPanelProps) {
  if (members.length === 0) {
    return (
      <section className="glass-panel rounded-[1.5rem] p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-[var(--warning)]" />
          <h2 className="text-lg font-bold">만료 예정 회원</h2>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">7일 이내 만료 예정 회원이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="glass-panel rounded-[1.5rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-[var(--warning)]" />
          <h2 className="text-lg font-bold">만료 예정 회원</h2>
        </div>
        <span className="badge badge-warning">{members.length}명</span>
      </div>

      <div className="mt-4 space-y-2">
        {members.slice(0, 8).map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3"
          >
            <div>
              <p className="font-semibold">{member.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {formatMembershipLabel(member)}
                {member.phone ? ` · ${member.phone}` : ""}
              </p>
            </div>
            <span className="badge badge-warning">{getExpiryText(member)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
