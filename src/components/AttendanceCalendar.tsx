import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ko } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import type { AttendanceLog } from "../types";

interface AttendanceCalendarProps {
  attendanceLogs: AttendanceLog[];
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function AttendanceCalendar({
  attendanceLogs,
  month,
  onMonthChange,
  selectedDate,
  onDateSelect,
}: AttendanceCalendarProps) {
  const activeLogs = useMemo(
    () => attendanceLogs.filter((log) => !log.canceled_at),
    [attendanceLogs],
  );

  const attendanceByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of activeLogs) {
      const key = log.checkin_at.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [activeLogs]);

  const monthLabel = format(month, "yyyy년 M월", { locale: ko });

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [month]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">출석 달력</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary !px-3"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="이전 달"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[8rem] text-center text-sm font-semibold">{monthLabel}</span>
          <button
            type="button"
            className="btn btn-secondary !px-3"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="다음 달"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[var(--muted)]">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const inMonth = isSameMonth(day, month);
          const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
          const count = attendanceByDate.get(toDateKey(day)) ?? 0;

          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl border transition ${
                isSelected
                  ? "border-sky-500 bg-[var(--brand-soft)]"
                  : inMonth
                    ? "border-[var(--border)] bg-[var(--panel-strong)] hover:border-sky-500/40"
                    : "border-transparent bg-transparent text-[var(--muted)] opacity-40"
              }`}
              onClick={() => onDateSelect(day)}
            >
              <span className={`text-sm font-semibold ${!inMonth ? "text-[var(--muted)]" : ""}`}>
                {format(day, "d")}
              </span>
              {count > 0 && (
                <span className="mt-1 flex items-center gap-0.5">
                  {Array.from({ length: Math.min(count, 3) }).map((_, index) => (
                    <span
                      key={index}
                      className="h-1.5 w-1.5 rounded-full bg-sky-500"
                    />
                  ))}
                  {count > 3 && (
                    <span className="text-[0.6rem] font-semibold text-sky-500">+{count - 3}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {format(selectedDate, "yyyy년 M월 d일 (EEE)", { locale: ko })} · 출석{" "}
          {attendanceByDate.get(toDateKey(selectedDate)) ?? 0}건
        </p>
      )}
    </div>
  );
}

export function getAttendanceLogsForDate(
  logs: AttendanceLog[],
  date: Date,
): AttendanceLog[] {
  const key = format(date, "yyyy-MM-dd");
  return logs.filter((log) => log.checkin_at.slice(0, 10) === key);
}

export function parseAttendanceDate(value: string): Date {
  return parseISO(value.slice(0, 10));
}

export function formatAttendanceLogLine(log: AttendanceLog): string {
  const time = log.checkin_at.length >= 16 ? log.checkin_at.slice(0, 16).replace("T", " ") : log.checkin_at;
  const typeLabel = log.attendance_type || "출석";
  const deduct =
    log.deducted_count > 0 ? ` · 횟수권 ${log.deducted_count}회 차감` : " · 월권";
  const canceled = log.canceled_at ? " · 취소됨" : "";
  return `${time} / ${typeLabel}${deduct}${canceled}`;
}
