import { api } from "../api/client";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { centerCodeFromId, resolveCenterIds } from "../lib/supabase/centers";
import type { CenterMappingDiagnosticRow } from "../types";

/**
 * Cross-checks local `members.center` against Supabase `members.center_id`
 * for every locally-synced member (has a remote_id). Members with a pending
 * unsynced insert are excluded — they haven't been verified against the
 * server yet (v1.0.33 center mapping diagnostics).
 */
export async function fetchCenterMappingDiagnostics(): Promise<CenterMappingDiagnosticRow[]> {
  const localMembers = await api.fetchCenterMappingMembers();
  const verifiable = localMembers.filter((m) => !m.has_pending_insert);
  if (verifiable.length === 0) {
    return [];
  }

  if (!isSupabaseConfigured()) {
    return verifiable.map((m) => ({
      local_id: m.local_id,
      name: m.name,
      remote_id: m.remote_id,
      local_center: m.center,
      supabase_center_id: null,
      supabase_center_code: null,
      display_center: m.center,
      status: "확인 필요" as const,
    }));
  }

  await resolveCenterIds().catch(() => undefined);

  const supabase = getSupabaseClient();
  const remoteIds = verifiable.map((m) => m.remote_id);

  const remoteCenterById = new Map<string, string>();
  if (supabase) {
    const chunkSize = 200;
    for (let i = 0; i < remoteIds.length; i += chunkSize) {
      const chunk = remoteIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("members")
        .select("id, center_id")
        .in("id", chunk);
      if (error) {
        console.warn("[centerMappingDiagnostics] Supabase 조회 실패:", error.message);
        continue;
      }
      for (const row of data ?? []) {
        remoteCenterById.set(String(row.id), String(row.center_id));
      }
    }
  }

  return verifiable.map((m) => {
    const supabaseCenterId = remoteCenterById.get(m.remote_id) ?? null;
    const supabaseCenterCode = supabaseCenterId ? centerCodeFromId(supabaseCenterId) : null;

    let status: CenterMappingDiagnosticRow["status"];
    if (!supabaseCenterId) {
      status = "확인 필요";
    } else if (!supabaseCenterCode) {
      status = "확인 필요";
    } else if (supabaseCenterCode === m.center) {
      status = "정상";
    } else {
      status = "불일치";
    }

    return {
      local_id: m.local_id,
      name: m.name,
      remote_id: m.remote_id,
      local_center: m.center,
      supabase_center_id: supabaseCenterId,
      supabase_center_code: supabaseCenterCode,
      display_center: m.center,
      status,
    };
  });
}

/** Builds repair corrections for mismatched rows (LOCAL center -> Supabase center code). */
export function buildCenterMappingCorrections(rows: CenterMappingDiagnosticRow[]) {
  return rows
    .filter((row) => row.status === "불일치" && row.supabase_center_code)
    .map((row) => ({
      local_id: row.local_id,
      correct_center: row.supabase_center_code as string,
    }));
}
