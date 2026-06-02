import { invoke } from "@tauri-apps/api/core";
import type { Center } from "../types";
import { getSession } from "../lib/supabase/auth";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { centerIdForCode } from "../lib/supabase/centers";
import type { SyncQueueItem, SyncRunResult, SyncStatus } from "./types";

const DEVICE_ID_KEY = "device_id";

async function fetchLocalSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("fetch_sync_status");
}

async function fetchLocalQueue(limit = 50): Promise<SyncQueueItem[]> {
  return invoke<SyncQueueItem[]>("fetch_sync_queue", { limit });
}

async function completeQueueItem(id: number) {
  return invoke("complete_sync_queue_item", { id });
}

async function failQueueItem(id: number, error: string) {
  return invoke("fail_sync_queue_item", { id, error });
}

async function updateSyncState(key: string, value: string) {
  return invoke("update_sync_state", { key, value });
}

async function mapRemoteId(entityType: string, localId: number, remoteId: string) {
  return invoke("map_remote_id", {
    entity_type: entityType,
    local_id: localId,
    remote_id: remoteId,
  });
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

function nowIso() {
  return new Date().toISOString();
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

export async function runSync(center: Center): Promise<SyncRunResult> {
  if (!isSupabaseConfigured()) {
    return { pulled: 0, pushed: 0, failed: 0, message: "Supabase ???" };
  }

  const session = await getSession();
  if (!session) {
    return { pulled: 0, pushed: 0, failed: 0, message: "??? ??" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { pulled: 0, pushed: 0, failed: 0, message: "Supabase ????? ??" };
  }

  const status = await fetchLocalSyncStatus();
  await ensureDeviceId(status);
  const centerId = centerIdForCode(center);

  let pulled = 0;
  let pushed = 0;
  let failed = 0;

  const since = status.last_pull_at ?? "1970-01-01T00:00:00.000Z";
  const { data: remoteMembers, error: pullError } = await supabase
    .from("members")
    .select("id, name, phone, member_type, memo, status, updated_at, center_id")
    .eq("center_id", centerId)
    .gt("updated_at", since)
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  if (pullError) {
    return { pulled, pushed, failed: 1, message: pullError.message };
  }

  pulled = remoteMembers?.length ?? 0;
  await updateSyncState("last_pull_at", nowIso());

  const queue = await fetchLocalQueue(100);
  for (const item of queue) {
    try {
      if (item.entity_type === "attendance") {
        const payload = JSON.parse(item.payload_json) as { member_id: number };
        const remoteId = await fetchRemoteId("member", payload.member_id);

        if (!remoteId) {
          await failQueueItem(item.id, "?? ?? ID ?? ??");
          failed += 1;
          continue;
        }

        const { error } = await supabase.rpc("rpc_record_attendance", {
          p_member_id: remoteId,
        });
        if (error) throw error;
      } else if (item.entity_type === "member") {
        const payload = JSON.parse(item.payload_json) as Record<string, unknown>;
        const base = {
          center_id: centerId,
          name: payload.name,
          phone: payload.phone ?? null,
          member_type: payload.member_type ?? "general",
          parent_name: payload.parent_name ?? null,
          parent_phone: payload.parent_phone ?? null,
          memo: payload.notes ?? null,
        };

        if (item.operation === "insert") {
          const { data, error } = await supabase
            .from("members")
            .insert(base)
            .select("id")
            .single();
          if (error) throw error;
          await mapRemoteId("member", item.entity_local_id, data.id);
        } else if (item.operation === "update") {
          const remoteId = await fetchRemoteId("member", item.entity_local_id);

          if (!remoteId) {
            const { data, error } = await supabase
              .from("members")
              .insert(base)
              .select("id")
              .single();
            if (error) throw error;
            await mapRemoteId("member", item.entity_local_id, data.id);
          } else {
            const { error } = await supabase.from("members").update(base).eq("id", remoteId);
            if (error) throw error;
          }
        } else if (item.operation === "soft_delete") {
          const remoteId = await fetchRemoteId("member", item.entity_local_id);
          if (remoteId) {
            const { error } = await supabase
              .from("members")
              .update({ deleted_at: nowIso(), status: "inactive" })
              .eq("id", remoteId);
            if (error) throw error;
          }
        }
      }

      await completeQueueItem(item.id);
      pushed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failQueueItem(item.id, message);
      failed += 1;
    }
  }

  if (pushed > 0) {
    await updateSyncState("last_push_at", nowIso());
  }

  return { pulled, pushed, failed };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return fetchLocalSyncStatus();
}
