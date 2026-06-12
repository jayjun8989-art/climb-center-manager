import type { Center, CenterRole, UserCenterRoleRow } from "../types";
import { getEffectiveRole } from "../lib/permissions";

export interface SyncErrorContext {
  loginEmail: string | null;
  roles: UserCenterRoleRow[] | null;
  rolesLoaded: boolean;
  rolesError: string | null;
}

export function requiredRoleForMemberWrite(): CenterRole {
  return "staff";
}

export function resolveCurrentRoleLabel(
  ctx: SyncErrorContext,
  center: Center | null,
): string {
  if (!ctx.rolesLoaded) {
    return "?? ?";
  }
  if (ctx.rolesError || ctx.roles === null) {
    return "?? ?? ??";
  }
  if (!center) {
    const highest = ctx.roles.reduce<CenterRole | null>((best, row) => {
      const rank = roleOrder(row.role);
      if (!best || rank > roleOrder(best)) return row.role;
      return best;
    }, null);
    return highest ?? "?? ?? ??";
  }
  const role = getEffectiveRole(ctx.roles, center);
  return role ?? "?? ?? ??";
}

function roleOrder(role: CenterRole): number {
  switch (role) {
    case "owner":
      return 4;
    case "admin":
      return 3;
    case "staff":
      return 2;
    case "viewer":
      return 1;
    default:
      return 0;
  }
}

export function formatAccessDeniedMessage(
  ctx: SyncErrorContext,
  center: Center | null,
  requiredRole: CenterRole = requiredRoleForMemberWrite(),
): string {
  const email = ctx.loginEmail?.trim() || "(??? ??)";
  const centerCode = center ?? "(?? ??)";
  const current = resolveCurrentRoleLabel(ctx, center);
  return `?? ?? ??? ???? � ???: ${email} � ??: ${centerCode} � ??: ${requiredRole} � ??: ${current}`;
}

export function isAccessDeniedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes("?? ?? ??") ||
    lower.includes("row-level security") ||
    lower.includes("access denied") ||
    message.includes("42501")
  );
}
