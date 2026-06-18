import type { Center } from "../types";
import { centerCodeFromId } from "../lib/supabase/centers";

type SupabaseMemberRow = {
  id: string;
  center_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  member_type: string;
  parent_name: string | null;
  parent_phone: string | null;
  memo: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  member_no: number | null;
};

type SupabaseMembershipRow = {
  id: string;
  member_id: string;
  center_id: string;
  membership_type: string;
  pass_type: string;
  start_date: string;
  end_date: string | null;
  total_count: number | null;
  used_count: number;
  remaining_count: number | null;
  status: string;
  price: number | null;
  created_at: string;
  updated_at: string;
};

type SupabaseAttendanceRow = {
  id: string;
  member_id: string;
  membership_id: string;
  center_id: string;
  checkin_at: string;
  attendance_type: string;
  deducted_count: number;
  memo: string | null;
  created_at: string;
};

type SupabaseLockerRow = {
  member_id: string | null;
  center_id: string;
  locker_number: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  memo: string | null;
};

export type PullSnapshotPayload = {
  members: Array<{
    remoteId: string;
    center: Center;
    name: string;
    phone: string | null;
    address: string | null;
    memberType: string;
    parentName: string | null;
    parentPhone: string | null;
    memo: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    memberNo: number | null;
  }>;
  memberships: Array<{
    remoteId: string;
    memberRemoteId: string;
    membershipType: string;
    passType: string;
    startDate: string;
    endDate: string | null;
    totalCount: number | null;
    usedCount: number;
    remainingCount: number | null;
    status: string;
    price: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
  attendanceLogs: Array<{
    remoteId: string;
    memberRemoteId: string;
    membershipRemoteId: string;
    center: Center;
    checkinAt: string;
    attendanceType: string;
    deductedCount: number;
    memo: string | null;
    createdAt: string;
  }>;
  lockers: Array<{
    memberRemoteId: string;
    center: Center;
    lockerNumber: string;
    lockerStartDate: string | null;
    lockerEndDate: string | null;
    lockerMemo: string | null;
    lockerStatus: string;
  }>;
};

/** Supabase can return numeric columns as strings. Coerce to number or null. */
function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Coerce to number, fallback to 0. */
function toIntOrZero(value: unknown): number {
  return toIntOrNull(value) ?? 0;
}

/** Coerce to number or null, for optional floats (price). */
function toFloatOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type SnapshotTypeError = { path: string; value: unknown; expected: string };

/** Validate all numeric fields in a snapshot and return the first type error. */
export function findSnapshotTypeError(payload: PullSnapshotPayload): SnapshotTypeError | null {
  for (let i = 0; i < payload.members.length; i++) {
    const m = payload.members[i];
    if (m.memberNo !== null && m.memberNo !== undefined && typeof m.memberNo !== "number") {
      return { path: `members[${i}].memberNo`, value: m.memberNo, expected: "number | null" };
    }
  }
  for (let i = 0; i < payload.memberships.length; i++) {
    const ms = payload.memberships[i];
    if (typeof ms.usedCount !== "number") {
      return { path: `memberships[${i}].usedCount`, value: ms.usedCount, expected: "number" };
    }
    if (ms.totalCount !== null && ms.totalCount !== undefined && typeof ms.totalCount !== "number") {
      return { path: `memberships[${i}].totalCount`, value: ms.totalCount, expected: "number | null" };
    }
    if (ms.remainingCount !== null && ms.remainingCount !== undefined && typeof ms.remainingCount !== "number") {
      return { path: `memberships[${i}].remainingCount`, value: ms.remainingCount, expected: "number | null" };
    }
    if (ms.price !== null && ms.price !== undefined && typeof ms.price !== "number") {
      return { path: `memberships[${i}].price`, value: ms.price, expected: "number | null" };
    }
  }
  for (let i = 0; i < payload.attendanceLogs.length; i++) {
    const a = payload.attendanceLogs[i];
    if (typeof a.deductedCount !== "number") {
      return { path: `attendanceLogs[${i}].deductedCount`, value: a.deductedCount, expected: "number" };
    }
  }
  return null;
}

function toLocalDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 19).replace("T", " ");
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function mapRemoteMemberType(value: string): string {
  switch (value) {
    case "regular":
      return "general";
    case "junior":
      return "junior";
    case "trial":
      return "trial";
    default:
      return "general";
  }
}

/** Map server status → local allowed values: active | paused | expired | inactive */
function mapRemoteMemberStatus(value: string | null | undefined): string {
  switch (value) {
    case "active":
    case "paused":
    case "expired":
    case "inactive":
      return value;
    default:
      return "inactive"; // trial, left, quit, null → inactive
  }
}

function mapRemoteMembershipType(row: SupabaseMembershipRow): string {
  switch (row.membership_type) {
    case "monthly":
      return "30days";
    case "session":
      return "5times";
    case "junior":
      return "junior";
    case "trial":
      return "trial";
    default:
      return "30days";
  }
}

function mapRemoteLockerStatus(status: string): string {
  switch (status) {
    case "occupied":
      return "active";
    case "expired":
      return "expired";
    default:
      return "empty";
  }
}

function centerOrThrow(centerId: string): Center {
  const center = centerCodeFromId(centerId);
  if (!center) {
    throw new Error(`? ? ?? ?? ID: ${centerId}`);
  }
  return center;
}

export function buildPullSnapshot(input: {
  members: SupabaseMemberRow[];
  memberships: SupabaseMembershipRow[];
  attendanceLogs: SupabaseAttendanceRow[];
  lockers: SupabaseLockerRow[];
}): PullSnapshotPayload {
  return {
    members: input.members.map((row) => ({
      remoteId: row.id,
      center: centerOrThrow(row.center_id),
      name: row.name,
      phone: row.phone,
      address: row.address,
      memberType: mapRemoteMemberType(row.member_type),
      parentName: row.parent_name,
      parentPhone: row.parent_phone,
      memo: row.memo,
      status: mapRemoteMemberStatus(row.status),
      createdAt: toLocalDateTime(row.created_at),
      updatedAt: toLocalDateTime(row.updated_at),
      memberNo: toIntOrNull(row.member_no),
    })),
    memberships: input.memberships.map((row) => ({
      remoteId: row.id,
      memberRemoteId: row.member_id,
      membershipType: mapRemoteMembershipType(row),
      passType: row.pass_type,
      startDate: row.start_date,
      endDate: row.end_date,
      totalCount: toIntOrNull(row.total_count),
      usedCount: toIntOrZero(row.used_count),
      remainingCount: toIntOrNull(row.remaining_count),
      status: row.status,
      price: toFloatOrNull(row.price),
      createdAt: toLocalDateTime(row.created_at),
      updatedAt: toLocalDateTime(row.updated_at),
    })),
    attendanceLogs: input.attendanceLogs.map((row) => ({
      remoteId: row.id,
      memberRemoteId: row.member_id,
      membershipRemoteId: row.membership_id,
      center: centerOrThrow(row.center_id),
      checkinAt: toLocalDateTime(row.checkin_at),
      attendanceType: row.attendance_type,
      deductedCount: toIntOrZero(row.deducted_count),
      memo: row.memo,
      createdAt: toLocalDateTime(row.created_at),
    })),
    lockers: input.lockers
      .filter((row): row is SupabaseLockerRow & { member_id: string } => Boolean(row.member_id))
      .map((row) => ({
        memberRemoteId: row.member_id,
        center: centerOrThrow(row.center_id),
        lockerNumber: row.locker_number,
        lockerStartDate: row.start_date,
        lockerEndDate: row.end_date,
        lockerMemo: row.memo,
        lockerStatus: mapRemoteLockerStatus(row.status),
      })),
  };
}

export function sanitizePullSnapshot(payload: PullSnapshotPayload): PullSnapshotPayload {
  const members = payload.members.filter((row) => {
    if (!row.remoteId?.trim()) {
      console.warn("[pull] skip members row: missing remoteId", row);
      return false;
    }
    return true;
  });

  const memberRemoteIds = new Set(members.map((member) => member.remoteId));

  const memberships = payload.memberships.filter((row) => {
    if (!row.remoteId?.trim()) {
      console.warn("[pull] skip memberships row: missing remoteId", row);
      return false;
    }
    if (!row.memberRemoteId?.trim() || !memberRemoteIds.has(row.memberRemoteId)) {
      console.warn("[pull] skip memberships row: missing or unknown memberRemoteId", row);
      return false;
    }
    return true;
  });

  const membershipRemoteIds = new Set(memberships.map((membership) => membership.remoteId));

  const attendanceLogs = payload.attendanceLogs.filter((row) => {
    if (!row.remoteId?.trim()) {
      console.warn("[pull] skip attendance_logs row: missing remoteId", row);
      return false;
    }
    if (!row.memberRemoteId?.trim() || !memberRemoteIds.has(row.memberRemoteId)) {
      console.warn("[pull] skip attendance_logs row: missing or unknown memberRemoteId", row);
      return false;
    }
    if (!row.membershipRemoteId?.trim() || !membershipRemoteIds.has(row.membershipRemoteId)) {
      console.warn("[pull] skip attendance_logs row: missing or unknown membershipRemoteId", row);
      return false;
    }
    return true;
  });

  const lockers = payload.lockers.filter((row) => {
    if (!row.memberRemoteId?.trim() || !memberRemoteIds.has(row.memberRemoteId)) {
      console.warn("[pull] skip lockers row: missing or unknown memberRemoteId", row);
      return false;
    }
    return true;
  });

  return { members, memberships, attendanceLogs, lockers };
}

/** Tauri invoke payload — camelCase keys must match Rust `#[serde(rename_all = "camelCase")]`. */
export function toInvokePullSnapshot(payload: PullSnapshotPayload): PullSnapshotPayload {
  return sanitizePullSnapshot(payload);
}
