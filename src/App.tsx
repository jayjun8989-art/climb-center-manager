import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api/client";
import { ExpiringPanel } from "./components/ExpiringPanel";
import { Header } from "./components/Header";
import { LoginPanel } from "./components/LoginPanel";
import { MemberDetailPanel } from "./components/MemberDetailPanel";
import { MemberFormModal } from "./components/MemberFormModal";
import { MemberList } from "./components/MemberList";
import { PaginationBar } from "./components/PaginationBar";
import { SyncStatusBar } from "./components/SyncStatusBar";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth";
import { useSync } from "./hooks/useSync";
import { useTheme } from "./hooks/useTheme";
import type { Center, DashboardStats, MemberGroupFilter, MemberInput, MemberListItem, MemberStatusFilter, BackupInfo, StorageInfo } from "./types";

function showMutationToast(
  setToast: (value: string) => void,
  successMessage: string,
  result: { backup_warning?: string | null },
) {
  if (result.backup_warning) {
    setToast(`${successMessage} · ${result.backup_warning}`);
    return;
  }
  setToast(successMessage);
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function App() {
  const { dark, toggleTheme } = useTheme();
  const auth = useSupabaseAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [center, setCenter] = useState<Center>("ONCLE");
  const [memberGroup, setMemberGroup] = useState<MemberGroupFilter>("all");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [expiringMembers, setExpiringMembers] = useState<MemberListItem[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberListItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberListItem | null>(null);
  const [toast, setToast] = useState("");
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [startupError, setStartupError] = useState("");

  const sync = useSync(center, auth.isAuthenticated);

  const refreshStorageInfo = useCallback(async () => {
    const info = await api.fetchStorageInfo();
    setStorageInfo(info);
    if (!info.integrity_ok) {
      setToast("데이터베이스 무결성 검사에 문제가 있습니다. 백업 복원을 확인해주세요.");
    }
  }, []);

  const refreshBackupInfo = useCallback(async () => {
    const info = await api.fetchBackupInfo();
    setBackupInfo(info);
    return info;
  }, []);

  const refreshDashboard = useCallback(async () => {
    const [nextStats, nextExpiring] = await Promise.all([
      api.fetchDashboardStats(center),
      api.fetchExpiringMembers(center, 7),
    ]);
    setStats(nextStats);
    setExpiringMembers(nextExpiring);
  }, [center]);

  const refreshMembers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getMembers({
        center,
        search: debouncedSearch,
        memberGroup,
        statusFilter,
        page,
        pageSize,
      });
      setMembers(result.members);
      setTotal(result.total);
      setSelectedMember((current) => {
        if (!current) return null;
        return result.members.find((member) => member.id === current.id) ?? current;
      });
    } finally {
      setLoading(false);
    }
  }, [center, debouncedSearch, memberGroup, statusFilter, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [center, debouncedSearch, memberGroup, statusFilter, pageSize]);

  useEffect(() => {
    refreshMembers().catch((error) => setToast(String(error)));
  }, [refreshMembers]);

  useEffect(() => {
    refreshDashboard().catch((error) => setToast(String(error)));
  }, [refreshDashboard]);

  useEffect(() => {
    refreshStorageInfo()
      .then(() => refreshBackupInfo())
      .then((backup) => {
        if (backup.created_on_startup && backup.last_backup_at) {
          setToast(`오늘 자동 백업 완료 · JSON·DB (${backup.last_backup_at})`);
        }
      })
      .catch((error) => setStartupError(String(error)));
  }, [refreshStorageInfo, refreshBackupInfo]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const membershipSummary = useMemo(() => {
    if (!stats) return "";
    return `월권 ${stats.monthly_count} · 횟수권 ${stats.session_count} · 주니어 ${stats.junior_count}`;
  }, [stats]);

  async function handleSaveMember(input: MemberInput) {
    try {
      if (editingMember) {
        const result = await api.editMember(editingMember.id, input);
        setSelectedMember((current) =>
          current?.id === editingMember.id ? result.data : current,
        );
        showMutationToast(setToast, "회원 정보가 수정되었습니다.", result);
      } else {
        const result = await api.addMember(input);
        setSelectedMember(result.data);
        showMutationToast(setToast, "새 회원이 등록되었습니다.", result);
      }
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo(), refreshStorageInfo()]);
      sync.syncNow().catch(() => undefined);
    } catch (error) {
      setToast(String(error));
      throw error;
    }
  }

  async function handleDeleteMember(member: MemberListItem) {
    const confirmed = window.confirm(`${member.name} 회원을 삭제하시겠습니까?`);
    if (!confirmed) return;
    try {
      const result = await api.removeMember(member.id);
      if (selectedMember?.id === member.id) setSelectedMember(null);
      showMutationToast(setToast, "회원이 삭제되었습니다.", result);
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo()]);
      sync.syncNow().catch(() => undefined);
    } catch (error) {
      setToast(String(error));
    }
  }

  async function handleAttendance(member: MemberListItem) {
    try {
      const result = await api.recordAttendance(member.id);
      setSelectedMember(result.data);
      if (result.backup_warning) {
        setToast(result.backup_warning);
      }
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo()]);
      sync.syncNow().catch(() => undefined);
      return result.data;
    } catch (error) {
      setToast(String(error));
      throw error;
    }
  }

  async function handleBackup() {
    try {
      const result = await api.manualBackup();
      setToast(`수동 백업 완료 · JSON·DB (${result.created_at})`);
      await refreshBackupInfo();
    } catch (error) {
      setToast(String(error));
    }
  }

  async function handleOpenBackupFolder() {
    try {
      await api.openBackupFolder();
    } catch (error) {
      setToast(String(error));
    }
  }

  async function handleOpenDataFolder() {
    try {
      await api.openDataFolder();
    } catch (error) {
      setToast(String(error));
    }
  }

  async function handleRestoreBackup() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON 백업", extensions: ["json"] }],
      title: "복원할 백업 파일 선택",
    });

    if (!selected || Array.isArray(selected)) return;

    const confirmed = window.confirm(
      "선택한 백업으로 현재 PC의 회원/출석 데이터를 덮어씁니다. 계속하시겠습니까?",
    );
    if (!confirmed) return;

    await api.restoreBackup(selected);
    setSelectedMember(null);
    setToast("백업 복원이 완료되었습니다.");
    await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo()]);
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      {startupError && (
        <div className="mx-auto mb-4 max-w-[1500px] rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          저장소 초기화 오류: {startupError}
        </div>
      )}

      {storageInfo && !storageInfo.integrity_ok && (
        <div className="mx-auto mb-4 max-w-[1500px] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
          데이터베이스 무결성 검사에 문제가 있습니다. 「복원」으로 최근 백업을 불러오세요.
        </div>
      )}

      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <Header
          center={center}
          onCenterChange={setCenter}
          memberGroup={memberGroup}
          onMemberGroupChange={setMemberGroup}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          search={search}
          onSearchChange={setSearch}
          dark={dark}
          onToggleTheme={toggleTheme}
          onAddMember={() => {
            setEditingMember(null);
            setModalOpen(true);
          }}
          onBackup={handleBackup}
          onRestoreBackup={() => {
            handleRestoreBackup().catch((error) => setToast(String(error)));
          }}
          onOpenBackupFolder={() => {
            handleOpenBackupFolder().catch((error) => setToast(String(error)));
          }}
          onOpenDataFolder={() => {
            handleOpenDataFolder().catch((error) => setToast(String(error)));
          }}
          stats={stats}
          backupInfo={backupInfo}
          storageInfo={storageInfo}
        />

        <SyncStatusBar
          configured={sync.configured}
          online={sync.online}
          authenticated={auth.isAuthenticated}
          status={sync.status}
          phase={sync.phase}
          lastResult={sync.lastResult}
          onSync={() => {
            sync.syncNow().catch((error) => setToast(String(error)));
          }}
          onLogin={() => setLoginOpen(true)}
        />

        {membershipSummary && (
          <p className="px-1 text-sm text-[var(--muted)]">회원권 구성 · {membershipSummary}</p>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <div className="space-y-4">
            <MemberList
              members={members}
              loading={loading}
              memberGroup={memberGroup}
              selectedId={selectedMember?.id ?? null}
              onSelect={setSelectedMember}
              onEdit={(member) => {
                setEditingMember(member);
                setModalOpen(true);
              }}
              onDelete={handleDeleteMember}
              onAttendance={async (member) => {
                try {
                  await handleAttendance(member);
                  setToast(`${member.name}님 출석 완료`);
                } catch (error) {
                  setToast(String(error));
                }
              }}
            />
            <PaginationBar
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>

          <div className="space-y-5">
            <MemberDetailPanel
              member={selectedMember}
              onAttendance={handleAttendance}
              onUpdated={(updated) => {
                setSelectedMember(updated);
                setMembers((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                );
              }}
            />
            <ExpiringPanel members={expiringMembers} />
          </div>
        </div>
      </div>

      <MemberFormModal
        open={modalOpen}
        center={center}
        member={editingMember}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSaveMember}
      />

      <LoginPanel
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        loading={auth.loading}
        onSubmit={async (email, password) => {
          await auth.login(email, password);
          setToast("Supabase 로그인 완료");
          await sync.syncNow();
        }}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
