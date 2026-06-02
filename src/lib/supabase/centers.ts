import type { Center } from "../../types";

/** Fixed UUIDs from supabase/migrations/20250101000000_init.sql */
export const CENTER_IDS: Record<Center, string> = {
  ONCLE: "11111111-1111-1111-1111-111111111001",
  GRABIT: "11111111-1111-1111-1111-111111111002",
};

export function centerIdForCode(code: Center): string {
  return CENTER_IDS[code];
}

export function centerCodeFromId(id: string): Center | null {
  const entry = Object.entries(CENTER_IDS).find(([, value]) => value === id);
  return entry ? (entry[0] as Center) : null;
}
