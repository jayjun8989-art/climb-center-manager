use rusqlite::{Connection, Result as SqlResult};

const SCHEMA_VERSION: i64 = 2;

pub fn current_schema_version(conn: &Connection) -> SqlResult<i64> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;

    let version: Option<i64> = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| value.parse().ok());

    Ok(version.unwrap_or(1))
}

pub fn set_schema_version(conn: &Connection, version: i64) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [version.to_string()],
    )?;
    Ok(())
}

pub fn create_v2_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            phone_normalized TEXT,
            member_type TEXT NOT NULL DEFAULT 'general'
                CHECK(member_type IN ('general', 'junior', 'trial')),
            center TEXT NOT NULL CHECK(center IN ('ONCLE', 'GRABIT')),
            parent_name TEXT,
            parent_phone TEXT,
            memo TEXT,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active', 'paused', 'expired', 'inactive')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            membership_type TEXT NOT NULL
                CHECK(membership_type IN ('30days', '90days', '180days', '5times', '8times', '16times', 'junior', 'trial')),
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
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS attendance_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            membership_id INTEGER NOT NULL REFERENCES memberships(id),
            center TEXT NOT NULL CHECK(center IN ('ONCLE', 'GRABIT')),
            checkin_at TEXT NOT NULL,
            attendance_type TEXT NOT NULL DEFAULT 'normal'
                CHECK(attendance_type IN ('normal', 'junior', 'trial')),
            deducted_count INTEGER NOT NULL DEFAULT 0,
            memo TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            membership_id INTEGER REFERENCES memberships(id),
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL DEFAULT 'cash'
                CHECK(payment_method IN ('card', 'cash', 'transfer', 'etc')),
            payment_date TEXT NOT NULL,
            memo TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pause_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id),
            membership_id INTEGER NOT NULL REFERENCES memberships(id),
            pause_start_date TEXT NOT NULL,
            pause_end_date TEXT,
            remaining_days_at_pause INTEGER,
            reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trial_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            center TEXT NOT NULL CHECK(center IN ('ONCLE', 'GRABIT')),
            trial_date TEXT NOT NULL,
            trial_price REAL NOT NULL DEFAULT 0,
            converted INTEGER NOT NULL DEFAULT 0,
            converted_member_id INTEGER REFERENCES members(id),
            memo TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_members_center ON members(center);
        CREATE INDEX IF NOT EXISTS idx_members_name ON members(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_members_phone_norm ON members(center, phone_normalized);
        CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
        CREATE INDEX IF NOT EXISTS idx_members_deleted ON members(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_id);
        CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(member_id, status);
        CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance_logs(member_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_membership ON attendance_logs(membership_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_checkin ON attendance_logs(checkin_at);
        CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
        CREATE INDEX IF NOT EXISTS idx_pause_member ON pause_logs(member_id);
        CREATE INDEX IF NOT EXISTS idx_trial_center ON trial_members(center);
        ",
    )
}

pub fn migrate_to_v2(conn: &Connection) -> SqlResult<()> {
    let version = current_schema_version(conn)?;
    if version >= 2 {
        return Ok(());
    }

    let members_schema: String = conn
        .query_row(
            "SELECT IFNULL(sql, '') FROM sqlite_master WHERE type='table' AND name='members'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    if members_schema.contains("membership_type") {
        migrate_legacy_flat_schema(conn)?;
    }

    create_v2_schema(conn)?;
    set_schema_version(conn, SCHEMA_VERSION)?;
    Ok(())
}

pub fn migrate_all(conn: &Connection) -> SqlResult<()> {
    migrate_to_v2(conn)?;
    crate::db::sync_local::migrate_to_v3(conn)?;
    Ok(())
}

fn migrate_legacy_flat_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;

        ALTER TABLE members RENAME TO members_legacy;
        ALTER TABLE attendance RENAME TO attendance_legacy;
        ",
    )?;

    create_v2_schema(conn)?;

    let mut stmt = conn.prepare(
        "SELECT id, center, name, phone, phone_normalized, membership_type, start_date, end_date,
                total_sessions, remaining_sessions, notes, created_at, updated_at
         FROM members_legacy",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<i32>>(8)?,
            row.get::<_, Option<i32>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, String>(12)?,
        ))
    })?;

    for row in rows {
        let (
            id,
            center,
            name,
            phone,
            phone_normalized,
            membership_type,
            start_date,
            end_date,
            total_sessions,
            remaining_sessions,
            notes,
            created_at,
            updated_at,
        ) = row?;

        let member_type = crate::db::status::legacy_member_type(&membership_type);
        conn.execute(
            "INSERT INTO members (
                id, name, phone, phone_normalized, member_type, center, parent_name, parent_phone,
                memo, status, created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, 'active', ?8, ?9, NULL)",
            rusqlite::params![
                id,
                name,
                phone,
                phone_normalized,
                member_type,
                center,
                notes,
                created_at,
                updated_at
            ],
        )?;

        let (new_type, pass_type, total_count, _, _) =
            crate::db::status::map_legacy_membership(&membership_type, total_sessions);
        let used_count = match pass_type.as_str() {
            "count" => {
                let total = total_count.unwrap_or(0);
                let remaining = remaining_sessions.unwrap_or(total);
                total - remaining
            }
            _ => 0,
        };
        let remaining_count = if pass_type == "count" {
            remaining_sessions.or(total_count)
        } else {
            None
        };

        conn.execute(
            "INSERT INTO memberships (
                member_id, membership_type, pass_type, start_date, end_date,
                total_count, used_count, remaining_count, status, price, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', NULL, ?9, ?10)",
            rusqlite::params![
                id,
                new_type,
                pass_type,
                start_date,
                end_date,
                total_count,
                used_count,
                remaining_count,
                created_at,
                updated_at
            ],
        )?;
        let membership_id = conn.last_insert_rowid();

        let mut attendance_stmt = conn.prepare(
            "SELECT id, member_id, checked_at FROM attendance_legacy WHERE member_id = ?1",
        )?;
        let attendance_rows = attendance_stmt.query_map([id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        for attendance_row in attendance_rows {
            let (attendance_id, member_id, checked_at) = attendance_row?;
            let attendance_type = crate::db::status::attendance_type_for_member(member_type);
            conn.execute(
                "INSERT INTO attendance_logs (
                    id, member_id, membership_id, center, checkin_at, attendance_type,
                    deducted_count, memo, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, NULL, ?7)",
                rusqlite::params![
                    attendance_id,
                    member_id,
                    membership_id,
                    center,
                    checked_at,
                    attendance_type,
                    checked_at
                ],
            )?;
        }
    }

    conn.execute_batch(
        "
        DROP TABLE IF EXISTS attendance_legacy;
        DROP TABLE IF EXISTS members_legacy;
        COMMIT;
        PRAGMA foreign_keys = ON;
        ",
    )?;

    Ok(())
}

use rusqlite::OptionalExtension;
