import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isTauriApp } from "../tauri";
import { getSupabaseConfig, isSupabaseConfigured } from "./config";

let client: SupabaseClient | null = null;
let clientIsDesktop: boolean | undefined;

export function clearPersistedSupabaseAuth() {
  if (typeof localStorage === "undefined") return;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
      keys.push(key);
    }
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;

  const desktopApp = isTauriApp();
  if (client && clientIsDesktop !== desktopApp) {
    client = null;
  }

  if (!client) {
    const { url, anonKey } = getSupabaseConfig();
    clientIsDesktop = desktopApp;
    client = createClient(url, anonKey, {
      auth: {
        persistSession: !desktopApp,
        autoRefreshToken: !desktopApp,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export function resetSupabaseClient() {
  client = null;
  clientIsDesktop = undefined;
}
