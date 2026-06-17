import { Cloud, CloudOff, LoaderCircle, LogOut, RefreshCw, Wrench } from "lucide-react";
import type { SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";
import { formatDateTimeSeoul } from "../lib/roster/time";

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
  if (!configured) {
    return (
      <div className="rounded-[1.2rem] border border-dashed border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-xs text-[var(--muted)]">
        서버 연결이 설정되지 않았습니다. 관리자에게 문의하면 클라우드 동기화를 사용할 수 있습니다.
      </div>
    );
  }

  const busy = phase === "pushing" || phase === "pulling";
  const pending = status?.pending_count ?? 0;
  const failed = status?.failed_count ?? 0;
  const canPurge = pending > 0 || failed > 0;

  return (
    <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {online ? (
            <Cloud size={16} className="text-emerald-500" />
          ) : (
            <CloudOff size={16} className="text-amber-500" />
          )}
          <span className="font-semibold">
            {online ? "온라인" : "오프라인"}
            {online && authenticated ? " · 동기화 가능" : ""}
          </span>
          {authenticated && roleLabel && (
            <span className="badge badge-muted">{roleLabel}</span>
          )}
          <span className="text-xs text-[var(--muted)]">
            대기 {pending}건
            {failed > 0 ? ` · 실패 ${failed}건` : ""}
            {status?.last_push_at ? ` · 마지막 동기화 ${formatDateTimeSeoul(status.last_push_at)}` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!authenticated ? (
            <button className="btn btn-secondary text-xs" onClick={onLogin}>
              로그인
            </button>
          ) : (
            <button className="btn btn-secondary text-xs" onClick={onLogout}>
              <LogOut size={14} />
              로그아웃
            </button>
          )}
          {authenticated && canSync && pending > 0 && onRepairQueue && (
            <button className="btn btn-secondary text-xs" disabled={busy} onClick={onRepairQueue}>
              <Wrench size={14} />
              대기 목록 복구
            </button>
          )}
          {authenticated && canSync && canPurge && onPurgeUnsupported && (
            <button
              className="btn btn-secondary text-xs"
              disabled={busy}
              onClick={onPurgeUnsupported}
              title="실패했거나 불필요한 동기화 대기 항목 제거"
            >
              불필요 항목 정리
            </button>
          )}
          <button
            className="btn btn-secondary text-xs"
            disabled={!online || !authenticated || !canSync || busy || pending === 0}
            onClick={onSync}
            title={!canSync ? "권한이 없습니다" : undefined}
          >
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            동기화
          </button>
        </div>
      </div>

      {lastResult?.message && (
        <p
          className={`mt-2 text-xs ${
            lastResult.failed > 0 ? "text-red-500" : "text-emerald-600"
          }`}
        >
          {lastResult.message}
        </p>
      )}

      {lastResult && lastResult.errors.length > 0 && (
        <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs text-red-500">
          {lastResult.errors.slice(0, 8).map((error) => (
            <li key={error}>{error}</li>
          ))}
          {lastResult.errors.length > 8 && (
            <li>외 {lastResult.errors.length - 8}건…</li>
          )}
        </ul>
      )}
    </div>
  );
}
