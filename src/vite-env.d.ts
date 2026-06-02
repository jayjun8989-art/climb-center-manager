/// <reference types="vite/client" />

/**
 * Client-exposed env vars (Vite `envPrefix: ["VITE_", "TAURI_"]`).
 * Supabase: anon public key only — never add service_role here.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
