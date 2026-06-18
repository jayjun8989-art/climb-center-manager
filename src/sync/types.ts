export interface SyncQueueItem {
  id: number;
  entity_type: string;
  entity_local_id: number;
  operation: string;
  payload_json: string;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}

export interface SyncStatus {
  pending_count: number;
  failed_count: number;
  last_pull_at: string | null;
  last_push_at: string | null;
  device_id: string | null;
}

export type SyncPhase = "idle" | "pulling" | "pushing" | "error";

export interface SyncRunResult {
  pushed: number;
  failed: number;
  skipped: number;
  errors: string[];
  message?: string;
}

export interface PullCenterDiagnostics {
  serverCount: number;   // rows actually fetched (after pagination)
  serverTotal?: number;  // COUNT from server (no row limit) — may be undefined
  upsertAttempt: number;
  upsertSuccess: number;
  mappingFail: number;
}

export interface PullMissingMemberSample {
  remoteId: string;
  name: string;
  memberNo: number | null;
  phone: string | null;
  phoneNormalizedVal: string | null;
  center: string;
  status: string;
  isTestData: boolean;
  failReason: string | null;
}

export interface PullRunResult {
  importedMembers: number;
  importedMemberships: number;
  importedAttendance: number;
  importedLockers: number;
  updatedMembers: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  message?: string;
  pullDiagnostics?: Record<string, PullCenterDiagnostics>;
  /** Total rows fetched from server across all pages (may differ from COUNT if RLS limits results) */
  fetchedTotal?: number;
  // Diagnostics from import
  serverTotal?: number;
  localTotalAfter?: number;
  localWithRemoteId?: number;
  missingRemoteIdCount?: number;
  missingRemoteIdSample?: PullMissingMemberSample[];
  conflictCount?: number;
}
