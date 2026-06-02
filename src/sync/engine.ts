import { invoke } from "@tauri-apps/api/core";
import type { Center, MemberInput } from "../types";
import { getSession } from "../lib/supabase/auth";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { centerIdForCode } from "../lib/supabase/centers";
import { formatSyncError } from "./errors";
import type { SyncQueueItem, SyncRunResult, SyncStatus } from "./types";

const DEVICE_ID_KEY = "device_id";

type MemberSyncPayload = MemberInput & { center: Center };

async function fetchLocalSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("fetch_sync_status");
}

async function fetchLocalQueue(limit = 100): Promise<SyncQueueItem[]> {
  return invoke<SyncQueueItem[]>("fetch_sync_queue", { limit });
}

async function failQueueItem(id: number, error: string) {
  return invoke("fail_sync_queue_item", { id, error });
}

async function updateSyncState(key: string, value: string) {
  return invoke("update_sync_state", { key, value });
}

async function fetchRemoteId(entityType: string, localId: number): Promise<string | null> {
  try {
    return await invoke<string | null>("fetch_remote_id", {
      entity_type: entityType,
      local_id: localId,
    });
  } catch {
    return null;
  }
}

async function completeMemberPush(
  queueId: number,
  localMemberId: number,
  remoteId: string,
  remoteUpdatedAt?: string | null,
) {
  return invoke("complete_member_sync_push", {
    queue_id: queueId,
    local_member_id: localMemberId,
    remote_id: remoteId,
    remote_updated_at: remoteUpdatedAt ?? null,
  });
}

function nowIso() {
  return new Date().toISOString();
}

function parseMemberPayload(payloadJson: string): MemberSyncPayload {
  const payload = JSON.parse(payloadJson) as MemberSyncPayload;
  if (!payload.center || !payload.name?.trim()) {
    throw new Error("??? payload? ?? ?? ?? ??? ????.");
  }
  return payload;
}

function memberRowFromPayload(payload: MemberSyncPayload, centerId: string) {
  return {
    center_id: centerId,
    name: payload.name.trim(),
    phone: payload.phone?.trim() || null,
    member_type: payload.member_type ?? "general",
    parent_name: payload.parent_name ?? null,
    parent_phone: payload.parent_phone ?? null,
    memo: payload.notes ?? null,
  };
}

async function ensureDeviceId(status: SyncStatus): Promise<string> {
  if (status.device_id) return status.device_id;
  const deviceId = crypto.randomUUID();
  await updateSyncState(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export async function checkOnline(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "Supabase ?????? ????? ?????." };
  }

  const payload = parseMemberPayload(item.payload_json);
  const centerId = centerIdForCode(payload.center);
  const row = memberRowFromPayload(payload, centerId);

  try {
    if (item.operation === "insert") {
      const { data, error } = await supabase
        .from("members")
        .insert(row)
        .select("id, updated_at")
        .single();
      if (error) throw error;
      await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
      return { ok: true };
    }

    if (item.operation === "update") {
      let remoteId = await fetchRemoteId("member", item.entity_local_id);

      if (!remoteId) {
        const { data, error } = await supabase
          .from("members")
          .insert(row)
          .select("id, updated_at")
          .single();
        if (error) throw error;
        remoteId = data.id;
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
      await completeMemberPush(item.id, item.entity_local_id, data.id, data.updated_at);
      return { ok: true };
    }

    if (item.operation === "soft_delete") {
      const remoteId = await fetchRemoteId("member", item.entity_local_id);
      if (!remoteId) {
        return { ok: false, error: "??? ?? ?? ID ??? ????." };
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
    }

    return { ok: false, error: `???? ?? ??? ?????: ${item.operation}` };
  } catch (error) {
    return { ok: false, error: formatSyncError(error) };
  }
}

/** Push local sync_queue to Supabase (members only — no pull merge). */
export async function pushSyncQueue(): Promise<SyncRunResult> {
  if (!isSupabaseConfigured()) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "Supabase? ???? ?????. .env ??? ?????.",
    };
  }

  const session = await getSession();
  if (!session) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "Supabase ???? ?????.",
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      message: "Supabase ?????? ????? ?????.",
    };
  }

  const status = await fetchLocalSyncStatus();
  await ensureDeviceId(status);

  const queue = await fetchLocalQueue(100);
  let pushed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of queue) {
    if (item.entity_type !== "member") {
      skipped += 1;
      continue;
    }

    const result = await pushMemberQueueItem(item);
    if (result.ok) {
      pushed += 1;
      continue;
    }

    await failQueueItem(item.id, result.error);
    failed += 1;
    errors.push(`?? #${item.entity_local_id}: ${result.error}`);
  }

  if (pushed > 0) {
    await updateSyncState("last_push_at", nowIso());
  }

  let message: string | undefined;
  if (pushed > 0 && failed === 0) {
    message = `??? ??: ${pushed}? ???`;
  } else if (failed > 0) {
    message = errors[0] ?? `??? ?? ${failed}?`;
  } else if (queue.length === 0) {
    message = "???? ?? ??? ????.";
  } else if (skipped > 0 && pushed === 0 && failed === 0) {
    message = "?? ??? ?? ??? ????. (?? ?? ?? push ???)";
  }

  return { pushed, failed, skipped, errors, message };
}

/** @deprecated Use pushSyncQueue — pull merge is not implemented yet. */
export async function runSync(_center?: Center): Promise<SyncRunResult> {
  return pushSyncQueue();
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return fetchLocalSyncStatus();
}
