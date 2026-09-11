import { useState } from "react";
import { X, Save, ChevronDown, ChevronUp, Calendar } from "lucide-react";
import { saveCareLog, fetchCareHistory, type FocusCareMember, type CareHistoryItem } from "../lib/supabase/dashboard";
import { generateMutationId } from "../sync/durableWrite";
import type { Center } from "../types";

interface CareLogModalProps {
  member: FocusCareMember;
  center: Center;
  onClose: () => void;
  onSaved: () => void;
}

const CARE_STATUS_OPTIONS = [
  "양호", "개선 중", "주의 필요", "부상", "결석 중", "기타"
];

export function CareLogModal({ member, center, onClose, onSaved }: CareLogModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [careDate,     setCareDate]     = useState(today);
  const [careStatus,   setCareStatus]   = useState("");
  const [careGoal,     setCareGoal]     = useState("");
  const [careContent,  setCareContent]  = useState("");
  const [weakPoint,    setWeakPoint]    = useState("");
  const [nextAction,   setNextAction]   = useState("");
  const [nextCareDate, setNextCareDate] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [history,      setHistory]      = useState<CareHistoryItem[] | null>(null);
  const [historyOpen,  setHistoryOpen]  = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const handleSave = async () => {
    if (!careContent.trim()) {
      setSaveError("케어 내용을 입력하세요.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await saveCareLog({
      clientMutationId: generateMutationId(),
      memberId:         member.member_id,
      center,
      careDate,
      careStatus,
      careGoal,
      careContent,
      weakPoint,
      nextAction,
      nextCareDate: nextCareDate || null,
      staffId:      null,
      photoPath:    null,
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error ?? "저장 실패");
      return;
    }
    onSaved();
    onClose();
  };

  const toggleHistory = async () => {
    if (!historyOpen && !history) {
      setHistoryLoading(true);
      try {
        const h = await fetchCareHistory(member.member_id);
        setHistory(h);
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    }
    setHistoryOpen((v) => !v);
  };

  const typeLabel = member.member_type === "junior" ? "주니어" : "성인";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-[var(--surface)] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-bold text-base">{member.member_name}</h3>
            <p className="text-xs text-[var(--muted)]">{typeLabel} · 집중케어</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--border)]">
            <X size={18} />
          </button>
        </div>

        {/* Previous care summary */}
        {(member.last_care_date || member.next_care_date) && (
          <div className="px-5 py-3 bg-blue-500/5 border-b border-[var(--border)] text-xs text-[var(--muted)] flex gap-4">
            {member.last_care_date && (
              <span>최근 케어: <strong className="text-[var(--text)]">{member.last_care_date}</strong></span>
            )}
            {member.next_care_date && (
              <span>다음 예정: <strong className={member.today_due ? "text-red-500" : "text-[var(--text)]"}>{member.next_care_date}</strong></span>
            )}
            <span>총 {member.care_log_count}회</span>
          </div>
        )}

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--muted)]">케어 날짜</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={careDate}
                onChange={(e) => setCareDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--muted)]">회원 상태</label>
              <select
                className="input w-full text-sm"
                value={careStatus}
                onChange={(e) => setCareStatus(e.target.value)}
              >
                <option value="">선택</option>
                {CARE_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">현재 케어 목표</label>
            <input
              type="text"
              className="input w-full text-sm"
              placeholder="이번 케어의 목표를 입력하세요"
              value={careGoal}
              onChange={(e) => setCareGoal(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">케어 내용 *</label>
            <textarea
              className="input w-full text-sm resize-none"
              rows={3}
              placeholder="오늘 케어 내용을 자세히 입력하세요"
              value={careContent}
              onChange={(e) => setCareContent(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">부족한 부분</label>
            <textarea
              className="input w-full text-sm resize-none"
              rows={2}
              placeholder="개선이 필요한 부분"
              value={weakPoint}
              onChange={(e) => setWeakPoint(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">다음 케어 계획</label>
            <textarea
              className="input w-full text-sm resize-none"
              rows={2}
              placeholder="다음 케어에서 할 내용"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--muted)]">
              <Calendar size={12} className="inline mr-1" />
              다음 확인일
            </label>
            <input
              type="date"
              className="input w-full text-sm"
              value={nextCareDate}
              min={today}
              onChange={(e) => setNextCareDate(e.target.value)}
            />
          </div>

          {saveError && (
            <p className="text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2">{saveError}</p>
          )}

          {/* History toggle */}
          <button
            type="button"
            className="w-full flex items-center justify-between text-xs text-[var(--muted)] py-2 border-t border-[var(--border)] mt-2"
            onClick={toggleHistory}
          >
            <span>이전 케어 기록</span>
            {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {historyOpen && (
            <div className="space-y-2">
              {historyLoading && <p className="text-xs text-[var(--muted)]">불러오는 중...</p>}
              {!historyLoading && history && history.length === 0 && (
                <p className="text-xs text-[var(--muted)]">케어 기록이 없습니다.</p>
              )}
              {!historyLoading && history && history.map((h) => (
                <div key={h.id} className="rounded-2xl border border-[var(--border)] px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{h.care_date}</span>
                    {h.care_status && (
                      <span className="rounded-full px-2 py-0.5 bg-[var(--border)] text-[10px]">{h.care_status}</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] line-clamp-2">{h.care_content}</p>
                  {h.next_care_date && (
                    <p className="text-[10px] text-blue-500">다음: {h.next_care_date}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] flex gap-3">
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={onClose}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={14} />
            {saving ? "저장 중..." : "케어 기록 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
