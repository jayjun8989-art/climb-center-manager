import type { Center, MemberInput } from "../types";
import { invokeCommand, isTauriApp, safeInvoke } from "../lib/tauri";
import { getSession } from "../lib/supabase/auth";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import {
  centerCodeFromId,
  centerIdForCode,
  resolveCenterId,
  resolveCenterIds,
} from "../lib/supabase/centers";
import {
  buildSupabaseMembershipRow,
  supabaseMemberTypeFromPayload,
} from "./membershipMapping";
import { formatSyncError, isPostgrestError } from "./errors";
import { buildPullSnapshot, toInvokePullSnapshot, findSnapshotTypeError } from "./pullMapping";
import type { SyncErrorContext } from "./permissionContext";
import type { PullCenterDiagnostics, PullRunResult, SyncQueueItem, SyncRunResult, SyncStatus } from "./types";

const DEVICE_ID_KEY = "device_id";

// ---------------------------------------------------------------------------
// Pagination helper — fetches all rows from Supabase bypassing the 1000-row
// PostgREST default limit by issuing repeated .range() requests.
// ---------------------------------------------------------------------------
const PULL_PAGE_SIZE = 500;

async function fetchAllPages<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const result: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFn(from, from + PULL_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < PULL_PAGE_SIZE) break;
    from += PULL_PAGE_SIZE;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Test-data detection — blocks upload of clearly invalid/test member entries.
// ---------------------------------------------------------------------------
const TEST_DATA_NAMES = new Set(["ddd", "dddd", "dfdfd", "주니어", "주니어 1"]);
const TEST_DATA_PHONES = new Set(["ddd", "ddff", "ㅎㅎㅎㅎ", "ㅈㅈㅈ"]);

function isTestDataMember(name: string, phone: string | null | undefined): boolean {
  return (
    TEST_DATA_NAMES.has(name.trim()) ||
    TEST_DATA_PHONES.has((phone ?? "").trim())
  );
}

type MemberSyncPayload = MemberInput & {
  center: Center;
  center_id?: string;
  local_id?: number;
  local_membership_id?: number | null;
};

type PayloadParseResult =
  | { ok: true; payload: MemberSyncPayload }
  | { ok: false; missingFields: string[]; message: string };

async function fetchLocalSyncStatus(): Promise<SyncStatus> {
  return (await safeInvoke<SyncStatus>("fetch_sync_status")) ?? {
    pending_count: 0,
    failed_count: 0,
    last_pull_at: null,
    last_push_at: null,
    device_id: null,
  };
}

async function fetchLocalQueue(limit = 100): Promise<SyncQueueItem[]> {
  return (await safeInvoke<SyncQueueItem[]>("fetch_sync_queue", { limit })) ?? [];
}

async function failQueueItem(id: number, error: string) {
  await safeInvoke("fail_sync_queue_item", { id, error });
}

async function updateSyncState(key: string, value: string) {
  await safeInvoke("update_sync_state", { key, value });
}

async function fetchRemoteId(entityType: string, localId: number): Promise<string | null> {
  return (
    (await safeInvoke<string | null>("fetch_remote_id", {
      entity_type: entityType,
      local_id: localId,
    })) ?? null
  );
}

async function completeMemberPush(
  queueId: number,
  localMemberId: number,
  remoteId: string,
  remoteUpdatedAt?: string | null,
) {
  await safeInvoke("complete_member_sync_push", {
    queue_id: queueId,
    local_member_id: localMemberId,
    remote_id: remoteId,
    remote_updated_at: remoteUpdatedAt ?? null,
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCenter(value: unknown): Center | null {
  if (value === "ONCLE" || value === "GRABIT") return value;
  return null;
}

function parseMemberPayload(payloadJson: string): PayloadParseResult {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      missingFields: ["(JSON 파싱 실패)"],
      message: "동기화 데이터 형식이 올바르지 않습니다.",
    };
  }

  const missingFields: string[] = [];
  const center = normalizeCenter(raw.center);
  const centerId = typeof raw.center_id === "string" ? raw.center_id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";

  if (!name) missingFields.push("name");
  if (!center && !centerId) {
    missingFields.push("center");
    missingFields.push("center_id");
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      missingFields,
      message: `동기화 데이터에 필수 정보(${missingFields.join(", ")})가 없습니다.`,
    };
  }

  const resolvedCenter = center ?? (centerId ? centerCodeFromId(centerId) : null);
  if (!resolvedCenter) {
    return {
      ok: false,
      missingFields: ["center"],
      message: "동기화 데이터에 센터 정보가 없습니다.",
    };
  }

  const base = raw as unknown as MemberSyncPayload;
  const localMembershipId =
    typeof raw.local_membership_id === "number" ? raw.local_membership_id : null;
  return {
    ok: true,
    payload: {
      ...base,
      center: resolvedCenter,
      name,
      center_id: centerId || centerIdForCode(resolvedCenter),
      local_membership_id: localMembershipId,
    },
  };
}

function memberNameFromPayloadJson(payloadJson: string): string | null {
  try {
    const raw = JSON.parse(payloadJson) as { name?: unknown };
    return typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  } catch {
    return null;
  }
}

function formatSyncFailure(
  item: SyncQueueItem,
  operation: string,
  detail: { missingFields?: string[]; message: string },
  center?: Center | null,
): string {
  const nameHint = memberNameFromPayloadJson(item.payload_json);
  const fields =
    detail.missingFields && detail.missingFields.length > 0
      ? ` · 누락: ${detail.missingFields.join(", ")}`
      : "";
  const label = nameHint ? `"${nameHint}"` : `회원 #${item.entity_local_id}`;
  const centerHint = center ? ` · 센터: ${center}` : "";
  return `${label} · ${operation}${fields}${centerHint} · ${detail.message}`;
}

function memberRowFromPayload(payload: MemberSyncPayload, centerId: string) {
  return {
    center_id: centerId,
    name: payload.name.trim(),
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    member_type: supabaseMemberTypeFromPayload(payload),
    parent_name: payload.parent_name ?? null,
    parent_phone: payload.parent_phone ?? null,
    memo: payload.notes ?? null,
    member_no: payload.member_no ?? null,
  };
}

async function mapRemoteMembershipId(
  localMembershipId: number,
  remoteMembershipId: string,
): Promise<void> {
  await safeInvoke("map_remote_id", {
    entity_type: "membership",
    local_id: localMembershipId,
    remote_id: remoteMembershipId,
  });
}

async function upsertRemoteMembership(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  payload: MemberSyncPayload,
  remoteMemberId: string,
  centerId: string,
): Promise<void> {
  const membershipRow = buildSupabaseMembershipRow(payload, remoteMemberId, centerId);
  const localMembershipId = payload.local_membership_id ?? null;

  let remoteMembershipId =
    localMembershipId != null ? await fetchRemoteId("membership", localMembershipId) : null;

  if (!remoteMembershipId) {
    const { data: existing, error: lookupError } = await supabase
      .from("memberships")
      .select("id")
      .eq("member_id", remoteMemberId)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw lookupError;
    remoteMembershipId = existing?.id ?? null;
  }

  if (remoteMembershipId) {
    const { data, error } = await supabase
      .from("memberships")
      .update(membershipRow)
      .eq("id", remoteMembershipId)
      .select("id")
      .single();
    if (error) throw error;
    if (localMembershipId != null) {
      await mapRemoteMembershipId(localMembershipId, data.id);
    }
    return;
  }

  const { data, error } = await supabase
    .from("memberships")
    .insert(membershipRow)
    .select("id")
    .single();
  if (error) throw error;
  if (localMembershipId != null) {
    await mapRemoteMembershipId(localMembershipId, data.id);
  }
}

function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits || null;
}

async function findRemoteMemberByPhone(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  centerId: string,
  phone: string | null | undefined,
): Promise<{ id: string; updated_at: string } | null> {
  const phoneNormalized = normalizePhoneDigits(phone);
  if (!phoneNormalized) return null;

  const { data, error } = await supabase
    .from("members")
    .select("id, updated_at")
    .eq("center_id", centerId)
    .eq("phone_normalized", phoneNormalized)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertRemoteMember(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  row: ReturnType<typeof memberRowFromPayload>,
  centerId: string,
  phone: string | null | undefined,
): Promise<{ id: string; updated_at: string }> {
  const { data, error } = await supabase
    .from("members")
    .insert(row)
    .select("id, updated_at")
    .single();

  if (
    error &&
    isPostgrestError(error) &&
    error.code === "23505"
  ) {
    const existing = await findRemoteMemberByPhone(supabase, centerId, phone);
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("members")
        .update(row)
        .eq("id", existing.id)
        .select("id, updated_at")
        .single();
      if (updateError) throw updateError;
      return updated;
    }
  }

  if (error) throw error;
  return data;
}

async function resolveCenterIdForPayload(payload: MemberSyncPayload): Promise<string> {
  if (payload.center_id?.trim()) return payload.center_id.trim();
  return resolveCenterId(payload.center);
}

async function ensureDeviceId(status: SyncStatus): Promise<string> {
  if (status.device_id) return status.device_id;
  const deviceId = crypto.randomUUID();
  await updateSyncState(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export async function repairSyncQueue(): Promise<{
  repaired: number;
  failed: number;
  message: string;
}> {
  if (!isTauriApp()) {
    return { repaired: 0, failed: 0, message: "데스크톱 앱에서만 대기 목록을 복구할 수 있습니다." };
  }
  const result = await safeInvoke<{ repaired: number; failed: number; removed: number }>(
    "repair_sync_queue",
  );
  if (!result) {
    return { repaired: 0, failed: 0, message: "대기 목록 복구에 실패했습니다." };
  }
  return {
    repaired: result.repaired,
    failed: result.failed,
    message: `대기 목록 복구 완료: ${result.repaired}건 갱신${result.failed > 0 ? `, 실패 ${result.failed}건` : ""}`,
  };
}

export async function purgeUnsupportedSyncQueue(): Promise<{
  removed: number;
  message: string;
}> {
  if (!isTauriApp()) {
    return { removed: 0, message: "데스크톱 앱에서만 정리할 수 있습니다." };
  }
  const removed =
    (await safeInvoke<number>("purge_unsupported_sync_queue_cmd")) ?? 0;
  return {
    removed,
    message:
      removed > 0
        ? `실패·불필요 동기화 대기 항목 ${removed}건을 제거했습니다.`
        : "제거할 대기 항목이 없습니다.",
  };
}

export async function checkOnline(): Promise<boolean> {
  if (!isSupabaseConfigured() || !isTauriApp()) return false;
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    const { error } = await supabase.from("centers").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function pushMemberQueueItem(
  item: SyncQueueItem,
  syncContext: SyncErrorContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "서버 연결을 확인해주세요." };
  }

  const operation = item.operation;

  if (operation === "soft_delete") {
    try {
      const remoteId = await fetchRemoteId("member", item.entity_local_id);
      if (!remoteId) {
        await safeInvoke("complete_sync_queue_item", { id: item.id });
        return { ok: true };
      }
      const deletedAt = nowIso();
      const { data, error } = await supabase
        .from("members")
        .update({ deleted_at: deletedAt, status: "inactive" })
        .eq("id", remoteId)
        .select("id, updated_at")
        .single();
      if (error) throw error;
      await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
      return { ok: true };
    } catch (error) {
      const message = formatSyncError(error, syncContext, null);
      return {
        ok: false,
        error: formatSyncFailure(item, "삭제", { message }, null),
      };
    }
  }

  const parsed = parseMemberPayload(item.payload_json);
  if (!parsed.ok) {
    return {
      ok: false,
      error: formatSyncFailure(item, operation === "insert" ? "등록" : "수정", parsed, null),
    };
  }

  const payload = parsed.payload;
  let centerId: string;
  try {
    centerId = await resolveCenterIdForPayload(payload);
  } catch (error) {
    const message = formatSyncError(error, syncContext, payload.center);
    return {
      ok: false,
      error: formatSyncFailure(item, operation === "insert" ? "등록" : "수정", {
        missingFields: ["center_id"],
        message,
      }, payload.center),
    };
  }

  const row = memberRowFromPayload(payload, centerId);

  // Block upload of test/garbage data patterns
  if (isTestDataMember(row.name, row.phone)) {
    return {
      ok: false,
      error: formatSyncFailure(item, "등록 차단", {
        message: `테스트 데이터로 감지됨 (이름: "${row.name}", 전화: "${row.phone ?? "없음"}") — 수동 확인 후 업로드 제외 처리가 필요합니다.`,
      }, payload.center),
    };
  }

  try {
    if (operation === "insert") {
      // Server duplicate check before inserting a new member
      const phone = row.phone?.replace(/[^0-9]/g, "") ?? null;
      if (phone && phone.length >= 7) {
        const { count: dupCount } = await supabase
          .from("members")
          .select("*", { count: "exact", head: true })
          .eq("center_id", centerId)
          .like("phone", `%${phone.slice(-7)}%`)
          .is("deleted_at", null);
        if ((dupCount ?? 0) > 0) {
          return {
            ok: false,
            error: formatSyncFailure(item, "등록 차단", {
              message: `서버에 동일 연락처 후보 ${dupCount}명 존재 — 수동 확인 후 "서버 회원 매칭 연결"을 먼저 진행하세요.`,
            }, payload.center),
          };
        }
      }
      const data = await upsertRemoteMember(supabase, row, centerId, payload.phone);
      await upsertRemoteMembership(supabase, payload, data.id, centerId);
      await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
      return { ok: true };
    }

    if (operation === "update") {
      let remoteId = await fetchRemoteId("member", item.entity_local_id);

      if (!remoteId) {
        const data = await upsertRemoteMember(supabase, row, centerId, payload.phone);
        await upsertRemoteMembership(supabase, payload, data.id, centerId);
        await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
        return { ok: true };
      }

      const { data, error } = await supabase
        .from("members")
        .update(row)
        .eq("id", remoteId)
        .select("id, updated_at")
        .single();
      if (error) throw error;
      await upsertRemoteMembership(supabase, payload, data.id, centerId);
      await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
      return { ok: true };
    }

    return {
      ok: false,
      error: formatSyncFailure(item, operation, {
        message: `지원하지 않는 작업입니다: ${operation}`,
      }, payload.center),
    };
  } catch (error) {
    const message = formatSyncError(error, syncContext, payload.center);
    console.error("[sync] members push 실패:", { operation, row, error });
    return {
      ok: false,
      error: formatSyncFailure(item, operation === "insert" ? "등록" : "수정", { message }, payload.center),
    };
  }
}

type AttendanceSyncPayload = {
  local_member_id: number;
  local_membership_id: number;
  center: Center;
  checkin_at: string;
  attendance_type: string;
  deducted_count: number;
  memo: string | null;
  source: string;
};

function toUtcIso(value: string): string {
  // Local "YYYY-MM-DD HH:MM:SS" -> ISO with Z (best-effort; treated as local time)
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

async function pushAttendanceQueueItem(
  item: SyncQueueItem,
  syncContext: SyncErrorContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "서버 연결을 확인해주세요." };
  }

  let payload: AttendanceSyncPayload;
  try {
    payload = JSON.parse(item.payload_json) as AttendanceSyncPayload;
  } catch {
    return { ok: false, error: `출석 #${item.entity_local_id} · 동기화 데이터 형식이 올바르지 않습니다.` };
  }

  try {
    const centerId = centerIdForCode(payload.center);
    const memberRemoteId = await fetchRemoteId("member", payload.local_member_id);
    if (!memberRemoteId) {
      // Member not synced yet — leave queued, retry on next push after member syncs.
      return { ok: false, error: `출석 #${item.entity_local_id} · 회원이 아직 동기화되지 않았습니다.` };
    }
    const membershipRemoteId = await fetchRemoteId("membership", payload.local_membership_id);
    if (!membershipRemoteId) {
      return { ok: false, error: `출석 #${item.entity_local_id} · 회원권이 아직 동기화되지 않았습니다.` };
    }

    const row = {
      member_id: memberRemoteId,
      membership_id: membershipRemoteId,
      center_id: centerId,
      checkin_at: toUtcIso(payload.checkin_at),
      attendance_type: payload.attendance_type === "junior" || payload.attendance_type === "trial"
        ? payload.attendance_type
        : "normal",
      deducted_count: payload.deducted_count,
      memo: payload.memo ?? null,
      source: payload.source,
    };

    const { error } = await supabase.from("attendance_logs").insert(row);
    if (error) throw error;

    await safeInvoke("complete_sync_queue_item", { id: item.id });
    return { ok: true };
  } catch (error) {
    const message = formatSyncError(error, syncContext, payload.center);
    return { ok: false, error: `출석 #${item.entity_local_id} · ${message}` };
  }
}

/** Upload a single local-only member directly to Supabase (creates/refreshes a queue item first). */
export async function uploadLocalMemberNow(localId: number): Promise<{ ok: boolean; message: string }> {
  if (!isTauriApp() || !isSupabaseConfigured()) {
    return { ok: false, message: "데스크톱 앱 및 서버 연결이 필요합니다." };
  }
  const session = await getSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };

  // Re-queue a fresh INSERT item for this member
  const queueId = await safeInvoke<number>("requeue_member_for_upload_cmd", { member_id: localId });
  if (!queueId) return { ok: false, message: "업로드 대기 항목 생성에 실패했습니다." };

  const queue = await fetchLocalQueue(100);
  const item = queue.find((q) => q.entity_type === "member" && q.entity_local_id === localId && !q.last_error);
  if (!item) return { ok: false, message: "업로드 대기 항목을 찾을 수 없습니다." };

  await resolveCenterIds().catch(() => {});

  const context: SyncErrorContext = {
    loginEmail: session.user.email ?? null,
    roles: null,
    rolesLoaded: true,
    rolesError: null,
  };

  const result = await pushMemberQueueItem(item, context);
  if (result.ok) return { ok: true, message: "업로드 완료" };
  // On failure, mark the queue item as failed
  await failQueueItem(item.id, result.error);
  return { ok: false, message: result.error };
}

/** Push local sync_queue to Supabase (members only — no pull merge). */
export async function pushSyncQueue(syncContext?: SyncErrorContext): Promise<SyncRunResult> {
  if (!isTauriApp()) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "데스크톱 앱에서만 동기화할 수 있습니다.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "서버 연결이 설정되지 않았습니다. 관리자에게 문의하세요.",
    };
  }

  const session = await getSession();
  if (!session) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "로그인이 필요합니다.",
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "서버 연결을 확인해주세요.",
    };
  }

  await resolveCenterIds().catch((error) => {
    console.warn("[sync] centers preload 실패, seed UUID 사용:", error);
  });

  await repairSyncQueue().catch((error) => {
    console.warn("[sync] 큐 자동 복구 실패:", error);
  });

  const status = await fetchLocalSyncStatus();
  await ensureDeviceId(status);

  const context: SyncErrorContext = syncContext ?? {
    loginEmail: session.user.email ?? null,
    roles: null,
    rolesLoaded: true,
    rolesError: null,
  };

  const queue = await fetchLocalQueue(100);
  let pushed = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;
  let memberPushed = 0;
  let membershipPushed = 0;
  let attendancePushed = 0;
  const errors: string[] = [];

  // Step 1: process all "member" items first (includes membership upserts).
  // Auto-push skips already-failed items (last_error !== null) to prevent
  // retry storms that flood the server with duplicate test/garbage data.
  const memberItems = queue.filter(
    (item) => item.entity_type === "member" && item.last_error === null,
  );
  const memberItemsFailed = queue.filter(
    (item) => item.entity_type === "member" && item.last_error !== null,
  );
  skipped += memberItemsFailed.length;
  const attendanceItems = queue.filter((item) => item.entity_type === "attendance");
  const otherItems = queue.filter(
    (item) => item.entity_type !== "member" && item.entity_type !== "attendance",
  );

  for (const item of memberItems) {
    const result = await pushMemberQueueItem(item, context);
    if (result.ok) {
      pushed += 1;
      memberPushed += 1;
      membershipPushed += 1;
      continue;
    }

    await failQueueItem(item.id, result.error);
    failed += 1;
    errors.push(result.error);
  }

  // Step 2: process "attendance" items, verifying member/membership remote_id now exist.
  for (const item of attendanceItems) {
    let payload: AttendanceSyncPayload | null = null;
    try {
      payload = JSON.parse(item.payload_json) as AttendanceSyncPayload;
    } catch {
      // fall through to normal push, which will report the parse error
    }

    if (payload) {
      const memberRemoteId = await fetchRemoteId("member", payload.local_member_id);
      const membershipRemoteId = await fetchRemoteId("membership", payload.local_membership_id);
      if (!memberRemoteId || !membershipRemoteId) {
        // Leave as pending (not blocked) — will retry on next push once member syncs.
        pending += 1;
        continue;
      }
    }

    const result = await pushAttendanceQueueItem(item, context);
    if (result.ok) {
      pushed += 1;
      attendancePushed += 1;
      continue;
    }
    await failQueueItem(item.id, result.error);
    failed += 1;
    errors.push(result.error);
  }

  skipped += otherItems.length;

  if (pushed > 0) {
    await updateSyncState("last_push_at", nowIso());
  }

  let message: string | undefined;
  if (pushed > 0 && failed === 0 && pending === 0) {
    message = `동기화 완료: 회원 ${memberPushed}명, 회원권 ${membershipPushed}건, 출석 ${attendancePushed}건 서버 반영`;
  } else if (failed > 0) {
    message = errors[0] ?? `업로드 실패 ${failed}건`;
  } else if (pending > 0 && failed === 0) {
    message = "동기화 보류: 회원 remote_id가 없어 회원 업로드를 먼저 시도합니다.";
  } else if (queue.length === 0) {
    message = "동기화할 대기 항목이 없습니다.";
  } else if (skipped > 0 && pushed === 0 && failed === 0) {
    message = `회원 외 ${skipped}건은 아직 동기화되지 않습니다. 「불필요 항목 정리」로 제거할 수 있습니다.`;
  }

  return { pushed, failed, skipped: skipped + pending, errors, message };
}

async function countLocalMembers(): Promise<number> {
  return (await safeInvoke<number>("count_local_members")) ?? 0;
}

async function countLocalMembersForCenters(centerCodes: Center[]): Promise<number> {
  if (centerCodes.length === 0) return 0;
  // Use the Tauri command that returns per-center counts and sum only the relevant ones
  type LocalCenterCounts = {
    oncleMembers: number;
    grabitMembers: number;
    oncleHidden: number;
    grabitHidden: number;
    oncleMemberships: number;
    grabitMemberships: number;
    oncleLocalDuplicate: number;
    grabitLocalDuplicate: number;
  };
  const counts = await safeInvoke<LocalCenterCounts>("get_center_member_counts");
  if (!counts) return 0;
  let total = 0;
  if (centerCodes.includes("ONCLE")) total += counts.oncleMembers;
  if (centerCodes.includes("GRABIT")) total += counts.grabitMembers;
  return total;
}

// ── 서버 회원 매칭 ────────────────────────────────────────────────────────────

import type {
  LocalMemberForMatch,
  LocalCenterCounts,
  MemberMatchEntry,
  ServerMatchReport,
  ServerCenterConsistency,
} from "../types";

function normalizePhoneDigitsLocal(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d || null;
}

/**
 * Fetch all server members for a center and match against local members without remote_id.
 * Auto-links when a single unambiguous match is found (member_no or phone).
 */
export async function matchServerMembersForCenter(center: Center): Promise<ServerMatchReport> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");

  const centerId = centerIdForCode(center);

  // Fetch server members for this center
  const { data: serverData, error: serverError } = await supabase
    .from("members")
    .select("id, name, phone, phone_normalized, member_no")
    .eq("center_id", centerId)
    .is("deleted_at", null);

  if (serverError) {
    throw new Error(`서버 회원 조회 실패: ${formatSyncError(serverError)}`);
  }

  const serverList: Array<{ id: string; name: string; phone: string | null; phone_normalized: string | null; member_no: number | null }> =
    serverData ?? [];

  // Get local members without remote_id for this center
  const localMembers: LocalMemberForMatch[] =
    (await safeInvoke<LocalMemberForMatch[]>("get_local_members_for_matching_cmd", { center })) ?? [];

  const report: ServerMatchReport = {
    center,
    auto_linked: [],
    needs_review: [],
    no_match: [],
    errors: [],
    total_checked: localMembers.length,
  };

  for (const local of localMembers) {
    const entry: MemberMatchEntry = {
      local_id: local.local_id,
      local_name: local.name,
      local_member_no: local.member_no ?? null,
      local_phone: local.phone ?? null,
      local_attendance_count: local.attendance_count,
      local_has_membership: local.has_membership,
      match_type: "none",
      candidates: [],
      auto_linked: false,
      remote_id: null,
    };

    // Priority 1: member_no exact match
    if (local.member_no != null && local.member_no > 0) {
      const byNo = serverList.filter((s) => s.member_no === local.member_no);
      if (byNo.length === 1) {
        entry.match_type = "member_no";
        entry.candidates = byNo.map((s) => ({ id: s.id, name: s.name, phone: s.phone, member_no: s.member_no }));
        try {
          await safeInvoke("link_member_remote_id_cmd", { localId: local.local_id, remoteId: byNo[0].id });
          entry.auto_linked = true;
          entry.remote_id = byNo[0].id;
          report.auto_linked.push(entry);
        } catch (e) {
          entry.error = e instanceof Error ? e.message : String(e);
          report.errors.push(`${local.name}: ${entry.error}`);
          report.needs_review.push(entry);
        }
        continue;
      }
      if (byNo.length > 1) {
        entry.match_type = "ambiguous";
        entry.candidates = byNo.map((s) => ({ id: s.id, name: s.name, phone: s.phone, member_no: s.member_no }));
        report.needs_review.push(entry);
        continue;
      }
    }

    // Priority 2: phone normalized match
    const localPhone = normalizePhoneDigitsLocal(local.phone);
    if (localPhone) {
      const byPhone = serverList.filter((s) => {
        const sp = normalizePhoneDigitsLocal(s.phone) ?? s.phone_normalized;
        return sp && sp === localPhone;
      });
      if (byPhone.length === 1) {
        entry.match_type = "phone";
        entry.candidates = byPhone.map((s) => ({ id: s.id, name: s.name, phone: s.phone, member_no: s.member_no }));
        try {
          await safeInvoke("link_member_remote_id_cmd", { localId: local.local_id, remoteId: byPhone[0].id });
          entry.auto_linked = true;
          entry.remote_id = byPhone[0].id;
          report.auto_linked.push(entry);
        } catch (e) {
          entry.error = e instanceof Error ? e.message : String(e);
          report.errors.push(`${local.name}: ${entry.error}`);
          report.needs_review.push(entry);
        }
        continue;
      }
      if (byPhone.length > 1) {
        entry.match_type = "ambiguous";
        entry.candidates = byPhone.map((s) => ({ id: s.id, name: s.name, phone: s.phone, member_no: s.member_no }));
        report.needs_review.push(entry);
        continue;
      }
    }

    // Priority 3: name match only (no auto-link, needs manual review)
    const byName = serverList.filter((s) => s.name.trim() === local.name.trim());
    if (byName.length > 0) {
      entry.match_type = "name";
      entry.candidates = byName.map((s) => ({ id: s.id, name: s.name, phone: s.phone, member_no: s.member_no }));
      report.needs_review.push(entry);
      continue;
    }

    report.no_match.push(entry);
  }

  return report;
}

/**
 * Compare server vs local data counts for a center (PC consistency check).
 */
export async function getServerCenterConsistency(center: Center): Promise<ServerCenterConsistency> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");

  const centerId = centerIdForCode(center);

  const [membersRes, activeMembersRes, membershipsRes, attendanceRes] = await Promise.all([
    supabase.from("members").select("*", { count: "exact", head: true }).eq("center_id", centerId).is("deleted_at", null),
    supabase.from("members").select("*", { count: "exact", head: true }).eq("center_id", centerId).eq("status", "active").is("deleted_at", null),
    supabase.from("memberships").select("*", { count: "exact", head: true }).eq("center_id", centerId),
    supabase.from("attendance_logs").select("*", { count: "exact", head: true }).eq("center_id", centerId).is("canceled_at", null),
  ]);

  const localCounts: LocalCenterCounts =
    (await safeInvoke<LocalCenterCounts>("get_local_center_counts_cmd", { center })) ??
    { members: 0, members_display: 0, memberships: 0, attendance: 0, members_no_remote_id: 0, memberships_no_remote_id: 0, attendance_no_remote_id: 0, blocked: 0 };

  const syncStatus = await fetchLocalSyncStatus();

  const serverMembers = membersRes.count ?? 0;
  const localMembers = localCounts.members;
  const localDisplay = localCounts.members_display;

  let verdict: "ok" | "warning" | "error" | "no_permission" = "ok";
  let verdict_message = "정상: 이 PC 원장은 서버와 일치합니다.";

  if (membersRes.error) {
    verdict = "no_permission";
    verdict_message = "권한 오류: 이 계정은 해당 센터에 접근할 수 없습니다.";
  } else if (serverMembers > 0 && localMembers < Math.floor(serverMembers * 0.7)) {
    verdict = "error";
    verdict_message = `원장 수 불일치: 서버 ${serverMembers}명 vs 로컬 DB ${localMembers}명 — 서버 기준 강제 불러오기를 실행하세요.`;
  } else if (localMembers === serverMembers && localDisplay < localMembers) {
    verdict = "warning";
    verdict_message = `원장 동기화 정상. 화면 표시(${localDisplay}명)는 필터/hidden 기준이므로 원장 불일치 아닙니다.`;
  } else if (localCounts.members_no_remote_id > 0 || syncStatus.pending_count > 0) {
    verdict = "warning";
    verdict_message = `주의: 이 PC에만 있는 미동기화 데이터가 있습니다 (remote_id 없는 회원 ${localCounts.members_no_remote_id}명, 대기 ${syncStatus.pending_count}건).`;
  }

  return {
    center,
    server_members: serverMembers,
    server_active_members: activeMembersRes.count ?? 0,
    server_memberships: membershipsRes.count ?? 0,
    server_attendance: attendanceRes.count ?? 0,
    local_members: localMembers,
    local_display_members: localDisplay,
    local_memberships: localCounts.memberships,
    local_attendance: localCounts.attendance,
    local_members_no_remote_id: localCounts.members_no_remote_id,
    local_memberships_no_remote_id: localCounts.memberships_no_remote_id,
    local_attendance_no_remote_id: localCounts.attendance_no_remote_id,
    local_blocked: localCounts.blocked,
    local_pending: syncStatus.pending_count,
    local_failed: syncStatus.failed_count,
    last_pull_at: syncStatus.last_pull_at ?? null,
    last_push_at: syncStatus.last_push_at ?? null,
    verdict,
    verdict_message,
  };
}

/** Pull members/memberships/attendance/lockers from Supabase into local SQLite cache. */
export async function pullFromSupabase(options?: {
  onlyIfEmpty?: boolean;
  forceRefresh?: boolean;
  centerIds?: string[];
}): Promise<PullRunResult> {
  const emptyResult = (
    partial: Partial<PullRunResult> & Pick<PullRunResult, "message">,
  ): PullRunResult => ({
    importedMembers: 0,
    importedMemberships: 0,
    importedAttendance: 0,
    importedLockers: 0,
    updatedMembers: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    ...partial,
  });

  if (!isTauriApp()) {
    return emptyResult({ message: "데스크톱 앱에서만 불러올 수 있습니다." });
  }

  if (!isSupabaseConfigured()) {
    return emptyResult({ message: "서버 연결이 설정되지 않았습니다." });
  }

  const session = await getSession();
  if (!session) {
    return emptyResult({ message: "로그인이 필요합니다." });
  }

  try {
    await invokeCommand<void>("ensure_local_db_ready");
  } catch (error) {
    const detail = formatSyncError(error);
    console.error("[pull] ensure_local_db_ready failed", error);
    return emptyResult({
      errors: [detail],
      message: `Supabase 데이터 불러오기에 실패했습니다: ${detail}`,
    });
  }

  // forceRefresh bypasses onlyIfEmpty check entirely
  if (!options?.forceRefresh && options?.onlyIfEmpty) {
    // Check center-specific local count (not total) so that test members from
    // another center don't prevent pulling this account's actual center data.
    const centerCodesToCheck = (options.centerIds ?? [])
      .map((id) => centerCodeFromId(id))
      .filter((c): c is Center => c !== null);
    const localCount = centerCodesToCheck.length > 0
      ? await countLocalMembersForCenters(centerCodesToCheck)
      : await countLocalMembers();
    if (localCount > 0) {
      return emptyResult({ message: "로컬 회원 데이터가 이미 있습니다." });
    }
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return emptyResult({ message: "서버 연결을 확인해주세요." });
  }

  if (options?.centerIds && options.centerIds.length === 0) {
    return emptyResult({ message: "현재 계정에 연결된 센터 권한이 없습니다." });
  }

  const centerIds =
    options?.centerIds ?? Object.values(await resolveCenterIds().catch(() => CENTER_IDS_FALLBACK()));

  // Build per-center diagnostics skeleton
  const pullDiagnostics: Record<string, PullCenterDiagnostics> = {};
  for (const cid of centerIds) {
    pullDiagnostics[cid] = { serverCount: 0, upsertAttempt: 0, upsertSuccess: 0, mappingFail: 0 };
  }

  console.info(
    `[pull] 시작 · 계정: ${session.user.email} · centerIds: [${centerIds.join(", ")}]`,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let membersRows: any[] = [];
  try {
    membersRows = await fetchAllPages((from, to) =>
      supabase
        .from("members")
        .select(
          "id, center_id, name, phone, address, member_type, parent_name, parent_phone, memo, status, created_at, updated_at, member_no",
        )
        .in("center_id", centerIds)
        .is("deleted_at", null)
        .range(from, to),
    );
  } catch (err) {
    const message = formatSyncError(err);
    console.error("[pull] members fetch failed", err);
    return emptyResult({ errors: [message], message, pullDiagnostics });
  }

  console.info(`[pull] 서버 회원 총 ${membersRows.length}명 페이지네이션 완료`);

  // Record server counts per center
  for (const row of membersRows) {
    if (pullDiagnostics[row.center_id]) {
      pullDiagnostics[row.center_id].serverCount += 1;
    } else {
      pullDiagnostics[row.center_id] = { serverCount: 1, upsertAttempt: 0, upsertSuccess: 0, mappingFail: 1 };
    }
  }
  console.info("[pull] 서버 회원 수 per center:", JSON.stringify(pullDiagnostics));

  const memberIds = membersRows.map((row) => row.id);
  if (memberIds.length === 0) {
    console.warn(
      `[pull] 서버에서 0명 조회됨. centerIds=[${centerIds.join(", ")}] — RLS 권한 또는 데이터 없음.`,
    );
    await updateSyncState("last_pull_at", nowIso());
    return emptyResult({ message: "Supabase에 불러올 회원이 없습니다.", pullDiagnostics });
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let membershipsRows: any[] = [];
  try {
    membershipsRows = await fetchAllPages((from, to) =>
      supabase
        .from("memberships")
        .select(
          "id, member_id, center_id, membership_type, pass_type, start_date, end_date, total_count, used_count, remaining_count, status, price, created_at, updated_at",
        )
        .in("center_id", centerIds)
        .range(from, to),
    );
    console.info(`[pull] 회원권 총 ${membershipsRows.length}건 페이지네이션 완료`);
  } catch (err) {
    const message = formatSyncError(err);
    console.warn("[pull] memberships fetch failed", err);
    warnings.push(`회원권 데이터는 불러오지 못했습니다: ${message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attendanceRows: any[] = [];
  try {
    attendanceRows = await fetchAllPages((from, to) =>
      supabase
        .from("attendance_logs")
        .select(
          "id, member_id, membership_id, center_id, checkin_at, attendance_type, deducted_count, memo, created_at",
        )
        .in("center_id", centerIds)
        .is("canceled_at", null)
        .range(from, to),
    );
    console.info(`[pull] 출석 총 ${attendanceRows.length}건 페이지네이션 완료`);
  } catch (err) {
    const message = formatSyncError(err);
    console.warn("[pull] attendance fetch failed", err);
    warnings.push(`출석 데이터는 불러오지 못했습니다: ${message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lockersRows: any[] = [];
  try {
    lockersRows = await fetchAllPages((from, to) =>
      supabase
        .from("lockers")
        .select("member_id, center_id, locker_number, status, start_date, end_date, memo")
        .in("center_id", centerIds)
        .not("member_id", "is", null)
        .range(from, to),
    );
    console.info(`[pull] 락카 총 ${lockersRows.length}건 페이지네이션 완료`);
  } catch (err) {
    const message = formatSyncError(err);
    console.warn("[pull] lockers fetch failed", err);
    warnings.push(`락카 데이터는 불러오지 못했지만 회원관리 기능은 사용할 수 있습니다. (${message})`);
  }

  const snapshot = toInvokePullSnapshot(
    buildPullSnapshot({
      members: membersRows,
      memberships: membershipsRows,
      attendanceLogs: attendanceRows,
      lockers: lockersRows,
    }),
  );

  // Pre-flight: validate all numeric fields so we catch type mismatches before
  // handing off to Rust (serde fails on string "505" where i64 is expected).
  const typeErr = findSnapshotTypeError(snapshot);
  if (typeErr) {
    const detail = `snapshot 타입 오류: ${typeErr.path} = ${JSON.stringify(typeErr.value)} (${typeof typeErr.value}) — ${typeErr.expected} 숫자가 필요합니다`;
    console.error("[pull] snapshot 타입 검증 실패", typeErr);
    return emptyResult({
      errors: [detail],
      warnings,
      message: `강제 불러오기 실패: ${detail}`,
      pullDiagnostics,
    });
  }

  console.info(
    `[pull] snapshot 타입 검증 통과 · members=${snapshot.members.length} memberships=${snapshot.memberships.length}`,
  );

  let importResult: {
    importedMembers: number;
    importedMemberships: number;
    importedAttendance: number;
    importedLockers: number;
    updatedMembers: number;
    skipped: number;
    failedMembers?: number;
    failedMemberships?: number;
    firstError?: string | null;
  };

  try {
    console.debug("[pull] import_pull_snapshot_cmd 시작 · members=%d memberships=%d", snapshot.members.length, snapshot.memberships.length);
    importResult = await invokeCommand("import_pull_snapshot_cmd", { snapshot });
    console.info("[pull] import_pull_snapshot_cmd 완료:", importResult);
  } catch (error) {
    const raw = formatSyncError(error);
    console.error("[pull] import_pull_snapshot_cmd 실패", error);
    // Distinguish Tauri arg deserialization errors from SQLite errors
    const isArgError = raw.includes("invalid args") || raw.includes("invalid type") || raw.includes("expected i");
    const detail = isArgError
      ? `snapshot 타입 오류 — ${raw}`
      : `SQLite upsert 오류 — ${raw}`;
    return emptyResult({
      errors: [detail],
      warnings,
      message: `강제 불러오기 실패: ${detail}`,
      pullDiagnostics,
    });
  }

  const totalServerCount = Object.values(pullDiagnostics).reduce((sum, d) => sum + d.serverCount, 0);
  const totalLocal = importResult.importedMembers + importResult.updatedMembers;
  const failedMembers = importResult.failedMembers ?? 0;

  // Set upsertSuccess = totalLocal distributed proportionally across centers
  for (const cid of centerIds) {
    if (pullDiagnostics[cid]) {
      pullDiagnostics[cid].upsertAttempt = pullDiagnostics[cid].serverCount;
      // Approximate per-center success if multiple centers; for single center it's exact.
      pullDiagnostics[cid].upsertSuccess = centerIds.length === 1
        ? totalLocal
        : Math.round((pullDiagnostics[cid].serverCount / Math.max(totalServerCount, 1)) * totalLocal);
    }
  }

  await updateSyncState("last_pull_at", nowIso());

  const totalImported =
    importResult.importedMembers +
    importResult.importedMemberships +
    importResult.importedAttendance +
    importResult.importedLockers;

  // Collect upsert errors
  if (importResult.firstError) {
    errors.push(`upsert 실패 (첫 번째): ${importResult.firstError}`);
  }
  if (failedMembers > 0) {
    const errMsg = `members upsert 실패 ${failedMembers}건 · 성공 ${totalLocal}건`;
    errors.push(errMsg);
    console.warn("[pull]", errMsg);
  }

  const diagMessages: string[] = [];
  for (const [cid, diag] of Object.entries(pullDiagnostics)) {
    const centerCode = centerCodeFromId(cid) ?? cid.slice(0, 8);
    if (diag.serverCount > 0 && diag.upsertSuccess === 0) {
      diagMessages.push(`불러오기 실패: 서버 ${centerCode} 회원 ${diag.serverCount}명 → 로컬 0명 저장됨`);
    } else if (diag.serverCount === 0) {
      diagMessages.push(`불러오기 경고: 서버 ${centerCode} 회원 0명`);
    } else {
      diagMessages.push(`불러오기 완료: 서버 ${centerCode} 회원 ${diag.serverCount}명 → 로컬 ${diag.upsertSuccess}명 저장`);
    }
  }
  console.info("[pull] 결과:", { totalServerCount, totalLocal, failedMembers, importResult, diagMessages });

  let message: string;
  if (totalServerCount > 0 && totalLocal === 0) {
    const firstErr = importResult.firstError ?? errors[0] ?? "SQLite 컬럼 누락 또는 constraint 오류";
    message = `강제 불러오기 실패: 서버 회원 ${totalServerCount}명을 조회했지만 로컬 DB에 0명만 반영되었습니다. 원인: ${firstErr}`;
  } else if (totalImported > 0 || importResult.updatedMembers > 0) {
    message = `불러오기 완료: 회원 ${totalLocal}명 · 출석 ${importResult.importedAttendance}건 · 락카 ${importResult.importedLockers}건`;
    if (failedMembers > 0) {
      message += ` (실패 ${failedMembers}건)`;
    }
  } else {
    message = "변경할 데이터가 없습니다.";
  }
  if (warnings.length > 0) {
    message = `${message} ${warnings[0]}`;
  }

  return {
    importedMembers: importResult.importedMembers,
    importedMemberships: importResult.importedMemberships,
    importedAttendance: importResult.importedAttendance,
    importedLockers: importResult.importedLockers,
    updatedMembers: importResult.updatedMembers,
    skipped: importResult.skipped,
    errors,
    warnings,
    message,
    pullDiagnostics,
    fetchedTotal: membersRows.length,
  };
}

function CENTER_IDS_FALLBACK(): Record<Center, string> {
  return {
    ONCLE: centerIdForCode("ONCLE"),
    GRABIT: centerIdForCode("GRABIT"),
  };
}

// ---------------------------------------------------------------------------
// Sync Verification Report
// ---------------------------------------------------------------------------

export interface SyncVerificationCenterReport {
  centerCode: string;
  centerId: string | null;
  serverMemberCount: number | null;
  serverMembershipCount: number | null;
  localMemberCount: number | null;
  localMembershipCount: number | null;
  localHiddenCount: number | null;
  localDuplicateCount: number | null;
  localRawTotal: number | null;
  localDeletedCount: number | null;
  allowed: boolean;
  serverQueryError: string | null;
}

export interface SyncVerificationReport {
  loginEmail: string | null;
  userCenterRoles: Array<{ center_id: string; role: string; center_code: string | null }>;
  allowedCenterCodes: string[];
  selectedCenterCode: string | null;
  supabaseCenters: Array<{ id: string; code: string; name: string }>;
  centers: SyncVerificationCenterReport[];
  diagnosis: string[];
  ranAt: string;
}

export async function runSyncVerificationReport(options?: {
  selectedCenter?: string;
  allowedCenterIds?: string[];
}): Promise<SyncVerificationReport> {
  const ranAt = new Date().toISOString();
  const diagnosis: string[] = [];
  const report: SyncVerificationReport = {
    loginEmail: null,
    userCenterRoles: [],
    allowedCenterCodes: [],
    selectedCenterCode: options?.selectedCenter ?? null,
    supabaseCenters: [],
    centers: [],
    diagnosis,
    ranAt,
  };

  const supabase = getSupabaseClient();
  if (!supabase) {
    diagnosis.push("⚠ Supabase 클라이언트를 초기화할 수 없습니다. 연결 설정 확인 필요.");
    return report;
  }

  const session = await getSession();
  if (!session) {
    diagnosis.push("⚠ 로그인 세션이 없습니다. 로그인 후 다시 시도하세요.");
    return report;
  }

  report.loginEmail = session.user.email ?? null;

  // 1. Fetch user_center_roles
  const { data: rolesData, error: rolesError } = await supabase
    .from("user_center_roles")
    .select("center_id, role")
    .eq("user_id", session.user.id);

  if (rolesError) {
    diagnosis.push(`⚠ user_center_roles 조회 실패: ${rolesError.message}`);
  } else {
    const centerIdsMap = await resolveCenterIds().catch(() => CENTER_IDS_FALLBACK());
    const codeById = Object.fromEntries(
      Object.entries(centerIdsMap).map(([code, id]) => [id, code]),
    );
    report.userCenterRoles = (rolesData ?? []).map((r) => ({
      center_id: r.center_id,
      role: r.role as string,
      center_code: codeById[r.center_id] ?? null,
    }));
    report.allowedCenterCodes = report.userCenterRoles
      .map((r) => r.center_code)
      .filter((c): c is string => c !== null);
  }

  // 2. Fetch Supabase centers list
  const { data: centersData, error: centersError } = await supabase
    .from("centers")
    .select("id, code, name");

  if (centersError) {
    diagnosis.push(`⚠ centers 테이블 조회 실패: ${centersError.message}`);
  } else {
    report.supabaseCenters = (centersData ?? []).map((c) => ({
      id: String(c.id),
      code: String(c.code),
      name: String(c.name),
    }));
  }

  // 3. Per-center server + local counts
  const centerIdsMap = await resolveCenterIds().catch(() => CENTER_IDS_FALLBACK());
  const allCenterCodes: string[] = ["ONCLE", "GRABIT"];

  type LocalCenterCounts = {
    oncleMembers: number;
    grabitMembers: number;
    oncleMemberships: number;
    grabitMemberships: number;
    oncleHidden: number;
    grabitHidden: number;
    oncleLocalDuplicate: number;
    grabitLocalDuplicate: number;
  };
  type RawMemberCounts = {
    oncleRawTotal: number;
    oncleDeleted: number;
    oncleHidden: number;
    oncleIsDuplicate: number;
    oncleVisible: number;
    grabitRawTotal: number;
    grabitDeleted: number;
    grabitHidden: number;
    grabitIsDuplicate: number;
    grabitVisible: number;
    allRawTotal: number;
    distinctCenters: string;
  };
  // Get local counts via Tauri commands
  let localCounts: LocalCenterCounts | null = null;
  let rawCounts: RawMemberCounts | null = null;
  if (isTauriApp()) {
    [localCounts, rawCounts] = await Promise.all([
      safeInvoke<LocalCenterCounts>("get_center_member_counts"),
      safeInvoke<RawMemberCounts>("get_raw_member_counts"),
    ]);
  }

  const localCountsByCenter: Record<string, {
    members: number | null;
    memberships: number | null;
    hidden: number | null;
    duplicate: number | null;
    rawTotal: number | null;
    deleted: number | null;
  }> = {
    ONCLE: localCounts
      ? { members: localCounts.oncleMembers, memberships: localCounts.oncleMemberships, hidden: localCounts.oncleHidden, duplicate: localCounts.oncleLocalDuplicate, rawTotal: rawCounts?.oncleRawTotal ?? null, deleted: rawCounts?.oncleDeleted ?? null }
      : { members: null, memberships: null, hidden: null, duplicate: null, rawTotal: null, deleted: null },
    GRABIT: localCounts
      ? { members: localCounts.grabitMembers, memberships: localCounts.grabitMemberships, hidden: localCounts.grabitHidden, duplicate: localCounts.grabitLocalDuplicate, rawTotal: rawCounts?.grabitRawTotal ?? null, deleted: rawCounts?.grabitDeleted ?? null }
      : { members: null, memberships: null, hidden: null, duplicate: null, rawTotal: null, deleted: null },
  };

  for (const code of allCenterCodes) {
    const centerId = centerIdsMap[code as "ONCLE" | "GRABIT"] ?? null;
    const allowed = report.allowedCenterCodes.includes(code);
    let serverMemberCount: number | null = null;
    let serverMembershipCount: number | null = null;
    let serverQueryError: string | null = null;

    if (centerId) {
      const { count: mc, error: me } = await supabase
        .from("members")
        .select("*", { count: "exact", head: true })
        .eq("center_id", centerId)
        .is("deleted_at", null);
      if (me) {
        serverQueryError = me.message;
        diagnosis.push(`⚠ Supabase ${code} members 조회 실패: ${me.message} (RLS 차단 가능)`);
      } else {
        serverMemberCount = mc ?? 0;
      }

      const { count: msc, error: mse } = await supabase
        .from("memberships")
        .select("*", { count: "exact", head: true })
        .eq("center_id", centerId);
      if (!mse) {
        serverMembershipCount = msc ?? 0;
      }
    }

    const local = localCountsByCenter[code];
    const centerReport: SyncVerificationCenterReport = {
      centerCode: code,
      centerId,
      serverMemberCount,
      serverMembershipCount,
      localMemberCount: local?.members ?? null,
      localMembershipCount: local?.memberships ?? null,
      localHiddenCount: local?.hidden ?? null,
      localDuplicateCount: local?.duplicate ?? null,
      localRawTotal: local?.rawTotal ?? null,
      localDeletedCount: local?.deleted ?? null,
      allowed,
      serverQueryError,
    };
    report.centers.push(centerReport);

    // Auto diagnosis
    const localVisible = local?.members ?? null;
    const localRaw = local?.rawTotal ?? null;
    const localVisibleStr = localVisible !== null
      ? (localRaw !== null && localRaw !== localVisible ? `원장 ${localRaw}명 / 표시 ${localVisible}명` : `${localVisible}명`)
      : "N/A";
    if (!allowed) {
      diagnosis.push(`⚠ ${code}: 이 계정에 ${code} 센터 권한이 없습니다 (user_center_roles에 미등록).`);
    } else if (serverMemberCount === 0 && !serverQueryError) {
      diagnosis.push(`⚠ ${code}: Supabase에서 회원 0명 조회 → RLS 정책이 차단하고 있거나 데이터가 없습니다.`);
    } else if (serverMemberCount !== null && serverMemberCount > 0 && (localVisible ?? 0) === 0 && (localRaw ?? 0) === 0) {
      diagnosis.push(`⚠ ${code}: 서버에는 ${serverMemberCount}명이 있지만 로컬에 0명. pull이 실패했거나 center mapping 오류입니다. 「Supabase에서 불러오기」를 다시 실행하세요.`);
    } else if (serverMemberCount !== null && serverMemberCount > 0 && localRaw !== null && localRaw > 0 && (localVisible ?? 0) < localRaw) {
      const hidden = local?.hidden ?? 0;
      const dup = local?.duplicate ?? 0;
      const del = local?.deleted ?? 0;
      diagnosis.push(`△ ${code}: 서버 ${serverMemberCount}명 / ${localVisibleStr} (숨김 ${hidden}명, 중복 ${dup}명, 삭제됨 ${del}명)`);
    } else if (serverMemberCount !== null && localVisible !== null) {
      const diff = Math.abs(serverMemberCount - localVisible);
      if (diff === 0) {
        diagnosis.push(`✓ ${code}: 서버 ${serverMemberCount}명 = ${localVisibleStr} (정상)`);
      } else {
        diagnosis.push(`△ ${code}: 서버 ${serverMemberCount}명 vs ${localVisibleStr} (차이 ${diff}명)`);
      }
    }

    if (options?.selectedCenter === code && !allowed) {
      diagnosis.push(`⚠ selected_center가 ${code}이지만 이 계정은 ${code} 권한이 없습니다.`);
    }
    if (options?.selectedCenter !== code && allowed && (local?.members ?? 0) > 0 && serverMemberCount !== null && serverMemberCount > 0) {
      if (report.allowedCenterCodes.length === 1) {
        diagnosis.push(`△ ${code}: 로컬에 ${code} 회원이 있지만 selected_center가 ${code}가 아닙니다. 센터 전환 필요.`);
      }
    }
  }

  if (diagnosis.length === 0) {
    diagnosis.push("✓ 모든 항목이 정상입니다.");
  }

  return report;
}

/** @deprecated Use pushSyncQueue — pull merge is not implemented yet. */
export async function runSync(_center?: Center): Promise<SyncRunResult> {
  return pushSyncQueue();
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return fetchLocalSyncStatus();
}

export type { SyncErrorContext } from "./permissionContext";
export { centerIdForCode };
