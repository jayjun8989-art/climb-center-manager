import type { Center } from "../../types";
import { getSupabaseClient } from "./client";
import { isSupabaseConfigured } from "./config";

/** Fallback UUIDs from supabase/migrations/20250101000000_init.sql */
export const CENTER_IDS: Record<Center, string> = {
  ONCLE: "11111111-1111-1111-1111-111111111001",
  GRABIT: "11111111-1111-1111-1111-111111111002",
};

let resolvedCenterIds: Partial<Record<Center, string>> | null = null;

/** Load center UUIDs from public.centers; fall back to migration seed IDs. */
export async function resolveCenterIds(): Promise<Record<Center, string>> {
  if (resolvedCenterIds?.ONCLE && resolvedCenterIds?.GRABIT) {
    return resolvedCenterIds as Record<Center, string>;
  }

  const merged: Record<Center, string> = { ...CENTER_IDS };

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from("centers")
        .select("id, code")
        .in("code", ["ONCLE", "GRABIT"]);

      if (error) {
        console.warn("[centers] public.centers 조회 실패, seed UUID 사용:", error.message);
      } else {
        for (const row of data ?? []) {
          const code = row.code as string;
          if (code === "ONCLE" || code === "GRABIT") {
            merged[code as Center] = String(row.id);
          }
        }
      }
    }
  }

  resolvedCenterIds = merged;
  return merged;
}

export async function resolveCenterId(code: Center): Promise<string> {
  const ids = await resolveCenterIds();
  const id = ids[code];
  if (!id) {
    throw new Error(`알 수 없는 센터 코드: ${code}`);
  }
  return id;
}

/** Sync helper — uses cached/fallback IDs without a network round-trip. */
export function centerIdForCode(code: Center): string {
  return resolvedCenterIds?.[code] ?? CENTER_IDS[code];
}

export function centerCodeFromId(id: string): Center | null {
  const ids = resolvedCenterIds ?? CENTER_IDS;
  const entry = Object.entries(ids).find(([, value]) => value === id);
  return entry ? (entry[0] as Center) : null;
}

export function resetCenterIdCache() {
  resolvedCenterIds = null;
}

/** Resolve center UUIDs for a given set of allowed center codes (e.g. the logged-in account's accessible centers). */
export async function resolveCenterIdsForCenters(centers: Center[]): Promise<string[]> {
  const ids = await resolveCenterIds().catch(() => CENTER_IDS);
  return centers.map((code) => ids[code]).filter((id): id is string => Boolean(id));
}
