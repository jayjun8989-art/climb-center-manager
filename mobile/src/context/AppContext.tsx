import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Center, PermissionSet, UserCenterRoleRow } from "../types";
import {
  buildPermissionSet,
  getAccessibleCenters,
  getEffectiveRole,
  isAdminOrOwner,
} from "../lib/permissions";
import { fetchMyRoles } from "../lib/members";
import { getSupabase } from "../lib/supabase";
import { isSupabaseConfigured } from "../lib/config";

type AppContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  rolesLoading: boolean;
  center: Center;
  setCenter: (center: Center) => void;
  roles: UserCenterRoleRow[];
  permissions: PermissionSet;
  accessibleCenters: Center[];
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [center, setCenter] = useState<Center>("ONCLE");
  const [roles, setRoles] = useState<UserCenterRoleRow[]>([]);

  const refreshRoles = useCallback(async () => {
    if (!user) { setRoles([]); return; }
    setRolesLoading(true);
    try {
      const next = await fetchMyRoles(user.id);
      setRoles(next);
    } catch {
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) { setLoading(false); return; }
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession) setRoles([]);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshRoles();
  }, [user, refreshRoles]);

  useEffect(() => {
    if (accessibleCenters.length > 0 && !accessibleCenters.includes(center)) {
      setCenter(accessibleCenters[0]);
    }
  });

  const accessibleCenters = useMemo(() => getAccessibleCenters(roles), [roles]);
  const effectiveRole = useMemo(() => getEffectiveRole(roles, center), [roles, center]);
  const permissions = useMemo(() => buildPermissionSet(effectiveRole), [effectiveRole]);
  const isAdmin = useMemo(() => isAdminOrOwner(roles), [roles]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setRoles([]);
  }, []);

  const value: AppContextValue = {
    session, user, loading, rolesLoading, center, setCenter, roles, permissions,
    accessibleCenters, isAdmin, signIn, signOut, refreshRoles,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
