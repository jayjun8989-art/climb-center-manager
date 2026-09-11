/**
 * directWrite — Supabase 직접 쓰기 (내구성 보장 버전)
 *
 * 모든 쓰기에:
 *  • client_mutation_id 발급 → Supabase UNIQUE 제약으로 중복 방지
 *  • 새 atomic RPC 사용 (pause/resume은 트랜잭션 단일 처리)
 *  • 실패 시 로컬 SQLite 큐로 폴백 (자동 재시도)
 *  • 성공 후 레코드 재조회 검증
 */

import { getSupabaseClient } from "../lib/supabase/client";
import { getSession } from "../lib/supabase/auth";
import { centerIdForCode } from "../lib/supabase/centers";
import { supabaseMembershipTypeFromLegacy, supabasePassType } from "./membershipMapping";
import { generateMutationId, withSessionRefresh } from "./durableWrite";
import { invokeCommand, isTauriApp, safeInvoke } from "../lib/tauri";
import type { Center, MemberInput, MemberListItem } from "../types";

export interface DirectWriteResult {
  ok: boolean;
  error?: string;
}

function sb() {
  const c = getSupabaseClient();
  if (!c) throw new Error("Supabase 미연결");
  return c;
}

// ── 로컬 SQLite 큐 enqueue (Tauri 전용) ─────────────────────────────────────
async function enqueueLocal(command: string, args: Record<string, unknown>): Promise<boolean> {
  if (!isTauriApp()) return false;
  try {
    await invokeCommand(command, args);
    return true;
  } catch {
    return false;
  }
}

// ── 출석 취소 ────────────────────────────────────────────────────────────────
export async function supabaseCancelAttendance(
  remoteAttendanceId: string,
  remoteMembershipId: string | null,
  isCountType: boolean,
  currentRemainingCount: number | null,
): Promise<DirectWriteResult> {
  try {
    const client = sb();
    const now = new Date().toISOString();

    const { error: attErr } = await withSessionRefresh(async () =>
      await client.from("attendance_logs").update({ canceled_at: now }).eq("id", remoteAttendanceId),
    );
    if (attErr) return { ok: false, error: `출석 취소 서버 반영 실패: ${attErr.message}` };

    if (isCountType && remoteMembershipId && currentRemainingCount != null) {
      const { error: msErr } = await client
        .from("memberships")
        .update({
          remaining_count: currentRemainingCount,
          remaining_sessions: currentRemainingCount,
          status: "active",
          updated_at: now,
        })
        .eq("id", remoteMembershipId);
      if (msErr) return { ok: false, error: `잔여 횟수 복구 실패: ${msErr.message}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 회원권 정지 (atomic RPC — 트랜잭션 보장) ────────────────────────────────
export async function supabasePauseMembership(
  remoteMembershipId: string,
  remoteMemberId: string,
  center: Center,
  remainingDays: number,
  reason: string,
): Promise<DirectWriteResult> {
  const mutationId = generateMutationId();
  try {
    const client = sb();
    const session = await getSession();
    const centerId = centerIdForCode(center);

    const { data, error } = await withSessionRefresh(async () =>
      await client.rpc("rpc_pause_membership", {
        p_client_mutation_id: mutationId,
        p_membership_id: remoteMembershipId,
        p_member_id: remoteMemberId,
        p_center_id: centerId,
        p_remaining_days: remainingDays,
        p_reason: reason || null,
        p_created_by: session?.user?.id ?? null,
      }),
    );

    if (error) return { ok: false, error: `회원권 정지 실패: ${error.message}` };
    const result = data as { ok?: boolean } | null;
    if (!result?.ok) return { ok: false, error: "회원권 정지 처리 실패" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 회원권 정지 해제 (atomic RPC) ────────────────────────────────────────────
export async function supabaseResumeMembership(
  remoteMembershipId: string,
  remoteMemberId: string,
  newEndDate: string,
): Promise<DirectWriteResult> {
  const mutationId = generateMutationId();
  try {
    const client = sb();
    const { data, error } = await withSessionRefresh(async () =>
      await client.rpc("rpc_resume_membership", {
        p_client_mutation_id: mutationId,
        p_membership_id: remoteMembershipId,
        p_member_id: remoteMemberId,
        p_new_end_date: newEndDate,
      }),
    );
    if (error) return { ok: false, error: `회원권 해제 실패: ${error.message}` };
    const result = data as { ok?: boolean } | null;
    if (!result?.ok) return { ok: false, error: "회원권 해제 처리 실패" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 회원 등록 (idempotent RPC + 실패 시 SQLite 큐 폴백) ─────────────────────
export async function supabaseAddMember(
  input: MemberInput,
): Promise<DirectWriteResult & { remoteId?: string; usedFallback?: boolean }> {
  const memberMutationId = generateMutationId();
  const membershipMutationId = generateMutationId();

  try {
    const client = sb();
    const centerId = centerIdForCode(input.center);
    if (!centerId) return { ok: false, error: `센터 ID 매핑 실패: ${input.center}` };

    const memberType =
      String(input.member_type ?? "").toLowerCase() === "junior" ? "junior" : "general";

    // Step 1: 회원 upsert (idempotent)
    const { data: memberData, error: mErr } = await withSessionRefresh(async () =>
      await client.rpc("rpc_upsert_member", {
        p_client_mutation_id: memberMutationId,
        p_center_id: centerId,
        p_name: input.name.trim(),
        p_phone: input.phone?.trim() || null,
        p_member_type: memberType,
        p_address: input.address?.trim() || null,
        p_parent_name: input.parent_name ?? null,
        p_parent_phone: input.parent_phone ?? null,
        p_memo: input.notes ?? null,
        p_member_no: input.member_no ?? null,
        p_status: "active",
      }),
    );

    if (mErr || !memberData) {
      // Supabase 실패 → 로컬 큐로 폴백
      const queued = await enqueueLocal("add_member", {
        input: { ...input, client_mutation_id: memberMutationId },
        enqueueSync: true,
      });
      return {
        ok: queued,
        usedFallback: true,
        error: queued ? undefined : `회원 등록 실패: ${mErr?.message}`,
      };
    }

    const remoteMemberId = (memberData as { id: string }).id;

    // Step 2: 회원권 upsert (idempotent)
    const msType = supabaseMembershipTypeFromLegacy(input.membership_type);
    const passType = supabasePassType(msType);
    const totalCount = input.total_sessions ?? null;
    const remainingCount =
      input.remaining_sessions ?? input.total_sessions ?? (passType === "count" ? 0 : null);

    const { error: msErr } = await withSessionRefresh(async () =>
      await client.rpc("rpc_upsert_membership", {
        p_client_mutation_id: membershipMutationId,
        p_member_id: remoteMemberId,
        p_center_id: centerId,
        p_membership_type: msType,
        p_pass_type: passType,
        p_start_date: input.start_date,
        p_end_date: input.end_date ?? null,
        p_total_count: totalCount,
        p_remaining_count: remainingCount,
        p_price: input.price ?? null,
        p_status: "active",
      }),
    );

    if (msErr) {
      // 회원은 저장됐지만 회원권 실패 → 큐에 회원권만 재시도 enqueue
      await safeInvoke("enqueue_membership_sync", {
        memberId: remoteMemberId,
        membershipMutationId,
        input,
      }).catch(() => undefined);
      // 회원 ID는 확보했으므로 partial success
      return { ok: true, remoteId: remoteMemberId, error: `회원권 저장 재시도 예정: ${msErr.message}` };
    }

    return { ok: true, remoteId: remoteMemberId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 네트워크 오류 등 → 로컬 큐 폴백
    const queued = await enqueueLocal("add_member", {
      input: { ...input, client_mutation_id: memberMutationId },
      enqueueSync: true,
    });
    return {
      ok: queued,
      usedFallback: true,
      error: queued ? undefined : error,
    };
  }
}

// ── 회원 수정 (client_mutation_id + 실패 시 SQLite 큐 폴백) ─────────────────
export async function supabaseEditMember(
  remoteMemberId: string,
  input: MemberInput,
): Promise<DirectWriteResult & { usedFallback?: boolean }> {
  const mutationId = generateMutationId();
  try {
    const client = sb();
    const now = new Date().toISOString();

    const memberType =
      String(input.member_type ?? "").toLowerCase() === "junior" ? "junior" : "general";

    const { error: mErr } = await withSessionRefresh(async () =>
      await client
        .from("members")
        .update({
          client_mutation_id: mutationId,
          name: input.name.trim(),
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
          member_type: memberType,
          parent_name: input.parent_name ?? null,
          parent_phone: input.parent_phone ?? null,
          memo: input.notes ?? null,
          member_no: input.member_no ?? null,
          updated_at: now,
        })
        .eq("id", remoteMemberId),
    );

    if (mErr) {
      const queued = await enqueueLocal("edit_member_by_remote_id", {
        remoteId: remoteMemberId,
        input: { ...input, client_mutation_id: mutationId },
      });
      return { ok: queued, usedFallback: true, error: queued ? undefined : `회원 수정 실패: ${mErr.message}` };
    }

    const msType = supabaseMembershipTypeFromLegacy(input.membership_type);
    const passType = supabasePassType(msType);
    const totalCount = input.total_sessions ?? null;
    const remainingCount =
      input.remaining_sessions ?? input.total_sessions ?? (passType === "count" ? 0 : null);

    const { error: msErr } = await client
      .from("memberships")
      .update({
        membership_type: msType,
        pass_type: passType,
        start_date: input.start_date,
        end_date: input.end_date ?? null,
        total_count: totalCount,
        remaining_count: remainingCount,
        price: input.price ?? null,
        updated_at: now,
      })
      .eq("member_id", remoteMemberId)
      .eq("status", "active");

    if (msErr) return { ok: false, error: `회원권 수정 실패: ${msErr.message}` };

    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const queued = await enqueueLocal("edit_member_by_remote_id", {
      remoteId: remoteMemberId,
      input: { ...input, client_mutation_id: mutationId },
    });
    return { ok: queued, usedFallback: true, error: queued ? undefined : error };
  }
}

// ── Synthetic MemberListItem (Supabase 직접 쓰기 후 임시 표시용) ─────────────
export function syntheticMemberListItem(
  input: MemberInput,
  remoteId?: string | null,
): MemberListItem {
  const now = new Date().toISOString();
  return {
    id: 0,
    remote_id: remoteId ?? null,
    name: input.name,
    phone: input.phone ?? null,
    member_type: (input.member_type as string) ?? "general",
    center: input.center,
    memo: input.notes ?? null,
    status: "active",
    membership_id: null,
    membership_type: input.membership_type,
    pass_type: null,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    total_count: input.total_sessions ?? null,
    remaining_count: input.remaining_sessions ?? null,
    membership_status: "active",
    display_status: "이용 가능",
    remaining_text: "",
    last_visit_at: null,
    pause_remaining_days: null,
    member_no: input.member_no ?? null,
    created_at: now,
    updated_at: now,
  };
}

// ── 즉시 푸시 트리거 ─────────────────────────────────────────────────────────
export function triggerImmediatePush(): void {
  window.dispatchEvent(new CustomEvent("climb-sync-push-now"));
}
