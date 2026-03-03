import postgres from 'postgres';

let _sql: postgres.Sql | null = null;

export function getDb(connectionUrl?: string): postgres.Sql {
  if (!_sql) {
    const url = connectionUrl ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
