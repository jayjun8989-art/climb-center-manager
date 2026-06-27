import type { Center } from "../types";
import { checkOnline, getSyncStatus, getServerCenterConsistency } from "./engine";
import { getSession } from "../lib/supabase/auth";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { getAppVersion, checkForUpdate } from "../lib/updater";

export type HealthVerdict = "ok" | "caution" | "admin_required" | "server_error" | "offline";

export interface HealthCheckItem {
  label: string;
  value: string;
  status: "ok" | "warn" | "error" | "info";
}

export interface HealthCheckResult {
  verdict: HealthVerdict;
  verdictLabel: string;
  verdictMessage: string;
  items: HealthCheckItem[];
  checkedAt: string;
}

export async function runHealthCheck(center: Center | undefined): Promise<HealthCheckResult> {
  const items: HealthCheckItem[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  let verdict: HealthVerdict = "ok";

  // 1. Version
  let appVersion = "?";
  try {
    appVersion = await getAppVersion();
  } catch { /* ignore */ }
  items.push({ label: "앱 버전", value: `v${appVersion}`, status: "info" });

  if (typeof __BUILD_DATE__ !== "undefined") {
    items.push({ label: "빌드", value: `${__BUILD_DATE__} / ${__BUILD_COMMIT__}`, status: "info" });
  }

  // 2. Supabase configured
  const configured = isSupabaseConfigured();
  if (!configured) {
    return {
      verdict: "offline",
      verdictLabel: "오프라인 캐시 모드",
      verdictMessage: "Supabase가 설정되지 않았습니다. 로컬 데이터만 사용 중입니다.",
      items,
      checkedAt: now,
    };
  }

  // 3. Server connection
  let online = false;
  try {
    online = await checkOnline();
  } catch { /* ignore */ }

  if (!online) {
    items.push({ label: "서버 연결", value: "실패", status: "error" });
    return {
      verdict: "offline",
      verdictLabel: "오프라인 캐시 모드",
      verdictMessage: "서버 연결이 안 됩니다. 로컬 캐시 데이터만 표시 중입니다. 인터넷 연결을 확인하세요.",
      items,
      checkedAt: now,
    };
  }
  items.push({ label: "서버 연결", value: "정상", status: "ok" });

  // 4. Auth session
  let session = null;
  try {
    session = await getSession();
  } catch { /* ignore */ }

  if (!session) {
    items.push({ label: "로그인", value: "세션 만료", status: "error" });
    return {
      verdict: "server_error",
      verdictLabel: "서버 연결 실패",
      verdictMessage: "로그인 세션이 만료되었습니다. 다시 로그인하세요.",
      items,
      checkedAt: now,
    };
  }
  items.push({ label: "로그인", value: session.user?.email ?? "확인됨", status: "ok" });

  // 5. Sync status
  let syncStatus = null;
  try {
    syncStatus = await getSyncStatus();
  } catch { /* ignore */ }

  if (syncStatus) {
    const lastPull = syncStatus.last_pull_at;
    const lastPush = syncStatus.last_push_at;
    items.push({ label: "마지막 서버→PC", value: lastPull ? lastPull.slice(0, 19).replace("T", " ") : "없음", status: lastPull ? "ok" : "warn" });
    items.push({ label: "마지막 PC→서버", value: lastPush ? lastPush.slice(0, 19).replace("T", " ") : "없음", status: "info" });

    const pending = syncStatus.pending_count ?? 0;
    const failed = syncStatus.failed_count ?? 0;

    if (pending > 0) {
      items.push({ label: "서버 미반영 대기", value: `${pending}건`, status: "warn" });
      if (verdict === "ok") verdict = "caution";
    } else {
      items.push({ label: "서버 미반영 대기", value: "0건", status: "ok" });
    }

    if (failed > 0) {
      items.push({ label: "동기화 실패", value: `${failed}건`, status: "error" });
      verdict = "admin_required";
    } else {
      items.push({ label: "동기화 실패", value: "0건", status: "ok" });
    }
  }

  // 6. Center consistency (if center selected)
  if (center) {
    items.push({ label: "선택 센터", value: center, status: "info" });

    try {
      const c = await getServerCenterConsistency(center);

      items.push({ label: "서버 회원", value: `${c.server_members}명`, status: "info" });
      items.push({ label: "화면 표시 회원", value: `${c.local_display_members}명`, status: "info" });

      const noRemote = c.local_members_no_remote_id ?? 0;
      if (noRemote > 0) {
        items.push({ label: "remote_id 없는 표시 회원", value: `${noRemote}명`, status: "error" });
        verdict = "admin_required";
      } else {
        items.push({ label: "remote_id 없는 표시 회원", value: "0명", status: "ok" });
      }

      if (c.server_members > 0 && c.local_display_members !== c.server_members) {
        const diff = c.local_display_members - c.server_members;
        if (Math.abs(diff) > 0) {
          items.push({ label: "회원 수 차이", value: `${diff > 0 ? "+" : ""}${diff}명`, status: diff === 0 ? "ok" : "warn" });
          if (Math.abs(diff) > 2 && verdict === "ok") verdict = "caution";
        }
      }

      const msNoRemote = c.local_memberships_no_remote_id ?? 0;
      if (msNoRemote > 0) {
        items.push({ label: "회원권 미연결", value: `${msNoRemote}건`, status: "warn" });
        if (verdict === "ok") verdict = "caution";
      } else {
        items.push({ label: "회원권 동기화", value: "정상", status: "ok" });
      }

      const attNoRemote = c.local_attendance_no_remote_id ?? 0;
      if (attNoRemote > 0) {
        items.push({ label: "출석 미연결", value: `${attNoRemote}건`, status: "warn" });
        if (verdict === "ok") verdict = "caution";
      } else {
        items.push({ label: "출석 동기화", value: "정상", status: "ok" });
      }
    } catch (e) {
      items.push({ label: "센터 검증", value: `실패: ${e instanceof Error ? e.message : String(e)}`, status: "error" });
      if (verdict === "ok") verdict = "caution";
    }
  }

  // 7. Update check
  try {
    const updateResult = await checkForUpdate();
    if (updateResult.kind === "available") {
      items.push({ label: "업데이트", value: `${updateResult.version} 사용 가능`, status: "warn" });
    } else if (updateResult.kind === "latest") {
      items.push({ label: "업데이트", value: "최신 버전", status: "ok" });
    }
  } catch {
    items.push({ label: "업데이트 확인", value: "실패", status: "info" });
  }

  // Build verdict
  const verdictLabel =
    verdict === "ok" ? "사용 가능" :
    verdict === "caution" ? "주의" :
    verdict === "admin_required" ? "관리자 확인 필요" :
    "알 수 없음";

  const verdictMessage =
    verdict === "ok" ? "서버 연결, 데이터 동기화, 권한 모두 정상입니다. 운영을 시작하세요." :
    verdict === "caution" ? "운영은 가능하지만 일부 항목을 확인해주세요. 잠시 후 다시 점검하거나 관리자에게 문의하세요." :
    verdict === "admin_required" ? "데이터 불일치 또는 동기화 문제가 있습니다. 관리자에게 연락하세요." :
    "상태를 확인할 수 없습니다.";

  return { verdict, verdictLabel, verdictMessage, items, checkedAt: now };
}
