import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, isTauriApp } from "./api/client";
import { AttendanceCheckPanel } from "./components/AttendanceCheckPanel";
import { MemberStatusPanel } from "./components/MemberStatusPanel";
import { Header } from "./components/Header";
import { LockerManagementPanel } from "./components/LockerManagementPanel";
import { LoginScreen } from "./components/LoginScreen";
import { SelfCheckinPanel } from "./components/SelfCheckinPanel";
import { MemberRosterPanel } from "./components/MemberRosterPanel";
import { MainNav, type AppView } from "./components/MainNav";
import { MemberDetailPanel } from "./components/MemberDetailPanel";
import { MemberFormModal } from "./components/MemberFormModal";
import { MemberList } from "./components/MemberList";
import { MembershipManagementPanel } from "./components/MembershipManagementPanel";
import { PaginationBar } from "./components/PaginationBar";
import { SyncStatusBar } from "./components/SyncStatusBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAutoDailyReport } from "./hooks/useAutoDailyReport";
import { useCenterPermissions } from "./hooks/useCenterPermissions";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth";
import { useSync } from "./hooks/useSync";
import { useTheme } from "./hooks/useTheme";
import { normalizeMembers } from "./lib/normalizeMembers";
import { assertPermission, canRegisterMemberInCenter, getAccessibleCenters, loginWelcomeLabel, REGISTER_DENIED, validateLoginRoles } from "./lib/permissions";
import { isSupabaseConfigured } from "./lib/supabase/config";
import {
  getCurrentLoginId,
  updateLoginId,
  updatePassword,
} from "./lib/supabase/auth";
import { normalizeCenterLoginId } from "./lib/supabase/credentials";
import { fetchMyCenterRoles } from "./lib/supabase/roles";
import { checkForUpdate } from "./lib/updater";
import { formatAppError, logAppError } from "./utils/errors";
import { resolveMemberLocalId } from "./utils/member";
import type {
  Center,
  DashboardStats,
  LockerFilter,
  LockerListItem,
  MemberGroupFilter,
  MemberInput,
  MemberListItem,
  MemberStatusFilter,
  BackupInfo,
  ReportInfo,
  StorageInfo,
} from "./types";

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
  const [center, setCenter] = useState<Center>("ONCLE");
  const [selfCheckinOpen, setSelfCheckinOpen] = useState(false);
  const access = useCenterPermissions(center, auth.user, auth.isAuthenticated);
  const { permissions, accessibleCenters, roleLabel, roles, loading: rolesLoading, error: rolesError } = access;
  const [activeView, setActiveView] = useState<AppView>("members");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceCheckinDate, setAttendanceCheckinDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [membershipSearch, setMembershipSearch] = useState("");
  const [lockerSearch, setLockerSearch] = useState("");
  const [lockerFilter, setLockerFilter] = useState<LockerFilter>("all");
  const [lockers, setLockers] = useState<LockerListItem[]>([]);
  const [lockersLoading, setLockersLoading] = useState(false);
  const [memberGroup, setMemberGroup] = useState<MemberGroupFilter>("all");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const debouncedAttendanceSearch = useDebouncedValue(attendanceSearch, 200);
  const debouncedMembershipSearch = useDebouncedValue(membershipSearch, 200);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberListItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberListItem | null>(null);
  const [toast, setToast] = useState("");
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null);

  const syncContext = useMemo(
    () => ({
      loginEmail: auth.user?.email ?? null,
      roles,
      rolesLoaded: !rolesLoading,
      rolesError,
    }),
    [auth.user?.email, roles, rolesLoading, rolesError],
  );

  const sync = useSync(auth.isAuthenticated, syncContext);

  const refreshReportInfo = useCallback(async () => {
    const info = await api.fetchReportInfo();
    setReportInfo(info);
    return info;
  }, []);

  useAutoDailyReport({
    enabled:
      auth.isAuthenticated &&
      sync.configured &&
      sync.online &&
      permissions.canExportRoster,
    roles,
    accessibleCenters,
    onComplete: (message) => setToast(message),
    onSaved: () => void refreshReportInfo(),
  });

  const canSync =
    permissions.canCreateMember ||
    permissions.canEditMember ||
    permissions.canEditMemberMemo ||
    permissions.canDeleteMember;

  useEffect(() => {
    if (!permissions.enforced) return;
    if (accessibleCenters.length === 0) return;
    if (!accessibleCenters.includes(center)) {
      setCenter(accessibleCenters[0]);
    }
  }, [accessibleCenters, center, permissions.enforced]);

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
    const nextStats = await api.fetchDashboardStats(center);
    setStats(nextStats);
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
      const deduped = normalizeMembers(result.members);
      const dedupedCount = deduped.length !== result.members.length
        ? result.total - (result.members.length - deduped.length)
        : result.total;
      setMembers(deduped);
      setTotal(dedupedCount);
      setSelectedMember((current) => {
        if (!current) return null;
        return deduped.find((member) => member.id === current.id) ?? current;
      });
    } finally {
      setLoading(false);
    }
  }, [center, debouncedSearch, memberGroup, statusFilter, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [center, debouncedSearch, memberGroup, statusFilter, pageSize]);

  const refreshLockers = useCallback(async () => {
    if (!permissions.canManageLocker) {
      setLockers([]);
      return;
    }
    setLockersLoading(true);
    try {
      const items = await api.listLockers(center);
      setLockers(items);
    } catch (error) {
      setToast(formatAppError(error));
    } finally {
      setLockersLoading(false);
    }
  }, [center, permissions.canManageLocker]);

  useEffect(() => {
    refreshMembers().catch((error) => setToast(String(error)));
  }, [refreshMembers]);

  useEffect(() => {
    const onPullComplete = () => {
      refreshMembers().catch(() => undefined);
      refreshDashboard().catch(() => undefined);
      refreshLockers().catch(() => undefined);
    };
    window.addEventListener("climb-sync-pull-complete", onPullComplete);
    return () => window.removeEventListener("climb-sync-pull-complete", onPullComplete);
  }, [refreshMembers, refreshDashboard, refreshLockers]);

  useEffect(() => {
    if (activeView === "lockers") {
      refreshLockers().catch((error) => setToast(String(error)));
    }
  }, [activeView, refreshLockers]);

  useEffect(() => {
    refreshDashboard().catch((error) => setToast(String(error)));
  }, [refreshDashboard]);

  useEffect(() => {
    void refreshStorageInfo()
      .then(() => refreshBackupInfo())
      .then((backup) => {
        if (backup?.created_on_startup && backup.last_backup_at) {
          setToast(`오늘 자동 백업 완료 · JSON·DB (${backup.last_backup_at})`);
        }
      })
      .then(() => refreshReportInfo());
  }, [refreshStorageInfo, refreshBackupInfo, refreshReportInfo]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isTauriApp() || !auth.isAuthenticated) return;
    void checkForUpdate().then((result) => {
      if (result.kind === "available") {
        setToast(`새 버전 v${result.version}이 있습니다. 설정 → 업데이트 확인에서 설치할 수 있습니다.`);
      }
    });
  }, []);

  const membershipSummary = useMemo(() => {
    if (!stats) return "";
    return `월권 ${stats.monthly_count} · 횟수권 ${stats.session_count} · 주니어 ${stats.junior_count}`;
  }, [stats]);

  const filterMembersByQuery = useCallback(
    (list: MemberListItem[], query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
          (m.memo ?? "").toLowerCase().includes(q),
      );
    },
    [],
  );

  const attendanceMembers = useMemo(
    () => filterMembersByQuery(members, debouncedAttendanceSearch),
    [members, debouncedAttendanceSearch, filterMembersByQuery],
  );

  const membershipMembers = useMemo(
    () => filterMembersByQuery(members, debouncedMembershipSearch),
    [members, debouncedMembershipSearch, filterMembersByQuery],
  );

  async function openMemberById(memberId: number) {
    setActiveView("members");
    const found = members.find((m) => m.id === memberId);
    if (found) {
      setSelectedMember(found);
      return;
    }
    try {
      const detail = await api.getMemberDetail(memberId);
      const ms = detail.active_membership;
      setSelectedMember({
        id: detail.member.id,
        name: detail.member.name,
        phone: detail.member.phone,
        member_type: detail.member.member_type,
        center: detail.member.center,
        memo: detail.member.memo,
        status: detail.member.status,
        membership_id: ms?.id ?? null,
        membership_type: ms?.membership_type ?? null,
        pass_type: ms?.pass_type ?? null,
        start_date: ms?.start_date ?? null,
        end_date: ms?.end_date ?? null,
        total_count: ms?.total_count ?? null,
        remaining_count: ms?.remaining_count ?? null,
        membership_status: ms?.status ?? null,
        display_status: detail.member.status,
        remaining_text: "",
        last_visit_at: detail.attendance[0]?.checkin_at ?? null,
        pause_remaining_days: null,
        created_at: detail.member.created_at,
        updated_at: detail.member.updated_at,
      });
    } catch {
      setToast("회원 정보를 불러오지 못했습니다.");
    }
  }

  async function handleSaveMember(input: MemberInput) {
    try {
      if (permissions.enforced) {
        if (rolesLoading) {
          throw new Error("권한 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
        }
        if (rolesError) {
          throw new Error("권한 정보 없음");
        }
        if (!accessibleCenters.includes(input.center)) {
          throw new Error(REGISTER_DENIED);
        }
      }
      const payload: MemberInput = {
        ...input,
        edited_by: currentLoginId || null,
      };
      if (editingMember) {
        assertPermission(
          permissions.canEditMember || permissions.canEditMemberMemo,
          permissions.denyReason,
        );
        const result = await api.editMember(editingMember.id, payload);
        setSelectedMember((current) =>
          current?.id === editingMember.id ? result.data : current,
        );
        showMutationToast(setToast, "회원 정보가 수정되었습니다.", result);
      } else {
        const canRegister = canRegisterMemberInCenter(roles, input.center, permissions.enforced);
        assertPermission(canRegister, REGISTER_DENIED);
        const enqueueSync = canRegisterMemberInCenter(roles, input.center, permissions.enforced);
        const result = await api.addMember(payload, { enqueueSync });
        setSelectedMember(result.data);
        showMutationToast(setToast, "새 회원이 등록되었습니다.", result);
      }
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo(), refreshStorageInfo()]);
      sync
        .syncNow()
        .then((syncResult) => {
          if (syncResult?.pushed && syncResult.pushed > 0) {
            setToast(`저장 완료 · 서버 저장 ${syncResult.pushed}건`);
          } else if (syncResult?.failed && syncResult.failed > 0 && syncResult.message) {
            console.error("[Supabase sync]", syncResult.errors);
            setToast(`저장 완료 · ${syncResult.message}`);
          }
        })
        .catch((syncError) => {
          setToast(`저장 완료 · ${formatAppError(syncError)}`);
        });
    } catch (error) {
      const message = logAppError("회원 저장", error);
      setToast(message);
      throw error;
    }
  }

  async function handleDeleteMember(member: MemberListItem) {
    try {
      assertPermission(permissions.canDeleteMember, permissions.denyReason);
    } catch (error) {
      setToast(formatAppError(error));
      return;
    }
    const confirmed = window.confirm(`${member.name} 회원을 삭제하시겠습니까?`);
    if (!confirmed) return;
    try {
      const result = await api.removeMember(member.id);
      if (selectedMember?.id === member.id) setSelectedMember(null);
      showMutationToast(setToast, "회원이 삭제되었습니다.", result);
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo()]);
      sync.syncNow().catch(() => undefined);
    } catch (error) {
      setToast(formatAppError(error));
    }
  }

  async function handleAttendance(
    member: MemberListItem,
    options?: { forceDuplicate?: boolean; checkinDate?: string | null },
  ): Promise<MemberListItem | null> {
    assertPermission(permissions.canCheckAttendance, permissions.denyReason);
    const memberId = resolveMemberLocalId(member);
    if (!memberId) {
      setToast("회원 ID를 찾을 수 없습니다.");
      throw new Error("회원 ID를 찾을 수 없습니다.");
    }

    const checkinDate = options?.checkinDate ?? null;
    const today = new Date().toISOString().slice(0, 10);
    if (checkinDate && checkinDate > today) {
      const msg = "미래 날짜로는 출석 체크할 수 없습니다.";
      setToast(msg);
      throw new Error(msg);
    }

    const forceDuplicate = options?.forceDuplicate ?? false;

    try {
      const result = await api.recordAttendance(member, {
        membershipId: member.membership_id,
        forceDuplicate,
        checkinDate,
        editor: currentLoginId || null,
      });
      setSelectedMember(result.data);
      if (result.backup_warning) {
        setToast(result.backup_warning);
      }
      await Promise.all([refreshMembers(), refreshDashboard(), refreshBackupInfo()]);
      sync.syncNow().catch(() => undefined);
      return result.data;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (!forceDuplicate && /OUT_OF_PERIOD/i.test(rawMessage)) {
        const confirmed = window.confirm(
          "선택한 출석일이 회원권 기간 밖입니다. 그래도 출석을 기록하시겠습니까?",
        );
        if (confirmed) {
          return handleAttendance(member, { forceDuplicate: true, checkinDate });
        }
        return null;
      }
      const message = logAppError("출석 체크", error);
      setToast(message);
      throw error;
    }
  }

  async function handleBackup() {
    try {
      assertPermission(permissions.role === "owner", permissions.denyReason);
      const result = await api.manualBackup();
      setToast(`수동 백업 완료 · JSON·DB (${result.created_at})`);
      await refreshBackupInfo();
    } catch (error) {
      setToast(formatAppError(error));
    }
  }

  async function handleOpenBackupFolder() {
    try {
      await api.openBackupFolder();
    } catch (error) {
      setToast(formatAppError(error));
    }
  }

  async function handleOpenDataFolder() {
    try {
      await api.openDataFolder();
    } catch (error) {
      setToast(formatAppError(error));
    }
  }

  async function handleRestoreBackup() {
    try {
      assertPermission(permissions.role === "owner", permissions.denyReason);
    } catch (error) {
      setToast(formatAppError(error));
      return;
    }
    if (!isTauriApp()) {
      setToast("브라우저 미리보기에서는 백업 복원을 지원하지 않습니다.");
      return;
    }

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

  const memoOnlyEdit =
    Boolean(editingMember) &&
    !permissions.canEditMember &&
    permissions.canEditMemberMemo;

  const requiresLogin = isSupabaseConfigured() || isTauriApp();
  const currentLoginId = getCurrentLoginId(auth.user);

  async function handleLogin(loginId: string, password: string) {
    const user = await auth.login(loginId, password);
    if (!user) {
      await auth.logout();
      throw new Error("로그인에 실패했습니다.");
    }
    const roles = await fetchMyCenterRoles(user.id);
    const roleError = validateLoginRoles(roles);
    if (roleError) {
      await auth.logout();
      throw new Error(roleError);
    }
    await access.refreshRoles();
    const centers = getAccessibleCenters(roles, isSupabaseConfigured());
    const loginKey = normalizeCenterLoginId(loginId);
    if (loginKey === "oncle" && centers.includes("ONCLE")) {
      setCenter("ONCLE");
    } else if (loginKey === "grabit" && centers.includes("GRABIT")) {
      setCenter("GRABIT");
    } else if (loginKey === "grabon" && centers.includes("ONCLE")) {
      setCenter("ONCLE");
    } else if (centers.length > 0) {
      setCenter(centers[0]);
    }
    setToast(`${loginWelcomeLabel(roles)} 로그인되었습니다.`);
    sync.syncNow().then((result) => {
      if (result?.message) setToast(result.message);
    }).catch(() => undefined);
  }

  if (isTauriApp() && !isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="glass-panel max-w-md rounded-[1.5rem] p-8 text-center">
          <h1 className="text-xl font-bold">서버 설정 오류</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            설치 파일에 Supabase 연결 정보가 없습니다. 앱을 다시 빌드하거나 관리자에게 문의하세요.
          </p>
        </div>
      </div>
    );
  }

  if (requiresLogin && auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--muted)]">로그인 정보 확인 중...</p>
      </div>
    );
  }

  if (selfCheckinOpen) {
    return <SelfCheckinPanel onClose={() => setSelfCheckinOpen(false)} />;
  }

  if (requiresLogin && !auth.isAuthenticated) {
    return (
      <LoginScreen
        loading={auth.loading}
        onSubmit={handleLogin}
        onOpenSelfCheckin={() => setSelfCheckinOpen(true)}
      />
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      {permissions.enforced && !permissions.hasCenterAccess && (
        <div className="mx-auto mb-4 max-w-[1500px] rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          이 센터에 대한 권한이 없습니다. 관리자에게 센터 권한 부여를 요청하세요.
        </div>
      )}
      {access.error && (
        <div className="mx-auto mb-4 max-w-[1500px] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
          권한 정보를 불러오지 못했습니다: {access.error}
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
            if (!permissions.canCreateMember) {
              setToast(permissions.denyReason);
              return;
            }
            setEditingMember(null);
            setModalOpen(true);
          }}
          stats={stats}
          backupInfo={backupInfo}
          permissions={permissions}
          accessibleCenters={accessibleCenters}
          showMemberFilters={activeView === "members"}
          showStats={activeView === "members" || activeView === "expiring"}
        />

        <MainNav
          activeView={activeView}
          onViewChange={setActiveView}
          permissions={permissions}
          onOpenSettings={() => {
            if (!permissions.canOpenSettings) {
              setToast(permissions.denyReason);
              return;
            }
            setSettingsOpen(true);
          }}
        />

        <SyncStatusBar
          configured={sync.configured}
          online={sync.online}
          authenticated={auth.isAuthenticated}
          roleLabel={roleLabel}
          canSync={canSync}
          status={sync.status}
          phase={sync.phase}
          lastResult={sync.lastResult}
          onSync={() => {
            if (!canSync) {
              setToast(permissions.denyReason);
              return;
            }
            sync
              .syncNow()
              .then((result) => {
                if (result?.message) setToast(result.message);
              })
              .catch((error) => setToast(formatAppError(error)));
          }}
          onLogin={() => setToast("로그아웃 후 다시 로그인해주세요.")}
          onLogout={() => {
            auth.logout().catch((error) => setToast(formatAppError(error)));
          }}
          onRepairQueue={() => {
            sync
              .repairQueue()
              .then((result) => setToast(result.message))
              .catch((error) => setToast(formatAppError(error)));
          }}
          onPurgeUnsupported={() => {
            const failedCount = sync.status?.failed_count ?? 0;
            const pendingCount = sync.status?.pending_count ?? 0;
            const confirmed = window.confirm(
              `동기화 대기 ${pendingCount}건${failedCount > 0 ? ` (실패 ${failedCount}건)` : ""} 중 실패·불필요 항목을 제거합니다.\n계속하시겠습니까?`,
            );
            if (!confirmed) return;
            sync
              .purgeUnsupported()
              .then((result) => {
                setToast(result.message);
                return sync.syncNow();
              })
              .then((syncResult) => {
                if (syncResult?.message) setToast(syncResult.message);
              })
              .catch((error) => setToast(formatAppError(error)));
          }}
        />

        {activeView === "members" && permissions.canViewStats && membershipSummary && (
          <p className="px-1 text-sm text-[var(--muted)]">회원권 구성 · {membershipSummary}</p>
        )}

        {activeView === "members" && (
          <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
            <div className="space-y-4">
              <MemberList
                members={members}
                loading={loading}
                memberGroup={memberGroup}
                selectedId={selectedMember?.id ?? null}
                permissions={permissions}
                onSelect={setSelectedMember}
                onEdit={(member) => {
                  if (!permissions.canEditMember && !permissions.canEditMemberMemo) {
                    setToast(permissions.denyReason);
                    return;
                  }
                  setEditingMember(member);
                  setModalOpen(true);
                }}
                onDelete={handleDeleteMember}
                onAttendance={async (member) => {
                  const updated = await handleAttendance(member);
                  if (updated) setToast(`${updated.name}님 출석 완료`);
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
                permissions={permissions}
                onAttendance={(member, checkinDate) => handleAttendance(member, { checkinDate })}
                editor={currentLoginId}
                onUpdated={(updated) => {
                  setSelectedMember(updated);
                  setMembers((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  );
                }}
              />
            </div>
          </div>
        )}

        {activeView === "attendance" && (
          <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
            <AttendanceCheckPanel
              members={attendanceMembers}
              loading={loading}
              search={attendanceSearch}
              onSearch={setAttendanceSearch}
              permissions={permissions}
              selectedId={selectedMember?.id ?? null}
              onSelect={setSelectedMember}
              checkinDate={attendanceCheckinDate}
              onCheckinDateChange={setAttendanceCheckinDate}
              onAttendance={(member, checkinDate) => {
                const today = new Date().toISOString().slice(0, 10);
                void handleAttendance(member, { checkinDate: checkinDate === today ? null : checkinDate }).then((updated) => {
                  if (updated) setToast(`${updated.name}님 출석 완료${checkinDate !== today ? ` (${checkinDate})` : ""}`);
                });
              }}
            />
            <MemberDetailPanel
              member={selectedMember}
              permissions={permissions}
              onAttendance={(member, checkinDate) => handleAttendance(member, { checkinDate })}
                editor={currentLoginId}
              onUpdated={(updated) => {
                setSelectedMember(updated);
                setMembers((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                );
              }}
            />
          </div>
        )}

        {activeView === "memberships" && (
          <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
            <MembershipManagementPanel
              members={membershipMembers}
              loading={loading}
              search={membershipSearch}
              onSearch={setMembershipSearch}
              permissions={permissions}
              selectedId={selectedMember?.id ?? null}
              onSelect={setSelectedMember}
              onUpdated={(updated) => {
                setSelectedMember(updated);
                setMembers((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                );
                refreshMembers().catch(() => undefined);
              }}
              onNotify={setToast}
            />
            <MemberDetailPanel
              member={selectedMember}
              permissions={permissions}
              onAttendance={(member, checkinDate) => handleAttendance(member, { checkinDate })}
                editor={currentLoginId}
              onUpdated={(updated) => {
                setSelectedMember(updated);
                setMembers((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                );
              }}
            />
          </div>
        )}

        {activeView === "lockers" && permissions.canManageLocker && (
          <LockerManagementPanel
            lockers={lockers}
            loading={lockersLoading}
            filter={lockerFilter}
            onFilterChange={setLockerFilter}
            search={lockerSearch}
            onSearch={setLockerSearch}
            onLockerClick={(memberId) => {
              openMemberById(memberId).catch((error) => setToast(String(error)));
            }}
          />
        )}

        {activeView === "roster" && permissions.canViewRoster && (
          <MemberRosterPanel
            permissions={permissions}
            roles={roles}
            accessibleCenters={accessibleCenters}
            onNotify={setToast}
          />
        )}

        {activeView === "expiring" && permissions.canViewRoster && (
          <MemberStatusPanel
            permissions={permissions}
            roles={roles}
            accessibleCenters={accessibleCenters}
          />
        )}
      </div>

      <MemberFormModal
        isOpen={modalOpen}
        center={center}
        member={editingMember}
        memoOnly={memoOnlyEdit}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSaveMember}
      />

      <SettingsPanel
        open={settingsOpen}
        center={center}
        onClose={() => setSettingsOpen(false)}
        backupInfo={backupInfo}
        storageInfo={storageInfo}
        reportInfo={reportInfo}
        canBackupRestore={permissions.canBackupRestore}
        canOpenBackupFolder={permissions.canOpenBackupFolder}
        canCheckUpdate={permissions.canCheckUpdate}
        canManageAccount={permissions.canManageAccount}
        canExportRoster={permissions.canExportRoster}
        canSyncPush={permissions.canSyncPush}
        canSyncPull={permissions.canSyncPull}
        currentLoginId={currentLoginId}
        onChangeLoginId={async (loginId) => {
          await updateLoginId(loginId);
        }}
        onChangePassword={async (password) => {
          await updatePassword(password);
        }}
        onOpenDataFolder={() => {
          handleOpenDataFolder().catch((error) => setToast(String(error)));
        }}
        onOpenBackupFolder={() => {
          handleOpenBackupFolder().catch((error) => setToast(String(error)));
        }}
        onOpenReportsFolder={
          permissions.canExportRoster
            ? () => api.openReportsFolder().catch((error) => setToast(String(error)))
            : undefined
        }
        onOpenReportsArchiveFolder={
          permissions.canExportRoster
            ? () => api.openReportsArchiveFolder().catch((error) => setToast(String(error)))
            : undefined
        }
        onOpenCombinedReport={
          permissions.canExportRoster
            ? () => api.openReportFile("회원명부_통합.xlsx").catch((error) => setToast(String(error)))
            : undefined
        }
        onRestoreBackup={() => {
          handleRestoreBackup().catch((error) => setToast(String(error)));
        }}
        onBackup={() => {
          handleBackup().catch((error) => setToast(String(error)));
        }}
        syncConfigured={sync.configured}
        syncOnline={sync.online}
        syncStatus={sync.status}
        syncBusy={sync.phase === "pushing" || sync.phase === "pulling"}
        onPullFromSupabase={() => {
          sync
            .pullNow()
            .then((result) => {
              if (result?.message) setToast(result.message);
              if (
                result &&
                (result.importedMembers > 0 ||
                  result.updatedMembers > 0 ||
                  result.importedMemberships > 0)
              ) {
                window.dispatchEvent(new CustomEvent("climb-sync-pull-complete"));
              }
            })
            .catch((error) => setToast(formatAppError(error)));
        }}
        onPushToSupabase={
          permissions.canSyncPush
            ? () => {
                if (!canSync) {
                  setToast(permissions.denyReason);
                  return;
                }
                sync
                  .syncNow()
                  .then((result) => {
                    if (result?.message) setToast(result.message);
                  })
                  .catch((error) => setToast(formatAppError(error)));
              }
            : undefined
        }
        onNotify={setToast}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
