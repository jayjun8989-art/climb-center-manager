use crate::backup::{create_backup, get_backup_info, restore_backup};
use crate::db::{
    cancel_attendance, check_attendance_with_options, complete_member_push, count_active_members,
    create_member, delete_member, enqueue_sync_item, ensure_local_schema, has_attendance_today,
    has_attendance_on_date,
    import_pull_snapshot, list_center_lockers, get_attendance, get_dashboard_stats,
    find_duplicate_member_candidates, get_expiring_members, get_member_detail, get_pause_logs, get_payments, get_remote_id, list_members,
    list_sync_queue, mark_sync_queue_error, pause_membership, purge_unsupported_sync_queue,
    repair_member_sync_queue, remove_sync_queue_item, resume_membership, set_sync_state, update_member,
    upsert_id_map, AppState, DbError, PullImportResult, PullSnapshot, RepairSyncQueueResult,
    SyncQueueItem, SyncStatus,
};
use crate::models::{
    AttendanceLog, BackupInfo, BackupResult, DashboardStats, LockerListItem, MemberDetail,
    MemberInput, MemberListItem, MutationResult, PaginatedMembers, PauseLog, Payment, StorageInfo,
};
use tauri::State;

fn backup_best_effort(state: &AppState) -> Option<String> {
    match create_backup(state) {
        Ok(_) => None,
        Err(error) => Some(format!("데이터는 저장되었지만 자동 백업에 실패했습니다: {error}")),
    }
}

#[tauri::command]
pub fn get_members(
    state: State<'_, AppState>,
    center: String,
    search: Option<String>,
    member_group: Option<String>,
    status_filter: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<PaginatedMembers, String> {
    let search = search.unwrap_or_default();
    let member_group = member_group.unwrap_or_else(|| "all".to_string());
    let status_filter = status_filter.unwrap_or_else(|| "all".to_string());
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(50).clamp(10, 200);

    let (members, total) = list_members(
        &state,
        &center,
        &search,
        &member_group,
        &status_filter,
        page,
        page_size,
    )
    .map_err(|e| e.to_string())?;

    Ok(PaginatedMembers {
        members,
        total,
        page,
        page_size,
    })
}

#[tauri::command]
pub fn get_member_by_id(state: State<'_, AppState>, id: i64) -> Result<MemberDetail, String> {
    get_member_detail(&state, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "회원을 찾을 수 없습니다.".to_string())
}

#[tauri::command]
pub fn add_member(
    state: State<'_, AppState>,
    input: MemberInput,
    enqueue_sync: Option<bool>,
) -> Result<MutationResult<MemberListItem>, String> {
    let member = create_member(&state, input, enqueue_sync.unwrap_or(true)).map_err(|e| e.to_string())?;
    Ok(MutationResult {
        backup_warning: backup_best_effort(&state),
        data: member,
    })
}

#[tauri::command]
pub fn edit_member(
    state: State<'_, AppState>,
    id: i64,
    input: MemberInput,
) -> Result<MutationResult<MemberListItem>, String> {
    let member = update_member(&state, id, input).map_err(|e| e.to_string())?;
    Ok(MutationResult {
        backup_warning: backup_best_effort(&state),
        data: member,
    })
}

#[tauri::command]
pub fn remove_member(
    state: State<'_, AppState>,
    id: i64,
) -> Result<MutationResult<bool>, String> {
    delete_member(&state, id).map_err(|e| e.to_string())?;
    Ok(MutationResult {
        backup_warning: backup_best_effort(&state),
        data: true,
    })
}

#[tauri::command]
pub fn record_attendance(
    state: State<'_, AppState>,
    member_id: i64,
    membership_id: Option<i64>,
    force_duplicate: Option<bool>,
    checkin_date: Option<String>,
    editor: Option<String>,
) -> Result<MutationResult<MemberListItem>, String> {
    let member = check_attendance_with_options(
        &state,
        member_id,
        membership_id,
        force_duplicate.unwrap_or(false),
        checkin_date,
        editor.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(MutationResult {
        backup_warning: backup_best_effort(&state),
        data: member,
    })
}

#[tauri::command]
pub fn lookup_member_by_number(
    state: State<'_, AppState>,
    center: String,
    member_number: i64,
) -> Result<Option<crate::models::SelfCheckinMember>, String> {
    crate::db::lookup_member_for_self_checkin(&state, &center, member_number)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_attendance_today_cmd(state: State<'_, AppState>, member_id: i64) -> Result<bool, String> {
    has_attendance_today(&state, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_attendance_on_date_cmd(
    state: State<'_, AppState>,
    member_id: i64,
    date: String,
) -> Result<bool, String> {
    has_attendance_on_date(&state, member_id, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_attendance_cmd(
    state: State<'_, AppState>,
    attendance_id: i64,
    reason: Option<String>,
    editor: Option<String>,
) -> Result<MutationResult<MemberListItem>, String> {
    let member = cancel_attendance(&state, attendance_id, reason.as_deref(), editor.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(MutationResult {
        backup_warning: backup_best_effort(&state),
        data: member,
    })
}

#[tauri::command]
pub fn list_lockers(state: State<'_, AppState>, center: String) -> Result<Vec<LockerListItem>, String> {
    if let Err(error) = state.with_conn(|conn| ensure_local_schema(conn).map_err(DbError::from)) {
        eprintln!("[lockers] schema ensure failed: {error}");
        return Ok(Vec::new());
    }
    match list_center_lockers(&state, &center) {
        Ok(items) => Ok(items),
        Err(error) => {
            eprintln!("[lockers] list failed: {error}");
            Ok(Vec::new())
        }
    }
}

#[tauri::command]
pub fn fetch_attendance(
    state: State<'_, AppState>,
    member_id: i64,
    limit: Option<i64>,
) -> Result<Vec<crate::models::AttendanceLog>, String> {
    get_attendance(&state, member_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_payments(state: State<'_, AppState>, member_id: i64) -> Result<Vec<Payment>, String> {
    get_payments(&state, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_pause_logs(state: State<'_, AppState>, member_id: i64) -> Result<Vec<PauseLog>, String> {
    get_pause_logs(&state, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pause_membership_command(
    state: State<'_, AppState>,
    membership_id: i64,
    reason: Option<String>,
) -> Result<MemberListItem, String> {
    pause_membership(&state, membership_id, reason).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resume_membership_command(
    state: State<'_, AppState>,
    membership_id: i64,
) -> Result<MemberListItem, String> {
    resume_membership(&state, membership_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_dashboard_stats(
    state: State<'_, AppState>,
    center: String,
) -> Result<DashboardStats, String> {
    get_dashboard_stats(&state, &center).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_expiring_members(
    state: State<'_, AppState>,
    center: String,
    days: Option<i64>,
) -> Result<Vec<MemberListItem>, String> {
    get_expiring_members(&state, &center, days.unwrap_or(7)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn find_duplicate_members(
    state: State<'_, AppState>,
    center: String,
) -> Result<Vec<crate::db::DuplicateMemberCandidateGroup>, String> {
    find_duplicate_member_candidates(&state, &center).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn manual_backup(state: State<'_, AppState>) -> Result<BackupResult, String> {
    let backup = create_backup(&state).map_err(|e| e.to_string())?;
    Ok(BackupResult {
        json_path: backup.json_path.to_string_lossy().to_string(),
        db_path: backup.db_path.to_string_lossy().to_string(),
        created_at: backup.created_at,
    })
}

#[tauri::command]
pub fn fetch_backup_info(state: State<'_, AppState>) -> Result<BackupInfo, String> {
    get_backup_info(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    state.storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_backup_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    restore_backup(&state, std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_backup_folder(state: State<'_, AppState>) -> Result<(), String> {
    tauri_plugin_opener::open_path(&state.backup_dir, None::<&str>)
        .map_err(|e| format!("백업 폴더를 열 수 없습니다: {e}"))
}

#[tauri::command]
pub fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    let data_dir = state
        .db_path
        .parent()
        .ok_or_else(|| "데이터 폴더 경로를 찾을 수 없습니다.".to_string())?;
    tauri_plugin_opener::open_path(data_dir, None::<&str>)
        .map_err(|e| format!("데이터 폴더를 열 수 없습니다: {e}"))
}

#[tauri::command]
pub fn fetch_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    crate::db::fetch_sync_status(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_sync_queue(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<SyncQueueItem>, String> {
    list_sync_queue(&state, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn complete_sync_queue_item(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    remove_sync_queue_item(&state, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fail_sync_queue_item(
    state: State<'_, AppState>,
    id: i64,
    error: String,
) -> Result<(), String> {
    mark_sync_queue_error(&state, id, &error).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_sync_state(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    set_sync_state(&state, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn map_remote_id(
    state: State<'_, AppState>,
    entity_type: String,
    local_id: i64,
    remote_id: String,
) -> Result<(), String> {
    upsert_id_map(&state, &entity_type, local_id, &remote_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn complete_member_sync_push(
    state: State<'_, AppState>,
    queue_id: i64,
    local_member_id: i64,
    remote_id: String,
    remote_updated_at: Option<String>,
) -> Result<(), String> {
    complete_member_push(
        &state,
        queue_id,
        local_member_id,
        &remote_id,
        remote_updated_at.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_remote_id(
    state: State<'_, AppState>,
    entity_type: String,
    local_id: i64,
) -> Result<Option<String>, String> {
    get_remote_id(&state, &entity_type, local_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn repair_sync_queue(state: State<'_, AppState>) -> Result<RepairSyncQueueResult, String> {
    repair_member_sync_queue(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn purge_unsupported_sync_queue_cmd(state: State<'_, AppState>) -> Result<i64, String> {
    purge_unsupported_sync_queue(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn enqueue_sync(
    state: State<'_, AppState>,
    entity_type: String,
    entity_local_id: i64,
    operation: String,
    payload_json: String,
) -> Result<i64, String> {
    enqueue_sync_item(
        &state,
        &entity_type,
        entity_local_id,
        &operation,
        &payload_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_local_db_ready(state: State<'_, AppState>) -> Result<(), String> {
    state
        .with_conn(|conn| {
            ensure_local_schema(conn).map_err(DbError::from)?;
            Ok(())
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_local_members(state: State<'_, AppState>) -> Result<i64, String> {
    count_active_members(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_pull_snapshot_cmd(
    state: State<'_, AppState>,
    snapshot: PullSnapshot,
) -> Result<PullImportResult, String> {
    import_pull_snapshot(&state, snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_report_info(state: State<'_, AppState>) -> Result<crate::reports::ReportInfo, String> {
    Ok(crate::reports::get_report_info(&state))
}

#[tauri::command]
pub fn write_report_file_cmd(
    state: State<'_, AppState>,
    path: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    crate::reports::write_report_file(&state, path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_report_state_cmd(
    state: State<'_, AppState>,
    date: String,
    path: String,
) -> Result<(), String> {
    crate::reports::set_report_state(&state, &date, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_reports_folder(state: State<'_, AppState>) -> Result<(), String> {
    std::fs::create_dir_all(&state.reports_dir).ok();
    tauri_plugin_opener::open_path(&state.reports_dir, None::<&str>)
        .map_err(|e| format!("명부 폴더를 열 수 없습니다: {e}"))
}

#[tauri::command]
pub fn open_report_file(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
    let path = state.reports_dir.join(relative_path.replace('/', "\\"));
    if !path.exists() {
        return Err(format!(
            "명부 파일이 없습니다. 먼저 「오늘 기준으로 엑셀 갱신」을 실행하세요.\n{}",
            path.to_string_lossy()
        ));
    }
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("명부 파일을 열 수 없습니다: {e}"))
}

#[tauri::command]
pub fn open_reports_archive_folder(state: State<'_, AppState>) -> Result<(), String> {
    let archive = crate::reports::report_archive_dir(&state);
    std::fs::create_dir_all(&archive).ok();
    tauri_plugin_opener::open_path(&archive, None::<&str>)
        .map_err(|e| format!("archive 폴더를 열 수 없습니다: {e}"))
}
