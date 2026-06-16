import { useCallback, useEffect, useRef, useState } from "react";
import { formatAppError } from "../utils/errors";
import { isSupabaseConfigured } from "../lib/supabase/config";
import {
  checkOnline,
  getSyncStatus,
  pullFromSupabase,
  purgeUnsupportedSyncQueue,
  pushSyncQueue,
  repairSyncQueue,
  type SyncErrorContext,
} from "../sync/engine";
import type { PullRunResult, SyncPhase, SyncRunResult, SyncStatus } from "../sync/types";

const SYNC_INTERVAL_MS = 60_000;

export function useSync(enabled: boolean, syncContext: SyncErrorContext, centerIds?: string[]) {
  const [configured] = useState(isSupabaseConfigured());
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);
  const [lastPullResult, setLastPullResult] = useState<PullRunResult | null>(null);
  const runningRef = useRef(false);
  const autoPullAttemptedRef = useRef(false);
  const syncContextRef = useRef(syncContext);
  syncContextRef.current = syncContext;

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
        message: "로그인이 필요합니다.",
      } satisfies SyncRunResult;
    }

    runningRef.current = true;
    setPhase("pushing");
    try {
      const result = await pushSyncQueue(syncContextRef.current);
      setLastResult(result);
      setPhase(result.failed > 0 ? "error" : "idle");
      await refreshStatus();
      return result;
    } catch (error) {
      const message = formatAppError(error);
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

  const pullNow = useCallback(
    async (options?: { onlyIfEmpty?: boolean; forceRefresh?: boolean; centerIds?: string[] }) => {
      if (!configured || runningRef.current) return null;
      if (!enabled) {
        return {
          importedMembers: 0,
          importedMemberships: 0,
          importedAttendance: 0,
          importedLockers: 0,
          updatedMembers: 0,
          skipped: 0,
          errors: [],
          warnings: [],
          message: "로그인이 필요합니다.",
        } satisfies PullRunResult;
      }

      runningRef.current = true;
      setPhase("pulling");
      try {
        const result = await pullFromSupabase({
          onlyIfEmpty: options?.onlyIfEmpty,
          forceRefresh: options?.forceRefresh,
          centerIds: options?.centerIds ?? centerIds,
        });
        setLastPullResult(result);
        setPhase(result.errors.length > 0 ? "error" : "idle");
        await refreshStatus();
        return result;
      } catch (error) {
        const message = formatAppError(error);
        const result: PullRunResult = {
          importedMembers: 0,
          importedMemberships: 0,
          importedAttendance: 0,
          importedLockers: 0,
          updatedMembers: 0,
          skipped: 0,
          errors: [message],
          warnings: [],
          message,
        };
        setLastPullResult(result);
        setPhase("error");
        return result;
      } finally {
        runningRef.current = false;
      }
    },
    [configured, enabled, refreshStatus, centerIds],
  );

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

  useEffect(() => {
    if (!enabled) {
      autoPullAttemptedRef.current = false;
      return;
    }
    if (!configured || autoPullAttemptedRef.current) return;
    // Only mark attempted AFTER pull runs — not before. This allows retry if
    // centerIds were not yet resolved on the first render cycle.
    if (centerIds === undefined) {
      // centerIds not yet resolved; wait for next render with resolved value
      return;
    }
    autoPullAttemptedRef.current = true;
    pullNow({ onlyIfEmpty: true, centerIds })
      .then((result) => {
        if (
          result &&
          (result.importedMembers > 0 ||
            result.updatedMembers > 0 ||
            result.importedMemberships > 0)
        ) {
          window.dispatchEvent(new CustomEvent("climb-sync-pull-complete"));
        }
      })
      .catch(() => undefined);
  }, [configured, enabled, pullNow, centerIds]);

  const repairQueue = useCallback(async () => {
    const result = await repairSyncQueue();
    await refreshStatus();
    return result;
  }, [refreshStatus]);

  const purgeUnsupported = useCallback(async () => {
    const result = await purgeUnsupportedSyncQueue();
    await refreshStatus();
    return result;
  }, [refreshStatus]);

  return {
    configured,
    online,
    status,
    phase,
    lastResult,
    lastPullResult,
    refreshStatus,
    syncNow,
    pullNow,
    repairQueue,
    purgeUnsupported,
  };
}
