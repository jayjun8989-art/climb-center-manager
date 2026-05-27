import { CalendarCheck2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AttendanceRecord, Member } from "../types";
import {
  formatDateTime,
  formatMembershipLabel,
  getExpiryText,
  getMemberStatus,
  getStatusBadgeClass,
  getStatusLabel,
  phoneFormat,
} from "../utils/member";

interface MemberDetailPanelProps {
  member: Member | null;
  onAttendance: (member: Member) => Promise<Member>;
}

export function MemberDetailPanel({ member, onAttendance }: MemberDetailPanelProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!member) {
      setRecords([]);
      return;
    }

    setLoading(true);
    api
      .fetchAttendance(member.id)
      .then(setRecords)
      .catch((error) => {
        setRecords([]);
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
  const status = getMemberStatus(currentMember);

  async function handleAttendance() {
    setProcessing(true);
    setMessage("");
    try {
      const updated = await onAttendance(currentMember);
      setMessage(`${updated.name}님 출석이 완료되었습니다.`);
      const nextRecords = await api.fetchAttendance(currentMember.id);
      setRecords(nextRecords);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="glass-panel rounded-[1.5rem] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">선택된 회원</p>
          <h2 className="mt-1 text-2xl font-bold">{currentMember.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={getStatusBadgeClass(status)}>{getStatusLabel(status)}</span>
            <span className="badge badge-muted">{formatMembershipLabel(currentMember)}</span>
          </div>
        </div>
        <button className="btn btn-primary" disabled={processing} onClick={handleAttendance}>
          <CalendarCheck2 size={18} />
          {processing ? "처리 중..." : "출석 체크"}
        </button>
      </div>

      <dl className="mt-5 grid gap-3 text-sm">
        <DetailRow
          label="연락처"
          value={currentMember.phone ? phoneFormat(currentMember.phone) : "-"}
        />
        <DetailRow label="시작일" value={currentMember.start_date} />
        <DetailRow label="만료/잔여" value={getExpiryText(currentMember)} />
        <DetailRow label="메모" value={currentMember.notes || "-"} />
      </dl>

      {message && (
        <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm">
          {message}
        </p>
      )}

      <div className="mt-6">
        <h3 className="font-semibold">최근 출석 기록</h3>
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="text-sm text-[var(--muted)]">출석 기록 불러오는 중...</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">출석 기록이 없습니다.</p>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm"
              >
                {formatDateTime(record.checked_at)}
              </div>
            ))
          )}
        </div>
      </div>
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
