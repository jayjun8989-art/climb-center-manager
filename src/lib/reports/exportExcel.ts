import ExcelJS from "exceljs";
import type { Center } from "../../types";
import type { MemberRosterRow } from "../roster/fetchRoster";
import {
  formatDateOnly,
  formatDateTimeSeoul,
  seoulToday,
  daysAgoSeoul,
  isSameSeoulDay,
} from "../roster/time";
import { inactiveOver30Days } from "../roster/fetchRoster";
import { isTauriApp, safeInvoke } from "../tauri";

export const ROSTER_MAIN_FILES = {
  combined: "회원명부_통합.xlsx",
  oncle: "ONCLE_회원명부.xlsx",
  grabit: "GRABIT_회원명부.xlsx",
} as const;

const HEADERS = [
  "등록일",
  "센터",
  "이름",
  "연락처",
  "주소",
  "회원구분",
  "회원권종류",
  "회원권등록일",
  "시작일",
  "종료일",
  "등록기간",
  "등록횟수/총횟수",
  "잔여횟수",
  "상태",
  "최근방문일",
  "락카번호",
  "메모",
];

function registrationDate(row: MemberRosterRow): string | null {
  return row.membership_registered_at ?? row.first_registered_at;
}

export function sortRosterRows(rows: MemberRosterRow[]): MemberRosterRow[] {
  return [...rows].sort((a, b) => {
    const dateA = registrationDate(a) ?? "";
    const dateB = registrationDate(b) ?? "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    if (a.center_code !== b.center_code) return a.center_code.localeCompare(b.center_code);
    return a.member_name.localeCompare(b.member_name, "ko");
  });
}

function rowValues(row: MemberRosterRow): (string | number)[] {
  const regDate = registrationDate(row);
  return [
    formatDateTimeSeoul(regDate),
    row.center_code,
    row.member_name,
    row.phone ?? "",
    row.address ?? "",
    row.member_type_label,
    row.membership_type_label ?? "",
    formatDateTimeSeoul(row.membership_registered_at),
    formatDateOnly(row.start_date),
    formatDateOnly(row.end_date),
    row.registration_period_days ?? "",
    row.total_sessions ?? "",
    row.remaining_sessions ?? "",
    row.membership_status ?? "",
    formatDateOnly(row.latest_visit_at),
    row.locker_number ?? "",
    row.memo ?? "",
  ];
}

async function addSheet(workbook: ExcelJS.Workbook, name: string, rows: MemberRosterRow[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(HEADERS);
  for (const row of sortRosterRows(rows)) {
    sheet.addRow(rowValues(row));
  }
  sheet.columns.forEach((column) => {
    let max = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    column.width = Math.min(Math.max(max + 2, 10), 40);
  });
  sheet.getRow(1).font = { bold: true };
}

function filterCenter(rows: MemberRosterRow[], center: Center): MemberRosterRow[] {
  return rows.filter((row) => row.center_code === center);
}

function todayRows(rows: MemberRosterRow[], today: string): MemberRosterRow[] {
  return rows.filter((row) => isSameSeoulDay(row.membership_registered_at, today));
}

function inactiveRows(rows: MemberRosterRow[], today: string): MemberRosterRow[] {
  return inactiveOver30Days(rows, daysAgoSeoul(30, today));
}

export async function buildCombinedWorkbook(
  allRows: MemberRosterRow[],
  today = seoulToday(),
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await addSheet(workbook, "전체", allRows);
  await addSheet(workbook, "ONCLE", filterCenter(allRows, "ONCLE"));
  await addSheet(workbook, "GRABIT", filterCenter(allRows, "GRABIT"));
  await addSheet(workbook, "오늘등록", todayRows(allRows, today));
  await addSheet(workbook, "1개월미등록", inactiveRows(allRows, today));
  return workbook;
}

export async function buildCenterWorkbook(
  center: Center,
  allRows: MemberRosterRow[],
  today = seoulToday(),
): Promise<ExcelJS.Workbook> {
  const centerRows = filterCenter(allRows, center);
  const workbook = new ExcelJS.Workbook();
  await addSheet(workbook, "회원명부", centerRows);
  await addSheet(workbook, "오늘등록", todayRows(centerRows, today));
  await addSheet(workbook, "1개월미등록", inactiveRows(centerRows, today));
  return workbook;
}

async function getReportsDir(): Promise<string> {
  const info = await safeInvoke<{ reports_dir: string }>("fetch_report_info");
  if (!info?.reports_dir) {
    throw new Error("명부 저장 경로를 확인할 수 없습니다.");
  }
  return info.reports_dir.replace(/\//g, "\\");
}

export async function saveWorkbookAt(
  workbook: ExcelJS.Workbook,
  absolutePath: string,
): Promise<string> {
  if (!isTauriApp()) {
    throw new Error("엑셀 저장은 데스크톱 앱에서만 가능합니다.");
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  const saved = await safeInvoke<string>("write_report_file_cmd", { path: absolutePath, bytes });
  if (!saved) throw new Error("명부 파일 저장에 실패했습니다.");
  return saved;
}

export interface ExportRosterResult {
  main: string[];
  archive: string[];
}

export interface ExportRosterScope {
  accessibleCenters: Center[];
  unifiedAccess: boolean;
}

export async function exportRosterReports(
  allRows: MemberRosterRow[],
  scope: ExportRosterScope,
  options?: { date?: string; includeArchive?: boolean },
): Promise<ExportRosterResult> {
  const date = options?.date ?? seoulToday();
  const includeArchive = options?.includeArchive ?? true;
  const reportsDir = await getReportsDir();
  const main: string[] = [];
  const archive: string[] = [];

  const exportCombined = scope.unifiedAccess || scope.accessibleCenters.length > 1;
  const centersToExport = scope.unifiedAccess
    ? (["ONCLE", "GRABIT"] as Center[])
    : scope.accessibleCenters;

  if (exportCombined) {
    const combinedMain = `${reportsDir}\\${ROSTER_MAIN_FILES.combined}`;
    main.push(await saveWorkbookAt(await buildCombinedWorkbook(allRows, date), combinedMain));
  }

  for (const center of centersToExport) {
    const centerMain = `${reportsDir}\\${ROSTER_MAIN_FILES[center === "ONCLE" ? "oncle" : "grabit"]}`;
    main.push(await saveWorkbookAt(await buildCenterWorkbook(center, allRows, date), centerMain));
  }

  if (includeArchive) {
    const archiveDir = `${reportsDir}\\archive\\${date}`;
    if (exportCombined) {
      archive.push(
        await saveWorkbookAt(
          await buildCombinedWorkbook(allRows, date),
          `${archiveDir}\\회원명부_통합_${date}.xlsx`,
        ),
      );
    }
    for (const center of centersToExport) {
      const prefix = center === "ONCLE" ? "ONCLE" : "GRABIT";
      archive.push(
        await saveWorkbookAt(
          await buildCenterWorkbook(center, allRows, date),
          `${archiveDir}\\${prefix}_회원명부_${date}.xlsx`,
        ),
      );
    }
  }

  const lastPath = exportCombined
    ? `${reportsDir}\\${ROSTER_MAIN_FILES.combined}`
    : main[0] ?? `${reportsDir}\\${ROSTER_MAIN_FILES.combined}`;

  await safeInvoke("set_report_state_cmd", { date, path: lastPath });
  return { main, archive };
}

export async function hasReportsForToday(): Promise<boolean> {
  if (!isTauriApp()) return false;
  const info = await safeInvoke<{ last_report_date: string | null }>("fetch_report_info");
  return info?.last_report_date === seoulToday();
}

export function rosterFilePath(reportsDir: string, fileName: string): string {
  return `${reportsDir.replace(/\//g, "\\")}\\${fileName}`;
}
