use crate::db::{AppState, DbError};
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};

const SYNC_TABLES: &[&str] = &[
    "members",
    "memberships",
    "attendance_logs",
    "payments",
    "pause_logs",
    "trial_members",
];

pub fn migrate_to_v3(conn: &Connection) -> SqlResult<()> {
    let version = super::migration::current_schema_version(conn)?;
    if version >= 3 {
        return Ok(());
    }

    for table in SYNC_TABLES {
        add_column_if_missing(conn, table, "remote_id", "TEXT")?;
        add_column_if_missing(conn, table, "sync_status", "TEXT NOT NULL DEFAULT 'pending'")?;
        add_column_if_missing(conn, table, "remote_updated_at", "TEXT")?;
    }

    conn.execute_batch(
        "
        UPDATE members SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE memberships SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE attendance_logs SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE payments SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE pause_logs SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';
        UPDATE trial_members SET sync_status = 'synced' WHERE sync_status IS NULL OR sync_status = 'pending';

        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_local_id INTEGER NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('insert', 'update', 'soft_delete')),
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS id_map (
            entity_type TEXT NOT NULL,
            local_id INTEGER NOT NULL,
            remote_id TEXT NOT NULL,
            PRIMARY KEY (entity_type, local_id)
        );

        CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
        ",
    )?;

    super::migration::set_schema_version(conn, 3)?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqlResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |row| row.get(0),
    )?;

    if count == 0 {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
    }
    Ok(())
}

pub fn enqueue_entity_op(
    state: &AppState,
    entity_type: &str,
    entity_local_id: i64,
    operation: &str,
    payload: &impl Serialize,
) -> Result<i64, DbError> {
    let payload_json =
        serde_json::to_string(payload).map_err(|error| DbError::Message(error.to_string()))?;
    enqueue_sync_item(
        state,
        entity_type,
        entity_local_id,
        operation,
        &payload_json,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub entity_type: String,
    pub entity_local_id: i64,
    pub operation: String,
    pub payload_json: String,
    pub created_at: String,
    pub retry_count: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub pending_count: i64,
    pub last_pull_at: Option<String>,
    pub last_push_at: Option<String>,
    pub device_id: Option<String>,
}

pub fn fetch_sync_status(state: &AppState) -> Result<SyncStatus, DbError> {
    state.with_conn(|conn| {
        let pending_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue",
            [],
            |row| row.get(0),
        )?;

        let read_state = |key: &str| -> Result<Option<String>, DbError> {
            conn.query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(DbError::from)
        };

        Ok(SyncStatus {
            pending_count,
            last_pull_at: read_state("last_pull_at")?,
            last_push_at: read_state("last_push_at")?,
            device_id: read_state("device_id")?,
        })
    })
}

pub fn enqueue_sync_item(
    state: &AppState,
    entity_type: &str,
    entity_local_id: i64,
    operation: &str,
    payload_json: &str,
) -> Result<i64, DbError> {
    state.with_conn(|conn| {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "UPDATE members SET sync_status = 'pending' WHERE id = ?1 AND ?2 = 'member'",
            rusqlite::params![entity_local_id, entity_type],
        )
        .ok();

        conn.execute(
            "INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![entity_type, entity_local_id, operation, payload_json, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn list_sync_queue(state: &AppState, limit: i64) -> Result<Vec<SyncQueueItem>, DbError> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, entity_local_id, operation, payload_json, created_at,
                    retry_count, last_error
             FROM sync_queue ORDER BY id ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(SyncQueueItem {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_local_id: row.get(2)?,
                operation: row.get(3)?,
                payload_json: row.get(4)?,
                created_at: row.get(5)?,
                retry_count: row.get(6)?,
                last_error: row.get(7)?,
            })
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    })
}

pub fn remove_sync_queue_item(state: &AppState, id: i64) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM sync_queue WHERE id = ?1", [id])?;
        Ok(())
    })
}

pub fn get_remote_id(
    state: &AppState,
    entity_type: &str,
    local_id: i64,
) -> Result<Option<String>, DbError> {
    state.with_conn(|conn| {
        if entity_type == "member" {
            if let Some(remote_id) = conn
                .query_row(
                    "SELECT remote_id FROM members WHERE id = ?1 AND remote_id IS NOT NULL",
                    [local_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            {
                return Ok(Some(remote_id));
            }
        }

        conn.query_row(
            "SELECT remote_id FROM id_map WHERE entity_type = ?1 AND local_id = ?2",
            rusqlite::params![entity_type, local_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(DbError::from)
    })
}

pub fn complete_member_push(
    state: &AppState,
    queue_id: i64,
    local_member_id: i64,
    remote_id: &str,
    remote_updated_at: Option<&str>,
) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let updated_at = remote_updated_at.unwrap_or(&now);
        let tx = conn.transaction()?;

        tx.execute(
            "UPDATE members
             SET remote_id = ?1, sync_status = 'synced', remote_updated_at = ?2, updated_at = updated_at
             WHERE id = ?3",
            rusqlite::params![remote_id, updated_at, local_member_id],
        )?;

        tx.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES ('member', ?1, ?2)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            rusqlite::params![local_member_id, remote_id],
        )?;

        tx.execute("DELETE FROM sync_queue WHERE id = ?1", [queue_id])?;
        tx.commit()?;
        Ok(())
    })
}

pub fn mark_sync_queue_error(state: &AppState, id: i64, error: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        let (entity_type, entity_local_id): (String, i64) = conn.query_row(
            "SELECT entity_type, entity_local_id FROM sync_queue WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        conn.execute(
            "UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ?1 WHERE id = ?2",
            rusqlite::params![error, id],
        )?;

        if entity_type == "member" {
            conn.execute(
                "UPDATE members SET sync_status = 'error' WHERE id = ?1",
                [entity_local_id],
            )?;
        }

        Ok(())
    })
}

pub fn set_sync_state(state: &AppState, key: &str, value: &str) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    })
}

pub fn upsert_id_map(
    state: &AppState,
    entity_type: &str,
    local_id: i64,
    remote_id: &str,
) -> Result<(), DbError> {
    state.with_conn(|conn| {
        conn.execute(
            "INSERT INTO id_map (entity_type, local_id, remote_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(entity_type, local_id) DO UPDATE SET remote_id = excluded.remote_id",
            rusqlite::params![entity_type, local_id, remote_id],
        )?;
        Ok(())
    })
}
