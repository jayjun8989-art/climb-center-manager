use rusqlite::{Connection, Result as SqlResult};

const LATEST_SCHEMA_VERSION: i64 = 10;

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

    // phone_normalized was in create_v2_schema but not in add_column migrations,
    // causing all upsert INSERT/UPDATE to fail on existing v1 DBs.
    add_column_if_missing(conn, "members", "phone_normalized", "TEXT")?;

    add_column_if_missing(conn, "members", "address", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_number", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_status", "TEXT NOT NULL DEFAULT 'empty'")?;
    add_column_if_missing(conn, "members", "locker_start_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_end_date", "TEXT")?;
    add_column_if_missing(conn, "members", "locker_memo", "TEXT")?;

    add_column_if_missing(conn, "members", "member_no", "INTEGER")?;

    // v10: local-only hide/quarantine flags for duplicate cleanup (no server impact).
    add_column_if_missing(conn, "members", "hidden_locally", "INTEGER NOT NULL DEFAULT 0")?;
    add_column_if_missing(conn, "members", "is_local_duplicate", "INTEGER NOT NULL DEFAULT 0")?;

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

    fix_memberships_check_constraint(conn)?;

    super::migration::set_schema_version(conn, LATEST_SCHEMA_VERSION)?;
    Ok(())
}

/// Recreates the memberships table if its CHECK constraint is missing '60days'.
/// SQLite does not support ALTER TABLE DROP CONSTRAINT, so we must rename + recreate.
fn fix_memberships_check_constraint(conn: &Connection) -> SqlResult<()> {
    // Check if the current memberships CHECK already includes '60days'
    let create_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='memberships'",
        [],
        |row| row.get(0),
    ).unwrap_or_default();

    if create_sql.contains("'60days'") || create_sql.contains("\"60days\"") {
        return Ok(()); // already fixed
    }

    // Recreate with updated CHECK using a temp table approach
    conn.execute_batch("
        PRAGMA foreign_keys = OFF;

        CREATE TABLE IF NOT EXISTS memberships_fix (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            membership_type TEXT NOT NULL
                CHECK(membership_type IN ('30days','60days','90days','180days','5times','8times','16times','junior','trial')),
            pass_type TEXT NOT NULL CHECK(pass_type IN ('period', 'count')),
            start_date TEXT NOT NULL,
            end_date TEXT,
            total_count INTEGER,
            used_count INTEGER NOT NULL DEFAULT 0,
            remaining_count INTEGER,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active', 'paused', 'expired', 'finished')),
            price REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            remote_id TEXT,
            sync_status TEXT NOT NULL DEFAULT 'pending',
            remote_updated_at TEXT
        );

        INSERT OR IGNORE INTO memberships_fix
            SELECT id, member_id,
                CASE membership_type
                    WHEN '30days' THEN '30days'
                    WHEN '60days' THEN '60days'
                    WHEN '90days' THEN '90days'
                    WHEN '180days' THEN '180days'
                    WHEN '5times' THEN '5times'
                    WHEN '8times' THEN '8times'
                    WHEN '16times' THEN '16times'
                    WHEN 'junior' THEN 'junior'
                    WHEN 'trial' THEN 'trial'
                    WHEN 'monthly' THEN '30days'
                    WHEN 'session' THEN '5times'
                    ELSE '30days'
                END,
                pass_type, start_date, end_date, total_count, used_count,
                remaining_count, status, price, created_at, updated_at,
                remote_id, COALESCE(sync_status, 'pending'), remote_updated_at
        FROM memberships;

        DROP TABLE memberships;
        ALTER TABLE memberships_fix RENAME TO memberships;

        PRAGMA foreign_keys = ON;
    ")?;

    Ok(())
}
