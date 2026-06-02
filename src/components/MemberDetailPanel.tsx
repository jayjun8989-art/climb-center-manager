import { CalendarCheck2, PauseCircle, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { MemberDetail, MemberListItem, PauseLog, Payment } from "../types";
import {
  formatDateTime,
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
  MEMBER_TYPE_LABELS,
  paymentMethodLabel,
  phoneFormat,
} from "../utils/member";

interface MemberDetailPanelProps {
  member: MemberListItem | null;
  onAttendance: (member: MemberListItem) => Promise<MemberListItem>;
  onUpdated: (member: MemberListItem) => void;
}

export function MemberDetailPanel({ member, onAttendance, onUpdated }: MemberDetailPanelProps) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!member) {
      setDetail(null);
      return;
    }

    setLoading(true);
    api
      .getMemberDetail(member.id)
      .then(setDetail)
      .catch((error) => {
        setDetail(null);
        setMessage(String(error));
      })
      .finally(() => setLoading(false));
  }, [member]);

  if (!member) {
    return (
      <section className="glass-panel rounded-[1.5rem] p-5">
        <h2 className="text-lg font-bold">회원 상세</h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          목록에서 회원을 선택하면 상세 정보가 표시됩니다.
        </p>
      </section>
    );
  }

  const currentMember = member;

  async function handleAttendance() {
    setProcessing(true);
    setMessage("");
    try {
      const updated = await onAttendance(currentMember);
      onUpdated(updated);
      const nextDetail = await api.getMemberDetail(currentMember.id);
      setDetail(nextDetail);
      setMessage(`${updated.name}님 출석이 완료되었습니다.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setProcessing(false);
    }
  }

  async function handlePause() {
    if (!currentMember.membership_id) return;
    const reason = window.prompt("정지 사유를 입력해주세요.", "") ?? undefined;
    try {
      const updated = await api.pauseMembership(currentMember.membership_id, reason);
      onUpdated(updated);
      setDetail(await api.getMemberDetail(currentMember.id));
      setMessage("회원권이 정지되었습니다.");
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function handleResume() {
    if (!currentMember.membership_id) return;
    try {
      const updated = await api.resumeMembership(currentMember.membership_id);
      onUpdated(updated);
      setDetail(await api.getMemberDetail(currentMember.id));
      setMessage("회원권 정지가 해제되었습니다.");
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <section className="glass-panel rounded-[1.5rem] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">선택된 회원</p>
          <h2 className="mt-1 text-2xl font-bold">{currentMember.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={getStatusBadgeClass(currentMember)}>{getStatusLabel(currentMember)}</span>
            <span className="badge badge-muted">{formatMembershipLabel(currentMember)}</span>
            <span className="badge badge-muted">
              {MEMBER_TYPE_LABELS[currentMember.member_type] ?? currentMember.member_type}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary" disabled={processing} onClick={handleAttendance}>
            <CalendarCheck2 size={18} />
            {processing ? "처리 중..." : "출석 체크"}
          </button>
          {currentMember.membership_id && currentMember.status === "paused" ? (
            <button className="btn btn-secondary" onClick={handleResume}>
              <PlayCircle size={18} />
              정지 해제
            </button>
          ) : currentMember.membership_id ? (
            <button className="btn btn-secondary" onClick={handlePause}>
              <PauseCircle size={18} />
              회원권 정지
            </button>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm">
        <DetailRow
          label="연락처"
          value={currentMember.phone ? phoneFormat(currentMember.phone) : "-"}
        />
        <DetailRow label="센터" value={currentMember.center} />
        <DetailRow label="시작일" value={currentMember.start_date ?? "-"} />
        <DetailRow label="만료/잔여" value={getExpiryText(currentMember)} />
        <DetailRow label="최근 방문" value={currentMember.last_visit_at ? formatDateTime(currentMember.last_visit_at) : "-"} />
        <DetailRow label="메모" value={currentMember.memo || "-"} />
      </dl>

      {message && (
        <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm">
          {message}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-[var(--muted)]">상세 기록 불러오는 중...</p>
      ) : detail ? (
        <div className="mt-6 space-y-6">
          <RecordSection title="출석 기록">
            {detail.attendance.length === 0 ? (
              <EmptyText text="출석 기록이 없습니다." />
            ) : (
              detail.attendance.map((record) => (
                <RecordRow
                  key={record.id}
                  primary={formatDateTime(record.checkin_at)}
                  secondary={`${record.attendance_type}${record.deducted_count ? ` · ${record.deducted_count}회 차감` : ""}`}
                />
              ))
            )}
          </RecordSection>

          <RecordSection title="결제 기록">
            {detail.payments.length === 0 ? (
              <EmptyText text="결제 기록이 없습니다." />
            ) : (
              detail.payments.map((payment: Payment) => (
                <RecordRow
                  key={payment.id}
                  primary={`${payment.amount.toLocaleString()}원 · ${paymentMethodLabel(payment.payment_method)}`}
                  secondary={`${payment.payment_date}${payment.memo ? ` · ${payment.memo}` : ""}`}
                />
              ))
            )}
          </RecordSection>

          <RecordSection title="정지 기록">
            {detail.pause_logs.length === 0 ? (
              <EmptyText text="정지 기록이 없습니다." />
            ) : (
              detail.pause_logs.map((pause: PauseLog) => (
                <RecordRow
                  key={pause.id}
                  primary={`${pause.pause_start_date} ~ ${pause.pause_end_date ?? "정지중"}`}
                  secondary={
                    pause.remaining_days_at_pause != null
                      ? `남은 ${pause.remaining_days_at_pause}일 · ${pause.reason ?? "사유 없음"}`
                      : pause.reason ?? "사유 없음"
                  }
                />
              ))
            )}
          </RecordSection>
        </div>
      ) : null}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function RecordSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function RecordRow({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm">
      <p>{primary}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{secondary}</p>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="text-sm text-[var(--muted)]">{text}</p>;
}
