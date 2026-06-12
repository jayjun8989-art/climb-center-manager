/** Asia/Seoul date helpers for roster filters and reports. */

export function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function seoulMonthStart(today = seoulToday()): string {
  return `${today.slice(0, 7)}-01`;
}

export function seoulMonthEnd(today = seoulToday()): string {
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

export function isSameSeoulDay(iso: string | null | undefined, day: string): boolean {
  if (!iso) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10) === day;
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(parsed);
  return local === day;
}

export function isInSeoulRange(
  iso: string | null | undefined,
  start: string,
  end: string,
): boolean {
  if (!iso) return false;
  const parsed = new Date(iso);
  const day = Number.isNaN(parsed.getTime())
    ? iso.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(parsed);
  return day >= start && day <= end;
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(parsed);
}

/** YYYY-MM-DD or YYYY-MM-DD HH:mm (Asia/Seoul) when time is present. */
export function formatDateTimeSeoul(value: string | null | undefined): string {
  if (!value) return "";
  const dateOnly = formatDateOnly(value);
  if (!value.includes("T") && !/\d{2}:\d{2}/.test(value.slice(10))) {
    return dateOnly;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const normalized = value.replace("T", " ").slice(0, 16);
    return normalized.length > 10 ? normalized : dateOnly;
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
  return `${dateOnly} ${time}`;
}

export function daysAgoSeoul(days: number, today = seoulToday()): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
