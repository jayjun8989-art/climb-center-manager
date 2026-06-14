import { useEffect, useRef } from "react";
import { fetchMemberRoster } from "../lib/roster/fetchRoster";
import { exportRosterReports, hasReportsForToday } from "../lib/reports/exportExcel";
import { hasUnifiedCenterAccess } from "../lib/permissions";
import { pullFromSupabase, checkOnline } from "../sync/engine";
import { resolveCenterIdsForCenters } from "../lib/supabase/centers";
import type { Center, UserCenterRoleRow } from "../types";

export function useAutoDailyReport(options: {
  enabled: boolean;
  roles: UserCenterRoleRow[];
  accessibleCenters: Center[];
  onComplete?: (message: string) => void;
  onSaved?: () => void;
}) {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!options.enabled || attemptedRef.current) return;
    attemptedRef.current = true;

    async function run() {
      try {
        const online = await checkOnline();
        if (!online) return;
        if (await hasReportsForToday()) return;
        const centerIds = await resolveCenterIdsForCenters(options.accessibleCenters);
        await pullFromSupabase({ onlyIfEmpty: false, centerIds });
        const rows = await fetchMemberRoster();
        const result = await exportRosterReports(rows, {
          accessibleCenters: options.accessibleCenters,
          unifiedAccess: hasUnifiedCenterAccess(options.roles),
        });
        options.onSaved?.();
        options.onComplete?.(
          `회원 명부 자동 갱신 완료 (운영 ${result.main.length}개 · archive ${result.archive.length}개)`,
        );
      } catch (error) {
        console.warn("[reports] auto daily save failed:", error);
      }
    }

    void run();
  }, [
    options.enabled,
    options.roles,
    options.accessibleCenters,
    options.onComplete,
    options.onSaved,
  ]);
}
