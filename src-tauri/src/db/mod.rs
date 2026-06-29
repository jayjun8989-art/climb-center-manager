mod address;
mod attendance_ext;
mod ensure_schema;
mod member_filter;
mod member_edit_log;
mod migration;
mod ops;
mod locker;
mod pull_import;
mod status;
mod sync_local;
pub mod diagnostic;
pub mod safe_sync;
pub mod test_data;

pub use attendance_ext::{
    cancel_attendance, check_attendance_with_options, has_attendance_today, has_attendance_on_date,
    get_attendance_mismatch_diagnostic, correct_member_remaining_count,
    AttendanceMismatchDiagnostic,
};
pub use ensure_schema::ensure_local_schema;
pub use locker::list_center_lockers;
pub use ops::*;
pub use diagnostic::{run_diagnostic, DiagnosticReport};
pub use safe_sync::{
    safe_sync_dry_run, resolve_member_queue_items, backfill_membership_remote_id,
    backfill_attendance_remote_id, get_attendance_candidates, save_safe_sync_report,
    cleanup_dry_run, execute_cleanup, save_cleanup_report,
    SafeSyncDryRun, SafeSyncMembershipCandidate, SafeSyncAttendanceCandidate,
    SafeSyncMemberQueueItem, ResolveMemberQueueResult,
    CleanupDryRun, CleanupResult,
};
pub use pull_import::{
    backfill_member_remote_ids_from_id_map, count_active_members, import_pull_snapshot,
    PullImportResult, PullSnapshot,
};
pub use sync_local::{
    complete_member_push, enqueue_entity_op, enqueue_sync_item, fetch_sync_status,
    get_remote_id, get_sync_diagnostics, get_upload_verification_report, list_members_with_remote_id,
    list_sync_queue, mark_sync_queue_error, purge_unsupported_sync_queue, repair_center_mapping,
    repair_member_sync_queue, remove_sync_queue_item, repair_status_mismatch, set_sync_state,
    upsert_id_map, requeue_member_for_upload, exclude_member_from_upload, set_member_hidden_locally,
    link_member_remote_id, get_local_members_for_matching, get_local_center_counts,
    CenterMappingCorrection, CenterMappingMember, CenterMappingRepairResult,
    RepairSyncQueueResult, SyncDiagnostics, SyncDiagnosticMember, SyncQueueItem, SyncStatus,
    UploadVerificationReport, UploadLocalMember, UploadLocalMembership, UploadLocalAttendance,
    LocalMemberForMatch, LocalCenterCounts,
};
