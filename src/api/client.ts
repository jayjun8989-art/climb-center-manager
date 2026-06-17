import type {
  AttendanceMismatchDiagnostic,
  AttendanceLog,
  BackupInfo,
  BackupResult,
  Center,
  DashboardStats,
  MemberDetail,
  MemberGroupFilter,
  MemberInput,
  MemberListItem,
  MemberStatusFilter,
  MutationResult,
  PaginatedMembers,
  PauseLog,
  Payment,
  ReportInfo,
  SelfCheckinMember,
  StorageInfo,
  SyncDiagnostics,
  SyncQueueItem,
  SyncStatus,
  DuplicateMemberCandidateGroup,
  LocalDuplicateCleanupSummary,
  CenterMappingMember,
  CenterMappingCorrection,
  CenterMappingRepairResult,
  UploadVerificationReport,
  ServerMatchReport,
  ServerCenterConsistency,
} from "../types";
import { uploadLocalMemberNow, matchServerMembersForCenter, getServerCenterConsistency } from "../sync/engine";
import {
  defaultBackupInfo,
  defaultDashboardStats,
  defaultStorageInfo,
  defaultSyncStatus,
  fallbackAddMember,
  fallbackEditMember,
  fallbackGetMembers,
  fallbackRecordAttendance,
  fallbackRemoveMember,
  fallbackSyncQueue,
} from "../lib/storageFallback";
import { invokeCommand, isTauriApp, safeInvoke } from "../lib/tauri";
import { logAppError } from "../utils/errors";
import { resolveMemberLocalId } from "../utils/member";

export { isTauriApp } from "../lib/tauri";

async function readCommand<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => T,
): Promise<T> {
  if (!isTauriApp()) {
    return fallback();
  }

  const result = await safeInvoke<T>(command, args);
  return result ?? fallback();
}

async function writeCommand<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => T,
): Promise<T> {
  if (!isTauriApp()) {
    return fallback();
  }

  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    throw new Error(logAppError(`Tauri ${command}`, error));
  }
}

async function actionCommand(
  command: string,
  args?: Record<string, unknown>,
  fallback?: () => void,
): Promise<void> {
  if (!isTauriApp()) {
    fallback?.();
    return;
  }

  try {
    await invokeCommand<void>(command, args);
  } catch (error) {
    throw new Error(logAppError(`Tauri ${command}`, error));
  }
}

export const api = {
  getMembers(params: {
    center: Center;
    search?: string;
    memberGroup?: MemberGroupFilter;
    statusFilter?: MemberStatusFilter;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedMembers> {
    return readCommand(
      "get_members",
      {
        center: params.center,
        search: params.search ?? "",
        member_group: params.memberGroup ?? "all",
        status_filter: params.statusFilter ?? "all",
        page: params.page ?? 1,
        page_size: params.pageSize ?? 50,
      },
      () => fallbackGetMembers(params),
    );
  },

  getMemberDetail(id: number): Promise<MemberDetail> {
    return writeCommand("get_member_by_id", { id }, () => {
      throw new Error("브라우저 미리보기에서는 회원 상세를 지원하지 않습니다.");
    });
  },

  addMember(
    input: MemberInput,
    options?: { enqueueSync?: boolean },
  ): Promise<MutationResult<MemberListItem>> {
    return writeCommand(
      "add_member",
      { input, enqueue_sync: options?.enqueueSync ?? true },
      () => fallbackAddMember(input),
    );
  },

  editMember(id: number, input: MemberInput): Promise<MutationResult<MemberListItem>> {
    return writeCommand("edit_member", { id, input }, () => fallbackEditMember(id, input));
  },

  removeMember(id: number): Promise<MutationResult<boolean>> {
    return writeCommand("remove_member", { id }, () => fallbackRemoveMember(id));
  },

  hasAttendanceToday(
    member: MemberListItem | { id?: number | null; member_id?: number | null },
  ): Promise<boolean> {
    const memberId = resolveMemberLocalId(member);
    return readCommand("has_attendance_today_cmd", { memberId }, () => false);
  },

  hasAttendanceOnDate(
    member: MemberListItem | { id?: number | null; member_id?: number | null },
    date: string,
  ): Promise<boolean> {
    const memberId = resolveMemberLocalId(member);
    return readCommand("has_attendance_on_date_cmd", { memberId, date }, () => false);
  },

  recordAttendance(
    member: MemberListItem | { id?: number | null; member_id?: number | null; membership_id?: number | null },
    options?: { membershipId?: number | null; forceDuplicate?: boolean; checkinDate?: string | null; editor?: string | null },
  ): Promise<MutationResult<MemberListItem>> {
    const memberId = resolveMemberLocalId(member);
    const membershipId = options?.membershipId ?? member.membership_id ?? null;
    return writeCommand(
      "record_attendance",
      {
        memberId,
        membershipId,
        forceDuplicate: options?.forceDuplicate ?? false,
        checkinDate: options?.checkinDate ?? null,
        editor: options?.editor ?? null,
      },
      () => fallbackRecordAttendance(memberId),
    );
  },

  getNextMemberNo(center: Center): Promise<number> {
    return readCommand<number>("get_next_member_no", { center }, () => 1001);
  },

  lookupMemberByNumber(center: Center, memberNumber: number): Promise<SelfCheckinMember | null> {
    return readCommand<SelfCheckinMember | null>(
      "lookup_member_by_number",
      { center, memberNumber },
      () => null,
    );
  },

  cancelAttendance(
    attendanceId: number,
    reason?: string,
    editor?: string | null,
  ): Promise<MutationResult<MemberListItem>> {
    return writeCommand("cancel_attendance_cmd", { attendanceId, reason: reason ?? null, editor: editor ?? null }, () => {
      throw new Error("출석 취소는 데스크톱 앱에서만 지원합니다.");
    });
  },

  listLockers(center: Center): Promise<import("../types").LockerListItem[]> {
    return readCommand("list_lockers", { center }, () => []);
  },

  fetchAttendance(
    member: MemberListItem | { id?: number | null; member_id?: number | null },
    limit = 20,
  ): Promise<AttendanceLog[]> {
    const memberId = resolveMemberLocalId(member);
    return readCommand("fetch_attendance", { memberId, limit }, () => []);
  },

  fetchPayments(
    member: MemberListItem | { id?: number | null; member_id?: number | null },
  ): Promise<Payment[]> {
    const memberId = resolveMemberLocalId(member);
    return readCommand("fetch_payments", { memberId }, () => []);
  },

  fetchPauseLogs(
    member: MemberListItem | { id?: number | null; member_id?: number | null },
  ): Promise<PauseLog[]> {
    const memberId = resolveMemberLocalId(member);
    return readCommand("fetch_pause_logs", { memberId }, () => []);
  },

  pauseMembership(membershipId: number, reason?: string): Promise<MemberListItem> {
    return writeCommand(
      "pause_membership_command",
      { membershipId: membershipId, reason: reason ?? null },
      () => {
        throw new Error("브라우저 미리보기에서는 정지 기능을 지원하지 않습니다.");
      },
    );
  },

  resumeMembership(membershipId: number): Promise<MemberListItem> {
    return writeCommand("resume_membership_command", { membershipId }, () => {
      throw new Error("브라우저 미리보기에서는 해제 기능을 지원하지 않습니다.");
    });
  },

  fetchDashboardStats(center: Center): Promise<DashboardStats> {
    return readCommand("fetch_dashboard_stats", { center }, () => {
      const members = fallbackGetMembers({ center, page: 1, pageSize: 10000 }).members;
      return defaultDashboardStats(members);
    });
  },

  fetchExpiringMembers(center: Center, days = 7): Promise<MemberListItem[]> {
    return readCommand("fetch_expiring_members", { center, days }, () => []);
  },

  manualBackup(): Promise<BackupResult> {
    return writeCommand("manual_backup", {}, () => {
      throw new Error("브라우저 미리보기에서는 백업을 지원하지 않습니다.");
    });
  },

  fetchBackupInfo(): Promise<BackupInfo> {
    return readCommand("fetch_backup_info", {}, defaultBackupInfo);
  },

  fetchStorageInfo(): Promise<StorageInfo> {
    return readCommand("fetch_storage_info", {}, defaultStorageInfo);
  },

  restoreBackup(path: string): Promise<void> {
    return actionCommand("restore_backup_file", { path });
  },

  openBackupFolder(): Promise<void> {
    return actionCommand("open_backup_folder");
  },

  openDataFolder(): Promise<void> {
    return actionCommand("open_data_folder");
  },

  fetchReportInfo(): Promise<ReportInfo> {
    return readCommand("fetch_report_info", {}, () => ({
      reports_dir: "",
      last_report_date: null,
      last_report_at: null,
      last_report_path: null,
    }));
  },

  openReportsFolder(): Promise<void> {
    return actionCommand("open_reports_folder");
  },

  openReportsArchiveFolder(): Promise<void> {
    return actionCommand("open_reports_archive_folder");
  },

  openReportFile(relativePath: string): Promise<void> {
    return actionCommand("open_report_file", { relativePath });
  },

  fetchSyncStatus(): Promise<SyncStatus> {
    return readCommand("fetch_sync_status", {}, defaultSyncStatus);
  },

  fetchSyncQueue(limit = 50): Promise<SyncQueueItem[]> {
    return readCommand("fetch_sync_queue", { limit }, () => fallbackSyncQueue(limit));
  },

  fetchSyncDiagnostics(): Promise<SyncDiagnostics> {
    return readCommand("get_sync_diagnostics", {}, () => ({
      queue_pending: 0,
      queue_failed: 0,
      queue_blocked: 0,
      members_without_remote_id: 0,
      memberships_without_remote_id: 0,
      local_only_members: 0,
      synced_members: 0,
      center_mapping_failed: 0,
      hidden_locally_count: 0,
      local_duplicate_count: 0,
      problem_members: [],
    }));
  },

  findDuplicateMembers(center: Center): Promise<DuplicateMemberCandidateGroup[]> {
    return readCommand("find_duplicate_members", { center }, () => []);
  },

  fetchCenterMappingMembers(): Promise<CenterMappingMember[]> {
    return readCommand("get_center_mapping_members", {}, () => []);
  },

  repairCenterMapping(corrections: CenterMappingCorrection[]): Promise<CenterMappingRepairResult> {
    return writeCommand(
      "repair_center_mapping_cmd",
      { corrections },
      () => ({ repaired: 0, skipped: 0 }),
    );
  },

  cleanupLocalDuplicates(center: Center): Promise<LocalDuplicateCleanupSummary> {
    return writeCommand(
      "cleanup_local_duplicates_cmd",
      { center },
      () => {
        throw new Error("브라우저 미리보기에서는 로컬 중복 정리를 지원하지 않습니다.");
      },
    );
  },

  getUploadVerificationReport(): Promise<UploadVerificationReport> {
    return readCommand("get_upload_verification_report_cmd", {}, () => {
      throw new Error("브라우저 미리보기에서는 지원하지 않습니다.");
    });
  },

  getAttendanceMismatchDiagnostic(memberId: number): Promise<AttendanceMismatchDiagnostic> {
    return readCommand("get_attendance_mismatch_diagnostic_cmd", { memberId }, () => {
      throw new Error("브라우저 미리보기에서는 지원하지 않습니다.");
    });
  },

  correctMemberRemainingCount(memberId: number): Promise<MutationResult<MemberListItem>> {
    return writeCommand("correct_member_remaining_count_cmd", { memberId }, () => {
      throw new Error("브라우저 미리보기에서는 지원하지 않습니다.");
    });
  },

  repairStatusMismatch(): Promise<number> {
    return writeCommand("repair_status_mismatch_cmd", {}, () => 0);
  },

  requeueMemberForUpload(memberId: number): Promise<number> {
    return writeCommand("requeue_member_for_upload_cmd", { member_id: memberId }, () => 0);
  },

  excludeMemberFromUpload(memberId: number): Promise<number> {
    return writeCommand("exclude_member_from_upload_cmd", { member_id: memberId }, () => 0);
  },

  setMemberHiddenLocally(memberId: number): Promise<void> {
    return writeCommand("set_member_hidden_locally_cmd", { member_id: memberId }, () => undefined as void);
  },

  uploadLocalMember(memberId: number): Promise<{ ok: boolean; message: string }> {
    return uploadLocalMemberNow(memberId);
  },

  linkMemberRemoteId(localId: number, remoteId: string): Promise<void> {
    return actionCommand("link_member_remote_id_cmd", { local_id: localId, remote_id: remoteId });
  },

  matchServerMembers(center: Center): Promise<ServerMatchReport> {
    return matchServerMembersForCenter(center);
  },

  getServerCenterConsistency(center: Center): Promise<ServerCenterConsistency> {
    return getServerCenterConsistency(center);
  },
};
