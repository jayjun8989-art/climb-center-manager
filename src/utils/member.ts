import { addMonths, format, parseISO, subDays } from "date-fns";

import type {
  LegacyMembershipType,
  MemberGroupFilter,
  MemberListItem,
  MemberStatus,
  MemberStatusFilter,
  MembershipCategory,
} from "../types";

export const CENTER_LABELS = {
  ONCLE: "ONCLE",
  GRABIT: "GRABIT",
} as const;

export type MonthlyDuration = 1 | 3 | 6;
export type JuniorCount = 8 | 16;

export const SESSION_TOTAL_COUNT = 5;
export const SESSION_VALIDITY_MONTHS = 2;
export const JUNIOR_COUNTS: JuniorCount[] = [8, 16];

export const MEMBERSHIP_LABELS: Record<LegacyMembershipType, string> = {
  monthly_1: "월권 (1개월)",
  monthly_3: "월권 (3개월)",
  monthly_6: "월권 (6개월)",
  session: "횟수권 (5회/2개월)",
  junior: "주니어권",
};

export const DB_MEMBERSHIP_LABELS: Record<string, string> = {
  "30days": "기간권 (30일)",
  "90days": "기간권 (90일)",
  "180days": "기간권 (180일)",
  "5times": "횟수권 (5회)",
  "8times": "주니어 (8회)",
  "16times": "주니어 (16회)",
  junior: "주니어권",
  trial: "체험권",
};

export const MEMBER_GROUP_LABELS: Record<MemberGroupFilter, string> = {
  all: "전체 회원",
  regular: "일반 회원",
  junior: "주니어",
  inactive_30: "1개월 미등록",
};

export function normalizeMemberType(
  memberType: string | null | undefined,
  membershipType?: string | null,
): "regular" | "junior" | "trial" {
  const value = String(memberType ?? "").trim().toLowerCase();
  if (value === "trial") return "trial";
  if (value === "junior") return "junior";
  if (value === "regular" || value === "general") return "regular";

  const membership = String(membershipType ?? "").toLowerCase();
  if (membership === "junior" || membership === "8times" || membership === "16times") {
    return "junior";
  }
  return "regular";
}

export function memberMatchesGroupFilter(
  member: Pick<MemberListItem, "member_type" | "membership_type" | "latest_membership_end_date" | "is_inactive_30_days" | "status">,
  group: MemberGroupFilter,
): boolean {
  const normalized = normalizeMemberType(member.member_type, member.membership_type);
  switch (group) {
    case "regular":
      return normalized === "regular";
    case "junior":
      return normalized === "junior";
    case "inactive_30":
      if (member.status === "paused") return false;
      if (member.is_inactive_30_days != null) return member.is_inactive_30_days;
      if (!member.latest_membership_end_date) return true;
      return (
        new Date(member.latest_membership_end_date).getTime() <=
        Date.now() - 30 * 24 * 60 * 60 * 1000
      );
    default:
      return true;
  }
}

export function getMemberGroupCount(
  group: MemberGroupFilter,
  stats: { total_members: number; regular_members: number; junior_count: number; inactive_30_members: number } | null,
): number {
  if (!stats) return 0;
  switch (group) {
    case "all":
      return stats.total_members;
    case "regular":
      return stats.regular_members;
    case "junior":
      return stats.junior_count;
    case "inactive_30":
      return stats.inactive_30_members;
  }
}

export function formatLatestMembershipTypeLabel(type: string | null | undefined): string {
  if (!type) return "없음";
  const simplified = SUPABASE_MEMBERSHIP_TYPE_LABELS[type];
  if (simplified) return simplified.split(" 또는")[0];
  if (type === "30days" || type === "90days" || type === "180days" || type === "monthly") {
    return "월권";
  }
  if (type === "5times" || type === "session") return "횟수권";
  if (type === "junior" || type === "8times" || type === "16times") return "주니어권";
  return DB_MEMBERSHIP_LABELS[type] ?? type;
}

export function formatInactivePeriodText(member: Pick<MemberListItem, "latest_membership_end_date" | "days_since_expired">): string {
  if (!member.latest_membership_end_date) return "기록 없음";
  const days = member.days_since_expired ?? 0;
  return `${Math.max(days, 0)}일 미등록`;
}

export function formatLatestExpiryLabel(endDate: string | null | undefined): string {
  if (!endDate) return "-";
  return `${endDate} 만료`;
}

export const MEMBER_STATUS_LABELS: Record<MemberStatusFilter, string> = {
  all: "전체 상태",
  active: "이용 가능",
  expired: "만료/소진",
};

export const MEMBER_TYPE_LABELS: Record<string, string> = {
  general: "일반",
  regular: "일반",
  junior: "주니어",
  trial: "체험",
};

export const SUPABASE_MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  monthly: "월권 또는 기간권",
  session: "횟수권",
  junior: "주니어권",
};

export function normalizePhoneInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function isMonthlyType(type: LegacyMembershipType): boolean {
  return type === "monthly_1" || type === "monthly_3" || type === "monthly_6";
}

export function isJuniorType(type: LegacyMembershipType): boolean {
  return type === "junior";
}

export function isSessionBased(type: LegacyMembershipType): boolean {
  return type === "session" || type === "junior";
}

export function dbMembershipToLegacy(type: string | null | undefined): LegacyMembershipType {
  switch (type) {
    case "30days":
      return "monthly_1";
    case "90days":
      return "monthly_3";
    case "180days":
      return "monthly_6";
    case "5times":
      return "session";
    case "8times":
    case "16times":
    case "junior":
      return "junior";
    default:
      return "monthly_1";
  }
}

export function getMonthlyDuration(type: LegacyMembershipType): MonthlyDuration | null {
  if (type === "monthly_1") return 1;
  if (type === "monthly_3") return 3;
  if (type === "monthly_6") return 6;
  return null;
}

export function getJuniorCountFromItem(member: Pick<MemberListItem, "membership_type" | "total_count">): JuniorCount {
  if (member.membership_type === "16times" || member.total_count === 16) return 16;
  return 8;
}

export function formatMembershipLabel(member: Pick<MemberListItem, "membership_type" | "total_count">): string {
  if (!member.membership_type) return "회원권 없음";

  const simplified = SUPABASE_MEMBERSHIP_TYPE_LABELS[member.membership_type];
  if (simplified) {
    if (member.membership_type === "junior") {
      return `주니어권 (${getJuniorCountFromItem(member)}회)`;
    }
    return simplified;
  }

  if (member.membership_type === "8times" || member.membership_type === "16times") {
    return `주니어권 (${getJuniorCountFromItem(member)}회)`;
  }
  if (member.membership_type === "junior") {
    return `주니어권 (${getJuniorCountFromItem(member)}회)`;
  }
  if (
    member.membership_type === "30days" ||
    member.membership_type === "90days" ||
    member.membership_type === "180days"
  ) {
    return "월권 또는 기간권";
  }
  if (member.membership_type === "5times") {
    return "횟수권";
  }
  return DB_MEMBERSHIP_LABELS[member.membership_type] ?? member.membership_type;
}

export function monthlyTypeFromDuration(duration: MonthlyDuration): LegacyMembershipType {
  if (duration === 1) return "monthly_1";
  if (duration === 3) return "monthly_3";
  return "monthly_6";
}

export function calcEndDateFromMonths(startDate: string, months: number): string {
  const start = parseISO(startDate);
  return format(subDays(addMonths(start, months), 1), "yyyy-MM-dd");
}

export function calcMonthlyEndDate(startDate: string, months: MonthlyDuration): string {
  return calcEndDateFromMonths(startDate, months);
}

export function calcSessionEndDate(startDate: string): string {
  return calcEndDateFromMonths(startDate, SESSION_VALIDITY_MONTHS);
}

export function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function resolveCategory(type: string | null | undefined): MembershipCategory {
  const legacy = dbMembershipToLegacy(type);
  if (isMonthlyType(legacy)) return "monthly";
  if (legacy === "session") return "session";
  return "junior";
}

export function getStatusBadgeClassFromDisplay(displayStatus: string) {
  if (displayStatus.includes("정지")) return "badge badge-warning";
  if (displayStatus.includes("임박") || displayStatus.includes("부족")) return "badge badge-warning";
  if (displayStatus.includes("만료") || displayStatus.includes("소진")) return "badge badge-danger";
  return "badge badge-active";
}

export function getMemberStatus(member: MemberListItem): MemberStatus {
  if (member.status === "paused" || member.display_status.includes("정지")) return "paused";
  if (member.display_status.includes("소진")) return "depleted";
  if (member.display_status.includes("만료")) return "expired";
  if (member.display_status.includes("임박") || member.display_status.includes("부족")) return "expiring";
  return "active";
}

export function getStatusLabel(member: MemberListItem | string): string {
  if (typeof member === "string") return member;
  return member.display_status;
}

export function getStatusBadgeClass(member: MemberListItem | MemberStatus) {
  if (typeof member === "string") {
    if (member === "paused" || member === "expiring") return "badge badge-warning";
    if (member === "expired" || member === "depleted") return "badge badge-danger";
    return "badge badge-active";
  }
  return getStatusBadgeClassFromDisplay(member.display_status);
}

export function getExpiryText(member: MemberListItem): string {
  return member.remaining_text;
}

export function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

export function phoneFormat(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return value;
}

export function paymentMethodLabel(method: string) {
  switch (method) {
    case "card":
      return "카드";
    case "cash":
      return "현금";
    case "transfer":
      return "계좌이체";
    default:
      return "기타";
  }
}

/** Local SQLite member PK (Tauri). Supports id or legacy member_id field. */
export function resolveMemberLocalId(member: {
  id?: number | null;
  member_id?: number | null;
}): number {
  const memberId = member.id ?? member.member_id;
  if (memberId == null || memberId === 0) {
    throw new Error("회원 ID를 찾을 수 없습니다.");
  }
  return memberId;
}
