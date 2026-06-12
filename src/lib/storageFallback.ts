import type {
  BackupInfo,
  Center,
  DashboardStats,
  MemberGroupFilter,
  MemberInput,
  MemberListItem,
  MemberStatusFilter,
  MutationResult,
  PaginatedMembers,
  StorageInfo,
  SyncQueueItem,
  SyncStatus,
} from "../types";
import { memberMatchesGroupFilter, normalizeMemberType } from "../utils/member";

const MEMBERS_KEY = "ccm_members_v1";
const SYNC_STATE_KEY = "ccm_sync_state_v1";

function nowString() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayString() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadMembers(): MemberListItem[] {
  try {
    const raw = localStorage.getItem(MEMBERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MemberListItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMembers(members: MemberListItem[]) {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
}

function nextId(members: MemberListItem[]) {
  return members.reduce((max, m) => Math.max(max, m.id), 0) + 1;
}

function mapMembershipLabel(type: string) {
  switch (type) {
    case "monthly_1":
      return "30days";
    case "monthly_3":
      return "90days";
    case "monthly_6":
      return "180days";
    case "junior":
      return "junior";
    default:
      return "5times";
  }
}

function buildListItem(input: MemberInput, id: number, createdAt: string): MemberListItem {
  const passType = input.membership_type === "session" ? "count" : "period";
  const endDate =
    input.end_date ??
    (passType === "period" && input.membership_type === "monthly_1"
      ? todayString()
      : null);

  return {
    id,
    name: input.name.trim(),
    phone: input.phone ?? null,
    member_type: input.member_type ?? "regular",
    center: input.center,
    memo: input.notes ?? null,
    status: "active",
    membership_id: id * 1000,
    membership_type: mapMembershipLabel(input.membership_type),
    pass_type: passType,
    start_date: input.start_date,
    end_date: endDate,
    total_count: input.total_sessions ?? null,
    remaining_count: input.remaining_sessions ?? input.total_sessions ?? null,
    membership_status: "active",
    display_status: "활성",
    remaining_text: passType === "count" ? `${input.remaining_sessions ?? 0}회` : "기간권",
    last_visit_at: null,
    pause_remaining_days: null,
    latest_membership_end_date: endDate,
    latest_membership_type: mapMembershipLabel(input.membership_type),
    days_since_expired: null,
    is_inactive_30_days: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function defaultStorageInfo(): StorageInfo {
  return {
    db_path: "localStorage (브라우저 미리보기)",
    backup_dir: "localStorage",
    reports_dir: "localStorage",
    journal_mode: "memory",
    integrity_ok: true,
  };
}

export function defaultBackupInfo(): BackupInfo {
  return {
    last_backup_at: null,
    backup_count: 0,
    json_backup_count: 0,
    db_backup_count: 0,
    max_backups: 30,
    backup_dir: "localStorage",
    db_path: "localStorage",
    last_json_path: null,
    last_db_path: null,
    created_on_startup: false,
  };
}

export function defaultSyncStatus(): SyncStatus {
  return {
    pending_count: 0,
    failed_count: 0,
    last_pull_at: null,
    last_push_at: null,
    device_id: null,
  };
}

export function defaultDashboardStats(members: MemberListItem[]): DashboardStats {
  const activeMembers = members.filter((m) => m.status === "active");
  return {
    total_members: members.length,
    active_members: activeMembers.length,
    expiring_soon: 0,
    paused_members: members.filter((m) => m.status === "paused").length,
    today_attendance: 0,
    trial_members: members.filter((m) => normalizeMemberType(m.member_type) === "trial").length,
    monthly_count: members.filter((m) => m.pass_type === "period").length,
    session_count: members.filter((m) => m.pass_type === "count").length,
    junior_count: members.filter((m) => normalizeMemberType(m.member_type, m.membership_type) === "junior").length,
    regular_members: members.filter((m) => normalizeMemberType(m.member_type, m.membership_type) === "regular").length,
    inactive_30_members: members.filter((m) => memberMatchesGroupFilter(m, "inactive_30")).length,
  };
}

export function fallbackGetMembers(params: {
  center: Center;
  search?: string;
  memberGroup?: MemberGroupFilter;
  statusFilter?: MemberStatusFilter;
  page?: number;
  pageSize?: number;
}): PaginatedMembers {
  let list = loadMembers().filter((m) => m.center === params.center);

  const search = (params.search ?? "").trim().toLowerCase();
  if (search) {
    list = list.filter(
      (m) =>
        m.name.toLowerCase().includes(search) ||
        (m.phone ?? "").includes(search) ||
        (m.memo ?? "").toLowerCase().includes(search),
    );
  }

  if (params.memberGroup && params.memberGroup !== "all") {
    list = list.filter((m) => memberMatchesGroupFilter(m, params.memberGroup!));
  }

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const start = (page - 1) * pageSize;

  return {
    members: list.slice(start, start + pageSize),
    total: list.length,
    page,
    page_size: pageSize,
  };
}

export function fallbackAddMember(input: MemberInput): MutationResult<MemberListItem> {
  const members = loadMembers();
  const now = nowString();
  const member = buildListItem(input, nextId(members), now);
  members.unshift(member);
  saveMembers(members);
  return { data: member, backup_warning: null };
}

export function fallbackEditMember(id: number, input: MemberInput): MutationResult<MemberListItem> {
  const members = loadMembers();
  const index = members.findIndex((m) => m.id === id);
  if (index < 0) throw new Error("회원을 찾을 수 없습니다.");
  const now = nowString();
  const updated = { ...buildListItem(input, id, members[index].created_at), updated_at: now };
  members[index] = updated;
  saveMembers(members);
  return { data: updated, backup_warning: null };
}

export function fallbackRemoveMember(id: number): MutationResult<boolean> {
  const members = loadMembers().filter((m) => m.id !== id);
  saveMembers(members);
  return { data: true, backup_warning: null };
}

export function fallbackRecordAttendance(memberId: number): MutationResult<MemberListItem> {
  const members = loadMembers();
  const index = members.findIndex((m) => m.id === memberId);
  if (index < 0) throw new Error("회원을 찾을 수 없습니다.");
  const now = nowString();
  members[index] = { ...members[index], last_visit_at: now, updated_at: now };
  saveMembers(members);
  return { data: members[index], backup_warning: null };
}

export function fallbackSyncQueue(_limit = 50): SyncQueueItem[] {
  return [];
}

export function fallbackSyncState(key: string, value: string) {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    const state = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    state[key] = value;
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
