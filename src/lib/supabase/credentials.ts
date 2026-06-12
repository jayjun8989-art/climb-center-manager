/** 로그인 아이디를 서버 이메일로 변환 (예: oncle → oncle@oncle.local) */
export const LOGIN_EMAIL_DOMAIN = "oncle.local";

export function normalizeLoginId(loginIdOrEmail: string): string {
  return loginIdOrEmail.trim().toLowerCase().replace(/\s+/g, "");
}

export function resolveLoginEmail(loginIdOrEmail: string): string {
  const trimmed = normalizeCenterLoginId(loginIdOrEmail);
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed}@${LOGIN_EMAIL_DOMAIN}`;
}

/** Map center / admin login ids to canonical ids (case-insensitive). */
export function normalizeCenterLoginId(loginIdOrEmail: string): string {
  const trimmed = normalizeLoginId(loginIdOrEmail);
  if (!trimmed || trimmed.includes("@")) return trimmed;
  if (trimmed === "oncle") return "oncle";
  if (trimmed === "grabit") return "grabit";
  if (trimmed === "grabon" || trimmed === "admin") return "grabon";
  return trimmed;
}

export const LOGIN_ACCOUNTS = {
  admin: { loginId: "grabon", password: "wkaqhek2222", label: "관리자 (ONCLE+GRABIT)" },
  oncle: { loginId: "oncle", password: "oncle", label: "ONCLE" },
  grabit: { loginId: "grabit", password: "grabit", label: "GRABIT" },
} as const;

export function loginIdFromEmail(email: string | undefined | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return email.slice(0, at);
}
