import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSession, isAuthAvailable, signInWithPassword, signOut } from "../lib/supabase/auth";
import { getSupabaseClient } from "../lib/supabase/client";

export function useSupabaseAuth() {
  const [available] = useState(isAuthAvailable());
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(available);

  const refresh = useCallback(async () => {
    if (!available) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getSession();
      setSession(next);
      setUser(next?.user ?? null);
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    await signInWithPassword(email, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await signOut();
    setSession(null);
    setUser(null);
  }, []);

  return {
    available,
    session,
    user,
    loading,
    isAuthenticated: Boolean(session),
    login,
    logout,
    refresh,
  };
}
