import { useState } from "react";
import { api } from "../api/client";
import { GrabonLogo } from "./GrabonLogo";
import type { Center, SelfCheckinMember } from "../types";

interface SelfCheckinPanelProps {
  onClose: () => void;
  onCheckinSuccess?: () => void;
}

type Stage = "input" | "confirm" | "done";

export function SelfCheckinPanel({ onClose, onCheckinSuccess }: SelfCheckinPanelProps) {
  const [center, setCenter] = useState<Center>("ONCLE");
  const [memberNumber, setMemberNumber] = useState("");
  const [member, setMember] = useState<SelfCheckinMember | null>(null);
  const [stage, setStage] = useState<Stage>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const trimmed = memberNumber.trim();
    const numeric = Number(trimmed);
    if (!trimmed || !Number.isFinite(numeric) || !Number.isInteger(numeric)) {
      setError("회원번호를 정확히 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const found = await api.lookupMemberByNumber(center, numeric);
      if (!found) {
        setError("회원 정보를 찾을 수 없습니다. 회원번호와 센터를 확인해주세요.");
        setMember(null);
        return;
      }
      setMember(found);
      setStage("confirm");
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckin() {
    if (!member) return;
    setError("");
    setLoading(true);
    try {
      const result = await api.recordAttendance(
        { id: member.id, membership_id: member.membership_id },
        { editor: "self-checkin" },
      );
      const updated = result.data;
      const remainingBefore = member.remaining_count ?? 0;
      const remainingAfter = updated.remaining_count ?? remainingBefore;
      const didDecrement = updated.pass_type === "count" && remainingAfter < remainingBefore;
      const countNote = didDecrement
        ? ` · 잔여 ${remainingBefore}회 → ${remainingAfter}회`
        : "";
      setSuccessMessage(`${member.name}님, 출석 처리되었습니다.${countNote}`);
      setStage("done");
      onCheckinSuccess?.();
    } catch (checkinError) {
      const message = checkinError instanceof Error ? checkinError.message : String(checkinError);
      setError(message.includes("이미 해당 날짜") ? "이미 오늘 출석 체크가 완료되었습니다." : message);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setMemberNumber("");
    setMember(null);
    setError("");
    setSuccessMessage("");
    setStage("input");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 to-slate-100 p-6 dark:from-slate-950 dark:to-slate-900">
      <div className="glass-panel w-full max-w-md rounded-[1.75rem] p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <GrabonLogo className="mb-4 h-14 w-auto max-w-[280px] object-contain" />
          <h1 className="mt-2 text-2xl font-bold">셀프 출석체크</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            센터와 회원번호를 입력하고 본인 확인 후 출석해주세요.
          </p>
        </div>

        {stage === "input" && (
          <form className="space-y-4" onSubmit={handleLookup}>
            <div>
              <label className="field-label">센터</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(["ONCLE", "GRABIT"] as Center[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`btn ${center === c ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setCenter(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="field-label">회원번호</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="회원번호 입력"
                value={memberNumber}
                onChange={(event) => setMemberNumber(event.target.value)}
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary w-full" disabled={loading}>
              {loading ? "확인 중..." : "조회"}
            </button>
            <button type="button" className="btn btn-secondary w-full" onClick={onClose}>
              뒤로
            </button>
          </form>
        )}

        {stage === "confirm" && member && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-center">
              <p className="text-lg font-bold">{member.name}님</p>
              {member.phone_last4 && (
                <p className="mt-1 text-sm text-[var(--muted)]">전화번호 끝 4자리: {member.phone_last4}</p>
              )}
              <p className="mt-1 text-sm text-[var(--muted)]">
                {member.membership_type ?? "이용권 없음"}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">{member.remaining_text}</p>
            </div>
            {error && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                {error}
              </p>
            )}
            <button type="button" className="btn btn-primary w-full" onClick={handleCheckin} disabled={loading}>
              {loading ? "처리 중..." : "본인 확인, 출석하기"}
            </button>
            <button type="button" className="btn btn-secondary w-full" onClick={handleReset} disabled={loading}>
              다시 입력
            </button>
          </div>
        )}

        {stage === "done" && (
          <div className="space-y-4 text-center">
            <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-600">
              {successMessage}
            </p>
            <button type="button" className="btn btn-primary w-full" onClick={handleReset}>
              다른 회원 출석체크
            </button>
            <button type="button" className="btn btn-secondary w-full" onClick={onClose}>
              종료
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
