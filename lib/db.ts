import { createClient, type Client } from '@libsql/client';

export type DbQueryResult<T = unknown> = {
  rows: T[];
  rowCount?: number;
};

export interface DbPool {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<DbQueryResult<R>>;
}

let tursoClientInstance: Client | null = null;

export function getTursoClient(): Client | null {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  if (!tursoClientInstance) {
    tursoClientInstance = createClient({ url, authToken });
  }
  return tursoClientInstance;
}

/**
 * Returns the active database pool backed by Turso/libSQL over HTTP.
 * 100% compatible with Cloudflare Workers edge environment.
 */
export function getDbPool(): DbPool | null {
  const client = getTursoClient();
  if (!client) return null;

  return {
    async query<R = unknown>(sql: string, params?: unknown[]): Promise<DbQueryResult<R>> {
      // Convert Postgres $1, $2 placeholders to SQLite ? placeholders if needed
      const sqliteSql = sql.replace(/\$\d+/g, '?');
      const res = await client.execute({
        sql: sqliteSql,
        args: (params as any[]) || [],
      });
      return {
        rows: res.rows as unknown as R[],
        rowCount: res.rows.length,
      };
    },
  };
}

export async function ensureDbReady(): Promise<void> {
  const client = getTursoClient();
  if (client) {
    try {
      await client.execute('SELECT 1');
    } catch (err) {
      console.warn('[db] Turso ping check warning:', err);
    }
  }
}
