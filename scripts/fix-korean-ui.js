import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const KO = {
  loginMissing: "\uC544\uC774\uB514\uC640 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.",
  loginTitle: "\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778",
  loginSubtitle: "\uC13C\uD130 \uD68C\uC6D0\uAD00\uB9AC\uB97C \uC2DC\uC791\uD558\uB824\uBA74 \uB85C\uADF8\uC778\uD558\uC138\uC694.",
  idLabel: "\uC544\uC774\uB514",
  passwordLabel: "\uBE44\uBC00\uBC88\uD638",
  loggingIn: "\uB85C\uADF8\uC778 \uC911...",
  login: "\uB85C\uADF8\uC778",
  loginFooter:
    "\uAE30\uBCF8 \uAD00\uB9AC\uC790 \uACC4\uC815\uC740 Owner \uAD8C\uD55C\uC744 \uAC00\uC9C4 \uACC4\uC815\uC785\uB2C8\uB2E4.",
  credentialsComment:
    "\uB85C\uADF8\uC778 \uC544\uC774\uB514\uB97C \uC11C\uBC84 \uC774\uBA54\uC77C\uB85C \uBCC0\uD658 (\uC608: oncle \u2192 oncle@oncle.local)",
  membershipTitle: "\uD68C\uC6D0\uAD8C \uAD00\uB9AC",
  membershipSubtitle:
    "\uD68C\uC6D0\uAD8C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uC77C\uC2DC\uC815\uC9C0\u00B7\uC7AC\uAC1C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  searchPlaceholder: "\uC774\uB984, \uC5F0\uB77D\uCC98 \uAC80\uC0C9...",
  loading: "\uBD88\uB7EC\uC624\uB294 \uC911...",
  noMembers: "\uD68C\uC6D0\uAD8C \uD68C\uC6D0\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
  pausePrompt: "\uC77C\uC2DC\uC815\uC9C0 \uC0AC\uC720\uB97C \uC785\uB825\uD558\uC138\uC694.",
  paused: "\uD68C\uC6D0\uAD8C\uC744 \uC77C\uC2DC\uC815\uC9C0\uD588\uC2B5\uB2C8\uB2E4.",
  resumed: "\uD68C\uC6D0\uAD8C\uC744 \uC7AC\uAC1C\uD588\uC2B5\uB2C8\uB2E4.",
  pauseBtn: "\uC77C\uC2DC\uC815\uC9C0",
  resumeBtn: "\uC7AC\uAC1C",
};

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
  console.log("wrote", rel);
}

write(
  "src/components/LoginScreen.tsx",
  `import { Mountain } from "lucide-react";
import { useState } from "react";

interface LoginScreenProps {
  loading?: boolean;
  onSubmit: (loginId: string, password: string) => Promise<void>;
}

export function LoginScreen({ loading, onSubmit }: LoginScreenProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!loginId.trim() || !password) {
      setError(${JSON.stringify(KO.loginMissing)});
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(loginId.trim(), password);
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
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-lg">
            <Mountain size={32} />
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-500">
            ONCLE / GRABIT
          </p>
          <h1 className="mt-2 text-2xl font-bold">${KO.loginTitle}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            ${KO.loginSubtitle}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="field-label">${KO.idLabel}</label>
            <input
              className="input"
              type="text"
              autoCapitalize="none"
              autoComplete="username"
              placeholder="oncle"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label">${KO.passwordLabel}</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder=${JSON.stringify(KO.passwordLabel)}
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
            {busy ? ${JSON.stringify(KO.loggingIn)} : ${JSON.stringify(KO.login)}}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          ${KO.loginFooter}
        </p>
      </div>
    </div>
  );
}
`,
);

write(
  "src/lib/supabase/credentials.ts",
  `/** ${KO.credentialsComment} */
export const LOGIN_EMAIL_DOMAIN = "oncle.local";

export function resolveLoginEmail(loginIdOrEmail: string): string {
  const trimmed = loginIdOrEmail.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return \`\${trimmed.toLowerCase()}@\${LOGIN_EMAIL_DOMAIN}\`;
}

export function loginIdFromEmail(email: string | undefined | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return email.slice(0, at);
}
`,
);

write(
  "src/components/MembershipManagementPanel.tsx",
  `import { PauseCircle, PlayCircle, Search } from "lucide-react";
import { api } from "../api/client";
import type { MemberListItem, PermissionSet } from "../types";
import { formatAppError } from "../utils/errors";
import {
  formatMembershipLabel,
  getExpiryText,
  getStatusBadgeClass,
  getStatusLabel,
} from "../utils/member";

interface MembershipManagementPanelProps {
  members: MemberListItem[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  permissions: PermissionSet;
  selectedId: number | null;
  onSelect: (member: MemberListItem) => void;
  onUpdated: (member: MemberListItem) => void;
  onNotify: (message: string) => void;
}

export function MembershipManagementPanel({
  members,
  loading,
  search,
  onSearch,
  permissions,
  selectedId,
  onSelect,
  onUpdated,
  onNotify,
}: MembershipManagementPanelProps) {
  const withMembership = members.filter((m) => m.membership_id != null);

  async function handlePause(member: MemberListItem) {
    if (!member.membership_id) return;
    const reason = window.prompt(${JSON.stringify(KO.pausePrompt)}, "") ?? undefined;
    try {
      const updated = await api.pauseMembership(member.membership_id, reason);
      onUpdated(updated);
      onNotify(${JSON.stringify(KO.paused)});
    } catch (error) {
      onNotify(formatAppError(error));
    }
  }

  async function handleResume(member: MemberListItem) {
    if (!member.membership_id) return;
    try {
      const updated = await api.resumeMembership(member.membership_id);
      onUpdated(updated);
      onNotify(${JSON.stringify(KO.resumed)});
    } catch (error) {
      onNotify(formatAppError(error));
    }
  }

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold">${KO.membershipTitle}</h2>
        <p className="text-sm text-[var(--muted)]">
          ${KO.membershipSubtitle}
        </p>
      </div>

      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          className="input pl-11"
          placeholder=${JSON.stringify(KO.searchPlaceholder)}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)]">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            ${KO.loading}
          </div>
        ) : withMembership.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            ${KO.noMembers}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {withMembership.map((member) => {
              const isSelected = selectedId === member.id;
              const paused = member.status === "paused" || member.membership_status === "paused";
              return (
                <div
                  key={member.id}
                  className={\`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between \${
                    isSelected
                      ? "bg-[var(--brand-soft)]"
                      : "bg-[var(--panel-strong)] hover:bg-[var(--brand-soft)]/60"
                  }\`}
                  onClick={() => onSelect(member)}
                >
                  <div className="min-w-0 flex-1 cursor-pointer">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{member.name}</p>
                      <span className={getStatusBadgeClass(member)}>{getStatusLabel(member)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatMembershipLabel(member)} \u00B7 {getExpiryText(member)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {paused ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!permissions.canResumeMembership}
                        title={
                          !permissions.canResumeMembership ? permissions.denyReason : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleResume(member);
                        }}
                      >
                        <PlayCircle size={18} />
                        ${KO.resumeBtn}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!permissions.canPauseMembership}
                        title={
                          !permissions.canPauseMembership ? permissions.denyReason : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePause(member);
                        }}
                      >
                        <PauseCircle size={18} />
                        ${KO.pauseBtn}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
`,
);
