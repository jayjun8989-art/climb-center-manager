import { Cloud, CloudOff, LoaderCircle, RefreshCw } from "lucide-react";
import type { SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";

interface SyncStatusBarProps {
  configured: boolean;
  online: boolean;
  authenticated: boolean;
  status: SyncStatus | null;
  phase: SyncPhase;
  lastResult: SyncRunResult | null;
  onSync: () => void;
  onLogin: () => void;
}

export function SyncStatusBar({
  configured,
  online,
  authenticated,
  status,
  phase,
  lastResult,
  onSync,
  onLogin,
}: SyncStatusBarProps) {
  if (!configured) {
    return (
      <div className="rounded-[1.2rem] border border-dashed border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-xs text-[var(--muted)]">
        Supabase ??? · `.env`? `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`? ???? ???? ???? ??? ? ????.
      </div>
    );
  }

  const busy = phase === "pulling" || phase === "pushing";
  const pending = status?.pending_count ?? 0;

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
            {online ? "???" : "????"} · ?? ??
          </span>
          <span className="text-xs text-[var(--muted)]">
            ?? {pending}?
            {status?.last_push_at ? ` · ??? ??? ${status.last_push_at}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!authenticated && (
            <button className="btn btn-secondary text-xs" onClick={onLogin}>
              Supabase ???
            </button>
          )}
          <button
            className="btn btn-secondary text-xs"
            disabled={!online || !authenticated || busy}
            onClick={onSync}
          >
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            ???
          </button>
        </div>
      </div>

      {lastResult?.message && (
        <p className="mt-2 text-xs text-amber-600">{lastResult.message}</p>
      )}
      {phase === "error" && lastResult && lastResult.failed > 0 && (
        <p className="mt-2 text-xs text-red-500">
          ??? ?? {lastResult.failed}? · ?? ???? ?????.
        </p>
      )}
    </div>
  );
}
