mod backup;
mod commands;
mod db;
mod models;
mod reports;

use backup::ensure_daily_backup;
use db::AppState;
use tauri::{Manager, RunEvent};

#[cfg(windows)]
fn show_startup_error(message: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    extern "system" {
        fn MessageBoxW(hwnd: *mut std::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    let text = to_wide(message);
    let caption = to_wide("클라이밍 센터 회원관리 - 시작 오류");
    unsafe {
        MessageBoxW(ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("앱 데이터 경로를 찾을 수 없습니다: {error}"))?;
            std::fs::create_dir_all(&app_data_dir).ok();

            const DB_FILENAME: &str = "climb-center-manager.db";
            const LEGACY_DB_FILENAME: &str = "climb_center.db";
            let db_path = app_data_dir.join(DB_FILENAME);
            let legacy_db_path = app_data_dir.join(LEGACY_DB_FILENAME);
            if !db_path.exists() && legacy_db_path.exists() {
                let _ = std::fs::rename(&legacy_db_path, &db_path);
            }
            let backup_dir = app_data_dir.join("backups");
            let reports_dir = app_data_dir.join("reports");

            let state = AppState::new(db_path, backup_dir, reports_dir).map_err(|error| {
                format!(
                    "데이터베이스를 초기화하지 못했습니다.\n경로: {}\n원인: {error}",
                    app_data_dir.to_string_lossy()
                )
            })?;

            if let Ok(Some(_)) = ensure_daily_backup(&state) {
                if let Ok(mut created) = state.startup_backup_created.lock() {
                    *created = true;
                }
            }

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_members,
            commands::find_duplicate_members,
            commands::cleanup_local_duplicates_cmd,
            commands::get_member_by_id,
            commands::add_member,
            commands::edit_member,
            commands::remove_member,
            commands::record_attendance,
            commands::lookup_member_by_number,
            commands::get_next_member_no,
            commands::has_attendance_today_cmd,
            commands::has_attendance_on_date_cmd,
            commands::cancel_attendance_cmd,
            commands::list_lockers,
            commands::fetch_attendance,
            commands::fetch_payments,
            commands::fetch_pause_logs,
            commands::pause_membership_command,
            commands::resume_membership_command,
            commands::fetch_dashboard_stats,
            commands::fetch_expiring_members,
            commands::manual_backup,
            commands::fetch_backup_info,
            commands::fetch_storage_info,
            commands::restore_backup_file,
            commands::open_backup_folder,
            commands::open_data_folder,
            commands::fetch_sync_status,
            commands::get_sync_diagnostics,
            commands::fetch_sync_queue,
            commands::repair_sync_queue,
            commands::get_center_mapping_members,
            commands::repair_center_mapping_cmd,
            commands::purge_unsupported_sync_queue_cmd,
            commands::complete_sync_queue_item,
            commands::fail_sync_queue_item,
            commands::update_sync_state,
            commands::map_remote_id,
            commands::complete_member_sync_push,
            commands::fetch_remote_id,
            commands::enqueue_sync,
            commands::count_local_members,
            commands::ensure_local_db_ready,
            commands::import_pull_snapshot_cmd,
            commands::fetch_report_info,
            commands::write_report_file_cmd,
            commands::set_report_state_cmd,
            commands::open_reports_folder,
            commands::open_report_file,
            commands::open_reports_archive_folder,
            commands::get_center_member_counts,
            commands::get_raw_member_counts,
            commands::get_upload_verification_report_cmd,
            commands::get_attendance_mismatch_diagnostic_cmd,
            commands::correct_member_remaining_count_cmd,
            commands::repair_status_mismatch_cmd,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            let message = format!("앱을 시작하지 못했습니다.\n{error}");
            #[cfg(windows)]
            show_startup_error(&message);
            #[cfg(not(windows))]
            eprintln!("{message}");
            std::process::exit(1);
        });

    app.run(|app_handle, event| {
        if matches!(
            event,
            RunEvent::Exit | RunEvent::ExitRequested { .. }
        ) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.checkpoint_wal().ok();
            }
        }
    });
}
