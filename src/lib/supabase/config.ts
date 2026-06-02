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

/** Reject server keys; allow anon JWT or Supabase publishable keys. */
export function isClientSafeSupabaseKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed === "your-anon-key") return false;
  if (/service[_-]?role/i.test(trimmed)) return false;
  if (trimmed.startsWith("sb_secret_")) return false;
  if (trimmed.startsWith("sb_publishable_")) return true;

  const role = decodeJwtRole(trimmed);
  if (role && role !== "anon") return false;

  return trimmed.startsWith("eyJ");
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
      "Supabase 키가 클라이언트에 사용할 수 없습니다. publishable/anon key만 .env에 넣으세요.",
    );
  }

  return { url, anonKey };
}
