import { CalendarCheck2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { startOfMonth } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AttendanceLog, MemberDetail, MemberListItem, PauseLog, Payment, PermissionSet } from "../types";
import {
  formatDateTime,
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
  MEMBER_TYPE_LABELS,
  paymentMethodLabel,
  phoneFormat,
  resolveMemberLocalId,
} from "../utils/member";
import {
  AttendanceCalendar,
  formatAttendanceLogLine,
  getAttendanceLogsForDate,
} from "./AttendanceCalendar";

interface MemberDetailPanelProps {
  member: MemberListItem | null;
  onAttendance: (member: MemberListItem) => Promise<MemberListItem | null>;
  onUpdated: (member: MemberListItem) => void;
  permissions: PermissionSet;
}

export function MemberDetailPanel({ member, onAttendance, onUpdated, permissions }: MemberDetailPanelProps) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!member) {
      setDetail(null);
      setSelectedDate(null);
      return;
    }

    setLoading(true);
    const memberId = resolveMemberLocalId(member);
    api
      .getMemberDetail(memberId)
      .then(setDetail)
      .catch((error) => {
        setDetail(null);
        setMessage(String(error));
      })
      .finally(() => setLoading(false));
  }, [member]);

  const dayLogs = useMemo(() => {
    if (!detail || !selectedDate) return [];
    return getAttendanceLogsForDate(detail.attendance, selectedDate);
  }, [detail, selectedDate]);

  const sortedAttendance = useMemo(() => {
    if (!detail) return [];
    return [...detail.attendance].sort((a, b) => b.checkin_at.localeCompare(a.checkin_at));
  }, [detail]);

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
  const locker = detail?.member;

  async function refreshDetail() {
    const nextDetail = await api.getMemberDetail(currentMember.id);
    setDetail(nextDetail);
  }

  async function handleAttendance() {
    setProcessing(true);
    setMessage("");
    try {
      const updated = await onAttendance(currentMember);
      if (!updated) return;
      onUpdated(updated);
      await refreshDetail();
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
      await refreshDetail();
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
      await refreshDetail();
      setMessage("회원권 정지가 해제되었습니다.");
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function handleCancelAttendance(log: AttendanceLog) {
    const reason = window.prompt("출석 취소 사유를 입력해주세요.", "") ?? "";
    if (reason === null) return;
    try {
      const result = await api.cancelAttendance(log.id, reason || undefined);
      onUpdated(result.data);
      await refreshDetail();
      setMessage("출석이 취소되었습니다.");
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={processing || !permissions.canCheckAttendance}
            title={!permissions.canCheckAttendance ? permissions.denyReason : undefined}
            onClick={() => void handleAttendance()}
          >
            <CalendarCheck2 size={18} />
            {processing ? "처리 중..." : "출석 체크"}
          </button>
          {currentMember.membership_id && currentMember.status === "paused" ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!permissions.canResumeMembership}
              title={!permissions.canResumeMembership ? permissions.denyReason : undefined}
              onClick={() => void handleResume()}
            >
              <PlayCircle size={18} />
              정지 해제
            </button>
          ) : currentMember.membership_id ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!permissions.canPauseMembership}
              title={!permissions.canPauseMembership ? permissions.denyReason : undefined}
              onClick={() => void handlePause()}
            >
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
        <DetailRow
          label="최근 방문"
          value={currentMember.last_visit_at ? formatDateTime(currentMember.last_visit_at) : "-"}
        />
        {locker?.locker_number && (
          <>
            <DetailRow label="락카 번호" value={locker.locker_number} />
            <DetailRow
              label="락카 기간"
              value={`${locker.locker_start_date?.slice(0, 10) ?? "-"} ~ ${locker.locker_end_date?.slice(0, 10) ?? "-"}`}
            />
            {locker.locker_memo && <DetailRow label="락카 메모" value={locker.locker_memo} />}
          </>
        )}
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
          <AttendanceCalendar
            attendanceLogs={detail.attendance}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
          />

          {selectedDate && dayLogs.length > 0 && (
            <div>
              <h3 className="font-semibold">선택한 날짜 출석</h3>
              <div className="mt-3 space-y-2">
                {dayLogs.map((record) => (
                  <AttendanceRow
                    key={record.id}
                    record={record}
                    canCancel={permissions.canCancelAttendance && !record.canceled_at}
                    onCancel={() => void handleCancelAttendance(record)}
                  />
                ))}
              </div>
            </div>
          )}

          <RecordSection title="출석 기록">
            {sortedAttendance.length === 0 ? (
              <EmptyText text="출석 기록이 없습니다." />
            ) : (
              sortedAttendance.map((record) => (
                <AttendanceRow
                  key={record.id}
                  record={record}
                  canCancel={permissions.canCancelAttendance && !record.canceled_at}
                  onCancel={() => void handleCancelAttendance(record)}
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

          <RecordSection title="수정 내역">
            {(detail.edit_logs ?? []).length === 0 ? (
              <EmptyText text="수정 내역이 없습니다." />
            ) : (
              (detail.edit_logs ?? []).map((log) => (
                <RecordRow
                  key={log.id}
                  primary={log.summary}
                  secondary={`${formatDateTime(log.created_at)}${log.editor ? ` · ${log.editor}` : ""}`}
                />
              ))
            )}
          </RecordSection>
        </div>
      ) : null}
    </section>
  );
}

function AttendanceRow({
  record,
  canCancel,
  onCancel,
}: {
  record: AttendanceLog;
  canCancel: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm">
      <div>
        <p>{formatAttendanceLogLine(record)}</p>
        {record.cancel_reason && (
          <p className="mt-1 text-xs text-[var(--muted)]">취소 사유: {record.cancel_reason}</p>
        )}
      </div>
      {canCancel && (
        <button type="button" className="btn btn-secondary shrink-0 !px-3 !py-2 text-xs" onClick={onCancel}>
          <XCircle size={16} />
          취소
        </button>
      )}
    </div>
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
