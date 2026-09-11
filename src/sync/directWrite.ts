import { getSupabaseClient } from "../lib/supabase/client";
import { getSession } from "../lib/supabase/auth";
import { centerIdForCode } from "../lib/supabase/centers";
import { supabaseMembershipTypeFromLegacy, supabasePassType } from "./membershipMapping";
import type { Center, MemberInput, MemberListItem } from "../types";

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
// Member add → Supabase
// ---------------------------------------------------------------------------

export async function supabaseAddMember(
  input: MemberInput,
): Promise<DirectWriteResult & { remoteId?: string }> {
  try {
    const sb = client();
    const now = new Date().toISOString();
    const centerId = centerIdForCode(input.center);
    if (!centerId) return { ok: false, error: `센터 ID 매핑 실패: ${input.center}` };

    const memberType =
      String(input.member_type ?? "").toLowerCase() === "junior" ? "junior" : "regular";

    const { data: memberRow, error: mErr } = await sb
      .from("members")
      .insert({
        center_id: centerId,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        member_type: memberType,
        parent_name: input.parent_name ?? null,
        parent_phone: input.parent_phone ?? null,
        memo: input.notes ?? null,
        member_no: input.member_no ?? null,
        status: "active",
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (mErr || !memberRow) {
      // Unique constraint on (center_id, phone_normalized) — upsert: reuse existing member
      if (mErr?.code === "23505" && mErr.message.includes("idx_members_center_phone")) {
        const phoneNorm = (input.phone ?? "").replace(/\D/g, "") || null;
        const { data: existing } = phoneNorm
          ? await sb
              .from("members")
              .select("id, name, deleted_at")
              .eq("center_id", centerId)
              .eq("phone_normalized", phoneNorm)
              .is("deleted_at", null)
              .maybeSingle()
          : { data: null };

        if (!existing) {
          return { ok: false, error: `회원 등록 실패: ${mErr?.message}` };
        }

        // Reuse existing member: update fields + add new membership
        const existingId = (existing as { id: string }).id;
        await sb.from("members").update({
          name: input.name.trim(),
          address: input.address?.trim() || null,
          member_type: memberType,
          parent_name: input.parent_name ?? null,
          parent_phone: input.parent_phone ?? null,
          memo: input.notes ?? null,
          member_no: input.member_no ?? null,
          updated_at: now,
        }).eq("id", existingId);

        const msType2 = supabaseMembershipTypeFromLegacy(input.membership_type);
        const passType2 = supabasePassType(msType2);
        const totalCount2 = input.total_sessions ?? null;
        const remainingCount2 =
          input.remaining_sessions ?? input.total_sessions ?? (passType2 === "count" ? 0 : null);

        const { error: msErr2 } = await sb.from("memberships").insert({
          member_id: existingId,
          center_id: centerId,
          membership_type: msType2,
          pass_type: passType2,
          start_date: input.start_date,
          end_date: input.end_date ?? null,
          total_count: totalCount2,
          remaining_count: remainingCount2,
          used_count: 0,
          price: input.price ?? null,
          status: "active",
          created_at: now,
          updated_at: now,
        });

        if (msErr2) return { ok: false, error: `회원권 등록 실패: ${msErr2.message}` };
        return { ok: true, remoteId: existingId };
      }
      return { ok: false, error: `회원 등록 실패: ${mErr?.message}` };
    }

    const remoteMemberId = (memberRow as { id: string }).id;

    const msType = supabaseMembershipTypeFromLegacy(input.membership_type);
    const passType = supabasePassType(msType);
    const totalCount = input.total_sessions ?? null;
    const remainingCount =
      input.remaining_sessions ?? input.total_sessions ?? (passType === "count" ? 0 : null);

    const { error: msErr } = await sb.from("memberships").insert({
      member_id: remoteMemberId,
      center_id: centerId,
      membership_type: msType,
      pass_type: passType,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      total_count: totalCount,
      remaining_count: remainingCount,
      used_count: 0,
      price: input.price ?? null,
      status: "active",
      created_at: now,
      updated_at: now,
    });

    if (msErr) return { ok: false, error: `회원권 등록 실패: ${msErr.message}` };

    return { ok: true, remoteId: remoteMemberId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Member edit → Supabase
// ---------------------------------------------------------------------------

export async function supabaseEditMember(
  remoteMemberId: string,
  input: MemberInput,
): Promise<DirectWriteResult> {
  try {
    const sb = client();
    const now = new Date().toISOString();

    const memberType =
      String(input.member_type ?? "").toLowerCase() === "junior" ? "junior" : "regular";

    const { error: mErr } = await sb
      .from("members")
      .update({
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
      .eq("id", remoteMemberId);

    if (mErr) return { ok: false, error: `회원 수정 실패: ${mErr.message}` };

    const msType = supabaseMembershipTypeFromLegacy(input.membership_type);
    const passType = supabasePassType(msType);
    const totalCount = input.total_sessions ?? null;
    const remainingCount =
      input.remaining_sessions ?? input.total_sessions ?? (passType === "count" ? 0 : null);

    const { error: msErr } = await sb
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Synthetic MemberListItem after Supabase-direct write (temporary until next refresh)
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
    member_type: (input.member_type as string) ?? "regular",
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

// ---------------------------------------------------------------------------
// Trigger immediate push of pending sync queue
// ---------------------------------------------------------------------------

export async function triggerImmediatePush(): Promise<void> {
  window.dispatchEvent(new CustomEvent("climb-sync-push-now"));
}
