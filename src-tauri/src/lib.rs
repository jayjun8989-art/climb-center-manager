mod backup;
mod commands;
mod db;
mod models;

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
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("앱 데이터 경로를 찾을 수 없습니다: {error}"))?;
            let db_path = app_data_dir.join("climb_center.db");
            let backup_dir = app_data_dir.join("backups");

            let state = AppState::new(db_path, backup_dir).map_err(|error| {
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
            commands::get_member_by_id,
            commands::add_member,
            commands::edit_member,
            commands::remove_member,
            commands::record_attendance,
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
            commands::fetch_sync_queue,
            commands::complete_sync_queue_item,
            commands::fail_sync_queue_item,
            commands::update_sync_state,
            commands::map_remote_id,
            commands::fetch_remote_id,
            commands::enqueue_sync,
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
