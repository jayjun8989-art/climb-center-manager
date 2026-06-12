import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  buildPermissionSet,
  formatRoleDisplayLabel,
  getAccessibleCenters,
  getEffectiveRole,
} from "../lib/permissions";
import { fetchMyCenterRoles } from "../lib/supabase/roles";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { Center, PermissionSet, UserCenterRoleRow } from "../types";

export function useCenterPermissions(
  center: Center,
  user: User | null,
  isAuthenticated: boolean,
) {
  const [roles, setRoles] = useState<UserCenterRoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enforced = isSupabaseConfigured();

  const refreshRoles = useCallback(async () => {
    if (!enforced || !user || !isAuthenticated) {
      setRoles([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await fetchMyCenterRoles(user.id);
      setRoles(next);
    } catch (err) {
      setRoles([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [enforced, user, isAuthenticated]);

  useEffect(() => {
    void refreshRoles();
  }, [refreshRoles]);

  const effectiveRole = useMemo(() => {
    if (!enforced) return "owner";
    if (!isAuthenticated) return null;
    return getEffectiveRole(roles, center);
  }, [enforced, isAuthenticated, roles, center]);

  const permissions: PermissionSet = useMemo(
    () =>
      buildPermissionSet(enforced ? effectiveRole : "owner", {
        enforced,
        loading,
        loginEmail: user?.email,
      }),
    [effectiveRole, enforced, loading, user?.email],
  );

  const accessibleCenters = useMemo(
    () => getAccessibleCenters(roles, enforced),
    [roles, enforced],
  );

  return {
    roles,
    effectiveRole: enforced && isAuthenticated ? effectiveRole : enforced ? null : null,
    permissions,
    accessibleCenters,
    loading,
    error,
    refreshRoles,
    roleLabel: formatRoleDisplayLabel({
      effectiveRole,
      loading,
      error,
      enforced,
      isAuthenticated,
      rolesCount: roles.length,
    }),
  };
}
