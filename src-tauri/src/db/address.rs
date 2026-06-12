use rusqlite::{Connection, Result as SqlResult};

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

pub fn migrate_to_v6(conn: &Connection) -> SqlResult<()> {
    let version = super::migration::current_schema_version(conn)?;
    if version >= 6 {
        return Ok(());
    }
    add_column_if_missing(conn, "members", "address", "TEXT")?;
    super::migration::set_schema_version(conn, 6)?;
    Ok(())
}
