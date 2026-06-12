import { Shield, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CENTER_ROLE_LABELS } from "../lib/permissions";
import {
  assignCenterRole,
  listStaffRoles,
  lookupUserByEmail,
  removeCenterRole,
} from "../lib/supabase/roles";
import { logAppError } from "../utils/errors";
import type { Center, CenterRole, StaffRoleAssignment } from "../types";

interface StaffManagementPanelProps {
  open: boolean;
  onClose: () => void;
}

const CENTERS: Center[] = ["ONCLE", "GRABIT"];
const ROLES: CenterRole[] = ["owner", "admin", "staff", "viewer"];

export function StaffManagementPanel({ open, onClose }: StaffManagementPanelProps) {
  const [rows, setRows] = useState<StaffRoleAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupUserId, setLookupUserId] = useState("");
  const [lookupLabel, setLookupLabel] = useState("");
  const [center, setCenter] = useState<Center>("ONCLE");
  const [role, setRole] = useState<CenterRole>("staff");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await listStaffRoles());
    } catch (err) {
      setError(logAppError("직원 권한 목록", err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  async function handleLookup() {
    setError("");
    setMessage("");
    const trimmed = lookupEmail.trim();
    if (!trimmed) {
      setError("이메일을 입력하세요.");
      return;
    }

    try {
      const user = await lookupUserByEmail(trimmed);
      if (!user) {
        setLookupUserId("");
        setLookupLabel("");
        setError("등록된 사용자가 없습니다.");
        return;
      }
      setLookupUserId(user.userId);
      setLookupLabel(`${user.displayName || user.email} (${user.email})`);
      setMessage("사용자를 찾았습니다. 센터와 역할을 선택한 뒤 권한을 부여하세요.");
    } catch (err) {
      setError(logAppError("사용자 조회", err));
    }
  }

  async function handleAssign() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const userId = lookupUserId.trim();
      if (!userId) {
        setError("먼저 이메일로 사용자 ID를 조회하세요.");
        return;
      }
      await assignCenterRole(userId, center, role);
      setMessage(`${center} · ${CENTER_ROLE_LABELS[role]} 권한을 부여했습니다.`);
      setLookupEmail("");
      setLookupUserId("");
      setLookupLabel("");
      await refresh();
    } catch (err) {
      setError(logAppError("권한 부여", err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(row: StaffRoleAssignment) {
    const confirmed = window.confirm(
      `${row.email || row.userId} · ${row.center} · ${CENTER_ROLE_LABELS[row.role]} 권한을 삭제할까요?`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await removeCenterRole(row.userId, row.center);
      setMessage("권한을 삭제했습니다.");
      await refresh();
    } catch (err) {
      setError(logAppError("권한 삭제", err));
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="glass-panel max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[1.5rem]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
              <Shield size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">센터 권한 관리</h2>
              <p className="text-sm text-[var(--muted)]">센터 Owner만 사용 · 본인이 Owner인 센터 권한만 표시</p>
            </div>
          </div>
          <button className="btn btn-secondary !px-3" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-88px)] overflow-auto p-6">
          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] p-4">
            <h3 className="font-semibold">권한 부여</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-[var(--muted)]">이메일</span>
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={lookupEmail}
                    onChange={(event) => setLookupEmail(event.target.value)}
                    placeholder="staff@example.com"
                  />
                  <button className="btn btn-secondary" type="button" onClick={handleLookup}>
                    조회
                  </button>
                </div>
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-[var(--muted)]">사용자 ID (이메일 조회 후 자동 입력)</span>
                  <input
                    className="input"
                    value={lookupUserId}
                    onChange={(event) => setLookupUserId(event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                {lookupLabel && (
                  <p className="text-xs text-emerald-600">확인: {lookupLabel}</p>
                )}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">센터</span>
                <select
                  className="input"
                  value={center}
                  onChange={(event) => setCenter(event.target.value as Center)}
                >
                  {CENTERS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">역할</span>
                <select
                  className="input"
                  value={role}
                  onChange={(event) => setRole(event.target.value as CenterRole)}
                >
                  {ROLES.map((item) => (
                    <option key={item} value={item}>
                      {CENTER_ROLE_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="btn btn-primary mt-4"
              disabled={saving}
              onClick={handleAssign}
            >
              <UserPlus size={18} />
              {saving ? "저장 중..." : "권한 부여"}
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
              {message}
            </p>
          )}

          <div className="mt-6">
            <h3 className="font-semibold">권한 목록</h3>
            {loading ? (
              <p className="mt-3 text-sm text-[var(--muted)]">불러오는 중...</p>
            ) : rows.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">등록된 권한이 없습니다.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-[1.2rem] border border-[var(--border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--panel-strong)] text-left text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3">이메일</th>
                      <th className="px-4 py-3">센터</th>
                      <th className="px-4 py-3">역할</th>
                      <th className="px-4 py-3 text-right">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-[var(--border)]">
                        <td className="px-4 py-3">{row.email || "-"}</td>
                        <td className="px-4 py-3">{row.center}</td>
                        <td className="px-4 py-3">{CENTER_ROLE_LABELS[row.role]}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="btn btn-danger !px-3 !py-2"
                            onClick={() => handleRemove(row)}
                            title="권한 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
