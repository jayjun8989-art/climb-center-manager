import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauriApp } from "./tauri";

/** Must match src-tauri/tauri.conf.json plugins.updater.endpoints[0] */
export const UPDATER_ENDPOINT =
  "https://github.com/jayjun8989-art/climb-center-manager/releases/latest/download/latest.json";

export const UPDATE_MESSAGES = {
  latest: "현재 최신 버전입니다.",
  found: (version: string) => `새 버전 v${version}을 찾았습니다.`,
  installing: "업데이트를 다운로드하고 설치하는 중입니다...",
  installFailed: (raw: string) => `다운로드/설치 실패: ${raw}`,
  checkFailed: (raw: string) => `업데이트 확인 실패: ${raw}`,
} as const;

export type UpdateCheckOutcome =
  | { kind: "skipped"; diagnostics: string[] }
  | { kind: "latest"; message: string; diagnostics: string[] }
  | { kind: "available"; version: string; message: string; diagnostics: string[]; update: Update }
  | { kind: "installed"; version: string; message: string; diagnostics: string[] }
  | { kind: "error"; message: string; diagnostics: string[] };

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logDiagnostics(diagnostics: string[]) {
  console.log(`[updater]\n${diagnostics.join("\n")}`);
}

export async function getAppVersion(): Promise<string> {
  if (!isTauriApp()) return import.meta.env.VITE_APP_VERSION ?? "0.1.0";
  return getVersion();
}

export async function checkForUpdate(options?: {
  installImmediately?: boolean;
}): Promise<UpdateCheckOutcome> {
  const diagnostics: string[] = [];

  if (!isTauriApp()) {
    diagnostics.push("Tauri 환경 아님 — updater check 건너뜀");
    return { kind: "skipped", diagnostics };
  }

  const currentVersion = await getAppVersion();
  diagnostics.push(`현재 앱 버전: v${currentVersion}`);
  diagnostics.push(`updater endpoint: ${UPDATER_ENDPOINT}`);
  diagnostics.push("update check 시작: true");

  try {
    const update = await check();

    if (!update) {
      diagnostics.push("업데이트 발견 여부: 없음");
      diagnostics.push(`발견한 최신 버전: v${currentVersion} (동일 또는 더 높음)`);
      logDiagnostics(diagnostics);
      return { kind: "latest", message: UPDATE_MESSAGES.latest, diagnostics };
    }

    diagnostics.push("업데이트 발견 여부: 있음");
    diagnostics.push(`발견한 최신 버전: v${update.version}`);
    logDiagnostics(diagnostics);

    const message = UPDATE_MESSAGES.found(update.version);

    if (options?.installImmediately) {
      return installUpdate(update, diagnostics);
    }

    return { kind: "available", version: update.version, message, diagnostics, update };
  } catch (error) {
    const raw = formatError(error);
    diagnostics.push("업데이트 발견 여부: 확인 실패");
    diagnostics.push(`에러 원문: ${raw}`);
    logDiagnostics(diagnostics);
    console.error("[updater] check failed", error);
    return { kind: "error", message: UPDATE_MESSAGES.checkFailed(raw), diagnostics };
  }
}

export async function installUpdate(
  update: Update,
  existingDiagnostics: string[] = [],
): Promise<UpdateCheckOutcome> {
  const diagnostics = [...existingDiagnostics, "다운로드 및 설치 시작"];
  logDiagnostics(diagnostics);

  try {
    await update.downloadAndInstall();
    diagnostics.push("다운로드/설치 완료 — 앱 재시작");
    logDiagnostics(diagnostics);
    await relaunch();
    return {
      kind: "installed",
      version: update.version,
      message: UPDATE_MESSAGES.installing,
      diagnostics,
    };
  } catch (error) {
    const raw = formatError(error);
    diagnostics.push(`다운로드/설치 실패: ${raw}`);
    logDiagnostics(diagnostics);
    console.error("[updater] install failed", error);
    return { kind: "error", message: UPDATE_MESSAGES.installFailed(raw), diagnostics };
  }
}
