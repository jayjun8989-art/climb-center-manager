import { addMonths, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";

import type { Member, MemberStatus, MembershipType, MemberStatusFilter } from "../types";



export const CENTER_LABELS = {

  ONCLE: "ONCLE",

  GRABIT: "GRABIT",

} as const;



export type MonthlyDuration = 1 | 3 | 6;

export type JuniorCount = 8 | 16;

export type MemberGroupFilter = "all" | "general" | "junior";



export const SESSION_TOTAL_COUNT = 5;

export const SESSION_VALIDITY_MONTHS = 2;

export const JUNIOR_COUNTS: JuniorCount[] = [8, 16];



export const MEMBERSHIP_LABELS: Record<MembershipType, string> = {

  monthly_1: "월권 (1개월)",

  monthly_3: "월권 (3개월)",

  monthly_6: "월권 (6개월)",

  session: "횟수권 (5회/2개월)",

  junior: "주니어권",

};



export const MEMBER_GROUP_LABELS: Record<MemberGroupFilter, string> = {

  all: "전체 회원",

  general: "일반 회원",

  junior: "주니어",

};

export const MEMBER_STATUS_LABELS: Record<MemberStatusFilter, string> = {
  all: "전체 상태",
  active: "이용 가능",
  expired: "만료/소진",
};

export function normalizePhoneInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}



export function isMonthlyType(type: MembershipType): boolean {

  return type === "monthly_1" || type === "monthly_3" || type === "monthly_6";

}



export function isJuniorType(type: MembershipType): boolean {

  return type === "junior";

}



export function isSessionBased(type: MembershipType): boolean {

  return type === "session" || type === "junior";

}



export function getMonthlyDuration(type: MembershipType): MonthlyDuration | null {

  if (type === "monthly_1") return 1;

  if (type === "monthly_3") return 3;

  if (type === "monthly_6") return 6;

  return null;

}



export function getJuniorCount(member: Pick<Member, "membership_type" | "total_sessions">): JuniorCount {

  if (member.total_sessions === 16) return 16;

  return 8;

}



export function formatMembershipLabel(member: Pick<Member, "membership_type" | "total_sessions">): string {

  if (member.membership_type === "junior") {

    return `주니어권 (${getJuniorCount(member)}회)`;

  }

  return MEMBERSHIP_LABELS[member.membership_type];

}



export function monthlyTypeFromDuration(duration: MonthlyDuration): MembershipType {

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



export function getMemberStatus(member: Member): MemberStatus {

  if (member.membership_type === "junior") {

    const remaining = member.remaining_sessions ?? 0;

    if (remaining <= 0) return "depleted";

    if (remaining <= 2) return "expiring";

    return "active";

  }



  if (member.membership_type === "session") {

    const remaining = member.remaining_sessions ?? 0;

    if (remaining <= 0) return "depleted";



    if (member.end_date) {

      const days = differenceInCalendarDays(parseISO(member.end_date), new Date());

      if (days < 0) return "expired";

      if (days <= 7 || remaining <= 2) return "expiring";

    }



    return "active";

  }



  if (!member.end_date) return "expired";

  const days = differenceInCalendarDays(parseISO(member.end_date), new Date());

  if (days < 0) return "expired";

  if (days <= 7) return "expiring";

  return "active";

}



export function getStatusLabel(status: MemberStatus) {

  switch (status) {

    case "active":

      return "이용 가능";

    case "expiring":

      return "만료 임박";

    case "expired":

      return "만료됨";

    case "depleted":

      return "횟수 소진";

  }

}



export function getStatusBadgeClass(status: MemberStatus) {

  switch (status) {

    case "active":

      return "badge badge-active";

    case "expiring":

      return "badge badge-warning";

    case "expired":

    case "depleted":

      return "badge badge-danger";

  }

}



export function getExpiryText(member: Member) {

  if (member.membership_type === "junior") {

    const remaining = member.remaining_sessions ?? 0;

    const total = member.total_sessions ?? getJuniorCount(member);

    return `잔여 ${remaining}회 / ${total}회`;

  }



  if (member.membership_type === "session") {

    const remaining = member.remaining_sessions ?? 0;

    const total = member.total_sessions ?? SESSION_TOTAL_COUNT;

    const usage = `잔여 ${remaining}회 / ${total}회`;



    if (!member.end_date) return usage;

    const days = differenceInCalendarDays(parseISO(member.end_date), new Date());

    if (days < 0) return `${usage} · 기간 만료`;

    if (days === 0) return `${usage} · 오늘 만료`;

    return `${usage} · D-${days}`;

  }



  if (!member.end_date) return "만료일 없음";

  const days = differenceInCalendarDays(parseISO(member.end_date), new Date());

  if (days < 0) return `만료 (${member.end_date})`;

  if (days === 0) return "오늘 만료";

  return `D-${days} (${member.end_date})`;

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


