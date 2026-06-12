import type { Center, CenterRole, LoginAccountKind, PermissionSet, UserCenterRoleRow } from "../types";
import { ADMIN_EXPORT_EMAILS, canExportRoster as canExportRosterByEmail } from "./exportPermissions";

export { ADMIN_EXPORT_EMAILS, canExportRosterByEmail as canExportRoster };

export const PERMISSION_DENIED = "권한이 없습니다";
export const REGISTER_DENIED = "이 센터에 회원을 등록할 권한이 없습니다";

export const LOGIN_ACCOUNT_LABELS: Record<LoginAccountKind, string> = {
  owner: "owner",
  staff: "staff",
};

export const CENTER_ROLE_LABELS: Record<CenterRole, string> = {
  owner: "owner",
  admin: "admin",
  staff: "staff",
  viewer: "viewer",
};

export function roleRank(role: CenterRole | null | undefined): number {
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

export function getEffectiveRole(
  roles: UserCenterRoleRow[],
  center: Center,
): CenterRole | null {
  if (roles.some((row) => row.role === "owner")) {
    return "owner";
  }
  if (roles.some((row) => row.role === "admin")) {
    return "admin";
  }
  return roles.find((row) => row.center === center)?.role ?? null;
}

export function hasUnifiedCenterAccess(roles: UserCenterRoleRow[]): boolean {
  return roles.some((row) => row.role === "owner" || row.role === "admin");
}

export function canCreateMember(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canEditMember(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canEditMemberMemo(role: CenterRole | null): boolean {
  return canEditMember(role);
}

export function canDeleteMember(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canPauseMembership(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canResumeMembership(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canManageStaff(role: CenterRole | null): boolean {
  return role === "owner";
}

export function canViewStats(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canCheckAttendance(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canCancelAttendance(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canManageLocker(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canEditMembership(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canOpenSettings(role: CenterRole | null): boolean {
  return hasCenterAccess(role);
}

/** Backup/restore and backup folder — grabon export admin only. */
export function canBackupRestore(loginEmail: string | null | undefined): boolean {
  return canExportRosterByEmail(loginEmail);
}

export function canOpenBackupFolder(loginEmail: string | null | undefined): boolean {
  return canExportRosterByEmail(loginEmail);
}

/** Admin login id/password change — grabon export admin only. */
export function canManageAccount(loginEmail: string | null | undefined): boolean {
  return canExportRosterByEmail(loginEmail);
}

/** App update check — all logged-in accounts with center access. */
export function canCheckUpdate(role: CenterRole | null): boolean {
  return hasCenterAccess(role);
}

export function canSyncPush(role: CenterRole | null): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canSyncPull(role: CenterRole | null): boolean {
  return hasCenterAccess(role);
}

export function canViewRoster(role: CenterRole | null): boolean {
  return role !== null;
}

export function hasCenterAccess(role: CenterRole | null): boolean {
  return role !== null;
}

export function buildPermissionSet(
  role: CenterRole | null,
  options: { enforced: boolean; loading: boolean; loginEmail?: string | null },
): PermissionSet {
  const { enforced, loading, loginEmail = null } = options;

  if (!enforced) {
    return {
      role: "owner",
      loading,
      enforced: false,
      hasCenterAccess: true,
      canCreateMember: true,
      canEditMember: true,
      canEditMemberMemo: true,
      canDeleteMember: true,
      canPauseMembership: true,
      canResumeMembership: true,
      canManageStaff: true,
      canViewStats: true,
      canCheckAttendance: true,
      canCancelAttendance: true,
      canManageLocker: true,
      canEditMembership: true,
      canOpenSettings: true,
      canManageAccount: true,
      canBackupRestore: true,
      canOpenBackupFolder: true,
      canCheckUpdate: true,
      canSyncPush: true,
      canSyncPull: true,
      canViewRoster: true,
      canExportRoster: true,
      denyReason: PERMISSION_DENIED,
    };
  }

  return {
    role,
    loading,
    enforced: true,
    hasCenterAccess: hasCenterAccess(role),
    canCreateMember: canCreateMember(role),
    canEditMember: canEditMember(role),
    canEditMemberMemo: canEditMemberMemo(role),
    canDeleteMember: canDeleteMember(role),
    canPauseMembership: canPauseMembership(role),
    canResumeMembership: canResumeMembership(role),
    canManageStaff: canManageStaff(role),
    canViewStats: canViewStats(role),
    canCheckAttendance: canCheckAttendance(role),
    canCancelAttendance: canCancelAttendance(role),
    canManageLocker: canManageLocker(role),
    canEditMembership: canEditMembership(role),
    canOpenSettings: canOpenSettings(role),
    canManageAccount: canManageAccount(loginEmail),
    canBackupRestore: canBackupRestore(loginEmail),
    canOpenBackupFolder: canOpenBackupFolder(loginEmail),
    canCheckUpdate: canCheckUpdate(role),
    canSyncPush: canSyncPush(role),
    canSyncPull: canSyncPull(role),
    canViewRoster: canViewRoster(role),
    canExportRoster: canExportRosterByEmail(loginEmail),
    denyReason: PERMISSION_DENIED,
  };
}

export function assertPermission(allowed: boolean, message = PERMISSION_DENIED): void {
  if (!allowed) {
    throw new Error(message);
  }
}

export function getAccessibleCenters(
  roles: UserCenterRoleRow[],
  enforced: boolean,
): Center[] {
  const all: Center[] = ["ONCLE", "GRABIT"];
  if (!enforced) return all;
  if (hasUnifiedCenterAccess(roles)) return all;

  const scoped = [
    ...new Set(
      roles
        .filter((row) => row.role === "staff" || row.role === "viewer")
        .map((row) => row.center),
    ),
  ];
  return all.filter((center) => scoped.includes(center));
}

export function resolveLoginAccountKind(roles: UserCenterRoleRow[]): LoginAccountKind | null {
  if (roles.some((row) => row.role === "owner" || row.role === "admin")) {
    return "owner";
  }
  if (roles.some((row) => row.role === "staff" || row.role === "viewer")) {
    return "staff";
  }
  return null;
}

export function validateLoginRoles(roles: UserCenterRoleRow[]): string | null {
  if (resolveLoginAccountKind(roles)) {
    return null;
  }
  return "센터 권한이 없는 계정입니다. 관리자에게 문의하세요.";
}

export function canRegisterMemberInCenter(
  roles: UserCenterRoleRow[],
  center: Center,
  enforced: boolean,
): boolean {
  if (!enforced) return true;
  return canCreateMember(getEffectiveRole(roles, center));
}

export function formatRoleDisplayLabel(options: {
  effectiveRole: CenterRole | null;
  loading: boolean;
  error: string | null;
  enforced: boolean;
  isAuthenticated: boolean;
  rolesCount: number;
}): string | null {
  const { effectiveRole, loading, error, enforced, isAuthenticated, rolesCount } = options;
  if (!enforced || !isAuthenticated) {
    return effectiveRole ? CENTER_ROLE_LABELS[effectiveRole] : null;
  }
  if (loading) return null;
  if (error || rolesCount === 0) return "권한 정보 없음";
  return effectiveRole ? CENTER_ROLE_LABELS[effectiveRole] : "권한 정보 없음";
}

export function loginWelcomeLabel(roles: UserCenterRoleRow[]): string {
  const kind = resolveLoginAccountKind(roles);
  if (kind === "owner") return "owner";
  const centers = getAccessibleCenters(roles, true);
  if (centers.length === 1) return `${centers[0]} · staff`;
  return "staff";
}
