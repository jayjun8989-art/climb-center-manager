import type { Center, MemberListItem } from "../../types";
import { normalizeMemberType } from "../../utils/member";
import type {
  ExpiredDayOption,
  ExpiringDayOption,
  MemberStatusCategory,
  MemberStatusMemberTypeFilter,
} from "./constants";
import { seoulToday } from "../roster/time";

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export function daysFromToday(target: string, today = seoulToday()): number {
  const end = dateOnly(target);
  if (!end) return Number.NaN;
  const startMs = new Date(`${today}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  return Math.round((endMs - startMs) / 86_400_000);
}

export function isCountMembership(member: MemberListItem): boolean {
  if (member.pass_type === "count") return true;
  const type = (member.membership_type ?? "").toLowerCase();
  return type === "5times" || type === "8times" || type === "16times" || type === "session";
}

export function isPausedMember(member: MemberListItem): boolean {
  return member.status === "paused" || member.membership_status === "paused";
}

/** Active/paused membership row is absent from the local join. */
export function hasNoMembership(member: MemberListItem): boolean {
  return member.membership_id == null;
}

export function isValidMember(member: MemberListItem, today = seoulToday()): boolean {
  if (hasNoMembership(member)) return false;
  if (isCountMembership(member)) {
    return (member.remaining_count ?? 0) >= 1;
  }
  const end = dateOnly(member.end_date);
  if (!end) return true;
  return daysFromToday(end, today) >= 0;
}

export function isExpiringMember(
  member: MemberListItem,
  withinDays: ExpiringDayOption,
  today = seoulToday(),
): boolean {
  if (hasNoMembership(member)) return false;
  if (isCountMembership(member)) return false;
  const end = dateOnly(member.end_date);
  if (!end) return false;
  const days = daysFromToday(end, today);
  return days >= 0 && days <= withinDays;
}

export function isExpiredMember(member: MemberListItem, today = seoulToday()): boolean {
  if (hasNoMembership(member)) return true;
  if (isCountMembership(member)) {
    return (member.remaining_count ?? 0) <= 0;
  }
  const end = dateOnly(member.end_date);
  if (!end) return false;
  return daysFromToday(end, today) < 0;
}

export function expiredReferenceDate(member: MemberListItem): string | null {
  return dateOnly(member.end_date) ?? dateOnly(member.latest_membership_end_date);
}

export function matchesExpiredWindow(
  member: MemberListItem,
  windowDays: ExpiredDayOption,
  today = seoulToday(),
): boolean {
  if (!isExpiredMember(member, today)) return false;
  if (windowDays === "all") return true;

  const ref = expiredReferenceDate(member);
  if (!ref) return true;

  const daysSince = -daysFromToday(ref, today);
  return daysSince >= 0 && daysSince <= windowDays;
}

export function matchesCenterFilter(
  member: MemberListItem,
  centerFilter: Center | "all",
  accessibleCenters: Center[],
): boolean {
  if (centerFilter !== "all") return member.center === centerFilter;
  return accessibleCenters.includes(member.center);
}

export function matchesMemberTypeFilter(
  member: MemberListItem,
  filter: MemberStatusMemberTypeFilter,
): boolean {
  if (filter === "all") return true;
  return normalizeMemberType(member.member_type, member.membership_type) === filter;
}

export function matchesSearch(member: MemberListItem, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");
  if (member.name.toLowerCase().includes(lower)) return true;
  if (member.memo?.toLowerCase().includes(lower)) return true;
  if (digits.length >= 4 && member.phone?.replace(/\D/g, "").includes(digits)) return true;
  if (member.phone?.includes(trimmed)) return true;
  return false;
}

export function isDepletionSoon(member: MemberListItem): boolean {
  if (!isCountMembership(member)) return false;
  const remaining = member.remaining_count ?? 0;
  return remaining >= 1 && remaining <= 2;
}

export function memberInCategory(
  member: MemberListItem,
  category: MemberStatusCategory,
  options: { expiringDays: ExpiringDayOption; expiredDays: ExpiredDayOption; today?: string },
): boolean {
  const today = options.today ?? seoulToday();
  switch (category) {
    case "active":
      return isValidMember(member, today);
    case "expiring":
      return isExpiringMember(member, options.expiringDays, today);
    case "expired":
      return matchesExpiredWindow(member, options.expiredDays, today);
    case "paused":
      return isPausedMember(member);
  }
}

export function sortMembersForCategory(
  members: MemberListItem[],
  category: MemberStatusCategory,
): MemberListItem[] {
  const sorted = [...members];
  switch (category) {
    case "active":
    case "expiring":
      sorted.sort((a, b) => {
        const endA = dateOnly(a.end_date) ?? "9999-99-99";
        const endB = dateOnly(b.end_date) ?? "9999-99-99";
        if (endA !== endB) return endA.localeCompare(endB);
        if (isCountMembership(a) || isCountMembership(b)) {
          return (a.remaining_count ?? 0) - (b.remaining_count ?? 0);
        }
        return a.name.localeCompare(b.name, "ko");
      });
      break;
    case "expired":
      sorted.sort((a, b) => {
        const refA = expiredReferenceDate(a) ?? "0000-00-00";
        const refB = expiredReferenceDate(b) ?? "0000-00-00";
        if (refA !== refB) return refB.localeCompare(refA);
        return a.name.localeCompare(b.name, "ko");
      });
      break;
    case "paused":
      sorted.sort((a, b) => {
        const remainA = a.pause_remaining_days ?? 9999;
        const remainB = b.pause_remaining_days ?? 9999;
        if (remainA !== remainB) return remainA - remainB;
        const startA = dateOnly(a.pause_start_date) ?? "9999-99-99";
        const startB = dateOnly(b.pause_start_date) ?? "9999-99-99";
        return startA.localeCompare(startB);
      });
      break;
  }
  return sorted;
}

export function countByCategory(
  members: MemberListItem[],
  options: { expiringDays: ExpiringDayOption; expiredDays: ExpiredDayOption; today?: string },
): Record<MemberStatusCategory, number> {
  const today = options.today ?? seoulToday();
  return {
    active: members.filter((m) => isValidMember(m, today)).length,
    expiring: members.filter((m) => isExpiringMember(m, options.expiringDays, today)).length,
    expired: members.filter((m) => matchesExpiredWindow(m, options.expiredDays, today)).length,
    paused: members.filter((m) => isPausedMember(m)).length,
  };
}
