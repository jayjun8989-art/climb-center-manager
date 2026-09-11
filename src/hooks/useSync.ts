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
const PULL_INTERVAL_MS = 60_000; // 1분마다 자동 pull
const BACKOFF_MAX_MS = 5 * 60_000; // 최대 5분 백오프

export function useSync(enabled: boolean, syncContext: SyncErrorContext, centerIds?: string[]) {
  const [configured] = useState(isSupabaseConfigured());
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);
  const [lastPullResult, setLastPullResult] = useState<PullRunResult | null>(null);
  const runningRef = useRef(false);
  const autoPullAttemptedRef = useRef(false);
  const backoffMsRef = useRef(5_000); // 재시도 초기 간격 5초
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
      if (result.failed > 0) {
        setPhase("error");
        // 지수 백오프 재시도 (대기열 삭제 없이)
        const delay = backoffMsRef.current;
        backoffMsRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
        window.setTimeout(() => {
          if (enabled && !runningRef.current) syncNow().catch(() => undefined);
        }, delay);
      } else {
        setPhase("idle");
        backoffMsRef.current = 5_000;
      }
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
      // 네트워크 오류: 백오프 재시도
      const delay = backoffMsRef.current;
      backoffMsRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
      window.setTimeout(() => {
        if (enabled && !runningRef.current) syncNow().catch(() => undefined);
      }, delay);
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
    const pushTimer = window.setInterval(() => {
      refreshStatus()
        .then(({ nextOnline, nextStatus }) => {
          if (nextOnline && enabled && (nextStatus.pending_count ?? 0) > 0) {
            syncNow().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, SYNC_INTERVAL_MS);

    const pullTimer = window.setInterval(() => {
      if (enabled && !runningRef.current) {
        pullNow({ centerIds })
          .then((result) => {
            if (result && (result.importedMembers > 0 || result.updatedMembers > 0 || result.importedMemberships > 0)) {
              window.dispatchEvent(new CustomEvent("climb-sync-pull-complete"));
            }
          })
          .catch(() => undefined);
      }
    }, PULL_INTERVAL_MS);

    const onPushNow = () => {
      if (enabled) syncNow().catch(() => undefined);
    };
    window.addEventListener("climb-sync-push-now", onPushNow);

    // 네트워크 복구 감지 → 즉시 큐 플러시 + pull
    const onOnline = () => {
      backoffMsRef.current = 5_000; // 백오프 리셋
      if (!enabled || runningRef.current) return;
      void refreshStatus().then(({ nextStatus }) => {
        if ((nextStatus.pending_count ?? 0) > 0) {
          syncNow().catch(() => undefined);
        }
        // Realtime 복구 후 누락 데이터 재조회
        pullNow({ centerIds }).then((result) => {
          if (result && (result.importedMembers > 0 || result.updatedMembers > 0)) {
            window.dispatchEvent(new CustomEvent("climb-sync-pull-complete"));
          }
        }).catch(() => undefined);
      });
    };
    window.addEventListener("online", onOnline);

    return () => {
      window.clearInterval(pushTimer);
      window.clearInterval(pullTimer);
      window.removeEventListener("climb-sync-push-now", onPushNow);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, refreshStatus, syncNow, pullNow, centerIds]);

  useEffect(() => {
    if (!enabled) {
      autoPullAttemptedRef.current = false;
      return;
    }
    if (!configured || autoPullAttemptedRef.current) return;
    if (centerIds === undefined) {
      // centerIds not yet resolved; wait for next render with resolved value
      return;
    }
    autoPullAttemptedRef.current = true;
    // Always pull on startup (no onlyIfEmpty) so server changes are reflected
    // on every app launch, regardless of local data state.
    pullNow({ centerIds })
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
