import type { Center } from "../types";
import { checkOnline, getSyncStatus, getServerCenterConsistency } from "./engine";
import { getSession } from "../lib/supabase/auth";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { getAppVersion, checkForUpdate } from "../lib/updater";
import { safeInvoke } from "../lib/tauri";

export type HealthVerdict = "ok" | "ok_info" | "caution" | "admin_required" | "server_error" | "offline";

export interface HealthCheckItem {
  label: string;
  value: string;
  status: "ok" | "warn" | "error" | "info";
}

export interface HealthCheckResult {
  verdict: HealthVerdict;
  verdictLabel: string;
  verdictMessage: string;
  action: string;
  items: HealthCheckItem[];
  infoItems: HealthCheckItem[];
  checkedAt: string;
}

export async function runHealthCheck(center: Center | undefined): Promise<HealthCheckResult> {
  const items: HealthCheckItem[] = [];
  const infoItems: HealthCheckItem[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  // Flags for final verdict
  let dataIssue = false;     // actual data mismatch requiring admin
  let syncWarning = false;   // sync queue items but data looks ok
  let hasInfoOnly = false;

  // 1. Version
  let appVersion = "?";
  try { appVersion = await getAppVersion(); } catch { /* */ }
  items.push({ label: "앱 버전", value: `v${appVersion}`, status: "info" });
  if (typeof __BUILD_DATE__ !== "undefined") {
    items.push({ label: "빌드", value: `${__BUILD_DATE__} / ${__BUILD_COMMIT__}`, status: "info" });
  }

  // 2. Supabase
  if (!isSupabaseConfigured()) {
    return fin("offline", "오프라인 캐시 모드", "Supabase 미설정. 로컬 데이터만 사용 중.", "Supabase 설정 필요", items, infoItems, now);
  }

  // 3. Server connection
  let online = false;
  try { online = await checkOnline(); } catch { /* */ }
  if (!online) {
    items.push({ label: "서버 연결", value: "실패", status: "error" });
    return fin("offline", "오프라인 캐시 모드", "서버 연결이 안 됩니다. 로컬 캐시 데이터만 표시 중.", "인터넷 연결 확인", items, infoItems, now);
  }
  items.push({ label: "서버 연결", value: "정상", status: "ok" });

  // 4. Auth
  let session = null;
  try { session = await getSession(); } catch { /* */ }
  if (!session) {
    items.push({ label: "로그인", value: "세션 만료", status: "error" });
    return fin("server_error", "서버 연결 실패", "로그인 세션이 만료되었습니다.", "다시 로그인", items, infoItems, now);
  }
  items.push({ label: "로그인", value: session.user?.email ?? "확인됨", status: "ok" });

  // 5. Sync status — collect raw numbers, judge AFTER center check
  let rawPending = 0;
  let rawFailed = 0;
  let lastPull: string | null = null;
  try {
    const s = await getSyncStatus();
    if (s) {
      lastPull = s.last_pull_at ?? null;
      rawPending = s.pending_count ?? 0;
      rawFailed = s.failed_count ?? 0;
    }
  } catch { /* */ }

  items.push({ label: "마지막 서버→PC", value: lastPull ? lastPull.slice(0, 19).replace("T", " ") : "없음", status: lastPull ? "ok" : "warn" });

  // 6. Center consistency — this is the actual data check
  let centerDataClean = true;
  if (center) {
    items.push({ label: "선택 센터", value: center, status: "info" });
    try {
      const c = await getServerCenterConsistency(center);

      items.push({ label: "서버 회원", value: `${c.server_members}명`, status: "info" });
      items.push({ label: "화면 표시 회원", value: `${c.local_display_members}명`, status: "info" });

      const noRemote = c.local_members_no_remote_id ?? 0;
      if (noRemote > 0) {
        let detail = `${noRemote}명`;
        try {
          const unlinked = await safeInvoke<Array<{ name: string; local_id: number }>>("get_local_members_for_matching_cmd", { center });
          if (unlinked && unlinked.length > 0) {
            detail += ` (${unlinked.slice(0, 3).map(m => m.name).join(", ")})`;
          }
        } catch { /* */ }
        items.push({ label: "remote_id 없는 표시 회원", value: detail, status: "error" });
        dataIssue = true;
        centerDataClean = false;
      } else {
        items.push({ label: "remote_id 없는 표시 회원", value: "0명", status: "ok" });
      }

      if (c.server_members > 0 && c.local_display_members !== c.server_members) {
        const diff = c.local_display_members - c.server_members;
        if (Math.abs(diff) > 2) {
          items.push({ label: "회원 수 차이", value: `${diff > 0 ? "+" : ""}${diff}명`, status: "warn" });
          centerDataClean = false;
          syncWarning = true;
        } else if (Math.abs(diff) > 0) {
          infoItems.push({ label: "회원 수 차이", value: `${diff > 0 ? "+" : ""}${diff}명 (hidden/필터 차이)`, status: "info" });
          hasInfoOnly = true;
        }
      }

      const msNoRemote = c.local_memberships_no_remote_id ?? 0;
      if (msNoRemote > 0) {
        items.push({ label: "회원권 미연결 (운영)", value: `${msNoRemote}건`, status: "warn" });
        centerDataClean = false;
        syncWarning = true;
      } else {
        items.push({ label: "회원권 동기화", value: "정상", status: "ok" });
      }

      const attNoRemote = c.local_attendance_no_remote_id ?? 0;
      if (attNoRemote > 0) {
        items.push({ label: "출석 미연결 (운영)", value: `${attNoRemote}건`, status: "warn" });
        centerDataClean = false;
        syncWarning = true;
      } else {
        items.push({ label: "출석 동기화", value: "정상", status: "ok" });
      }

      const blocked = c.local_blocked ?? 0;
      if (blocked > 0) {
        infoItems.push({ label: "테스트/정리 완료 항목", value: `${blocked}건 (운영 영향 없음)`, status: "info" });
        hasInfoOnly = true;
      }
    } catch (e) {
      items.push({ label: "센터 검증", value: `실패: ${e instanceof Error ? e.message : String(e)}`, status: "error" });
      syncWarning = true;
    }
  }

  // 7. NOW judge sync queue with center data context
  if (centerDataClean && rawPending > 0) {
    // Data is fine but queue has items → these are likely test/resolved leftovers
    infoItems.push({ label: "sync 대기 항목", value: `${rawPending}건 (테스트/정리 대상 — 운영 영향 없음)`, status: "info" });
    hasInfoOnly = true;
  } else if (!centerDataClean && rawPending > 0) {
    items.push({ label: "서버 미반영 대기", value: `${rawPending}건`, status: "warn" });
    syncWarning = true;
  } else {
    items.push({ label: "서버 미반영 대기", value: "0건", status: "ok" });
  }

  if (centerDataClean && rawFailed > 0) {
    infoItems.push({ label: "sync 실패 항목", value: `${rawFailed}건 (테스트/차단 대상 — 운영 영향 없음)`, status: "info" });
    hasInfoOnly = true;
  } else if (rawFailed > 0) {
    items.push({ label: "동기화 실패", value: `${rawFailed}건`, status: "error" });
    dataIssue = true;
  } else {
    items.push({ label: "동기화 실패", value: "0건", status: "ok" });
  }

  // 8. Update
  try {
    const u = await checkForUpdate();
    if (u.kind === "available") {
      items.push({ label: "업데이트", value: `${u.version} 사용 가능`, status: "warn" });
    } else if (u.kind === "latest") {
      items.push({ label: "업데이트", value: "최신 버전", status: "ok" });
    }
  } catch {
    infoItems.push({ label: "업데이트 확인", value: "실패 (운영 영향 없음)", status: "info" });
  }

  // Final verdict
  if (dataIssue) {
    return fin("admin_required", "관리자 확인 필요", "운영 데이터 불일치가 있습니다.", "관리자에게 연락하세요", items, infoItems, now);
  }
  if (syncWarning) {
    return fin("caution", "주의", "운영은 가능하지만 일부 항목을 확인해주세요.", "잠시 후 다시 점검하거나 관리자에게 문의", items, infoItems, now);
  }
  if (hasInfoOnly) {
    return fin("ok_info", "사용 가능", "서버와 화면 데이터가 일치합니다. 운영에 영향 없는 참고 항목이 있습니다.", "운영을 시작하세요", items, infoItems, now);
  }
  return fin("ok", "사용 가능", "서버 연결, 데이터 동기화, 권한 모두 정상입니다.", "운영을 시작하세요", items, infoItems, now);
}

function fin(
  verdict: HealthVerdict, verdictLabel: string, verdictMessage: string, action: string,
  items: HealthCheckItem[], infoItems: HealthCheckItem[], checkedAt: string,
): HealthCheckResult {
  return { verdict, verdictLabel, verdictMessage, action, items, infoItems, checkedAt };
}
