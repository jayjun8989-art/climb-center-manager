export function formatAppError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  return "? ? ?? ??? ??????.";
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
          ?? ?? ????? ?? ???? ?? ??????.
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
