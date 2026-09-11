/**
 * durableWrite — 모든 Supabase 쓰기의 내구성 레이어
 *
 * 보장:
 *  1. 각 작업에 고유 client_mutation_id 발급
 *  2. Supabase 성공 → 레코드 재조회로 저장값 검증
 *  3. Supabase 실패 → 로컬 SQLite 큐에 보존, 자동 재시도
 *  4. 세션 만료(401) → refreshSession() 후 1회 재시도
 *  5. 프로그램 종료/재부팅 후에도 SQLite 큐가 작업 보존
 */

import { getSupabaseClient } from "../lib/supabase/client";
import { isTauriApp } from "../lib/tauri";

// ── UUID v4 (crypto.randomUUID 폴백) ─────────────────────────────────────────
export function generateMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── 세션 갱신 후 재시도 ───────────────────────────────────────────────────────
export async function withSessionRefresh<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 401 / JWT expired → refresh and retry once
    if (/jwt expired|not authenticated|401|refresh/i.test(msg)) {
      const sb = getSupabaseClient();
      if (sb) {
        const { error: refreshErr } = await sb.auth.refreshSession();
        if (!refreshErr) {
          return await fn();
        }
      }
    }
    throw err;
  }
}

// ── 내구성 Supabase 실행기 ────────────────────────────────────────────────────
// Supabase 실패 시 localFallback(SQLite 큐 경로)으로 폴백하고
// 성공 여부를 반환한다.
export interface DurableResult<T> {
  data: T | null;
  usedFallback: boolean;
  error?: string;
}

export async function durableSupabaseWrite<T>(
  supabaseOp: () => Promise<T>,
  localFallback: (() => Promise<T>) | null,
): Promise<DurableResult<T>> {
  try {
    const data = await withSessionRefresh(supabaseOp);
    return { data, usedFallback: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[durableWrite] Supabase 실패, 로컬 큐 폴백:", error);

    if (localFallback && isTauriApp()) {
      try {
        const data = await localFallback();
        return { data, usedFallback: true };
      } catch (fallbackErr) {
        return {
          data: null,
          usedFallback: true,
          error: `Supabase: ${error} / 로컬: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        };
      }
    }

    return { data: null, usedFallback: false, error };
  }
}

// ── 쓰기 후 검증: 저장된 레코드를 재조회해 핵심 값 확인 ──────────────────────
export async function verifyRecord(
  table: string,
  id: string,
  expectedFields: Record<string, unknown>,
): Promise<{ verified: boolean; mismatch?: string }> {
  try {
    const sb = getSupabaseClient();
    if (!sb) return { verified: false, mismatch: "Supabase 미연결" };

    const { data, error } = await sb
      .from(table)
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return { verified: false, mismatch: error?.message ?? "레코드 없음" };

    for (const [key, expected] of Object.entries(expectedFields)) {
      const actual = (data as Record<string, unknown>)[key];
      if (String(actual) !== String(expected)) {
        return {
          verified: false,
          mismatch: `${key}: 예상 "${expected}", 실제 "${actual}"`,
        };
      }
    }
    return { verified: true };
  } catch {
    return { verified: false, mismatch: "검증 조회 실패" };
  }
}
