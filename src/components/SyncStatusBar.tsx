/**
 * SyncStatusBar — 동기화 상태를 직원이 이해할 수 있게 표시
 *
 * 3가지 평상 상태:
 *  1. 정상: "Supabase 동기화 정상 · 미처리 0건"
 *  2. 전송 중: "Supabase 저장 중 · 자동 처리 중"
 *  3. 오프라인: "인터넷 연결 대기 · 입력 자료 안전하게 보관 중"
 *  4. 해결 필요(자동 불가): "동기화 해결 필요 N건 · 확인하기"
 */

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudOff,
  LoaderCircle,
  LogOut,
  TriangleAlert,
} from "lucide-react";
import type { SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";

interface SyncStatusBarProps {
  configured: boolean;
  online: boolean;
  authenticated: boolean;
  roleLabel?: string | null;
  canSync: boolean;
  status: SyncStatus | null;
  phase: SyncPhase;
  lastResult: SyncRunResult | null;
  onSync: () => void;
  onRepairQueue?: () => void;
  onPurgeUnsupported?: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

export function SyncStatusBar({
  configured,
  online,
  authenticated,
  roleLabel,
  canSync,
  status,
  phase,
  lastResult,
  onSync,
  onRepairQueue,
  onPurgeUnsupported,
  onLogin,
  onLogout,
}: SyncStatusBarProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  if (!configured) return null;

  const busy = phase === "pushing" || phase === "pulling";
  const pending = status?.pending_count ?? 0;
  const failed = status?.failed_count ?? 0;

  // 자동 해결 불가한 실패 (영구 오류): failed_count 기준
  const needsReview = failed > 0;

  // ── 상태 결정 ──────────────────────────────────────────────────────────────
  type StatusKind = "ok" | "syncing" | "offline" | "review";

  let kind: StatusKind;
  let mainText: string;
  let subText: string | null = null;

  if (!online || !authenticated) {
    kind = "offline";
    if (!authenticated) {
      mainText = "로그인 필요 · 입력 자료 안전하게 보관 중";
    } else {
      mainText = "인터넷 연결 대기 · 입력 자료 안전하게 보관 중";
      if (pending > 0) subText = `미전송 ${pending}건 — 인터넷 복구 시 자동 전송`;
    }
  } else if (busy) {
    kind = "syncing";
    mainText = phase === "pulling" ? "Supabase 불러오는 중..." : "Supabase 저장 중 · 자동 처리 중";
    if (pending > 0) subText = `대기 ${pending}건`;
  } else if (needsReview) {
    kind = "review";
    mainText = `동기화 해결 필요 ${failed}건 · 확인하기`;
  } else if (pending > 0) {
    kind = "syncing";
    mainText = "Supabase 저장 중 · 자동 처리 중";
    subText = `대기 ${pending}건`;
  } else {
    kind = "ok";
    mainText = "Supabase 동기화 정상 · 미처리 0건";
  }

  const kindStyles: Record<StatusKind, string> = {
    ok: "border-emerald-500/20 bg-emerald-500/5",
    syncing: "border-blue-500/20 bg-blue-500/5",
    offline: "border-amber-500/20 bg-amber-500/5",
    review: "border-red-500/20 bg-red-500/5",
  };

  const KindIcon = {
    ok: <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />,
    syncing: <LoaderCircle size={15} className="text-blue-500 animate-spin shrink-0" />,
    offline: <CloudOff size={15} className="text-amber-500 shrink-0" />,
    review: <TriangleAlert size={15} className="text-red-500 shrink-0" />,
  };

  const textColors: Record<StatusKind, string> = {
    ok: "text-emerald-700 dark:text-emerald-400",
    syncing: "text-blue-700 dark:text-blue-400",
    offline: "text-amber-700 dark:text-amber-400",
    review: "text-red-600 dark:text-red-400",
  };

  return (
    <div className={`rounded-[1.2rem] border px-4 py-2.5 ${kindStyles[kind]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 주 상태 메시지 */}
        <div className="flex items-center gap-2 min-w-0">
          {KindIcon[kind]}
          <div className="min-w-0">
            <span className={`text-sm font-medium ${textColors[kind]}`}>{mainText}</span>
            {subText && (
              <span className="ml-2 text-xs text-[var(--muted)]">{subText}</span>
            )}
            {authenticated && roleLabel && (
              <span className="ml-2 text-xs text-[var(--muted)]">· {roleLabel}</span>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 해결 필요 시 상세 토글 */}
          {needsReview && (
            <button
              type="button"
              className="btn btn-secondary text-xs py-1 px-3 border-red-500/30 text-red-600"
              onClick={() => setDetailOpen((v) => !v)}
            >
              {detailOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              상세 보기
            </button>
          )}

          {/* 수동 재시도 (해결 필요 상태에서만) */}
          {needsReview && authenticated && canSync && onRepairQueue && (
            <button
              type="button"
              className="btn btn-secondary text-xs py-1 px-3"
              disabled={busy}
              onClick={() => { onRepairQueue(); setDetailOpen(true); }}
            >
              다시 시도
            </button>
          )}

          {/* 불필요 항목 정리 (숨김 상태) */}
          {needsReview && authenticated && canSync && onPurgeUnsupported && (
            <button
              type="button"
              className="btn btn-secondary text-xs py-1 px-3 text-[var(--muted)]"
              disabled={busy}
              onClick={onPurgeUnsupported}
              title="자동 복구 불가 항목 정리"
            >
              오류 정리
            </button>
          )}

          {/* 수동 동기화 (대기 있을 때만) */}
          {authenticated && canSync && pending > 0 && !needsReview && (
            <button
              type="button"
              className="btn btn-secondary text-xs py-1 px-3"
              disabled={!online || busy}
              onClick={onSync}
            >
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
              지금 전송
            </button>
          )}

          {/* 로그인/로그아웃 */}
          {!authenticated ? (
            <button type="button" className="btn btn-secondary text-xs py-1 px-3" onClick={onLogin}>
              로그인
            </button>
          ) : (
            <button type="button" className="btn btn-secondary text-xs py-1 px-3" onClick={onLogout}>
              <LogOut size={13} />
              로그아웃
            </button>
          )}
        </div>
      </div>

      {/* 해결 필요 상세 패널 */}
      {detailOpen && needsReview && (
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-red-600">
            자동 해결 불가 항목 {failed}건 — 아래 내용을 확인하고 수정 후 [다시 시도]를 누르세요.
          </p>
          {lastResult?.errors && lastResult.errors.length > 0 && (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {lastResult.errors.slice(0, 10).map((err, i) => (
                <li key={i} className="text-xs text-red-600 border-b border-red-500/10 pb-1 last:border-0">
                  · {err}
                </li>
              ))}
              {lastResult.errors.length > 10 && (
                <li className="text-xs text-[var(--muted)]">외 {lastResult.errors.length - 10}건…</li>
              )}
            </ul>
          )}
          {(!lastResult?.errors || lastResult.errors.length === 0) && (
            <p className="text-xs text-[var(--muted)]">
              설정 → 동기화 진단에서 자세한 내용을 확인하세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
