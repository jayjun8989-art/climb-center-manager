import { useState } from "react";
import { X } from "lucide-react";

interface PauseModalProps {
  memberName: string;
  onConfirm: (pauseDays: number, reason: string, startDate: string, endDate: string) => void;
  onClose: () => void;
}

type PauseMode = "by_date" | "by_days";

export function PauseModal({ memberName, onConfirm, onClose }: PauseModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [mode,      setMode]      = useState<PauseMode>("by_date");
  const [startDate, setStartDate] = useState(today);
  const [endDate,   setEndDate]   = useState("");
  const [days,      setDays]      = useState<number | "">(14);
  const [reason,    setReason]    = useState("");

  function calcDays(): number {
    if (mode === "by_days") return typeof days === "number" ? days : 0;
    if (!startDate || !endDate) return 0;
    const diff = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000;
    return Math.max(0, Math.round(diff));
  }

  function calcEndDate(): string {
    if (mode === "by_date") return endDate;
    if (typeof days !== "number" || !startDate) return "";
    const d = new Date(startDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function handleConfirm() {
    const n = calcDays();
    if (n <= 0) return;
    onConfirm(n, reason, startDate, calcEndDate());
  }

  const pauseDays = calcDays();
  const valid = pauseDays > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-[var(--surface)] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-bold text-base">회원권 일시정지</h3>
            <p className="text-xs text-[var(--muted)]">{memberName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--border)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Mode tabs */}
          <div className="flex rounded-2xl bg-[var(--border)] p-1 gap-1">
            <button
              type="button"
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${mode === "by_date" ? "bg-[var(--surface)] shadow-sm" : "text-[var(--muted)]"}`}
              onClick={() => setMode("by_date")}
            >
              날짜 지정
            </button>
            <button
              type="button"
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${mode === "by_days" ? "bg-[var(--surface)] shadow-sm" : "text-[var(--muted)]"}`}
              onClick={() => setMode("by_days")}
            >
              일수 지정
            </button>
          </div>

          {mode === "by_date" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--muted)]">정지 시작일</label>
                <input
                  type="date"
                  className="input w-full text-sm"
                  value={startDate}
                  min={today}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--muted)]">정지 종료일</label>
                <input
                  type="date"
                  className="input w-full text-sm"
                  value={endDate}
                  min={startDate || today}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--muted)]">정지 시작일</label>
                <input
                  type="date"
                  className="input w-full text-sm"
                  value={startDate}
                  min={today}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--muted)]">정지 일수</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input flex-1 text-sm"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(e) => setDays(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="예: 14"
                  />
                  <span className="text-sm text-[var(--muted)]">일</span>
                </div>
                {calcEndDate() && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    종료일: <strong className="text-[var(--text)]">{calcEndDate()}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          {valid && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              {pauseDays}일 정지 · 재개 시 만료일이 {pauseDays}일 연장됩니다
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">정지 사유 (선택)</label>
            <input
              type="text"
              className="input w-full text-sm"
              placeholder="예: 부상, 여행, 개인 사정"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={!valid}
            onClick={handleConfirm}
          >
            일시정지 적용
          </button>
        </div>
      </div>
    </div>
  );
}
