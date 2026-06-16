import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauriApp } from "./tauri";

export type UpdateDiagnosticResult = {
  currentVersion: string;
  buildDate: string;
  buildCommit: string;
  endpoint: string;
  fetchSuccess: boolean;
  fetchError: string | null;
  remoteVersion: string | null;
  remotePubDate: string | null;
  signaturePresent: boolean | null;
  downloadUrl: string | null;
  downloadUrlAccessible: boolean | null;
  versionComparison: "newer" | "same" | "older" | null;
  updateAvailable: boolean;
  failureReason: string | null;
  releaseUrl: string;
};

function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  for (const [x, y] of [[aMaj, bMaj], [aMin, bMin], [aPatch, bPatch]] as [number, number][]) {
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function runUpdateDiagnostic(opts: {
  buildDate: string;
  buildCommit: string;
}): Promise<UpdateDiagnosticResult> {
  const releaseUrl =
    "https://github.com/jayjun8989-art/climb-center-manager/releases/latest";

  const currentVersion = await getAppVersion();
  const result: UpdateDiagnosticResult = {
    currentVersion,
    buildDate: opts.buildDate,
    buildCommit: opts.buildCommit,
    endpoint: UPDATER_ENDPOINT,
    fetchSuccess: false,
    fetchError: null,
    remoteVersion: null,
    remotePubDate: null,
    signaturePresent: null,
    downloadUrl: null,
    downloadUrlAccessible: null,
    versionComparison: null,
    updateAvailable: false,
    failureReason: null,
    releaseUrl,
  };

  // 1. Fetch latest.json
  let json: unknown;
  try {
    const res = await fetch(UPDATER_ENDPOINT, { cache: "no-store" });
    if (!res.ok) {
      result.fetchError = `HTTP ${res.status} ${res.statusText}`;
      result.failureReason = `latest.json 다운로드 실패 (${result.fetchError})`;
      return result;
    }
    json = await res.json();
    result.fetchSuccess = true;
  } catch (e) {
    result.fetchError = e instanceof Error ? e.message : String(e);
    result.failureReason = result.fetchError.includes("fetch")
      ? `네트워크 오류 — 인터넷 연결을 확인하세요 (${result.fetchError})`
      : `latest.json 다운로드 실패: ${result.fetchError}`;
    return result;
  }

  // 2. Parse
  if (typeof json !== "object" || json === null || !("version" in json)) {
    result.failureReason = "latest.json 파싱 실패 — 예상 형식이 아닙니다";
    return result;
  }
  const latestJson = json as Record<string, unknown>;
  result.remoteVersion = typeof latestJson.version === "string" ? latestJson.version : null;
  result.remotePubDate = typeof latestJson.pub_date === "string" ? latestJson.pub_date : null;

  const platforms = latestJson.platforms as Record<string, unknown> | undefined;
  const winPlatform = platforms?.["windows-x86_64"] as Record<string, unknown> | undefined;
  result.signaturePresent = typeof winPlatform?.signature === "string" && winPlatform.signature.length > 0;
  result.downloadUrl = typeof winPlatform?.url === "string" ? winPlatform.url : null;

  if (!result.remoteVersion) {
    result.failureReason = "latest.json에 version 필드가 없습니다";
    return result;
  }

  // 3. Compare versions
  const cmp = compareSemver(result.remoteVersion, currentVersion);
  result.versionComparison = cmp === 1 ? "newer" : cmp === 0 ? "same" : "older";

  if (result.versionComparison === "same") {
    result.failureReason = `latest.json의 버전(v${result.remoteVersion})이 현재 버전과 같습니다 — GitHub Release 반영이 아직 안 됐거나 이미 최신 버전입니다`;
    return result;
  }
  if (result.versionComparison === "older") {
    result.failureReason = `latest.json의 버전(v${result.remoteVersion})이 현재 버전(v${currentVersion})보다 낮습니다`;
    return result;
  }

  // 4. Check signature
  if (!result.signaturePresent) {
    result.failureReason = "latest.json에 windows-x86_64 signature 필드가 없습니다 — .sig 파일이 릴리스에 업로드되지 않았을 수 있습니다";
    return result;
  }

  // 5. Check download URL reachability (HEAD)
  if (result.downloadUrl) {
    try {
      const headRes = await fetch(result.downloadUrl, { method: "HEAD", cache: "no-store" });
      result.downloadUrlAccessible = headRes.ok;
      if (!headRes.ok) {
        result.failureReason = `다운로드 URL 접근 실패 (HTTP ${headRes.status}) — GitHub Release에 .exe 파일이 아직 업로드 중일 수 있습니다`;
        return result;
      }
    } catch (e) {
      result.downloadUrlAccessible = false;
      result.failureReason = `다운로드 URL 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`;
      return result;
    }
  }

  result.updateAvailable = true;
  return result;
}

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
