import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { checkOnline, getSyncStatus, pushSyncQueue } from "../sync/engine";
import type { SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";

const SYNC_INTERVAL_MS = 60_000;

export function useSync(enabled: boolean) {
  const [configured] = useState(isSupabaseConfigured());
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);
  const runningRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const nextOnline = await checkOnline();
    setOnline(nextOnline);
    const nextStatus = await getSyncStatus();
    setStatus(nextStatus);
    return { nextOnline, nextStatus };
  }, []);

  const syncNow = useCallback(async () => {
    if (!configured || runningRef.current) return null;
    if (!enabled) {
      return {
        pushed: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        message: "Supabase ???? ?????.",
      } satisfies SyncRunResult;
    }

    runningRef.current = true;
    setPhase("pushing");
    try {
      const result = await pushSyncQueue();
      setLastResult(result);
      setPhase(result.failed > 0 ? "error" : "idle");
      await refreshStatus();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: SyncRunResult = {
        pushed: 0,
        failed: 1,
        skipped: 0,
        errors: [message],
        message,
      };
      setLastResult(result);
      setPhase("error");
      return result;
    } finally {
      runningRef.current = false;
    }
  }, [configured, enabled, refreshStatus]);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshStatus()
        .then(({ nextOnline, nextStatus }) => {
          if (nextOnline && enabled && (nextStatus.pending_count ?? 0) > 0) {
            syncNow().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refreshStatus, syncNow]);

  return {
    configured,
    online,
    status,
    phase,
    lastResult,
    refreshStatus,
    syncNow,
  };
}
