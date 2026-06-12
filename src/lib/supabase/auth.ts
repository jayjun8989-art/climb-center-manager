import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { loginIdFromEmail, resolveLoginEmail } from "./credentials";

export async function signInWithPassword(loginIdOrEmail: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("서버 연결을 확인해주세요.");
  }
  const email = resolveLoginEmail(loginIdOrEmail);
  const normalizedPassword = password.trim();
  if (!email || !normalizedPassword) {
    throw new Error("아이디와 비밀번호를 입력해주세요.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: normalizedPassword,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("invalid login") || error.message.includes("Invalid login credentials")) {
      throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    if (message.includes("database error querying schema")) {
      throw new Error(
        "서버 계정 설정에 문제가 있습니다. Supabase SQL 시드(000010)를 다시 실행한 뒤 시도하세요.",
      );
    }
    throw new Error(error.message);
  }
  if (!data.session || !data.user) {
    throw new Error("로그인에 실패했습니다. 다시 시도해주세요.");
  }
  return data;
}

export async function signOut() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
}

export function isAuthAvailable(): boolean {
  return isSupabaseConfigured();
}

export function getCurrentLoginId(user: User | null): string {
  if (!user) return "";
  const meta = user.user_metadata as { login_id?: string } | undefined;
  if (meta?.login_id) return meta.login_id;
  return loginIdFromEmail(user.email);
}

export async function updateLoginId(newLoginId: string): Promise<void> {
  const trimmed = newLoginId.trim().toLowerCase();
  if (!trimmed || trimmed.includes("@")) {
    throw new Error("아이디 형식이 올바르지 않습니다.");
  }
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");

  const email = resolveLoginEmail(trimmed);
  const { error } = await supabase.auth.updateUser({
    email,
    data: { login_id: trimmed },
  });
  if (error) throw new Error(error.message);
}

export async function updatePassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new Error("비밀번호는 8자 이상이어야 합니다.");
  }
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
