import { getSupabaseClient } from "../lib/supabase/client";
import { getSession } from "../lib/supabase/auth";
import { centerIdForCode } from "../lib/supabase/centers";
import type { Center } from "../types";

export interface DirectWriteResult {
  ok: boolean;
  error?: string;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new Error("Supabase 미연결");
  return sb;
}

// ---------------------------------------------------------------------------
// Attendance cancel → Supabase
// ---------------------------------------------------------------------------

export async function supabaseCancelAttendance(
  remoteAttendanceId: string,
  remoteMembershipId: string | null,
  isCountType: boolean,
  currentRemainingCount: number | null,
): Promise<DirectWriteResult> {
  try {
    const sb = client();
    const now = new Date().toISOString();

    const { error: attErr } = await sb
      .from("attendance_logs")
      .update({ canceled_at: now })
      .eq("id", remoteAttendanceId);

    if (attErr) return { ok: false, error: `출석 취소 서버 반영 실패: ${attErr.message}` };

    if (isCountType && remoteMembershipId && currentRemainingCount != null) {
      const { error: msErr } = await sb
        .from("memberships")
        .update({
          remaining_count: currentRemainingCount,
          remaining_sessions: currentRemainingCount,
          status: "active",
          updated_at: now,
        })
        .eq("id", remoteMembershipId);

      if (msErr) return { ok: false, error: `잔여 횟수 복구 서버 반영 실패: ${msErr.message}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Membership pause → Supabase
// ---------------------------------------------------------------------------

export async function supabasePauseMembership(
  remoteMembershipId: string,
  remoteMemberId: string,
  center: Center,
  remainingDays: number,
  reason: string,
): Promise<DirectWriteResult> {
  try {
    const sb = client();
    const session = await getSession();
    const now = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const centerId = centerIdForCode(center);

    const { error: msErr } = await sb
      .from("memberships")
      .update({ status: "paused", updated_at: now })
      .eq("id", remoteMembershipId);

    if (msErr) return { ok: false, error: `회원권 정지 서버 반영 실패: ${msErr.message}` };

    const { error: mErr } = await sb
      .from("members")
      .update({ status: "paused", updated_at: now })
      .eq("id", remoteMemberId);

    if (mErr) return { ok: false, error: `회원 정지 상태 서버 반영 실패: ${mErr.message}` };

    const { error: plErr } = await sb
      .from("pause_logs")
      .insert({
        member_id: remoteMemberId,
        membership_id: remoteMembershipId,
        center_id: centerId,
        pause_start_date: today,
        remaining_days_at_pause: remainingDays,
        reason: reason || null,
        created_by: session?.user?.id ?? null,
        created_at: now,
        updated_at: now,
      });

    if (plErr) return { ok: false, error: `정지 기록 서버 반영 실패: ${plErr.message}` };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Membership resume → Supabase
// ---------------------------------------------------------------------------

export async function supabaseResumeMembership(
  remoteMembershipId: string,
  remoteMemberId: string,
  newEndDate: string,
): Promise<DirectWriteResult> {
  try {
    const sb = client();
    const now = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const { error: msErr } = await sb
      .from("memberships")
      .update({ status: "active", end_date: newEndDate, updated_at: now })
      .eq("id", remoteMembershipId);

    if (msErr) return { ok: false, error: `회원권 해제 서버 반영 실패: ${msErr.message}` };

    const { error: mErr } = await sb
      .from("members")
      .update({ status: "active", updated_at: now })
      .eq("id", remoteMemberId);

    if (mErr) return { ok: false, error: `회원 상태 해제 서버 반영 실패: ${mErr.message}` };

    const { error: plErr } = await sb
      .from("pause_logs")
      .update({ pause_end_date: today, updated_at: now })
      .eq("membership_id", remoteMembershipId)
      .is("pause_end_date", null);

    if (plErr) return { ok: false, error: `정지 해제 기록 서버 반영 실패: ${plErr.message}` };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Trigger immediate push of pending sync queue
// ---------------------------------------------------------------------------

export async function triggerImmediatePush(): Promise<void> {
  window.dispatchEvent(new CustomEvent("climb-sync-push-now"));
}
