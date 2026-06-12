import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isTauriApp } from "../lib/tauri";
import { getSession, isAuthAvailable, signInWithPassword, signOut } from "../lib/supabase/auth";
import { clearPersistedSupabaseAuth, getSupabaseClient, resetSupabaseClient } from "../lib/supabase/client";

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
    let cancelled = false;

    async function bootstrapAuth() {
      if (!available) {
        setLoading(false);
        return;
      }

      if (isTauriApp()) {
        clearPersistedSupabaseAuth();
        resetSupabaseClient();
      }

      if (!cancelled) {
        await refresh();
      }
    }

    void bootstrapAuth();

    const supabase = getSupabaseClient();
    if (!supabase) {
      return () => {
        cancelled = true;
      };
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [available, refresh]);

  const login = useCallback(async (loginId: string, password: string) => {
    const data = await signInWithPassword(loginId, password);
    setSession(data.session);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    if (isTauriApp()) {
      clearPersistedSupabaseAuth();
    }
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
