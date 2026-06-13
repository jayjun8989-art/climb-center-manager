const ERROR_REPLACEMENTS: [RegExp, string][] = [
  [/command failed/i, "요청 처리에 실패했습니다."],
  [/invalid args/i, "입력값이 올바르지 않습니다."],
  [/DUPLICATE_TODAY/i, "이미 해당 날짜에 출석 기록이 있습니다."],
  [/OUT_OF_PERIOD/i, "선택한 출석일이 회원권 기간 밖입니다."],
  [/payload/i, "데이터"],
  [/\bpush\b/i, "전송"],
  [/supabase/i, "서버"],
  [/\brpc\b/i, "요청"],
  [/sync_queue/i, "동기화 대기 목록"],
  [/tauri/i, "프로그램"],
];

function sanitizeUserMessage(message: string): string {
  let result = message.trim();
  for (const [pattern, replacement] of ERROR_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  if (result.includes("???") || result.includes("\uFFFD")) {
    if (/CHECK constraint failed/i.test(message)) {
      return "입력값이 저장 규칙에 맞지 않습니다. 회원 구분과 회원권 정보를 확인하세요.";
    }
    return "알 수 없는 오류가 발생했습니다.";
  }
  return result;
}

export function formatAppError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return sanitizeUserMessage(error);
  }

  if (error instanceof Error && error.message.trim()) {
    return sanitizeUserMessage(error.message);
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return sanitizeUserMessage(record.message);
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return sanitizeUserMessage(record.error);
    }
  }

  return "알 수 없는 오류가 발생했습니다.";
}
export function logAppError(context: string, error: unknown): string {
  const message = formatAppError(error);
  console.error(`[${context}]`, error);
  return message;
}

export function showFatalError(title: string, message: string) {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <div style="
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem;
      font-family: 'Malgun Gothic', 'Segoe UI', 'Apple SD Gothic Neo', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    ">
      <div style="max-width: 720px; width: 100%;">
        <h1 style="font-size: 1.5rem; margin: 0 0 0.75rem;">${escapeHtml(title)}</h1>
        <p style="margin: 0 0 1rem; color: #94a3b8;">
          앱을 시작하지 못했습니다. 아래 메시지를 확인해주세요.
        </p>
        <pre style="
          white-space: pre-wrap;
          word-break: break-word;
          background: #111827;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 1rem;
          font-size: 0.875rem;
          margin: 0;
        ">${escapeHtml(message)}</pre>
      </div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
