import type { Center, CenterRole, PermissionSet, UserCenterRoleRow } from "../types";

export const PERMISSION_DENIED = "??? ????";

export function getEffectiveRole(roles: UserCenterRoleRow[], center: Center): CenterRole | null {
  if (roles.some((r) => r.role === "owner")) return "owner";
  if (roles.some((r) => r.role === "admin")) return "admin";
  return roles.find((r) => r.center === center)?.role ?? null;
}

export function getAccessibleCenters(roles: UserCenterRoleRow[]): Center[] {
  const all: Center[] = ["ONCLE", "GRABIT"];
  if (roles.some((r) => r.role === "owner" || r.role === "admin")) return all;
  const scoped = [
    ...new Set(
      roles
        .filter((r) => r.role === "staff" || r.role === "viewer")
        .map((r) => r.center),
    ),
  ];
  return all.filter((center) => scoped.includes(center));
}

export function buildPermissionSet(role: CenterRole | null): PermissionSet {
  return {
    role,
    hasCenterAccess: role !== null,
    canCheckAttendance: role === "owner" || role === "admin" || role === "staff",
    canCreateMember: role === "owner" || role === "admin" || role === "staff",
    canEditMember: role === "owner" || role === "admin" || role === "staff",
    canCancelAttendance: role === "owner" || role === "admin",
    canDeleteMember: role === "owner" || role === "admin",
    denyReason: PERMISSION_DENIED,
  };
}
