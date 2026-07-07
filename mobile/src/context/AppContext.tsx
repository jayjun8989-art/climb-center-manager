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
import { router } from "expo-router";
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
  const [center, setCenter] = useState<Center>("ONCLE");
  const [roles, setRoles] = useState<UserCenterRoleRow[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  const refreshRoles = useCallback(async () => {
    if (!user) { setRoles([]); setRolesLoaded(true); return; }
    const next = await fetchMyRoles(user.id);
    setRoles(next);
    setRolesLoaded(true);
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
      if (!nextSession) { setRoles([]); setRolesLoaded(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshRoles().catch(() => { setRoles([]); setRolesLoaded(true); });
  }, [user, refreshRoles]);

  // Navigate after roles are loaded
  useEffect(() => {
    if (!rolesLoaded || !session) return;
    if (isAdminOrOwner(roles)) {
      router.replace("/(admin)");
    } else if (roles.length > 0) {
      router.replace("/(app)/attendance");
    }
  }, [rolesLoaded, roles, session]);

  const accessibleCenters = useMemo(() => getAccessibleCenters(roles), [roles]);
  const effectiveRole = useMemo(() => getEffectiveRole(roles, center), [roles, center]);
  const permissions = useMemo(() => buildPermissionSet(effectiveRole), [effectiveRole]);
  const isAdmin = useMemo(() => isAdminOrOwner(roles), [roles]);

  useEffect(() => {
    if (accessibleCenters.length > 0 && !accessibleCenters.includes(center)) {
      setCenter(accessibleCenters[0]);
    }
  }, [accessibleCenters, center]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setRoles([]);
    setRolesLoaded(false);
  }, []);

  const value: AppContextValue = {
    session, user, loading, center, setCenter, roles, permissions,
    accessibleCenters, isAdmin, signIn, signOut, refreshRoles,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider가 없습니다.");
  return ctx;
}
