import { invoke as tauriInvoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

function isInvokeReady(): boolean {
  return typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

/** Tauri WebView 환경 여부 (브라우저 미리보기 제외). */
export function isTauriApp(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauriRuntime()) return true;
  return "__TAURI_INTERNALS__" in window;
}

/** WebView IPC가 준비될 때까지 대기. */
export async function waitForTauriReady(timeoutMs = 5000): Promise<boolean> {
  if (!isTauriApp()) return false;
  if (isInvokeReady()) return true;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isInvokeReady()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  return isInvokeReady();
}

export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriApp()) {
    console.warn(`[Tauri 미연결] ${command} 건너뜀`);
    return null;
  }

  const ready = await waitForTauriReady();
  if (!ready) {
    console.warn(`[Tauri IPC 준비 안 됨] ${command} 건너뜀`);
    return null;
  }

  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    console.error(`[Tauri invoke 실패] ${command}`, error);
    return null;
  }
}

/** Tauri 명령 실행 — 실패 시 예외 (UI 피드백). */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriApp()) {
    throw new Error("데스크톱 앱(Tauri)에서만 사용할 수 있습니다.");
  }

  const ready = await waitForTauriReady();
  if (!ready) {
    throw new Error("Tauri IPC가 준비되지 않았습니다. 앱을 다시 시작하세요.");
  }

  return tauriInvoke<T>(command, args);
}
