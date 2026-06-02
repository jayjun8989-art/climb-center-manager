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
  last_pull_at: string | null;
  last_push_at: string | null;
  device_id: string | null;
}

export type SyncPhase = "idle" | "pulling" | "pushing" | "error";

export interface SyncRunResult {
  pulled: number;
  pushed: number;
  failed: number;
  message?: string;
}
