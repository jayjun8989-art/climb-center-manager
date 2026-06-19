import { invoke } from "@tauri-apps/api/core";
import { getSupabaseClient } from "../lib/supabase/client";
import { CENTER_IDS } from "../lib/supabase/centers";
import { supabaseMembershipTypeFromLegacy, supabasePassType } from "./membershipMapping";

// ---------------------------------------------------------------------------
// Types from Rust backend
// ---------------------------------------------------------------------------

export interface SafeSyncMemberQueueItem {
  queueId: number;
  entityLocalId: number;
  memberName: string;
  memberRemoteId: string;
}

export interface SafeSyncMembershipCandidate {
  localId: number;
  memberId: number;
  memberName: string;
  memberPhone: string | null;
  memberCenter: string;
  memberRemoteId: string;
  membershipType: string;
  passType: string | null;
  startDate: string | null;
  endDate: string | null;
  remainingCount: number | null;
  totalCount: number | null;
  status: string;
  price: number | null;
}

export interface SafeSyncAttendanceCandidate {
  localId: number;
  memberId: number;
  membershipId: number | null;
  memberName: string;
  memberCenter: string;
  memberRemoteId: string;
  membershipRemoteId: string | null;
  checkinAt: string;
  attendanceType: string;
  deductedCount: number;
}

export interface SafeSyncDryRun {
  generatedAt: string;
  memberQueueResolve: SafeSyncMemberQueueItem[];
  membershipCandidates: SafeSyncMembershipCandidate[];
  membershipBlockedTest: number;
  attendanceCandidatesMax: number;
  attendanceBlockedTest: number;
  manualReview: number;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface ActionItem {
  localId: number;
  name: string;
  action: "inserted" | "backfilled" | "blocked_test" | "error";
  serverIdUsed?: string;
  error?: string;
}

export interface SafeSyncResult {
  before: {
    membershipsNoRemoteId: number;
    attendanceNoRemoteId: number;
    syncQueuePending: number;
  };
  actions: {
    memberQueueResolved: number;
    membershipInserted: number;
    membershipBackfilled: number;
    membershipBlockedTest: number;
    attendanceInserted: number;
    attendanceBackfilled: number;
    attendanceBlockedTest: number;
    manualReview: number;
    errors: string[];
    membershipDetails: ActionItem[];
    attendanceDetails: ActionItem[];
  };
  after: {
    membershipsNoRemoteId: number;
    attendanceNoRemoteId: number;
    syncQueuePending: number;
  };
  reportFilePath?: string;
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export async function safeSyncDryRun(): Promise<SafeSyncDryRun> {
  return invoke<SafeSyncDryRun>("safe_sync_dry_run_cmd");
}

// ---------------------------------------------------------------------------
// Center code → UUID
// ---------------------------------------------------------------------------

function centerIdFromCode(code: string): string {
  return CENTER_IDS[code as keyof typeof CENTER_IDS] ?? "";
}

// ---------------------------------------------------------------------------
// Execute safe sync
// ---------------------------------------------------------------------------

export async function executeSafeSync(
  dryRun: SafeSyncDryRun,
  onProgress?: (msg: string) => void,
): Promise<SafeSyncResult> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 클라이언트가 없습니다");

  const errors: string[] = [];
  const msDetails: ActionItem[] = [];
  const attDetails: ActionItem[] = [];

  // ── Before counts ──
  const beforeMs = dryRun.membershipCandidates.length + dryRun.membershipBlockedTest;
  const beforeAtt = dryRun.attendanceCandidatesMax + dryRun.attendanceBlockedTest;
  const beforeQueue = dryRun.memberQueueResolve.length;

  // ── Step 1: Resolve member queue ──
  onProgress?.("member queue 정리 중...");
  let memberQueueResolved = 0;
  if (dryRun.memberQueueResolve.length > 0) {
    const queueIds = dryRun.memberQueueResolve.map((q) => q.queueId);
    try {
      const res = await invoke<{ resolvedCount: number; errors: string[] }>(
        "resolve_member_queue_cmd",
        { queueIds },
      );
      memberQueueResolved = res.resolvedCount;
      if (res.errors.length > 0) errors.push(...res.errors);
    } catch (e) {
      errors.push(`member queue resolve 실패: ${e}`);
    }
  }

  // ── Step 2: Process memberships ──
  onProgress?.("회원권 처리 중...");
  let msInserted = 0;
  let msBackfilled = 0;

  for (const ms of dryRun.membershipCandidates) {
    try {
      const centerId = centerIdFromCode(ms.memberCenter);
      if (!centerId) {
        errors.push(`[ms#${ms.localId}] 센터 ID 매핑 실패: ${ms.memberCenter}`);
        msDetails.push({ localId: ms.localId, name: ms.memberName, action: "error", error: "센터 ID 매핑 실패" });
        continue;
      }

      const msType = supabaseMembershipTypeFromLegacy(ms.membershipType);
      const passType = supabasePassType(msType);

      // Server duplicate check
      const { data: existing } = await supabase
        .from("memberships")
        .select("id")
        .eq("member_id", ms.memberRemoteId)
        .eq("membership_type", msType)
        .eq("pass_type", passType)
        .eq("start_date", ms.startDate ?? "")
        .limit(1);

      if (existing && existing.length > 0) {
        // Backfill only
        const serverId = existing[0].id as string;
        await invoke("backfill_membership_remote_id_cmd", { localId: ms.localId, remoteId: serverId });
        msBackfilled++;
        msDetails.push({ localId: ms.localId, name: ms.memberName, action: "backfilled", serverIdUsed: serverId });
      } else {
        // Insert
        const totalCount = ms.totalCount ?? null;
        const remainingCount = ms.remainingCount ?? ms.totalCount ?? (passType === "count" ? 0 : null);
        const usedCount =
          totalCount != null && remainingCount != null
            ? Math.max(0, totalCount - remainingCount)
            : 0;

        const { data: inserted, error: insertErr } = await supabase
          .from("memberships")
          .insert({
            member_id: ms.memberRemoteId,
            center_id: centerId,
            membership_type: msType,
            pass_type: passType,
            start_date: ms.startDate,
            end_date: ms.endDate ?? null,
            total_count: totalCount,
            remaining_count: remainingCount,
            used_count: usedCount,
            price: ms.price ?? null,
            status: ms.status || "active",
          })
          .select("id")
          .single();

        if (insertErr) {
          errors.push(`[ms#${ms.localId}] ${ms.memberName}: insert 실패 — ${insertErr.message}`);
          msDetails.push({ localId: ms.localId, name: ms.memberName, action: "error", error: insertErr.message });
          continue;
        }

        const serverId = inserted.id as string;
        await invoke("backfill_membership_remote_id_cmd", { localId: ms.localId, remoteId: serverId });
        msInserted++;
        msDetails.push({ localId: ms.localId, name: ms.memberName, action: "inserted", serverIdUsed: serverId });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`[ms#${ms.localId}] ${ms.memberName}: ${msg}`);
      msDetails.push({ localId: ms.localId, name: ms.memberName, action: "error", error: msg });
    }
  }

  // ── Step 3: Process attendance (re-fetch candidates after membership backfill) ──
  onProgress?.("출석 처리 중...");
  let attInserted = 0;
  let attBackfilled = 0;

  try {
    const attCandidates = await invoke<SafeSyncAttendanceCandidate[]>("get_attendance_candidates_cmd");

    for (const att of attCandidates) {
      try {
        if (!att.membershipRemoteId) {
          continue;
        }

        // Server duplicate check
        const { data: existing } = await supabase
          .from("attendance_logs")
          .select("id")
          .eq("member_id", att.memberRemoteId)
          .eq("checkin_at", att.checkinAt)
          .limit(1);

        if (existing && existing.length > 0) {
          const serverId = existing[0].id as string;
          await invoke("backfill_attendance_remote_id_cmd", { localId: att.localId, remoteId: serverId });
          attBackfilled++;
          attDetails.push({ localId: att.localId, name: att.memberName, action: "backfilled", serverIdUsed: serverId });
        } else {
          const centerId = centerIdFromCode(att.memberCenter);
          const { data: inserted, error: insertErr } = await supabase
            .from("attendance_logs")
            .insert({
              member_id: att.memberRemoteId,
              membership_id: att.membershipRemoteId,
              center_id: centerId,
              checkin_at: att.checkinAt,
              attendance_type: att.attendanceType || "regular",
              deducted_count: att.deductedCount,
            })
            .select("id")
            .single();

          if (insertErr) {
            errors.push(`[att#${att.localId}] ${att.memberName}: insert 실패 — ${insertErr.message}`);
            attDetails.push({ localId: att.localId, name: att.memberName, action: "error", error: insertErr.message });
            continue;
          }

          const serverId = inserted.id as string;
          await invoke("backfill_attendance_remote_id_cmd", { localId: att.localId, remoteId: serverId });
          attInserted++;
          attDetails.push({ localId: att.localId, name: att.memberName, action: "inserted", serverIdUsed: serverId });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`[att#${att.localId}] ${att.memberName}: ${msg}`);
        attDetails.push({ localId: att.localId, name: att.memberName, action: "error", error: msg });
      }
    }
  } catch (e) {
    errors.push(`출석 후보 조회 실패: ${e}`);
  }

  // ── After counts (re-run dry-run to get fresh counts) ──
  onProgress?.("결과 확인 중...");
  let afterMs = 0;
  let afterAtt = 0;
  let afterQueue = 0;
  try {
    const afterDry = await invoke<SafeSyncDryRun>("safe_sync_dry_run_cmd");
    afterMs = afterDry.membershipCandidates.length + afterDry.membershipBlockedTest;
    afterAtt = afterDry.attendanceCandidatesMax + afterDry.attendanceBlockedTest;
    afterQueue = afterDry.memberQueueResolve.length;
  } catch {
    // ignore
  }

  const result: SafeSyncResult = {
    before: {
      membershipsNoRemoteId: beforeMs,
      attendanceNoRemoteId: beforeAtt,
      syncQueuePending: beforeQueue,
    },
    actions: {
      memberQueueResolved,
      membershipInserted: msInserted,
      membershipBackfilled: msBackfilled,
      membershipBlockedTest: dryRun.membershipBlockedTest,
      attendanceInserted: attInserted,
      attendanceBackfilled: attBackfilled,
      attendanceBlockedTest: dryRun.attendanceBlockedTest,
      manualReview: dryRun.manualReview,
      errors,
      membershipDetails: msDetails,
      attendanceDetails: attDetails,
    },
    after: {
      membershipsNoRemoteId: afterMs,
      attendanceNoRemoteId: afterAtt,
      syncQueuePending: afterQueue,
    },
  };

  // Save report JSON
  try {
    const json = JSON.stringify(result, null, 2);
    const filePath = await invoke<string>("save_safe_sync_report_cmd", { json });
    result.reportFilePath = filePath;
  } catch (e) {
    errors.push(`리포트 저장 실패: ${e}`);
  }

  return result;
}
