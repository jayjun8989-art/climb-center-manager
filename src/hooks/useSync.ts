import { useCallback, useEffect, useRef, useState } from "react";
import type { Center } from "../types";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { checkOnline, getSyncStatus, runSync } from "../sync/engine";
import type { SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";

const SYNC_INTERVAL_MS = 60_000;

export function useSync(center: Center, enabled: boolean) {
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
    if (!configured || !enabled || runningRef.current) return null;
    runningRef.current = true;
    setPhase("pushing");
    try {
      const result = await runSync(center);
      setLastResult(result);
      if (result.failed > 0) {
        setPhase("error");
      } else {
        setPhase("idle");
      }
      await refreshStatus();
      return result;
    } catch {
      setPhase("error");
      return null;
    } finally {
      runningRef.current = false;
    }
  }, [center, configured, enabled, refreshStatus]);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshStatus()
        .then(({ nextOnline }) => {
          if (nextOnline && enabled) {
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
