import { GrabonLogo } from "./GrabonLogo";
import { useState } from "react";

interface LoginScreenProps {
  loading?: boolean;
  onSubmit: (loginId: string, password: string) => Promise<void>;
  onOpenSelfCheckin?: () => void;
}

export function LoginScreen({ loading, onSubmit, onOpenSelfCheckin }: LoginScreenProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!loginId.trim() || !password) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(loginId.trim(), password.trim());
      setPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  const busy = loading || submitting;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 to-slate-100 p-6 dark:from-slate-950 dark:to-slate-900">
      <div className="glass-panel w-full max-w-md rounded-[1.75rem] p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <GrabonLogo className="mb-4 h-14 w-auto max-w-[280px] object-contain" />
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Climb Center Manager
          </p>
          <h1 className="mt-2 text-2xl font-bold">로그인</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            ONCLE · GRABIT · 관리자(grabon) 아이디로 로그인
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="field-label">아이디</label>
            <input
              className="input"
              type="text"
              autoCapitalize="none"
              autoComplete="username"
              placeholder="oncle · grabit · grabon"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label">비밀번호</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="비밀번호"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? "로그인 중..." : "로그인"}
          </button>
        </form>
        {onOpenSelfCheckin && (
          <button
            type="button"
            className="btn btn-secondary mt-4 w-full"
            onClick={onOpenSelfCheckin}
          >
            셀프 출석체크
          </button>
        )}
      </div>
    </div>
  );
}
