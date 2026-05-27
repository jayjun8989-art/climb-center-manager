import { invoke } from "@tauri-apps/api/core";
import type {
  AttendanceRecord,
  BackupInfo,
  BackupResult,
  Center,
  DashboardStats,
  Member,
  MemberGroupFilter,
  MemberInput,
  MemberStatusFilter,
  MutationResult,
  PaginatedMembers,
  StorageInfo,
} from "../types";
import { formatAppError } from "../utils/errors";

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatAppError(error));
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
    return invokeCommand("get_members", {
      center: params.center,
      search: params.search ?? "",
      member_group: params.memberGroup ?? "all",
      status_filter: params.statusFilter ?? "all",
      page: params.page ?? 1,
      page_size: params.pageSize ?? 50,
    });
  },

  getMember(id: number): Promise<Member> {
    return invokeCommand("get_member_by_id", { id });
  },

  addMember(input: MemberInput): Promise<MutationResult<Member>> {
    return invokeCommand("add_member", { input });
  },

  editMember(id: number, input: MemberInput): Promise<MutationResult<Member>> {
    return invokeCommand("edit_member", { id, input });
  },

  removeMember(id: number): Promise<MutationResult<boolean>> {
    return invokeCommand("remove_member", { id });
  },

  recordAttendance(memberId: number): Promise<MutationResult<Member>> {
    return invokeCommand("record_attendance", { member_id: memberId });
  },

  fetchAttendance(memberId: number, limit = 20): Promise<AttendanceRecord[]> {
    return invokeCommand("fetch_attendance", { member_id: memberId, limit });
  },

  fetchDashboardStats(center: Center): Promise<DashboardStats> {
    return invokeCommand("fetch_dashboard_stats", { center });
  },

  fetchExpiringMembers(center: Center, days = 7): Promise<Member[]> {
    return invokeCommand("fetch_expiring_members", { center, days });
  },

  manualBackup(): Promise<BackupResult> {
    return invokeCommand("manual_backup");
  },

  fetchBackupInfo(): Promise<BackupInfo> {
    return invokeCommand("fetch_backup_info");
  },

  fetchStorageInfo(): Promise<StorageInfo> {
    return invokeCommand("fetch_storage_info");
  },

  restoreBackup(path: string): Promise<void> {
    return invokeCommand("restore_backup_file", { path });
  },

  openBackupFolder(): Promise<void> {
    return invokeCommand("open_backup_folder");
  },

  openDataFolder(): Promise<void> {
    return invokeCommand("open_data_folder");
  },
};
