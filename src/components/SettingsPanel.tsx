import { AlertTriangle, DatabaseBackup, Download, FolderOpen, KeyRound, RefreshCw, Settings, ShieldAlert, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttendanceMismatchDiagnostic, BackupInfo, Center, CenterMappingDiagnosticRow, DuplicateMemberCandidateGroup, LocalDuplicateCleanupSummary, MemberMatchEntry, ReportInfo, ServerCenterConsistency, ServerMatchReport, StorageInfo, SyncDiagnostics, UploadVerificationReport } from "../types";
import { fetchCenterMappingDiagnostics, buildCenterMappingCorrections } from "../sync/centerMappingDiagnostics";
import type { SyncStatus } from "../sync/types";
import { formatDateTimeSeoul } from "../lib/roster/time";
import { checkForUpdate, getAppVersion, installUpdate, runUpdateDiagnostic, UPDATER_ENDPOINT, type UpdateCheckOutcome, type UpdateDiagnosticResult } from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { api } from "../api/client";
import { repairSyncQueue, runSyncVerificationReport, type SyncVerificationReport } from "../sync/engine";
import { getSupabaseClient } from "../lib/supabase/client";
import { invoke } from "@tauri-apps/api/core";
import { safeSyncDryRun, executeSafeSync, type SafeSyncDryRun, type SafeSyncResult } from "../sync/safeSync";
import type { CleanupDryRun, CleanupResult } from "../sync/cleanupTypes";
import { runHealthCheck, type HealthCheckResult } from "../sync/healthCheck";

// ---------------------------------------------------------------------------
// Diagnostic report types (v1.0.54)
// ---------------------------------------------------------------------------

interface DiagItem {
  localId: number;
  isTestData: boolean;
  classification: string;
  classificationReason: string;
}
interface DiagMembershipItem extends DiagItem {
  membershipType: string;
  memberName: string;
  memberCenter: string;
  memberRemoteId: string | null;
}
interface DiagAttendanceItem extends DiagItem {
  checkinAt: string;
  memberName: string;
  memberCenter: string;
  memberRemoteId: string | null;
  membershipRemoteId: string | null;
}
interface DiagSyncQueueItem extends DiagItem {
  entityType: string;
  operation: string;
  entityLocalId: number;
  retryCount: number;
  lastError: string | null;
  memberName: string | null;
  memberRemoteId: string | null;
}
interface DiagSection<T> {
  total: number;
  summary: Record<string, number>;
  items: T[];
}
interface DiagnosticReport {
  generatedAt: string;
  membershipsNoRemoteId: DiagSection<DiagMembershipItem>;
  attendanceNoRemoteId: DiagSection<DiagAttendanceItem>;
  syncQueue: DiagSection<DiagSyncQueueItem>;
  diagFilePath: string | null;
}

interface SettingsPanelProps {
  open: boolean;
  center?: Center;
  onClose: () => void;
  backupInfo: BackupInfo | null;
  storageInfo: StorageInfo | null;
  reportInfo?: ReportInfo | null;
  canBackupRestore?: boolean;
  canOpenBackupFolder?: boolean;
  canCheckUpdate?: boolean;
  canManageAccount?: boolean;
  canExportRoster?: boolean;
  canSyncPush?: boolean;
  canSyncPull?: boolean;
  currentLoginId?: string;
  onChangeLoginId?: (loginId: string) => Promise<void>;
  onChangePassword?: (password: string) => Promise<void>;
  onOpenDataFolder: () => void;
  onOpenBackupFolder: () => void;
  onOpenReportsFolder?: () => void;
  onOpenReportsArchiveFolder?: () => void;
  onOpenCombinedReport?: () => void;
  onRestoreBackup: () => void;
  onBackup: () => void;
  onNotify: (message: string) => void;
  syncConfigured?: boolean;
  syncOnline?: boolean;
  syncStatus?: SyncStatus | null;
  syncBusy?: boolean;
  onPullFromSupabase?: () => void;
  onForcePullFromSupabase?: () => Promise<{
    serverCount: number;
    fetchedCount: number;
    localDbCount: number;
    localDisplayCount: number;
    noRemoteIdCount: number;
    displayCount: number;
    message: string;
    verdict: string;
    missingCount?: number;
    missingSample?: Array<{ remoteId: string; name: string; memberNo: number | null; phone: string | null; phoneNormalizedVal: string | null; center: string; status: string; isTestData: boolean; failReason: string | null }>;
    diagFilePath?: string;
  }>;
  onPushToSupabase?: () => void;
  allowedCenterIds?: string[];
}
export function SettingsPanel({
  open,
  center,
  onClose,
  backupInfo,
  storageInfo,
  reportInfo = null,
  onOpenDataFolder,
  onOpenBackupFolder,
  onOpenReportsFolder,
  onOpenReportsArchiveFolder,
  onOpenCombinedReport,
  onRestoreBackup,
  onBackup,
  onNotify,
  canBackupRestore = false,
  canOpenBackupFolder = false,
  canCheckUpdate = true,
  canManageAccount = false,
  canExportRoster = false,
  canSyncPush = false,
  canSyncPull = true,
  currentLoginId = "",
  onChangeLoginId,
  onChangePassword,
  syncConfigured = false,
  syncOnline = false,
  syncStatus = null,
  syncBusy = false,
  onPullFromSupabase,
  onForcePullFromSupabase,
  onPushToSupabase,
  allowedCenterIds,
}: SettingsPanelProps) {
  const [appVersion, setAppVersion] = useState("...");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckOutcome | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [newLoginId, setNewLoginId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<LocalDuplicateCleanupSummary | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateMemberCandidateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [verifyBusyId, setVerifyBusyId] = useState<number | null>(null);

  const [centerMappingRows, setCenterMappingRows] = useState<CenterMappingDiagnosticRow[] | null>(null);
  const [centerMappingLoading, setCenterMappingLoading] = useState(false);
  const [centerMappingRepairBusy, setCenterMappingRepairBusy] = useState(false);

  const [verifyReport, setVerifyReport] = useState<SyncVerificationReport | null>(null);
  const [verifyReportLoading, setVerifyReportLoading] = useState(false);

  const [updateDiagnostic, setUpdateDiagnostic] = useState<UpdateDiagnosticResult | null>(null);
  const [updateDiagnosticLoading, setUpdateDiagnosticLoading] = useState(false);

  const [uploadReport, setUploadReport] = useState<UploadVerificationReport | null>(null);
  const [uploadReportLoading, setUploadReportLoading] = useState(false);
  const [repairingMismatch, setRepairingMismatch] = useState(false);
  const [mismatchDiag, setMismatchDiag] = useState<AttendanceMismatchDiagnostic | null>(null);
  const [mismatchMemberId, setMismatchMemberId] = useState("");
  const [mismatchLoading, setMismatchLoading] = useState(false);
  const [correctingRemaining, setCorrectingRemaining] = useState(false);
  const [uploadingMemberId, setUploadingMemberId] = useState<number | null>(null);
  const [memberActionResults, setMemberActionResults] = useState<Record<number, { ok: boolean; message: string }>>({});

  const [serverMatchReport, setServerMatchReport] = useState<ServerMatchReport | null>(null);
  const [serverMatchLoading, setServerMatchLoading] = useState(false);
  const [linkingMemberId, setLinkingMemberId] = useState<number | null>(null);

  const [serverConsistency, setServerConsistency] = useState<ServerCenterConsistency | null>(null);
  const [serverConsistencyLoading, setServerConsistencyLoading] = useState(false);

  const [forcePullBusy, setForcePullBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagReport, setDiagReport] = useState<DiagnosticReport | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);
  const [safeSyncBusy, setSafeSyncBusy] = useState(false);
  const [safeSyncDryRunResult, setSafeSyncDryRunResult] = useState<SafeSyncDryRun | null>(null);
  const [safeSyncConfirmOpen, setSafeSyncConfirmOpen] = useState(false);
  const [safeSyncResult, setSafeSyncResult] = useState<SafeSyncResult | null>(null);
  const [safeSyncProgress, setSafeSyncProgress] = useState("");
  const [queueCleanupBusy, setQueueCleanupBusy] = useState(false);
  const [queueCleanupDryRun, setQueueCleanupDryRun] = useState<CleanupDryRun | null>(null);
  const [queueCleanupConfirmOpen, setQueueCleanupConfirmOpen] = useState(false);
  const [queueCleanupResult, setQueueCleanupResult] = useState<CleanupResult & { reportFilePath?: string } | null>(null);
  const [forcePullResult, setForcePullResult] = useState<{
    serverCount: number;
    fetchedCount: number;
    localDbCount: number;
    localDisplayCount: number;
    noRemoteIdCount: number;
    displayCount: number;
    message: string;
    verdict: string;
    warning?: string;
    missingCount?: number;
    missingSample?: Array<{ remoteId: string; name: string; memberNo: number | null; phone: string | null; phoneNormalizedVal: string | null; center: string; status: string; isTestData: boolean; failReason: string | null }>;
    diagFilePath?: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    void getAppVersion().then(setAppVersion);
    setNewLoginId(currentLoginId);
    setNewPassword("");
    setConfirmPassword("");
    setUpdateResult(null);
    setPendingUpdate(null);
  }, [open, currentLoginId]);

  async function handleChangeLoginId() {
    if (!onChangeLoginId) return;
    const trimmed = newLoginId.trim();
    if (!trimmed) {
      onNotify("새 아이디를 입력해주세요.");
      return;
    }
    if (trimmed === currentLoginId) {
      onNotify("현재와 같은 아이디입니다.");
      return;
    }
    setSavingAccount(true);
    try {
      await onChangeLoginId(trimmed);
      onNotify("아이디가 변경되었습니다. 다음 로그인부터 새 아이디를 사용하세요.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleChangePassword() {
    if (!onChangePassword) return;
    if (newPassword.length < 8) {
      onNotify("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setSavingAccount(true);
    try {
      await onChangePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      onNotify("비밀번호가 변경되었습니다.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateResult(null);
    setPendingUpdate(null);
    try {
      const result = await checkForUpdate();
      setUpdateResult(result);
      if (result.kind === "skipped") {
        onNotify("데스크톱 앱에서만 업데이트를 확인할 수 있습니다.");
        return;
      }
      if (result.kind === "latest" || result.kind === "error") {
        onNotify(result.message);
        return;
      }
      if (result.kind === "available") {
        setPendingUpdate(result.update);
        onNotify(result.message);
      }
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!pendingUpdate) return;
    setInstallingUpdate(true);
    try {
      const result = await installUpdate(
        pendingUpdate,
        updateResult?.kind === "available" ? updateResult.diagnostics : [],
      );
      setUpdateResult(result);
      if (result.kind === "error" || result.kind === "installed") {
        onNotify(result.message);
      }
    } finally {
      setInstallingUpdate(false);
    }
  }

  async function handleRunUpdateDiagnostic() {
    setUpdateDiagnosticLoading(true);
    try {
      const result = await runUpdateDiagnostic({
        buildDate: __BUILD_DATE__,
        buildCommit: __BUILD_COMMIT__,
      });
      setUpdateDiagnostic(result);
    } finally {
      setUpdateDiagnosticLoading(false);
    }
  }

  async function handleRunCleanup() {
    if (!center) return;
    setCleanupBusy(true);
    try {
      const result = await api.cleanupLocalDuplicates(center);
      setCleanupResult(result);
      setCleanupConfirmOpen(false);
      onNotify(
        result.rows_hidden > 0
          ? `로컬 중복 정리 완료: ${result.groups_processed}개 그룹, ${result.rows_hidden}건 숨김 처리됨.`
          : "정리할 로컬 중복 항목이 없습니다.",
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function handleOpenDuplicates() {
    if (!center) return;
    setDuplicatesOpen(true);
    setDuplicatesLoading(true);
    try {
      const groups = await api.findDuplicateMembers(center);
      setDuplicateGroups(groups);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setDuplicatesLoading(false);
    }
  }

  async function handleRefreshDiagnostics() {
    setDiagnosticsLoading(true);
    try {
      const result = await api.fetchSyncDiagnostics();
      setDiagnostics(result);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void handleRefreshDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleRetryFailed() {
    setRetryBusy(true);
    try {
      const repair = await repairSyncQueue();
      if (repair.message) onNotify(repair.message);
      if (onPushToSupabase) onPushToSupabase();
      await handleRefreshDiagnostics();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryBusy(false);
    }
  }

  async function handleRunVerifyReport() {
    setVerifyReportLoading(true);
    try {
      const report = await runSyncVerificationReport({
        selectedCenter: center,
        allowedCenterIds,
      });
      setVerifyReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setVerifyReportLoading(false);
    }
  }

  async function handleRefreshCenterMapping() {
    setCenterMappingLoading(true);
    try {
      const rows = await fetchCenterMappingDiagnostics();
      setCenterMappingRows(rows);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCenterMappingLoading(false);
    }
  }

  async function handleRepairCenterMapping() {
    if (!centerMappingRows) return;
    const corrections = buildCenterMappingCorrections(centerMappingRows);
    if (corrections.length === 0) {
      onNotify("보정할 항목이 없습니다.");
      return;
    }
    setCenterMappingRepairBusy(true);
    try {
      const result = await api.repairCenterMapping(corrections);
      onNotify(`센터 매핑 보정 완료: ${result.repaired}건 수정, ${result.skipped}건 건너뜀`);
      await handleRefreshCenterMapping();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCenterMappingRepairBusy(false);
    }
  }

  async function handleVerifyOnServer(localId: number, remoteId: string | null) {
    if (!remoteId) {
      onNotify("remote_id가 없어 서버 존재 확인을 할 수 없습니다.");
      return;
    }
    setVerifyBusyId(localId);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        onNotify("서버 연결을 확인해주세요.");
        return;
      }
      const { data, error } = await supabase
        .from("members")
        .select("id")
        .eq("id", remoteId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) {
        onNotify(`서버 존재 확인 실패: ${error.message}`);
        return;
      }
      onNotify(data ? `서버에 존재합니다 (id: ${data.id})` : "서버에 해당 회원이 존재하지 않습니다.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setVerifyBusyId(null);
    }
  }

  async function handleMembershipAttendanceDiag() {
    setDiagBusy(true);
    setDiagReport(null);
    try {
      const report = await invoke<DiagnosticReport>("membership_attendance_queue_diag_cmd");
      setDiagReport(report);
    } catch (error) {
      onNotify(`진단 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDiagBusy(false);
    }
  }

  async function handleHealthCheck() {
    setHealthBusy(true);
    try {
      const result = await runHealthCheck(center);
      setHealthResult(result);
    } catch (error) {
      onNotify(`점검 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setHealthBusy(false);
    }
  }

  async function handleSafeSyncDryRun() {
    setSafeSyncBusy(true);
    setSafeSyncDryRunResult(null);
    setSafeSyncResult(null);
    setSafeSyncProgress("");
    try {
      const dr = await safeSyncDryRun();
      setSafeSyncDryRunResult(dr);
      setSafeSyncConfirmOpen(true);
    } catch (error) {
      onNotify(`dry-run 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSafeSyncBusy(false);
    }
  }

  async function handleSafeSyncExecute() {
    if (!safeSyncDryRunResult) return;
    setSafeSyncConfirmOpen(false);
    setSafeSyncBusy(true);
    setSafeSyncProgress("시작 중...");
    try {
      const result = await executeSafeSync(safeSyncDryRunResult, setSafeSyncProgress);
      setSafeSyncResult(result);
      setSafeSyncProgress("");
      onNotify(`처리 완료 — 회원권 insert:${result.actions.membershipInserted} backfill:${result.actions.membershipBackfilled}, 출석 insert:${result.actions.attendanceInserted} backfill:${result.actions.attendanceBackfilled}`);
    } catch (error) {
      onNotify(`처리 실패: ${error instanceof Error ? error.message : String(error)}`);
      setSafeSyncProgress("");
    } finally {
      setSafeSyncBusy(false);
    }
  }

  async function handleQueueCleanupDryRun() {
    setQueueCleanupBusy(true);
    setQueueCleanupDryRun(null);
    setQueueCleanupResult(null);
    try {
      const dr = await invoke<CleanupDryRun>("cleanup_dry_run_cmd");
      setQueueCleanupDryRun(dr);
      setQueueCleanupConfirmOpen(true);
    } catch (error) {
      onNotify(`큐 정리 dry-run 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setQueueCleanupBusy(false);
    }
  }

  async function handleQueueCleanupExecute() {
    setQueueCleanupConfirmOpen(false);
    setQueueCleanupBusy(true);
    try {
      const result = await invoke<CleanupResult>("execute_cleanup_cmd");
      const json = JSON.stringify(result, null, 2);
      let reportFilePath: string | undefined;
      try {
        reportFilePath = await invoke<string>("save_cleanup_report_cmd", { json });
      } catch { /* ignore */ }
      setQueueCleanupResult({ ...result, reportFilePath });
      onNotify(`큐 정리 완료 — member resolved:${result.memberQueueResolved}, att resolved:${result.attendanceQueueResolved}, test hidden:${result.testMembersHidden}, dup hidden:${result.localDupMembersHidden}, ms backfill:${result.localDupMembershipsBackfilled}`);
    } catch (error) {
      onNotify(`큐 정리 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setQueueCleanupBusy(false);
    }
  }

  async function handleForcePull() {
    if (!onForcePullFromSupabase) return;
    setForcePullBusy(true);
    setForcePullResult(null);
    try {
      const result = await onForcePullFromSupabase();
      let warning: string | undefined;
      const missing = result.missingCount ?? 0;
      if (missing > 0) {
        warning = `서버 ${result.serverCount}명 중 ${missing}명의 remote_id가 로컬에 없음 — 재시도 권장`;
      } else if (result.serverCount > 0 && result.localDbCount < result.serverCount * 0.9) {
        warning = `서버 원장 ${result.serverCount}명 중 로컬 DB에 ${result.localDbCount}명만 저장됨 — upsert 오류 가능성`;
      }
      setForcePullResult({ ...result, warning });
      onNotify(result.message);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setForcePullBusy(false);
    }
  }

  async function handleRunUploadReport() {
    setUploadReportLoading(true);
    try {
      const report = await api.getUploadVerificationReport();
      setUploadReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setUploadReportLoading(false);
    }
  }

  async function handleRepairMismatch() {
    setRepairingMismatch(true);
    try {
      const count = await api.repairStatusMismatch();
      onNotify(count > 0 ? `상태 불일치 ${count}건 보정 완료 (sync_status → pending)` : "보정할 항목이 없습니다.");
      const report = await api.getUploadVerificationReport();
      setUploadReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setRepairingMismatch(false);
    }
  }

  async function handleMismatchDiagnose() {
    const id = parseInt(mismatchMemberId.trim(), 10);
    if (!id || isNaN(id)) {
      onNotify("회원 local ID를 정확히 입력해주세요.");
      return;
    }
    setMismatchLoading(true);
    try {
      const result = await api.getAttendanceMismatchDiagnostic(id);
      setMismatchDiag(result);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setMismatchLoading(false);
    }
  }

  async function handleCorrectRemaining() {
    if (!mismatchDiag) return;
    const confirmed = window.confirm(
      `${mismatchDiag.member_name}의 잔여 횟수를 ${mismatchDiag.current_remaining}회 → ${mismatchDiag.expected_remaining}회로 보정합니다. 계속하시겠습니까?`
    );
    if (!confirmed) return;
    setCorrectingRemaining(true);
    try {
      await api.correctMemberRemainingCount(mismatchDiag.member_id);
      onNotify(`${mismatchDiag.member_name} 잔여 횟수 보정 완료.`);
      const updated = await api.getAttendanceMismatchDiagnostic(mismatchDiag.member_id);
      setMismatchDiag(updated);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCorrectingRemaining(false);
    }
  }

  async function handleMatchServerMembers() {
    if (!center) return;
    setServerMatchLoading(true);
    setServerMatchReport(null);
    try {
      const report = await api.matchServerMembers(center);
      setServerMatchReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setServerMatchLoading(false);
    }
  }

  async function handleLinkMember(entry: MemberMatchEntry, remoteId: string) {
    setLinkingMemberId(entry.local_id);
    try {
      await api.linkMemberRemoteId(entry.local_id, remoteId);
      onNotify(`"${entry.local_name}" 연결 완료 (remote_id: ${remoteId.slice(0, 8)}...)`);
      await handleMatchServerMembers();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setLinkingMemberId(null);
    }
  }

  async function handleCheckServerConsistency() {
    if (!center) return;
    setServerConsistencyLoading(true);
    setServerConsistency(null);
    try {
      const result = await api.getServerCenterConsistency(center);
      setServerConsistency(result);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setServerConsistencyLoading(false);
    }
  }

  async function handleUploadMember(localId: number) {
    setUploadingMemberId(localId);
    try {
      const result = await api.uploadLocalMember(localId);
      setMemberActionResults((prev) => ({ ...prev, [localId]: result }));
      if (result.ok) {
        const report = await api.getUploadVerificationReport();
        setUploadReport(report);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemberActionResults((prev) => ({ ...prev, [localId]: { ok: false, message } }));
    } finally {
      setUploadingMemberId(null);
    }
  }

  async function handleExcludeMember(localId: number, name: string) {
    const confirmed = window.confirm(
      `"${name}" 회원을 업로드 제외로 표시합니다. 이 회원은 동기화 대상에서 빠집니다. 계속하시겠습니까?`
    );
    if (!confirmed) return;
    try {
      await api.excludeMemberFromUpload(localId);
      setMemberActionResults((prev) => ({ ...prev, [localId]: { ok: true, message: "업로드 제외로 설정됨" } }));
      const report = await api.getUploadVerificationReport();
      setUploadReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleHideMember(localId: number, name: string) {
    const confirmed = window.confirm(
      `"${name}" 회원을 로컬에서 숨김 처리합니다. 회원 목록에서 보이지 않게 됩니다. 계속하시겠습니까?`
    );
    if (!confirmed) return;
    try {
      await api.setMemberHiddenLocally(localId);
      onNotify(`"${name}" 회원이 숨김 처리되었습니다.`);
      const report = await api.getUploadVerificationReport();
      setUploadReport(report);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="glass-panel w-full max-w-lg rounded-[1.5rem]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">설정</h2>
              <p className="text-sm text-[var(--muted)]">앱 버전 · 동기화 · 업데이트</p>
            </div>
          </div>
          <button className="btn btn-secondary !px-3" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[85vh] space-y-4 overflow-y-auto px-6 py-5">
          {/* ── 운영 상태 점검 ── */}
          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert size={18} className="text-emerald-500" />
              <p className="text-sm font-semibold text-[var(--text)]">운영 상태 점검</p>
            </div>
            <button
              className="btn btn-secondary w-full"
              disabled={healthBusy}
              onClick={() => void handleHealthCheck()}
            >
              <RefreshCw size={16} className={healthBusy ? "animate-spin" : ""} />
              {healthBusy ? "점검 중..." : "운영 상태 점검"}
            </button>
            {healthResult && (
              <div className="mt-3 space-y-2">
                <div className={`rounded-xl p-3 text-center text-sm font-semibold ${
                  healthResult.verdict === "ok" || healthResult.verdict === "ok_info" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30" :
                  healthResult.verdict === "caution" ? "bg-amber-500/10 text-amber-400 border border-amber-500/30" :
                  healthResult.verdict === "admin_required" ? "bg-red-500/10 text-red-400 border border-red-500/30" :
                  "bg-gray-500/10 text-gray-400 border border-gray-500/30"
                }`}>
                  <div className="text-lg">{healthResult.verdictLabel}</div>
                  <div className="mt-1 text-xs font-normal opacity-80">{healthResult.verdictMessage}</div>
                  <div className="mt-1 text-[10px] font-normal opacity-60">{healthResult.action}</div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px] space-y-1">
                  {healthResult.items.map((item, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-[var(--muted)]">{item.label}</span>
                      <span className={`font-semibold ${
                        item.status === "ok" ? "text-emerald-500" :
                        item.status === "warn" ? "text-amber-400" :
                        item.status === "error" ? "text-red-400" :
                        "text-[var(--text)]"
                      }`}>{item.value}</span>
                    </div>
                  ))}
                  {healthResult.infoItems.length > 0 && (
                    <details className="pt-1">
                      <summary className="cursor-pointer text-[10px] text-[var(--muted)]">참고 항목 {healthResult.infoItems.length}건 (운영 영향 없음)</summary>
                      <div className="mt-1 space-y-0.5">
                        {healthResult.infoItems.map((item, i) => (
                          <div key={i} className="flex justify-between text-[var(--muted)]">
                            <span>{item.label}</span>
                            <span>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="pt-1 text-[9px] text-[var(--muted)]">점검 시간: {healthResult.checkedAt}</div>
                </div>
              </div>
            )}
          </div>

          {canManageAccount && (
            <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
              <div className="mb-3 flex items-center gap-2">
                <KeyRound size={18} className="text-sky-500" />
                <p className="text-sm font-semibold text-[var(--text)]">관리자 계정</p>
              </div>
              <p className="mb-3 text-xs text-[var(--muted)]">
                현재 아이디: <span className="font-semibold text-[var(--text)]">{currentLoginId || "-"}</span>
                <br />
                Admin 로그인 후 이 화면에서 아이디·비밀번호를 변경할 수 있습니다.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="field-label">새 아이디</label>
                  <input
                    className="input"
                    value={newLoginId}
                    onChange={(e) => setNewLoginId(e.target.value)}
                    placeholder="영문/숫자 아이디"
                    autoCapitalize="none"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  disabled={savingAccount}
                  onClick={() => void handleChangeLoginId()}
                >
                  아이디 변경
                </button>
                <div className="border-t border-[var(--border)] pt-3">
                  <label className="field-label">새 비밀번호</label>
                  <input
                    className="input mb-2"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="8자 이상"
                  />
                  <label className="field-label">비밀번호 확인</label>
                  <input
                    className="input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="다시 입력"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  disabled={savingAccount}
                  onClick={() => void handleChangePassword()}
                >
                  비밀번호 변경
                </button>
              </div>
            </div>
          )}

          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text)]">앱 버전</p>
            <p className="mt-1 text-sm text-[var(--muted)]">현재 버전: v{appVersion}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">빌드: {__BUILD_DATE__} / {__BUILD_COMMIT__}</p>
            <p className="mt-1 break-all text-xs text-[var(--muted)]">endpoint: {UPDATER_ENDPOINT}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={checkingUpdate || installingUpdate || !canCheckUpdate}
                onClick={() => void handleCheckUpdate()}
              >
                <Download size={18} />
                {checkingUpdate ? "확인 중..." : "업데이트 확인"}
              </button>
              {pendingUpdate && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={checkingUpdate || installingUpdate}
                  onClick={() => void handleInstallUpdate()}
                >
                  <Download size={18} />
                  {installingUpdate ? "설치 중..." : "다운로드 및 설치"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onNotify(`현재 설치 버전: v${appVersion}`)}
              >
                현재 설치파일 버전 확인
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={updateDiagnosticLoading}
                onClick={() => void handleRunUpdateDiagnostic()}
              >
                {updateDiagnosticLoading ? "진단 중..." : "업데이트 진단"}
              </button>
            </div>
            {updateResult && updateResult.diagnostics.length > 0 && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px] leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
                {updateResult.diagnostics.join("\n")}
              </pre>
            )}
            {updateResult?.kind === "available" && (
              <p className="mt-2 text-sm font-semibold text-amber-500">{updateResult.message}</p>
            )}
            {updateResult?.kind === "latest" && (
              <p className="mt-2 text-sm text-[var(--muted)]">{updateResult.message}</p>
            )}
            {updateResult?.kind === "error" && (
              <p className="mt-2 text-sm text-red-500">{updateResult.message}</p>
            )}
            {updateDiagnostic && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px]">
                <div className="mb-2 font-semibold text-[var(--text)]">업데이트 진단 결과</div>
                <div className="space-y-1 text-[var(--muted)]">
                  <div>현재 버전: <span className="font-semibold text-[var(--text)]">v{updateDiagnostic.currentVersion}</span></div>
                  <div>빌드 날짜: <span className="font-semibold text-[var(--text)]">{updateDiagnostic.buildDate}</span></div>
                  <div>커밋: <span className="font-semibold text-[var(--text)]">{updateDiagnostic.buildCommit}</span></div>
                  <div className="break-all">endpoint: <span className="text-[var(--text)]">{updateDiagnostic.endpoint}</span></div>
                  <div>
                    latest.json 다운로드:{" "}
                    <span className={`font-semibold ${updateDiagnostic.fetchSuccess ? "text-green-600" : "text-red-500"}`}>
                      {updateDiagnostic.fetchSuccess ? "성공" : `실패 — ${updateDiagnostic.fetchError}`}
                    </span>
                  </div>
                  {updateDiagnostic.remoteVersion !== null && (
                    <div>최신 버전: <span className="font-semibold text-[var(--text)]">v{updateDiagnostic.remoteVersion}</span></div>
                  )}
                  {updateDiagnostic.remotePubDate !== null && (
                    <div>배포 날짜: <span className="font-semibold text-[var(--text)]">{updateDiagnostic.remotePubDate}</span></div>
                  )}
                  {updateDiagnostic.signaturePresent !== null && (
                    <div>
                      서명(signature):{" "}
                      <span className={`font-semibold ${updateDiagnostic.signaturePresent ? "text-green-600" : "text-red-500"}`}>
                        {updateDiagnostic.signaturePresent ? "있음" : "없음"}
                      </span>
                    </div>
                  )}
                  {updateDiagnostic.downloadUrl !== null && (
                    <div className="break-all">다운로드 URL: <span className="text-[var(--text)]">{updateDiagnostic.downloadUrl}</span></div>
                  )}
                  {updateDiagnostic.downloadUrlAccessible !== null && (
                    <div>
                      URL 접근:{" "}
                      <span className={`font-semibold ${updateDiagnostic.downloadUrlAccessible ? "text-green-600" : "text-red-500"}`}>
                        {updateDiagnostic.downloadUrlAccessible ? "가능" : "실패"}
                      </span>
                    </div>
                  )}
                  {updateDiagnostic.versionComparison !== null && (
                    <div>
                      버전 비교:{" "}
                      <span className={`font-semibold ${updateDiagnostic.versionComparison === "newer" ? "text-green-600" : "text-amber-500"}`}>
                        {updateDiagnostic.versionComparison === "newer"
                          ? `v${updateDiagnostic.remoteVersion}이 더 최신`
                          : updateDiagnostic.versionComparison === "same"
                          ? "현재 버전과 동일"
                          : "현재 버전보다 낮음"}
                      </span>
                    </div>
                  )}
                  <div>
                    업데이트 가능:{" "}
                    <span className={`font-semibold ${updateDiagnostic.updateAvailable ? "text-green-600" : "text-amber-500"}`}>
                      {updateDiagnostic.updateAvailable ? "예" : "아니오"}
                    </span>
                  </div>
                  {updateDiagnostic.failureReason && (
                    <div className="mt-1 rounded-lg bg-[var(--panel-strong)] p-2 text-amber-500">
                      사유: {updateDiagnostic.failureReason}
                    </div>
                  )}
                  <div className="mt-1">
                    공식 릴리스:{" "}
                    <a
                      href={updateDiagnostic.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 underline"
                    >
                      GitHub Releases
                    </a>
                    <span className="ml-1 text-[var(--muted)]">(자동 업데이트 실패 시 직접 설치 가능)</span>
                  </div>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              업데이트/재설치해도 회원 데이터는 Supabase와 AppData에 유지됩니다.
            </p>
          </div>

          {/* ── 업로드 검증 리포트 (관리자 전용) ── */}
          {canSyncPush && (
          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <Upload size={18} className="text-sky-500" />
              <p className="text-sm font-semibold text-[var(--text)]">업로드 검증 리포트 <span className="text-[10px] text-amber-400">(관리자)</span></p>
            </div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              이 PC에만 있고 Supabase 서버에 아직 업로드되지 않은 데이터를 확인합니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={uploadReportLoading}
                onClick={() => void handleRunUploadReport()}
              >
                <RefreshCw size={14} className={uploadReportLoading ? "animate-spin" : ""} />
                {uploadReportLoading ? "분석 중..." : "업로드 검증 리포트"}
              </button>
              {uploadReport && uploadReport.status_mismatch_count > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  disabled={repairingMismatch}
                  onClick={() => void handleRepairMismatch()}
                >
                  {repairingMismatch ? "보정 중..." : "상태 불일치 보정"}
                </button>
              )}
            </div>
            {uploadReport && (
              <div className="mt-3 space-y-2 text-xs">
                {/* 판정 메시지 */}
                {uploadReport.queue_pending === 0 && uploadReport.queue_failed === 0 &&
                  uploadReport.queue_blocked === 0 && uploadReport.members_no_remote_id === 0 ? (
                  <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-600">
                    업로드 누락 없음: 이 PC의 변경사항은 모두 서버와 동기화되었습니다.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {uploadReport.members_no_remote_id > 0 && (
                      <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-600">
                        서버 ID가 없는 로컬 전용 회원 {uploadReport.members_no_remote_id}명이 있습니다. 테스트 회원인지 실제 회원인지 확인 후 Supabase로 동기화하세요.
                      </div>
                    )}
                    {uploadReport.status_mismatch_count > 0 && (
                      <div className="rounded-lg bg-red-500/10 px-3 py-2 text-red-500">
                        상태 불일치: remote_id가 없는데 synced로 표시된 항목 {uploadReport.status_mismatch_count}건. 위 "상태 불일치 보정" 버튼으로 보정하세요.
                      </div>
                    )}
                    {uploadReport.queue_failed > 0 && (
                      <div className="rounded-lg bg-red-500/10 px-3 py-2 text-red-500">
                        동기화 실패 {uploadReport.queue_failed}건이 대기 중입니다.
                      </div>
                    )}
                  </div>
                )}
                {/* 수치 요약 */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] p-3">
                  <div>대기 sync_queue: <span className="font-semibold">{uploadReport.queue_pending}</span></div>
                  <div>실패 sync_queue: <span className={`font-semibold ${uploadReport.queue_failed > 0 ? "text-red-500" : ""}`}>{uploadReport.queue_failed}</span></div>
                  <div>blocked: <span className={`font-semibold ${uploadReport.queue_blocked > 0 ? "text-amber-500" : ""}`}>{uploadReport.queue_blocked}</span></div>
                  <div>remote_id 없는 회원: <span className={`font-semibold ${uploadReport.members_no_remote_id > 0 ? "text-amber-500" : ""}`}>{uploadReport.members_no_remote_id}</span></div>
                  <div>remote_id 없는 회원권: <span className="font-semibold">{uploadReport.memberships_no_remote_id}</span></div>
                  <div>remote_id 없는 출석: <span className="font-semibold">{uploadReport.attendance_no_remote_id}</span></div>
                  <div>remote_id 없는 결제: <span className="font-semibold">{uploadReport.payments_no_remote_id}</span></div>
                  <div>remote_id 없는 정지: <span className="font-semibold">{uploadReport.pause_logs_no_remote_id}</span></div>
                  <div>상태 불일치: <span className={`font-semibold ${uploadReport.status_mismatch_count > 0 ? "text-red-500" : ""}`}>{uploadReport.status_mismatch_count}</span></div>
                  <div>업로드 가능: <span className="font-semibold text-emerald-600">{uploadReport.uploadable_count}</span></div>
                  <div>업로드 불가: <span className={`font-semibold ${uploadReport.blocked_upload_count > 0 ? "text-amber-500" : ""}`}>{uploadReport.blocked_upload_count}</span></div>
                </div>
                {/* 로컬 전용 회원 목록 */}
                {uploadReport.local_only_members.length > 0 && (
                  <div>
                    <div className="mb-1 font-semibold text-[var(--text)]">로컬 전용 회원 ({uploadReport.local_only_members.length}명)</div>
                    <div className="space-y-1">
                      {uploadReport.local_only_members.map((m) => {
                        const isTestCandidate = /^\d+$/.test(m.name.trim()) || /테스트|test/i.test(m.name) || m.sync_status === 'local_only';
                        const actionResult = memberActionResults[m.local_id];
                        const isUploading = uploadingMemberId === m.local_id;
                        return (
                          <div key={m.local_id} className="rounded-lg border border-[var(--border)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold">{m.name}</span>
                                {isTestCandidate && (
                                  <span className="rounded bg-slate-500/10 px-1 py-0.5 text-[10px] text-slate-500">테스트 후보</span>
                                )}
                              </div>
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${m.can_upload ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                                {m.sync_status === 'local_only' ? "업로드 제외" : m.can_upload ? "업로드 가능" : "보류"}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[var(--muted)]">
                              {m.center} · {m.member_type} · 회원번호: {m.member_no ?? "없음"} · local id: {m.local_id}
                            </div>
                            <div className="text-[var(--muted)]">
                              sync_status: {m.sync_status} · 회원권: {m.has_membership ? "있음" : "없음"} · 출석: {m.attendance_count}건
                            </div>
                            {m.upload_block_reason && (
                              <div className="text-amber-500">{m.upload_block_reason}</div>
                            )}
                            {m.last_error && (
                              <div className="text-red-500">오류: {m.last_error}</div>
                            )}
                            {actionResult && (
                              <div className={`mt-1 ${actionResult.ok ? "text-emerald-600" : "text-red-500"}`}>
                                {actionResult.ok ? "✓ " : "✗ "}{actionResult.message}
                              </div>
                            )}
                            {m.sync_status !== 'local_only' && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  className="btn btn-secondary !px-2 !py-1 text-[11px]"
                                  disabled={isUploading}
                                  onClick={() => void handleUploadMember(m.local_id)}
                                >
                                  {isUploading ? "업로드 중..." : "서버에 업로드"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary !px-2 !py-1 text-[11px]"
                                  onClick={() => void handleExcludeMember(m.local_id, m.name)}
                                >
                                  업로드 제외
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary !px-2 !py-1 text-[11px]"
                                  onClick={() => void handleHideMember(m.local_id, m.name)}
                                >
                                  로컬 숨김
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* 로컬 전용 회원권 목록 */}
                {uploadReport.local_only_memberships.length > 0 && (
                  <div>
                    <div className="mb-1 font-semibold text-[var(--text)]">로컬 전용 회원권 ({uploadReport.local_only_memberships.length}건)</div>
                    <div className="space-y-1">
                      {uploadReport.local_only_memberships.map((ms) => (
                        <div key={ms.local_id} className="rounded-lg border border-[var(--border)] px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{ms.member_name}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${ms.can_upload ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                              {ms.can_upload ? "업로드 가능" : "보류"}
                            </span>
                          </div>
                          <div className="text-[var(--muted)]">
                            {ms.membership_type} · {ms.start_date} ~ {ms.end_date ?? "-"} · 잔여: {ms.remaining_count ?? "-"}/{ms.total_count ?? "-"}
                          </div>
                          {ms.upload_block_reason && (
                            <div className="text-amber-500">{ms.upload_block_reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 로컬 전용 출석 목록 */}
                {uploadReport.local_only_attendance.length > 0 && (
                  <div>
                    <div className="mb-1 font-semibold text-[var(--text)]">로컬 전용 출석 ({uploadReport.local_only_attendance.length}건)</div>
                    <div className="space-y-1">
                      {uploadReport.local_only_attendance.map((att) => (
                        <div key={att.local_id} className="rounded-lg border border-[var(--border)] px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{att.member_name}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${att.can_upload ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                              {att.can_upload ? "업로드 가능" : "보류"}
                            </span>
                          </div>
                          <div className="text-[var(--muted)]">
                            {att.checkin_at.slice(0, 10)} · {att.source ?? "staff"} · 차감: {att.deducted_count}회 · member_has_remote_id: {att.member_has_remote_id ? "있음" : "없음"}
                          </div>
                          {att.upload_block_reason && (
                            <div className="text-amber-500">{att.upload_block_reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* ── 서버 회원 매칭 검사 (관리자 전용) ── */}
          {canSyncPush && center && (
            <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldAlert size={18} className="text-sky-500" />
                <p className="text-sm font-semibold text-[var(--text)]">서버 회원 매칭 검사</p>
              </div>
              <p className="mb-3 text-xs text-[var(--muted)]">
                서버 ID 없는 로컬 회원을 Supabase 회원과 매칭합니다.
                회원번호 → 연락처 순으로 자동 연결하고, 이름만 일치하는 경우 수동 확인 후 연결합니다.
              </p>
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={serverMatchLoading}
                onClick={() => void handleMatchServerMembers()}
              >
                <RefreshCw size={14} className={serverMatchLoading ? "animate-spin" : ""} />
                {serverMatchLoading ? "매칭 중..." : "서버 회원 매칭 검사"}
              </button>
              {serverMatchReport && (
                <div className="mt-3 space-y-2 text-xs">
                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border)] p-3 text-center">
                    <div>
                      <div className="text-emerald-600 font-semibold text-base">{serverMatchReport.auto_linked.length}</div>
                      <div className="text-[var(--muted)]">자동 연결</div>
                    </div>
                    <div>
                      <div className={`font-semibold text-base ${serverMatchReport.needs_review.length > 0 ? "text-amber-500" : ""}`}>{serverMatchReport.needs_review.length}</div>
                      <div className="text-[var(--muted)]">수동 확인 필요</div>
                    </div>
                    <div>
                      <div className={`font-semibold text-base ${serverMatchReport.no_match.length > 0 ? "text-red-500" : ""}`}>{serverMatchReport.no_match.length}</div>
                      <div className="text-[var(--muted)]">매칭 없음</div>
                    </div>
                  </div>

                  {serverMatchReport.auto_linked.length > 0 && (
                    <div>
                      <div className="mb-1 font-semibold text-emerald-600">자동 연결 완료 ({serverMatchReport.auto_linked.length})</div>
                      <div className="space-y-1">
                        {serverMatchReport.auto_linked.map((e) => (
                          <div key={e.local_id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
                            <span className="font-semibold">{e.local_name}</span>
                            <span className="ml-2 text-[var(--muted)]">
                              {e.match_type === 'member_no' ? '회원번호' : e.match_type === 'phone' ? '연락처' : '이름'} 일치
                            </span>
                            {e.remote_id && (
                              <span className="ml-2 font-mono text-[10px] text-[var(--muted)]">{e.remote_id.slice(0, 8)}...</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {serverMatchReport.needs_review.length > 0 && (
                    <div>
                      <div className="mb-1 font-semibold text-amber-500">수동 확인 필요 ({serverMatchReport.needs_review.length})</div>
                      <div className="space-y-2">
                        {serverMatchReport.needs_review.map((e) => (
                          <div key={e.local_id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">{e.local_name}</span>
                              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">이름 일치 후보</span>
                            </div>
                            <div className="text-[var(--muted)]">회원번호: {e.local_member_no ?? "없음"} · 연락처: {e.local_phone ?? "없음"}</div>
                            <div className="mt-1 space-y-1">
                              {e.candidates.map((c) => (
                                <div key={c.id} className="flex items-center justify-between gap-2 rounded bg-[var(--panel)] px-2 py-1">
                                  <div>
                                    <span className="font-semibold">{c.name}</span>
                                    <span className="ml-2 text-[var(--muted)]">{c.phone ?? "연락처없음"} / 번호: {c.member_no ?? "없음"}</span>
                                    <span className="ml-2 font-mono text-[10px] text-[var(--muted)]">{c.id.slice(0, 8)}...</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary !px-2 !py-1 text-[10px] shrink-0"
                                    disabled={linkingMemberId === e.local_id}
                                    onClick={() => void handleLinkMember(e, c.id)}
                                  >
                                    {linkingMemberId === e.local_id ? "연결 중..." : "이 회원으로 연결"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {serverMatchReport.no_match.length > 0 && (
                    <div>
                      <div className="mb-1 font-semibold text-[var(--text)]">서버 매칭 없음 ({serverMatchReport.no_match.length}) — 신규 업로드 필요</div>
                      <div className="space-y-1">
                        {serverMatchReport.no_match.map((e) => (
                          <div key={e.local_id} className="rounded-lg border border-[var(--border)] px-3 py-1.5">
                            <span className="font-semibold">{e.local_name}</span>
                            <span className="ml-2 text-[var(--muted)]">번호: {e.local_member_no ?? "없음"} · 연락처: {e.local_phone ?? "없음"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {serverMatchReport.errors.length > 0 && (
                    <div className="rounded-lg bg-red-500/10 px-3 py-2 text-red-500">
                      {serverMatchReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PC간 데이터 일치 검증 ── */}
          {center && (
            <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
              <div className="mb-3 flex items-center gap-2">
                <RefreshCw size={18} className="text-sky-500" />
                <p className="text-sm font-semibold text-[var(--text)]">PC간 데이터 일치 검증</p>
              </div>
              <p className="mb-3 text-xs text-[var(--muted)]">
                같은 계정으로 이 앱을 사용하는 모든 PC에서 동일한 데이터가 보여야 합니다.
                서버의 회원 수와 이 PC의 로컬 데이터를 비교합니다.
              </p>
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={serverConsistencyLoading}
                onClick={() => void handleCheckServerConsistency()}
              >
                <RefreshCw size={14} className={serverConsistencyLoading ? "animate-spin" : ""} />
                {serverConsistencyLoading ? "검증 중..." : "PC간 일치 검증"}
              </button>
              {serverConsistency && (
                <div className="mt-3 space-y-2 text-xs">
                  <div className={`rounded-lg px-3 py-2 font-semibold ${
                    serverConsistency.verdict === 'ok' ? "bg-emerald-500/10 text-emerald-600" :
                    serverConsistency.verdict === 'warning' ? "bg-amber-500/10 text-amber-600" :
                    serverConsistency.verdict === 'error' ? "bg-red-500/10 text-red-500" :
                    "bg-slate-500/10 text-slate-500"
                  }`}>
                    {serverConsistency.verdict_message}
                  </div>
                  <div className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-[11px]">
                    <div className="font-semibold text-[var(--text)]">서버 (Supabase) · deleted_at IS NULL 기준</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <div>전체 원장: <span className="font-semibold">{serverConsistency.server_members}</span></div>
                      <div>회원권 전체: <span className="font-semibold">{serverConsistency.server_memberships}</span></div>
                      <div>출석: <span className="font-semibold">{serverConsistency.server_attendance}</span></div>
                    </div>
                    <div className="border-t border-[var(--border)] pt-2 font-semibold text-[var(--text)]">이 PC (로컬 DB)</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <div>로컬 DB 원장 전체: <span className={`font-semibold ${serverConsistency.local_members !== serverConsistency.server_members ? "text-amber-500" : "text-emerald-600"}`}>{serverConsistency.local_members}</span></div>
                      <div>화면 표시 회원: <span className="font-semibold text-[var(--muted)]">{serverConsistency.local_display_members}</span></div>
                      <div>remote_id 있는 회원: <span className="font-semibold">{serverConsistency.local_members - serverConsistency.local_members_no_remote_id}</span></div>
                      <div>remote_id 없는 회원: <span className={`font-semibold ${serverConsistency.local_members_no_remote_id > 0 ? "text-amber-500" : ""}`}>{serverConsistency.local_members_no_remote_id}</span></div>
                      <div>회원권 전체: <span className="font-semibold">{serverConsistency.local_memberships}</span></div>
                      <div>remote_id 없는 회원권: <span className={`font-semibold ${serverConsistency.local_memberships_no_remote_id > 0 ? "text-amber-500" : ""}`}>{serverConsistency.local_memberships_no_remote_id}</span></div>
                      <div>출석: <span className="font-semibold">{serverConsistency.local_attendance}</span></div>
                      <div>remote_id 없는 출석: <span className={`font-semibold ${serverConsistency.local_attendance_no_remote_id > 0 ? "text-amber-500" : ""}`}>{serverConsistency.local_attendance_no_remote_id}</span></div>
                      <div>대기 중: <span className={`font-semibold ${serverConsistency.local_pending > 0 ? "text-amber-500" : ""}`}>{serverConsistency.local_pending}</span></div>
                      <div>실패: <span className={`font-semibold ${serverConsistency.local_failed > 0 ? "text-red-500" : ""}`}>{serverConsistency.local_failed}</span></div>
                      <div>blocked: <span className={`font-semibold ${serverConsistency.local_blocked > 0 ? "text-amber-500" : ""}`}>{serverConsistency.local_blocked}</span></div>
                      <div>마지막 서버→PC: <span className="font-semibold">{formatDateTimeSeoul(serverConsistency.last_pull_at) || "없음"}</span></div>
                      <div>마지막 PC→서버: <span className="font-semibold">{formatDateTimeSeoul(serverConsistency.last_push_at) || "없음"}</span></div>
                    </div>
                    {serverConsistency.local_memberships_no_remote_id > 0 && (
                      <div className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-amber-600">
                        remote_id 없는 회원권 {serverConsistency.local_memberships_no_remote_id}건: 해당 회원이 서버와 연결(remote_id)되어 있으면 다음 동기화에서 자동 업로드됩니다. 회원 remote_id가 없으면 먼저 "서버 회원 매칭 검사"를 실행하세요.
                      </div>
                    )}
                    {serverConsistency.local_attendance_no_remote_id > 0 && (
                      <div className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-amber-600">
                        remote_id 없는 출석 {serverConsistency.local_attendance_no_remote_id}건: 회원 remote_id 연결 후 동기화하면 업로드됩니다.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 출석-회원권 차감 불일치 진단 ── */}
          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              <p className="text-sm font-semibold text-[var(--text)]">출석-회원권 차감 불일치 진단</p>
            </div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              회원 local ID를 입력하면 출석 기록 기준 예상 잔여 횟수와 현재 잔여 횟수를 비교합니다.
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                type="number"
                placeholder="회원 local ID"
                value={mismatchMemberId}
                onChange={(e) => setMismatchMemberId(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={mismatchLoading}
                onClick={() => void handleMismatchDiagnose()}
              >
                {mismatchLoading ? "분석 중..." : "진단"}
              </button>
            </div>
            {mismatchDiag && (
              <div className="mt-3 space-y-2 text-xs">
                <div className={`rounded-lg px-3 py-2 ${mismatchDiag.mismatch ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-600"}`}>
                  {mismatchDiag.mismatch
                    ? `불일치: 현재 잔여 ${mismatchDiag.current_remaining}회 ≠ 예상 ${mismatchDiag.expected_remaining}회 (차이: ${mismatchDiag.diff}회)`
                    : `일치: 잔여 ${mismatchDiag.current_remaining}회 = 예상 ${mismatchDiag.expected_remaining}회`
                  }
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] p-3">
                  <div>회원: <span className="font-semibold">{mismatchDiag.member_name}</span></div>
                  <div>local id: <span className="font-semibold">{mismatchDiag.member_id}</span></div>
                  <div>회원권 종류: <span className="font-semibold">{mismatchDiag.membership_type ?? "없음"}</span></div>
                  <div>총 횟수: <span className="font-semibold">{mismatchDiag.total_count ?? "-"}</span></div>
                  <div>현재 잔여: <span className="font-semibold">{mismatchDiag.current_remaining ?? "-"}</span></div>
                  <div>출석 차감 합계: <span className="font-semibold">{mismatchDiag.attendance_deducted_sum}</span></div>
                  <div>예상 잔여: <span className="font-semibold">{mismatchDiag.expected_remaining ?? "-"}</span></div>
                  <div>차이: <span className={`font-semibold ${mismatchDiag.diff !== 0 ? "text-red-500" : ""}`}>{mismatchDiag.diff}</span></div>
                </div>
                {mismatchDiag.mismatch && (
                  <button
                    type="button"
                    className="btn btn-secondary w-full text-sm"
                    disabled={correctingRemaining}
                    onClick={() => void handleCorrectRemaining()}
                  >
                    {correctingRemaining ? "보정 중..." : `이 회원 잔여 횟수 출석 기록 기준 보정 (${mismatchDiag.current_remaining} → ${mismatchDiag.expected_remaining})`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-xs text-[var(--muted)]">
            <p className="text-sm font-semibold text-[var(--text)]">데이터 · 명부 저장 위치</p>
            <p>
              <span className="font-semibold text-[var(--text)]">DB 파일</span>{" "}
              {storageInfo?.db_path ?? "-"}
            </p>
            {canExportRoster && (
              <>
                <p className="mt-1">
                  <span className="font-semibold text-[var(--text)]">명부 폴더</span>{" "}
                  {reportInfo?.reports_dir ?? storageInfo?.reports_dir ?? "-"}
                </p>
                <p className="mt-1">
                  운영 파일: 회원명부_통합.xlsx · ONCLE_회원명부.xlsx · GRABIT_회원명부.xlsx
                </p>
                <p className="mt-1">백업 스냅샷: archive/YYYY-MM-DD/</p>
                <p className="mt-1">
                  마지막 명부 갱신: {reportInfo?.last_report_at ?? reportInfo?.last_report_date ?? "-"}
                </p>
                <p className="mt-1">최근 갱신 파일: {reportInfo?.last_report_path ?? "-"}</p>
              </>
            )}
            {canOpenBackupFolder && (
              <p className="mt-1">
                <span className="font-semibold text-[var(--text)]">백업 폴더</span>{" "}
                {backupInfo?.backup_dir ?? storageInfo?.backup_dir ?? "-"}
              </p>
            )}
            <p className="mt-2">
              <span className="font-semibold text-[var(--text)]">Supabase</span>{" "}
              {!syncConfigured
                ? "미설정"
                : syncOnline
                  ? "연결됨"
                  : "오프라인"}
            </p>
            {canSyncPush && (
              <p className="mt-1">
                마지막 업로드: {formatDateTimeSeoul(syncStatus?.last_push_at) || "-"}
              </p>
            )}
            {canSyncPull && (
              <p className="mt-1">
                마지막 불러오기: {formatDateTimeSeoul(syncStatus?.last_pull_at) || "-"}
              </p>
            )}
            {canBackupRestore && backupInfo?.last_backup_at && (
              <p className="mt-1">
                최근 백업: {backupInfo.last_backup_at}
                {backupInfo.json_backup_count > 0 &&
                  ` · JSON ${backupInfo.json_backup_count} · DB ${backupInfo.db_backup_count}`}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed">
              회원 데이터는 설치 폴더가 아닌 AppData에 저장됩니다. 재설치·업데이트 후에도 이 경로의
              DB와 백업이 유지됩니다.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn btn-secondary" onClick={onOpenDataFolder}>
              <FolderOpen size={18} />
              데이터 폴더 열기
            </button>
            {canExportRoster && onOpenReportsFolder && (
              <button className="btn btn-secondary" onClick={onOpenReportsFolder}>
                <FolderOpen size={18} />
                명부 폴더 열기
              </button>
            )}
            {canExportRoster && onOpenCombinedReport && (
              <button className="btn btn-secondary" onClick={onOpenCombinedReport}>
                <FolderOpen size={18} />
                통합 명부 열기
              </button>
            )}
            {canExportRoster && onOpenReportsArchiveFolder && (
              <button className="btn btn-secondary" onClick={onOpenReportsArchiveFolder}>
                <FolderOpen size={18} />
                archive 폴더 열기
              </button>
            )}
            {canOpenBackupFolder && (
              <button className="btn btn-secondary" onClick={onOpenBackupFolder}>
                <FolderOpen size={18} />
                백업 폴더 열기
              </button>
            )}
            {canSyncPull && onPullFromSupabase && (
              <button
                className="btn btn-secondary"
                disabled={!syncConfigured || !syncOnline || syncBusy}
                onClick={onPullFromSupabase}
              >
                <Download size={18} />
                Supabase에서 불러오기
              </button>
            )}
            {canSyncPush && onPushToSupabase && (
              <button
                className="btn btn-primary"
                disabled={!syncConfigured || !syncOnline || syncBusy}
                onClick={() => {
                  const risks: string[] = [];
                  if ((diagnostics?.members_without_remote_id ?? 0) > 0) risks.push(`remote_id 없는 회원 ${diagnostics!.members_without_remote_id}명`);
                  if ((diagnostics?.queue_failed ?? 0) > 0) risks.push(`실패 항목 ${diagnostics!.queue_failed}건`);
                  if ((diagnostics?.queue_blocked ?? 0) > 0) risks.push(`blocked ${diagnostics!.queue_blocked}건`);
                  if (risks.length > 0) {
                    const ok = window.confirm(
                      `[주의] 현재 동기화 위험 요소가 있습니다:\n${risks.join("\n")}\n\n서버에 중복/테스트 데이터가 생성될 위험이 있습니다.\n먼저 업로드 검증 리포트에서 문제를 해결한 후 동기화하세요.\n\n그래도 계속하시겠습니까?`
                    );
                    if (!ok) return;
                  }
                  onPushToSupabase();
                }}
              >
                <Upload size={18} />
                Supabase로 동기화
              </button>
            )}
          </div>

          {canBackupRestore && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn btn-secondary" onClick={onRestoreBackup}>
              <DatabaseBackup size={18} />
              복원
            </button>
            <button className="btn btn-primary" onClick={onBackup}>
              <DatabaseBackup size={18} />
              수동 백업
            </button>
          </div>
          )}

          {canSyncPush && center && (
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert size={16} className="text-amber-500" />
                로컬 중복 회원 정리 <span className="text-[10px] text-amber-400">(관리자)</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                과거 동기화 오류로 내 PC에만 같은 회원이 여러 줄로 보일 수 있습니다. 아래 기능은
                로컬 DB에서만 중복 행을 "숨김" 처리하며, 데이터 삭제나 Supabase 변경은 전혀
                일어나지 않습니다.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button className="btn btn-secondary" onClick={() => void handleOpenDuplicates()}>
                  중복 회원 진단
                </button>
                <button
                  className="btn btn-primary"
                  disabled={cleanupBusy}
                  onClick={() => setCleanupConfirmOpen(true)}
                >
                  서버 기준 로컬 정리
                </button>
              </div>
              {cleanupResult && (
                <div className="mt-2 text-[11px] text-[var(--muted)]">
                  최근 결과: {cleanupResult.groups_processed}개 그룹 처리, {cleanupResult.rows_hidden}건 숨김
                  {cleanupResult.affected_names.length > 0 &&
                    ` (${cleanupResult.affected_names.join(", ")})`}
                </div>
              )}
            </div>
          )}

          {canSyncPush && center && (
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <RefreshCw size={16} className="text-sky-500" />
                  동기화 진단 <span className="text-[10px] text-amber-400">(관리자)</span>
                </div>
                <button
                  className="btn btn-secondary !px-3"
                  disabled={diagnosticsLoading}
                  onClick={() => void handleRefreshDiagnostics()}
                >
                  {diagnosticsLoading ? "새로고침 중..." : "진단 새로고침"}
                </button>
              </div>

              {diagnostics && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)] sm:grid-cols-3">
                  <div>대기: <span className="font-semibold text-[var(--text)]">{diagnostics.queue_pending}</span></div>
                  <div>실패: <span className="font-semibold text-[var(--text)]">{diagnostics.queue_failed}</span></div>
                  <div>blocked: <span className="font-semibold text-[var(--text)]">{diagnostics.queue_blocked}</span></div>
                  <div>remote_id 없는 회원: <span className="font-semibold text-[var(--text)]">{diagnostics.members_without_remote_id}</span></div>
                  <div>remote_id 없는 회원권: <span className="font-semibold text-[var(--text)]">{diagnostics.memberships_without_remote_id}</span></div>
                  <div>로컬 전용 회원: <span className="font-semibold text-[var(--text)]">{diagnostics.local_only_members}</span></div>
                  <div>서버 동기화 완료: <span className="font-semibold text-[var(--text)]">{diagnostics.synced_members}</span></div>
                  <div>센터 매핑 실패: <span className="font-semibold text-[var(--text)]">{diagnostics.center_mapping_failed}</span></div>
                  <div>hidden_locally: <span className="font-semibold text-[var(--text)]">{diagnostics.hidden_locally_count}</span></div>
                  <div>is_local_duplicate: <span className="font-semibold text-[var(--text)]">{diagnostics.local_duplicate_count}</span></div>
                </div>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {onPullFromSupabase && (
                  <button className="btn btn-secondary" disabled={syncBusy} onClick={onPullFromSupabase}>
                    Supabase에서 불러오기
                  </button>
                )}
                {onPushToSupabase && (
                  <button
                    className="btn btn-secondary"
                    disabled={syncBusy}
                    onClick={() => {
                      const risks: string[] = [];
                      if ((diagnostics?.members_without_remote_id ?? 0) > 0) risks.push(`remote_id 없는 회원 ${diagnostics!.members_without_remote_id}명`);
                      if ((diagnostics?.queue_failed ?? 0) > 0) risks.push(`실패 항목 ${diagnostics!.queue_failed}건`);
                      if ((diagnostics?.queue_blocked ?? 0) > 0) risks.push(`blocked ${diagnostics!.queue_blocked}건`);
                      if (risks.length > 0) {
                        const ok = window.confirm(
                          `[주의] 현재 동기화 위험 요소가 있습니다:\n${risks.join("\n")}\n\n서버에 중복/테스트 데이터가 생성될 위험이 있습니다.\n먼저 업로드 검증 리포트를 확인하고 문제를 해결한 후 동기화하세요.\n\n그래도 계속하시겠습니까?`
                        );
                        if (!ok) return;
                      }
                      onPushToSupabase();
                    }}
                  >
                    Supabase로 동기화
                  </button>
                )}
                <button
                  className="btn btn-secondary sm:col-span-2"
                  disabled={retryBusy || syncBusy || (diagnostics?.queue_failed ?? 0) > 0}
                  title={(diagnostics?.queue_failed ?? 0) > 0 ? `실패 항목 ${diagnostics?.queue_failed}건이 있습니다. 업로드 검증 리포트에서 원인을 확인하고 수동으로 처리하세요. (테스트 데이터로 차단된 항목은 재시도 불가)` : undefined}
                  onClick={() => void handleRetryFailed()}
                >
                  {retryBusy ? "재시도 중..." : `실패 항목 다시 시도${(diagnostics?.queue_failed ?? 0) > 0 ? ` (${diagnostics!.queue_failed}건 — 직접 확인 필요)` : ""}`}
                </button>
                <button
                  className="btn btn-secondary sm:col-span-2"
                  disabled={verifyReportLoading}
                  onClick={() => void handleRunVerifyReport()}
                >
                  <ShieldAlert size={16} />
                  {verifyReportLoading ? "검증 중..." : "동기화 검증 리포트"}
                </button>
                {onForcePullFromSupabase && (
                  <button
                    className="btn btn-primary sm:col-span-2"
                    disabled={forcePullBusy || syncBusy}
                    onClick={() => void handleForcePull()}
                  >
                    <Download size={18} />
                    {forcePullBusy ? "강제 불러오기 중..." : "서버 기준 강제 불러오기"}
                  </button>
                )}
              </div>
              {forcePullResult && (() => {
                const isFailed = forcePullResult.serverCount > 0 && forcePullResult.localDbCount === 0;
                const isWarning = !isFailed && !!forcePullResult.warning;
                const isOk = !isFailed && !isWarning;
                const borderClass = isFailed
                  ? "border-red-500/40 bg-red-500/10"
                  : isWarning
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-emerald-500/30 bg-emerald-500/5";
                return (
                  <div className={`mt-3 rounded-xl border p-3 text-[11px] ${borderClass}`}>
                    <div className={`mb-2 font-semibold ${isFailed ? "text-red-600" : isOk ? "text-emerald-600" : "text-amber-600"}`}>
                      {isFailed ? "강제 불러오기 실패" : "강제 불러오기 결과"}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--muted)]">
                      <div>서버 원장: <span className="font-semibold text-[var(--text)]">{forcePullResult.serverCount}명</span></div>
                      <div>서버에서 받은 회원: <span className="font-semibold text-[var(--text)]">{forcePullResult.fetchedCount}명</span></div>
                      <div>로컬 DB 저장 회원: <span className={`font-semibold ${isFailed ? "text-red-600" : forcePullResult.localDbCount === forcePullResult.serverCount ? "text-emerald-600" : "text-amber-500"}`}>{forcePullResult.localDbCount}명</span></div>
                      <div>화면 표시 회원: <span className="font-semibold text-[var(--text)]">{forcePullResult.displayCount}명</span></div>
                      <div>remote_id 없는 회원: <span className={`font-semibold ${forcePullResult.noRemoteIdCount > 0 ? "text-amber-500" : "text-emerald-600"}`}>{forcePullResult.noRemoteIdCount}명</span></div>
                      <div>missing remote_id: <span className={`font-semibold ${(forcePullResult.missingCount ?? 0) > 0 ? "text-red-500" : "text-emerald-600"}`}>{forcePullResult.missingCount ?? 0}명</span></div>
                    </div>
                    <div className={`mt-2 font-semibold ${isFailed ? "text-red-600" : isOk ? "text-emerald-600" : "text-amber-500"}`}>
                      {forcePullResult.verdict}
                    </div>
                    {forcePullResult.warning && (
                      <div className="mt-1 text-amber-500">{forcePullResult.warning}</div>
                    )}
                    <div className="mt-1 text-[var(--muted)]">{forcePullResult.message}</div>
                    {(forcePullResult.missingSample ?? []).length > 0 && (
                      <details className="mt-2" open>
                        <summary className="cursor-pointer text-amber-500 font-semibold">missing 샘플 ({forcePullResult.missingSample!.length}건)</summary>
                        <div className="mt-1 max-h-64 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px] space-y-1">
                          {forcePullResult.missingSample!.map((m) => (
                            <div key={m.remoteId} className={m.isTestData ? "text-amber-400" : "text-red-400"}>
                              <div>[{m.center}] <strong>{m.name}</strong> | no={m.memberNo ?? "-"} | phone={m.phone ?? "-"} | norm={m.phoneNormalizedVal ?? "-"} | status={m.status}{m.isTestData ? " ⚠테스트" : ""}</div>
                              <div className="pl-2 text-[9px] text-[var(--muted)]">remote_id: {m.remoteId}</div>
                              {m.failReason && <div className="pl-2 text-[9px] text-red-500">원인: {m.failReason}</div>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {forcePullResult.diagFilePath && (
                      <div className="mt-1 text-[9px] text-[var(--muted)] font-mono break-all">
                        진단 파일: {forcePullResult.diagFilePath}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── 회원권·출석·큐 진단 버튼 ── */}
              <div className="mt-3">
                <button
                  className="btn btn-secondary w-full"
                  disabled={diagBusy}
                  onClick={() => void handleMembershipAttendanceDiag()}
                >
                  <RefreshCw size={16} className={diagBusy ? "animate-spin" : ""} />
                  {diagBusy ? "진단 중..." : "회원권·출석·큐 진단 리포트"}
                </button>
              </div>
              {diagReport && (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px] space-y-2">
                  <div className="font-semibold text-[var(--text)]">회원권·출석·큐 진단 결과 <span className="text-[var(--muted)] font-normal">({diagReport.generatedAt})</span></div>

                  {/* 회원권 */}
                  <details open>
                    <summary className="cursor-pointer font-semibold text-[var(--text)]">
                      회원권 (remote_id 없음): {diagReport.membershipsNoRemoteId.total}건
                    </summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--muted)]">
                      {Object.entries(diagReport.membershipsNoRemoteId.summary).map(([k, v]) => (
                        <div key={k}><span className={k === "SAFE_UPLOAD_CANDIDATE" ? "text-emerald-500" : k.startsWith("BLOCK") ? "text-red-500" : "text-amber-400"}>{k}</span>: <span className="font-semibold text-[var(--text)]">{v}</span></div>
                      ))}
                    </div>
                    {diagReport.membershipsNoRemoteId.items.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px] space-y-0.5">
                        {diagReport.membershipsNoRemoteId.items.map((m) => (
                          <div key={m.localId} className={m.classification === "SAFE_UPLOAD_CANDIDATE" ? "text-emerald-500" : m.classification.startsWith("BLOCK") ? "text-red-400" : "text-amber-400"}>
                            [{m.memberCenter}] {m.memberName} — {m.membershipType} | {m.classification}
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  {/* 출석 */}
                  <details open>
                    <summary className="cursor-pointer font-semibold text-[var(--text)]">
                      출석 (remote_id 없음): {diagReport.attendanceNoRemoteId.total}건
                    </summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--muted)]">
                      {Object.entries(diagReport.attendanceNoRemoteId.summary).map(([k, v]) => (
                        <div key={k}><span className={k === "SAFE_UPLOAD_CANDIDATE" ? "text-emerald-500" : k.startsWith("BLOCK") ? "text-red-500" : "text-amber-400"}>{k}</span>: <span className="font-semibold text-[var(--text)]">{v}</span></div>
                      ))}
                    </div>
                    {diagReport.attendanceNoRemoteId.items.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px] space-y-0.5">
                        {diagReport.attendanceNoRemoteId.items.map((a) => (
                          <div key={a.localId} className={a.classification === "SAFE_UPLOAD_CANDIDATE" ? "text-emerald-500" : a.classification.startsWith("BLOCK") ? "text-red-400" : "text-amber-400"}>
                            [{a.memberCenter}] {a.memberName} — {a.checkinAt.slice(0, 10)} | {a.classification}
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  {/* 큐 */}
                  <details open>
                    <summary className="cursor-pointer font-semibold text-[var(--text)]">
                      sync_queue: {diagReport.syncQueue.total}건
                    </summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--muted)]">
                      {Object.entries(diagReport.syncQueue.summary).map(([k, v]) => (
                        <div key={k}><span className={k === "ALREADY_RESOLVED" ? "text-emerald-500" : k.startsWith("BLOCK") ? "text-red-500" : k.includes("CANDIDATE") ? "text-sky-400" : "text-amber-400"}>{k}</span>: <span className="font-semibold text-[var(--text)]">{v}</span></div>
                      ))}
                    </div>
                    {diagReport.syncQueue.items.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px] space-y-0.5">
                        {diagReport.syncQueue.items.map((q) => (
                          <div key={q.localId} className={q.classification === "ALREADY_RESOLVED" ? "text-emerald-500" : q.classification.startsWith("BLOCK") ? "text-red-400" : q.classification.includes("CANDIDATE") ? "text-sky-400" : "text-amber-400"}>
                            [{q.entityType}#{q.entityLocalId}] {q.memberName ?? "?"} | {q.classification}{q.lastError ? ` — ${q.lastError.slice(0, 60)}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  {diagReport.diagFilePath && (
                    <div className="text-[9px] text-[var(--muted)] font-mono break-all">
                      저장 위치: {diagReport.diagFilePath}
                    </div>
                  )}
                </div>
              )}

              {/* ── 검증된 회원권·출석 처리 버튼 (관리자 전용) ── */}
              {canSyncPush && (<>
              <div className="mt-3">
                <button
                  className="btn btn-secondary w-full"
                  disabled={safeSyncBusy || !syncOnline}
                  onClick={() => void handleSafeSyncDryRun()}
                >
                  <Upload size={16} className={safeSyncBusy ? "animate-spin" : ""} />
                  {safeSyncBusy ? (safeSyncProgress || "처리 중...") : "검증된 회원권·출석 처리 실행"}
                </button>
                {!syncOnline && (
                  <div className="mt-1 text-[10px] text-amber-500">Supabase 연결 필요</div>
                )}
              </div>

              {/* Dry-run confirm dialog */}
              {safeSyncConfirmOpen && safeSyncDryRunResult && (
                <div className="mt-3 rounded-xl border-2 border-amber-500 bg-[var(--panel)] p-3 text-[11px] space-y-2">
                  <div className="font-semibold text-amber-400">검증된 회원권·출석 처리 — dry-run 요약</div>
                  <div className="space-y-0.5 text-[var(--muted)]">
                    <div>member queue 정리 후보: <span className="font-semibold text-[var(--text)]">{safeSyncDryRunResult.memberQueueResolve.length}건</span></div>
                    <div>회원권 업로드/매칭 후보: <span className="font-semibold text-emerald-500">{safeSyncDryRunResult.membershipCandidates.length}건</span></div>
                    <div>회원권 테스트 차단: <span className="font-semibold text-red-400">{safeSyncDryRunResult.membershipBlockedTest}건</span></div>
                    <div>출석 업로드/매칭 후보: <span className="font-semibold text-sky-400">최대 {safeSyncDryRunResult.attendanceCandidatesMax}건</span></div>
                    <div>출석 테스트 차단: <span className="font-semibold text-red-400">{safeSyncDryRunResult.attendanceBlockedTest}건</span></div>
                    {safeSyncDryRunResult.manualReview > 0 && (
                      <div>수동 확인: <span className="font-semibold text-amber-400">{safeSyncDryRunResult.manualReview}건</span></div>
                    )}
                  </div>
                  <div className="text-[10px] text-amber-400 mt-2">
                    이 작업은 테스트 데이터를 업로드하지 않고, 검증된 회원권/출석만 처리합니다. 계속할까요?
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-secondary flex-1" onClick={() => setSafeSyncConfirmOpen(false)}>
                      취소
                    </button>
                    <button className="btn btn-secondary flex-1 !border-emerald-500 !text-emerald-500" onClick={() => void handleSafeSyncExecute()}>
                      확인 — 실행
                    </button>
                  </div>
                </div>
              )}

              {/* Safe sync result */}
              {safeSyncResult && (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px] space-y-2">
                  <div className="font-semibold text-emerald-500">검증된 회원권·출석 처리 결과</div>
                  <div className="grid grid-cols-3 gap-x-2 text-[10px]">
                    <div className="font-semibold text-[var(--muted)]">항목</div>
                    <div className="font-semibold text-[var(--muted)]">처리 전</div>
                    <div className="font-semibold text-[var(--muted)]">처리 후</div>
                    <div>회원권 no remote_id</div>
                    <div>{safeSyncResult.before.membershipsNoRemoteId}</div>
                    <div className="font-semibold">{safeSyncResult.after.membershipsNoRemoteId}</div>
                    <div>출석 no remote_id</div>
                    <div>{safeSyncResult.before.attendanceNoRemoteId}</div>
                    <div className="font-semibold">{safeSyncResult.after.attendanceNoRemoteId}</div>
                    <div>member queue pending</div>
                    <div>{safeSyncResult.before.syncQueuePending}</div>
                    <div className="font-semibold">{safeSyncResult.after.syncQueuePending}</div>
                  </div>
                  <div className="space-y-0.5 text-[var(--muted)]">
                    <div>member queue resolved: <span className="text-emerald-500 font-semibold">{safeSyncResult.actions.memberQueueResolved}</span></div>
                    <div>회원권 insert: <span className="text-emerald-500 font-semibold">{safeSyncResult.actions.membershipInserted}</span> / backfill: <span className="text-sky-400 font-semibold">{safeSyncResult.actions.membershipBackfilled}</span> / 테스트 차단: <span className="text-red-400 font-semibold">{safeSyncResult.actions.membershipBlockedTest}</span></div>
                    <div>출석 insert: <span className="text-emerald-500 font-semibold">{safeSyncResult.actions.attendanceInserted}</span> / backfill: <span className="text-sky-400 font-semibold">{safeSyncResult.actions.attendanceBackfilled}</span> / 테스트 차단: <span className="text-red-400 font-semibold">{safeSyncResult.actions.attendanceBlockedTest}</span></div>
                    {safeSyncResult.actions.manualReview > 0 && (
                      <div>수동 확인: <span className="text-amber-400 font-semibold">{safeSyncResult.actions.manualReview}</span></div>
                    )}
                  </div>
                  {safeSyncResult.actions.errors.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-red-400">오류 {safeSyncResult.actions.errors.length}건</summary>
                      <div className="mt-1 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[9px] text-red-400 space-y-0.5">
                        {safeSyncResult.actions.errors.map((e, i) => <div key={i}>{e}</div>)}
                      </div>
                    </details>
                  )}
                  {safeSyncResult.actions.membershipDetails.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-[var(--muted)]">회원권 상세 {safeSyncResult.actions.membershipDetails.length}건</summary>
                      <div className="mt-1 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[9px] space-y-0.5">
                        {safeSyncResult.actions.membershipDetails.map((d, i) => (
                          <div key={i} className={d.action === "inserted" ? "text-emerald-500" : d.action === "backfilled" ? "text-sky-400" : "text-red-400"}>
                            [ms#{d.localId}] {d.name} — {d.action}{d.serverIdUsed ? ` (${d.serverIdUsed.slice(0, 8)})` : ""}{d.error ? ` — ${d.error}` : ""}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {safeSyncResult.actions.attendanceDetails.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-[var(--muted)]">출석 상세 {safeSyncResult.actions.attendanceDetails.length}건</summary>
                      <div className="mt-1 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[9px] space-y-0.5">
                        {safeSyncResult.actions.attendanceDetails.map((d, i) => (
                          <div key={i} className={d.action === "inserted" ? "text-emerald-500" : d.action === "backfilled" ? "text-sky-400" : "text-red-400"}>
                            [att#{d.localId}] {d.name} — {d.action}{d.serverIdUsed ? ` (${d.serverIdUsed.slice(0, 8)})` : ""}{d.error ? ` — ${d.error}` : ""}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {safeSyncResult.reportFilePath && (
                    <div className="text-[9px] text-[var(--muted)] font-mono break-all">
                      리포트 저장: {safeSyncResult.reportFilePath}
                    </div>
                  )}
                </div>
              )}

              {/* ── 큐 정리 + 테스트 숨김 버튼 ── */}
              <div className="mt-3">
                <button
                  className="btn btn-secondary w-full"
                  disabled={queueCleanupBusy}
                  onClick={() => void handleQueueCleanupDryRun()}
                >
                  <RefreshCw size={16} className={queueCleanupBusy ? "animate-spin" : ""} />
                  {queueCleanupBusy ? "처리 중..." : "큐 정리 + 테스트 데이터 숨김"}
                </button>
              </div>

              {queueCleanupConfirmOpen && queueCleanupDryRun && (
                <div className="mt-3 rounded-xl border-2 border-amber-500 bg-[var(--panel)] p-3 text-[11px] space-y-2">
                  <div className="font-semibold text-amber-400">큐 정리 + 테스트 숨김 — dry-run 요약</div>
                  <div className="space-y-0.5 text-[var(--muted)]">
                    <div>member queue resolved 후보: <span className="font-semibold text-emerald-500">{queueCleanupDryRun.resolvableMemberQueue}건</span></div>
                    <div>attendance queue resolved 후보: <span className="font-semibold text-emerald-500">{queueCleanupDryRun.resolvableAttendanceQueue}건</span></div>
                    <div>테스트 회원 숨김 후보: <span className="font-semibold text-amber-400">{queueCleanupDryRun.testMembersToHide.length}건</span>
                      {queueCleanupDryRun.testMembersToHide.length > 0 && (
                        <span className="text-[var(--muted)]"> ({queueCleanupDryRun.testMembersToHide.map(m => m.name).join(", ")})</span>
                      )}
                    </div>
                    <div>로컬 중복 숨김 후보: <span className="font-semibold text-amber-400">{queueCleanupDryRun.localDupMembersToHide.length}건</span>
                      {queueCleanupDryRun.localDupMembersToHide.length > 0 && (
                        <span className="text-[var(--muted)]"> ({queueCleanupDryRun.localDupMembersToHide.map(m => m.name).join(", ")})</span>
                      )}
                    </div>
                    <div>회원권 중복 backfill 후보: <span className="font-semibold text-sky-400">{queueCleanupDryRun.localDupMemberships}건</span></div>
                    <div>BLOCK_TEST_DATA 유지: <span className="font-semibold text-red-400">{queueCleanupDryRun.blockTestData}건</span></div>
                    <div>MANUAL_REVIEW 유지: <span className="font-semibold text-amber-400">{queueCleanupDryRun.manualReview}건</span></div>
                  </div>
                  <div className="text-[10px] text-amber-400 mt-2">
                    이 작업은 서버에 업로드/삭제하지 않고, 로컬 큐 정리와 테스트 데이터 숨김만 합니다. 계속할까요?
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-secondary flex-1" onClick={() => setQueueCleanupConfirmOpen(false)}>취소</button>
                    <button className="btn btn-secondary flex-1 !border-emerald-500 !text-emerald-500" onClick={() => void handleQueueCleanupExecute()}>확인 — 실행</button>
                  </div>
                </div>
              )}

              {queueCleanupResult && (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px] space-y-2">
                  <div className="font-semibold text-emerald-500">큐 정리 + 테스트 숨김 결과</div>
                  <div className="space-y-0.5 text-[var(--muted)]">
                    <div>member queue resolved: <span className="text-emerald-500 font-semibold">{queueCleanupResult.memberQueueResolved}</span></div>
                    <div>attendance queue resolved: <span className="text-emerald-500 font-semibold">{queueCleanupResult.attendanceQueueResolved}</span></div>
                    <div>테스트 회원 숨김: <span className="text-amber-400 font-semibold">{queueCleanupResult.testMembersHidden}</span></div>
                    <div>로컬 중복 숨김: <span className="text-amber-400 font-semibold">{queueCleanupResult.localDupMembersHidden}</span></div>
                    <div>회원권 중복 backfill: <span className="text-sky-400 font-semibold">{queueCleanupResult.localDupMembershipsBackfilled}</span></div>
                  </div>
                  {queueCleanupResult.errors.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-red-400">오류 {queueCleanupResult.errors.length}건</summary>
                      <div className="mt-1 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[9px] text-red-400 space-y-0.5">
                        {queueCleanupResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                      </div>
                    </details>
                  )}
                  {queueCleanupResult.reportFilePath && (
                    <div className="text-[9px] text-[var(--muted)] font-mono break-all">
                      리포트 저장: {queueCleanupResult.reportFilePath}
                    </div>
                  )}
                </div>
              )}

              </>)}

              {verifyReport && (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[11px]">
                  <div className="mb-2 font-semibold text-[var(--text)]">동기화 검증 리포트</div>
                  <div className="space-y-1 text-[var(--muted)]">
                    <div>계정: <span className="font-semibold text-[var(--text)]">{verifyReport.loginEmail ?? "-"}</span></div>
                    <div>선택 센터: <span className="font-semibold text-[var(--text)]">{verifyReport.selectedCenterCode ?? "-"}</span></div>
                    <div>허용 센터: <span className="font-semibold text-[var(--text)]">{verifyReport.allowedCenterCodes.join(", ") || "없음"}</span></div>
                    <div className="mt-1">user_center_roles:
                      {verifyReport.userCenterRoles.length === 0
                        ? <span className="ml-1 text-amber-500">없음</span>
                        : verifyReport.userCenterRoles.map((r, i) => (
                          <span key={i} className="ml-1 text-[var(--text)]">{r.center_code ?? r.center_id.slice(0, 8)} ({r.role})</span>
                        ))
                      }
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {verifyReport.centers.map((c) => (
                      <div key={c.centerCode} className="rounded-lg border border-[var(--border)] p-2">
                        <div className="font-semibold text-[var(--text)]">{c.centerCode} {!c.allowed && <span className="text-red-500">✗ 권한없음</span>}</div>
                        <div className="grid grid-cols-2 gap-x-2 text-[var(--muted)]">
                          <div>서버 회원: <span className={`font-semibold ${c.serverMemberCount === 0 ? "text-amber-500" : "text-[var(--text)]"}`}>{c.serverMemberCount ?? "조회실패"}</span></div>
                          <div>로컬 표시: <span className={`font-semibold ${(c.localMemberCount ?? 0) === 0 ? "text-amber-500" : "text-[var(--text)]"}`}>{c.localMemberCount ?? "N/A"}</span></div>
                          <div>서버 회원권: <span className="font-semibold text-[var(--text)]">{c.serverMembershipCount ?? "-"}</span></div>
                          <div>로컬 회원권: <span className="font-semibold text-[var(--text)]">{c.localMembershipCount ?? "N/A"}</span></div>
                          {c.localRawTotal !== null && c.localRawTotal !== c.localMemberCount && (
                            <div className="col-span-2 text-amber-500">로컬 원장 합계: <span className="font-semibold">{c.localRawTotal}명</span> (삭제됨 {c.localDeletedCount ?? 0}, hidden {c.localHiddenCount ?? 0}, 중복 {c.localDuplicateCount ?? 0})</div>
                          )}
                          {(c.localRawTotal === null || c.localRawTotal === c.localMemberCount) && (
                            <>
                              <div>로컬 hidden: <span className="font-semibold text-[var(--text)]">{c.localHiddenCount ?? "-"}</span></div>
                              <div>로컬 중복: <span className="font-semibold text-[var(--text)]">{c.localDuplicateCount ?? "-"}</span></div>
                            </>
                          )}
                          {c.serverQueryError && (
                            <div className="col-span-2 text-red-500">서버 오류: {c.serverQueryError}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="font-semibold text-[var(--text)]">진단 결과:</div>
                    {verifyReport.diagnosis.map((d, i) => (
                      <div key={i} className={d.startsWith("✓") ? "text-green-600" : d.startsWith("△") ? "text-amber-500" : "text-red-500"}>{d}</div>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">검증 시각: {verifyReport.ranAt}</div>
                </div>
              )}

              {diagnostics && diagnostics.problem_members.length > 0 && (
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-[var(--border)]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-[var(--panel-strong)]">
                      <tr>
                        <th className="px-2 py-1">이름</th>
                        <th className="px-2 py-1">센터</th>
                        <th className="px-2 py-1">번호</th>
                        <th className="px-2 py-1">local id</th>
                        <th className="px-2 py-1">remote_id</th>
                        <th className="px-2 py-1">상태</th>
                        <th className="px-2 py-1">마지막 시도</th>
                        <th className="px-2 py-1">에러</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.problem_members.map((m) => (
                        <tr key={m.local_id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1">{m.name}</td>
                          <td className="px-2 py-1">{m.center}</td>
                          <td className="px-2 py-1">{m.member_no ?? "-"}</td>
                          <td className="px-2 py-1">{m.local_id}</td>
                          <td className="px-2 py-1 max-w-[100px] truncate" title={m.remote_id ?? ""}>{m.remote_id ?? "없음"}</td>
                          <td className="px-2 py-1">{m.sync_status ?? "-"}</td>
                          <td className="px-2 py-1">{m.last_sync_attempt ?? "-"}</td>
                          <td className="px-2 py-1 max-w-[140px] truncate" title={m.last_error ?? ""}>{m.last_error ?? "-"}</td>
                          <td className="px-2 py-1">
                            <button
                              className="btn btn-secondary !px-2 !py-0.5 text-[10px]"
                              disabled={verifyBusyId === m.local_id || !m.remote_id}
                              onClick={() => void handleVerifyOnServer(m.local_id, m.remote_id)}
                            >
                              서버 존재 확인
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {center && (
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <RefreshCw size={16} className="text-sky-500" />
                  센터 매핑 진단
                </div>
                <button
                  className="btn btn-secondary !px-3"
                  disabled={centerMappingLoading}
                  onClick={() => void handleRefreshCenterMapping()}
                >
                  {centerMappingLoading ? "확인 중..." : "센터 매핑 확인"}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Supabase에 등록된(remote_id 있는) 회원의 센터 코드와 로컬 센터 값을 비교합니다.
                동기화 대기중인 신규 회원은 제외됩니다.
              </p>

              {centerMappingRows && (
                <>
                  <div className="mt-3 text-[11px] text-[var(--muted)]">
                    불일치: <span className="font-semibold text-[var(--text)]">
                      {centerMappingRows.filter((r) => r.status === "불일치").length}
                    </span>
                    {" · "}확인 필요: <span className="font-semibold text-[var(--text)]">
                      {centerMappingRows.filter((r) => r.status === "확인 필요").length}
                    </span>
                    {" · "}정상: <span className="font-semibold text-[var(--text)]">
                      {centerMappingRows.filter((r) => r.status === "정상").length}
                    </span>
                  </div>

                  {centerMappingRows.some((r) => r.status === "불일치") && (
                    <div className="mt-2">
                      <button
                        className="btn btn-primary"
                        disabled={centerMappingRepairBusy}
                        onClick={() => void handleRepairCenterMapping()}
                      >
                        {centerMappingRepairBusy ? "보정 중..." : "서버 기준 센터 매핑 보정"}
                      </button>
                    </div>
                  )}

                  {centerMappingRows.filter((r) => r.status !== "정상").length > 0 && (
                    <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-[var(--border)]">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-[var(--panel-strong)]">
                          <tr>
                            <th className="px-2 py-1">이름</th>
                            <th className="px-2 py-1">local id</th>
                            <th className="px-2 py-1">remote_id</th>
                            <th className="px-2 py-1">로컬 센터</th>
                            <th className="px-2 py-1">Supabase center_id</th>
                            <th className="px-2 py-1">Supabase 센터</th>
                            <th className="px-2 py-1">화면 표시 센터</th>
                            <th className="px-2 py-1">상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {centerMappingRows
                            .filter((r) => r.status !== "정상")
                            .map((r) => (
                              <tr key={r.local_id} className="border-t border-[var(--border)]">
                                <td className="px-2 py-1">{r.name}</td>
                                <td className="px-2 py-1">{r.local_id}</td>
                                <td className="px-2 py-1 max-w-[100px] truncate" title={r.remote_id}>{r.remote_id}</td>
                                <td className="px-2 py-1">{r.local_center}</td>
                                <td className="px-2 py-1 max-w-[100px] truncate" title={r.supabase_center_id ?? ""}>{r.supabase_center_id ?? "-"}</td>
                                <td className="px-2 py-1">{r.supabase_center_code ?? "-"}</td>
                                <td className="px-2 py-1">{r.display_center}</td>
                                <td className="px-2 py-1">{r.status}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {cleanupConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div className="glass-panel w-full max-w-sm rounded-[1.25rem] p-5">
            <h3 className="text-lg font-bold">서버 기준 로컬 정리</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              내 PC의 로컬 DB에서, 같은 회원으로 보이는 중복 행 중 대표 1건만 남기고 나머지는
              "숨김" 처리합니다. 행은 삭제되지 않으며, Supabase 서버 데이터는 전혀 변경되지
              않습니다. 계속하시겠습니까?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setCleanupConfirmOpen(false)}
                disabled={cleanupBusy}
              >
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void handleRunCleanup()} disabled={cleanupBusy}>
                {cleanupBusy ? "처리 중..." : "정리 실행"}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicatesOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div className="glass-panel flex max-h-[80vh] w-full max-w-lg flex-col rounded-[1.25rem] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">중복 회원 진단</h3>
              <button className="btn btn-secondary !px-3" onClick={() => setDuplicatesOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              같은 센터에서 이름/연락처가 동일한 로컬 회원 행 그룹입니다 (읽기 전용 진단 정보).
            </p>
            <div className="mt-3 flex-1 overflow-y-auto">
              {duplicatesLoading ? (
                <p className="text-sm text-[var(--muted)]">불러오는 중...</p>
              ) : duplicateGroups.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">중복 후보가 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {duplicateGroups.map((group, idx) => (
                    <li key={idx} className="rounded-xl border border-[var(--border)] p-3 text-sm">
                      <div className="font-semibold">
                        {group.name} <span className="text-[var(--muted)]">({group.center})</span>
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        연락처: {group.phone ?? "없음"} · {group.member_ids.length}건
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                        ID: {group.member_ids.join(", ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
