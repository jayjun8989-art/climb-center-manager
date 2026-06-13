use rusqlite::{Connection, Result as SqlResult};

const LATEST_SCHEMA_VERSION: i64 = 9;

const SYNC_TABLES: &[&str] = &[
    "members",
    "memberships",
    "attendance_logs",
    "payments",
    "pause_logs",
    "trial_members",
];

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqlResult<()> {
    let table_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    if table_exists == 0 {
        return Ok(());
    }

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

pub fn ensure_local_schema(conn: &Connection) -> SqlResult<()> {
    super::migration::create_v2_schema(conn)?;

    for table in SYNC_TABLES {
        add_column_if_missing(conn, table, "remote_id", "TEXT")?;
        add_column_if_missing(conn, table, "sync_status", "TEXT NOT NULL DEFAULT 'pending'")?;
        add_column_if_missing(conn, table, "remote_updated_at", "TEXT")?;
    }

    add_column_if_missing(conn, "members", "address", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_number", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_status", "TEXT NOT NULL DEFAULT 'empty'")?;
    add_column_if_missing(conn, "members", "locker_start_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_end_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_memo", "TEXT")?;

    add_column_if_missing(conn, "members", "member_no", "INTEGER")?;

    add_column_if_missing(conn, "attendance_logs", "canceled_at", "TEXT")?;
    add_column_if_missing(conn, "attendance_logs", "canceled_by", "TEXT")?;
    add_column_if_missing(conn, "attendance_logs", "cancel_reason", "TEXT")?;
    add_column_if_missing(conn, "attendance_logs", "source", "TEXT NOT NULL DEFAULT 'staff'")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

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

        CREATE TABLE IF NOT EXISTS member_edit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            action TEXT NOT NULL CHECK(action IN ('create', 'update')),
            editor TEXT,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
        CREATE INDEX IF NOT EXISTS idx_members_remote_id ON members(remote_id);
        CREATE INDEX IF NOT EXISTS idx_members_dup_lookup ON members(center, name, phone);
        CREATE INDEX IF NOT EXISTS idx_members_locker ON members(center, locker_number);
        CREATE INDEX IF NOT EXISTS idx_member_edit_logs_member
            ON member_edit_logs(member_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_members_member_no ON members(center, member_no);

        UPDATE members SET locker_status = 'empty'
        WHERE locker_status IS NULL OR locker_status = '';
        ",
    )?;

    super::migration::set_schema_version(conn, LATEST_SCHEMA_VERSION)?;
    Ok(())
}
