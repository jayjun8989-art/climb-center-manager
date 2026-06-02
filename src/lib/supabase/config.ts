/** Decode JWT payload role without verifying signature (shape check only). */
function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(normalized)) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

/** Reject service_role keys and other non-anon JWT roles in client config. */
export function isClientSafeSupabaseKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed === "your-anon-key") return false;
  if (/service[_-]?role/i.test(trimmed)) return false;

  const role = decodeJwtRole(trimmed);
  if (role && role !== "anon") return false;

  return true;
}

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(
    url &&
      key &&
      !url.includes("your-project-id") &&
      isClientSafeSupabaseKey(key),
  );
}

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

  if (anonKey && !isClientSafeSupabaseKey(anonKey)) {
    throw new Error(
      "Supabase ?? ?????? ??? ? ????. anon public key? .env? ????. service_role? ?? ???? ???.",
    );
  }

  return { url, anonKey };
}
