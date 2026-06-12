/** Accounts allowed to create/open Excel member roster files. */
export const ADMIN_EXPORT_EMAILS = ["grabon@oncle.local"] as const;

export function normalizeLoginEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Excel export/open/auto-save � independent from member edit or attendance permissions. */
export function canExportRoster(loginEmail: string | null | undefined): boolean {
  const normalized = normalizeLoginEmail(loginEmail);
  if (!normalized) return false;
  return ADMIN_EXPORT_EMAILS.some((allowed) => allowed.toLowerCase() === normalized);
}
