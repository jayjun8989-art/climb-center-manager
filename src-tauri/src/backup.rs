use crate::db::{export_all_data, AppState, DbError};
use chrono::Local;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_BACKUPS: usize = 30;

pub struct BackupPaths {
    pub json_path: PathBuf,
    pub db_path: PathBuf,
    pub created_at: String,
}

pub fn ensure_daily_backup(state: &AppState) -> Result<Option<BackupPaths>, DbError> {
    let today = Local::now().format("%Y%m%d").to_string();
    if has_backup_for_date(&state.backup_dir, &today)? {
        return Ok(None);
    }

    let backup = create_backup(state)?;
    Ok(Some(backup))
}

pub fn create_backup(state: &AppState) -> Result<BackupPaths, DbError> {
    state.checkpoint_wal()?;

    let data = export_all_data(state)?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let json_filename = format!("backup_{timestamp}.json");
    let db_filename = format!("backup_{timestamp}.db");
    let json_path = state.backup_dir.join(&json_filename);
    let db_path = state.backup_dir.join(&db_filename);

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| DbError::Message(format!("백업 JSON 변환 실패: {e}")))?;

    let mut file = fs::File::create(&json_path)
        .map_err(|e| DbError::Message(format!("백업 JSON 파일 생성 실패: {e}")))?;
    file.write_all(json.as_bytes())
        .map_err(|e| DbError::Message(format!("백업 JSON 파일 저장 실패: {e}")))?;

    fs::copy(&state.db_path, &db_path).map_err(|e| {
        DbError::Message(format!(
            "SQLite DB 백업 복사 실패: {} -> {} ({e})",
            state.db_path.to_string_lossy(),
            db_path.to_string_lossy()
        ))
    })?;

    cleanup_old_backups(&state.backup_dir)?;

    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    Ok(BackupPaths {
        json_path,
        db_path,
        created_at,
    })
}

pub fn restore_backup(state: &AppState, path: &Path) -> Result<(), DbError> {
    let json = fs::read_to_string(path)
        .map_err(|e| DbError::Message(format!("백업 파일을 읽을 수 없습니다: {e}")))?;

    let data: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| DbError::Message(format!("백업 JSON 형식이 올바르지 않습니다: {e}")))?;

    crate::db::restore_all_data(state, data).map_err(|e| DbError::Message(e.to_string()))?;
    create_backup(state).ok();
    Ok(())
}

fn has_backup_for_date(dir: &Path, date_prefix: &str) -> Result<bool, DbError> {
    let prefix = format!("backup_{date_prefix}_");
    let entries = fs::read_dir(dir)
        .map_err(|e| DbError::Message(format!("백업 폴더 읽기 실패: {e}")))?;

    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if !is_json_backup(&path) {
            continue;
        }
        if path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.starts_with(&prefix))
        {
            return Ok(true);
        }
    }

    Ok(false)
}

fn is_json_backup(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.starts_with("backup_"))
}

fn is_db_backup(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("db"))
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.starts_with("backup_"))
}

fn backup_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.to_string())
}

fn format_backup_timestamp(stem: &str) -> String {
    let timestamp = stem.strip_prefix("backup_").unwrap_or(stem);
    if timestamp.len() == 15 {
        format!(
            "{}-{}-{} {}:{}:{}",
            &timestamp[0..4],
            &timestamp[4..6],
            &timestamp[6..8],
            &timestamp[9..11],
            &timestamp[11..13],
            &timestamp[13..15]
        )
    } else {
        timestamp.to_string()
    }
}

fn cleanup_old_backups(dir: &PathBuf) -> Result<(), DbError> {
    let mut json_files: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| DbError::Message(format!("백업 폴더 읽기 실패: {e}")))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| is_json_backup(path))
        .collect();

    json_files.sort_by(|a, b| b.cmp(a));

    for old_json in json_files.iter().skip(MAX_BACKUPS) {
        fs::remove_file(old_json).ok();
        if let Some(stem) = backup_stem(old_json) {
            let old_db = dir.join(format!("{stem}.db"));
            fs::remove_file(old_db).ok();
        }
    }

    let kept_stems: Vec<String> = json_files
        .iter()
        .take(MAX_BACKUPS)
        .filter_map(|path| backup_stem(path))
        .collect();

    let db_files: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| DbError::Message(format!("백업 폴더 읽기 실패: {e}")))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| is_db_backup(path))
        .collect();

    for db_file in db_files {
        if let Some(stem) = backup_stem(&db_file) {
            if !kept_stems.iter().any(|kept| kept == &stem) {
                fs::remove_file(db_file).ok();
            }
        }
    }

    Ok(())
}

pub fn get_backup_info(state: &AppState) -> Result<crate::models::BackupInfo, DbError> {
    let dir = &state.backup_dir;
    let mut json_files: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(dir)
        .map_err(|e| DbError::Message(format!("백업 폴더 읽기 실패: {e}")))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !is_json_backup(&path) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();

    json_files.sort_by(|a, b| b.1.cmp(&a.1));

    let db_backup_count = fs::read_dir(dir)
        .map_err(|e| DbError::Message(format!("백업 폴더 읽기 실패: {e}")))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| is_db_backup(path))
        .count() as i64;

    let latest_json = json_files.first().map(|(path, _)| path.clone());
    let last_backup_at = latest_json.as_ref().and_then(|path| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .map(format_backup_timestamp)
    });
    let last_json_path = latest_json
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let last_db_path = latest_json.as_ref().and_then(|json_path| {
        backup_stem(json_path).map(|stem| dir.join(format!("{stem}.db")).to_string_lossy().to_string())
    });

    Ok(crate::models::BackupInfo {
        last_backup_at,
        backup_count: json_files.len() as i64,
        json_backup_count: json_files.len() as i64,
        db_backup_count,
        max_backups: MAX_BACKUPS as i64,
        backup_dir: dir.to_string_lossy().to_string(),
        db_path: state.db_path.to_string_lossy().to_string(),
        last_json_path,
        last_db_path,
        created_on_startup: *state
            .startup_backup_created
            .lock()
            .map_err(|_| DbError::Lock)?,
    })
}
