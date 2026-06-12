/** Days-until-expiry options for the expiring tab (0 = today). */
export const EXPIRING_DAY_OPTIONS = [0, 7, 15, 30, 60] as const;

/** Past-day windows for the expired tab. */
export const EXPIRED_DAY_OPTIONS = [7, 30, 90] as const;

export const DEFAULT_EXPIRING_DAYS = 30;
export const DEFAULT_EXPIRED_DAYS = 30;

export type ExpiringDayOption = (typeof EXPIRING_DAY_OPTIONS)[number];
export type ExpiredDayOption = (typeof EXPIRED_DAY_OPTIONS)[number] | "all";

export type MemberStatusCategory = "active" | "expiring" | "expired" | "paused";

export type MemberStatusMemberTypeFilter = "all" | "regular" | "junior";

export const MEMBER_STATUS_CATEGORY_LABELS: Record<MemberStatusCategory, string> = {
  active: "이용가능",
  expiring: "만료예정",
  expired: "만료·소진",
  paused: "휴면회원",
};

export function expiringDayLabel(days: ExpiringDayOption): string {
  if (days === 0) return "당일";
  return `${days}일 이내`;
}

export function expiredDayLabel(days: ExpiredDayOption): string {
  if (days === "all") return "전체";
  return `지난 ${days}일`;
}
