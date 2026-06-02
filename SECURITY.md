# Security checklist (Supabase)

## Client-safe configuration

- `.env` is gitignored; only `.env.example` is tracked.
- The Tauri/React app reads **only**:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` (anon public key)
- `src/lib/supabase/config.ts` rejects JWTs whose `role` is not `anon` and blocks `service_role` strings.

## Never in this repo / app

- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_SERVICE_ROLE_KEY`
- Any `service_role` JWT in frontend or Tauri code

## Never commit runtime data

Git ignores:

- `*.db`, `*.sqlite*`, `climb_center.db`
- `backup_*.json`, `backup_*.db`, `backups/`
- `*.log`, `logs/`

Local paths (outside repo by default):

- DB: `%APPDATA%\com.rabbg.climb-center-manager\climb_center.db`
- Backups: `%APPDATA%\com.rabbg.climb-center-manager\backups\`

## Before connecting production Supabase

1. Copy `.env.example` ? `.env` locally (do not commit `.env`).
2. Paste **anon** key from Dashboard ? API, not service_role.
3. Run `git status` and confirm `.env` is untracked.
4. Apply SQL migrations; assign `user_center_roles` for staff accounts.
