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
import { buildPullSnapshot, toInvokePullSnapshot } from "./pullMapping";
import type { SyncErrorContext } from "./permissionContext";
import type { PullCenterDiagnostics, PullRunResult, SyncQueueItem, SyncRunResult, SyncStatus } from "./types";

const DEVICE_ID_KEY = "device_id";

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

async function pushMemberQueueItem(
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

  try {
    if (operation === "insert") {
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
  const memberItems = queue.filter((item) => item.entity_type === "member");
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

/** Pull members/memberships/attendance/lockers from Supabase into local SQLite cache. */
export async function pullFromSupabase(options?: {
  onlyIfEmpty?: boolean;
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

  const localCount = await countLocalMembers();
  if (options?.onlyIfEmpty && localCount > 0) {
    return emptyResult({ message: "로컬 회원 데이터가 이미 있습니다." });
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

  const membersRes = await supabase
    .from("members")
    .select(
      "id, center_id, name, phone, address, member_type, parent_name, parent_phone, memo, status, created_at, updated_at, member_no",
    )
    .in("center_id", centerIds)
    .is("deleted_at", null);
  if (membersRes.error) {
    const message = formatSyncError(membersRes.error);
    console.error("[pull] members fetch failed", membersRes.error);
    return emptyResult({
      errors: [message],
      message,
      pullDiagnostics,
    });
  }

  // Record server counts per center
  for (const row of membersRes.data ?? []) {
    if (pullDiagnostics[row.center_id]) {
      pullDiagnostics[row.center_id].serverCount += 1;
    } else {
      // center_id not in our map — mapping fail
      pullDiagnostics[row.center_id] = { serverCount: 1, upsertAttempt: 0, upsertSuccess: 0, mappingFail: 1 };
    }
  }
  console.info("[pull] 서버 회원 수 per center:", JSON.stringify(pullDiagnostics));

  const memberIds = (membersRes.data ?? []).map((row) => row.id);
  if (memberIds.length === 0) {
    console.warn(
      `[pull] 서버에서 0명 조회됨. centerIds=[${centerIds.join(", ")}] — RLS 권한 또는 데이터 없음.`,
    );
    await updateSyncState("last_pull_at", nowIso());
    return emptyResult({ message: "Supabase에 불러올 회원이 없습니다.", pullDiagnostics });
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  const membershipsRes = await supabase
    .from("memberships")
    .select(
      "id, member_id, center_id, membership_type, pass_type, start_date, end_date, total_count, used_count, remaining_count, status, price, created_at, updated_at",
    )
    .in("center_id", centerIds);
  if (membershipsRes.error) {
    const message = formatSyncError(membershipsRes.error);
    console.warn("[pull] memberships fetch failed", membershipsRes.error);
    warnings.push(`회원권 데이터는 불러오지 못했습니다: ${message}`);
  }

  const attendanceRes = await supabase
    .from("attendance_logs")
    .select(
      "id, member_id, membership_id, center_id, checkin_at, attendance_type, deducted_count, memo, created_at",
    )
    .in("center_id", centerIds)
    .is("canceled_at", null);
  if (attendanceRes.error) {
    const message = formatSyncError(attendanceRes.error);
    console.warn("[pull] attendance fetch failed", attendanceRes.error);
    warnings.push(`출석 데이터는 불러오지 못했습니다: ${message}`);
  }

  const lockersRes = await supabase
    .from("lockers")
    .select("member_id, center_id, locker_number, status, start_date, end_date, memo")
    .in("center_id", centerIds)
    .not("member_id", "is", null);
  if (lockersRes.error) {
    const message = formatSyncError(lockersRes.error);
    console.warn("[pull] lockers fetch failed", lockersRes.error);
    warnings.push(`락카 데이터는 불러오지 못했지만 회원관리 기능은 사용할 수 있습니다. (${message})`);
  }

  const snapshot = toInvokePullSnapshot(
    buildPullSnapshot({
      members: membersRes.data ?? [],
      memberships: membershipsRes.data ?? [],
      attendanceLogs: attendanceRes.data ?? [],
      lockers: lockersRes.data ?? [],
    }),
  );

  let importResult: {
    importedMembers: number;
    importedMemberships: number;
    importedAttendance: number;
    importedLockers: number;
    updatedMembers: number;
    skipped: number;
  };

  try {
    console.debug("[pull] import_pull_snapshot_cmd payload", snapshot);
    importResult = await invokeCommand("import_pull_snapshot_cmd", { snapshot });
  } catch (error) {
    const detail = formatSyncError(error);
    console.error("[pull] import_pull_snapshot_cmd failed", error, snapshot);
    return emptyResult({
      errors: [detail],
      warnings,
      message: `Supabase 데이터 불러오기에 실패했습니다: ${detail}`,
      pullDiagnostics,
    });
  }

  // Record upsert success counts
  const totalServerCount = Object.values(pullDiagnostics).reduce((sum, d) => sum + d.serverCount, 0);
  const totalLocal = importResult.importedMembers + importResult.updatedMembers;
  for (const cid of centerIds) {
    if (pullDiagnostics[cid]) {
      pullDiagnostics[cid].upsertAttempt = pullDiagnostics[cid].serverCount;
    }
  }

  await updateSyncState("last_pull_at", nowIso());

  const totalImported =
    importResult.importedMembers +
    importResult.importedMemberships +
    importResult.importedAttendance +
    importResult.importedLockers;

  // Build diagnostic messages per center
  const diagMessages: string[] = [];
  for (const [cid, diag] of Object.entries(pullDiagnostics)) {
    const centerCode = centerCodeFromId(cid) ?? cid.slice(0, 8);
    if (diag.serverCount > 0 && diag.upsertSuccess === 0 && diag.mappingFail === 0) {
      diagMessages.push(`불러오기 경고: 서버 ${centerCode} 회원 ${diag.serverCount}명이 있으나 로컬에 0명 저장됨`);
    } else if (diag.serverCount === 0) {
      diagMessages.push(`불러오기 경고: 서버 ${centerCode} 회원 0명 (RLS 권한 오류 또는 데이터 없음)`);
    } else {
      diagMessages.push(`불러오기 완료: 서버 ${centerCode} 회원 ${diag.serverCount}명 확인`);
    }
  }
  console.info("[pull] 결과:", { totalServerCount, totalLocal, importResult, diagMessages });

  let message: string;
  if (totalImported > 0 || importResult.updatedMembers > 0) {
    message = `불러오기 완료: 회원 ${importResult.importedMembers + importResult.updatedMembers}명 · 출석 ${importResult.importedAttendance}건 · 락카 ${importResult.importedLockers}건`;
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
  // Get local counts via Tauri command
  let localCounts: LocalCenterCounts | null = null;
  if (isTauriApp()) {
    localCounts = await safeInvoke<LocalCenterCounts>("get_center_member_counts");
  }

  const localCountsByCenter: Record<string, {
    members: number | null;
    memberships: number | null;
    hidden: number | null;
    duplicate: number | null;
  }> = {
    ONCLE: localCounts
      ? { members: localCounts.oncleMembers, memberships: localCounts.oncleMemberships, hidden: localCounts.oncleHidden, duplicate: localCounts.oncleLocalDuplicate }
      : { members: null, memberships: null, hidden: null, duplicate: null },
    GRABIT: localCounts
      ? { members: localCounts.grabitMembers, memberships: localCounts.grabitMemberships, hidden: localCounts.grabitHidden, duplicate: localCounts.grabitLocalDuplicate }
      : { members: null, memberships: null, hidden: null, duplicate: null },
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
      allowed,
      serverQueryError,
    };
    report.centers.push(centerReport);

    // Auto diagnosis
    if (!allowed) {
      diagnosis.push(`⚠ ${code}: 이 계정에 ${code} 센터 권한이 없습니다 (user_center_roles에 미등록).`);
    } else if (serverMemberCount === 0 && !serverQueryError) {
      diagnosis.push(`⚠ ${code}: Supabase에서 회원 0명 조회 → RLS 정책이 차단하고 있거나 데이터가 없습니다.`);
    } else if (serverMemberCount !== null && serverMemberCount > 0 && (local?.members ?? 0) === 0) {
      diagnosis.push(`⚠ ${code}: 서버에는 ${serverMemberCount}명이 있지만 로컬에 0명. pull이 실패했거나 center mapping 오류입니다. 「Supabase에서 불러오기」를 다시 실행하세요.`);
    } else if (serverMemberCount !== null && local?.members !== null) {
      const diff = Math.abs(serverMemberCount - (local.members ?? 0));
      if (diff === 0) {
        diagnosis.push(`✓ ${code}: 서버 ${serverMemberCount}명 = 로컬 ${local.members}명 (정상)`);
      } else {
        diagnosis.push(`△ ${code}: 서버 ${serverMemberCount}명 vs 로컬 ${local.members}명 (차이 ${diff}명 — deleted_at 포함 여부 등)`);
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
