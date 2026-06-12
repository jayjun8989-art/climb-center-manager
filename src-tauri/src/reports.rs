use crate::db::{AppState, DbError};
use chrono::Local;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportInfo {
    pub reports_dir: String,
    pub last_report_date: Option<String>,
    pub last_report_at: Option<String>,
    pub last_report_path: Option<String>,
}

fn read_report_state(state: &AppState, key: &str) -> Result<Option<String>, DbError> {
    state.with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(DbError::from)
    })
}

pub fn get_report_info(state: &AppState) -> ReportInfo {
    ReportInfo {
        reports_dir: state.reports_dir.to_string_lossy().to_string(),
        last_report_date: read_report_state(state, "last_report_date").ok().flatten(),
        last_report_at: read_report_state(state, "last_report_at").ok().flatten(),
        last_report_path: read_report_state(state, "last_report_path").ok().flatten(),
    }
}

pub fn write_report_file(_state: &AppState, path: String, bytes: Vec<u8>) -> Result<String, DbError> {
    let file_path = PathBuf::from(&path);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| DbError::Message(error.to_string()))?;
    }
    std::fs::write(&file_path, bytes).map_err(|error| DbError::Message(error.to_string()))?;
    Ok(file_path.to_string_lossy().to_string())
}

pub fn set_report_state(state: &AppState, date: &str, path: &str) -> Result<(), DbError> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    crate::db::set_sync_state(state, "last_report_date", date)?;
    crate::db::set_sync_state(state, "last_report_at", &now)?;
    crate::db::set_sync_state(state, "last_report_path", path)?;
    Ok(())
}

pub fn report_archive_dir(state: &AppState) -> PathBuf {
    state.reports_dir.join("archive")
}
