/**
 * AuditService — query and export audit logs for institution admins.
 * This is a read-side companion to src/proxy/audit.ts (which writes entries).
 * All queries are strictly scoped to a single institutionId.
 */
import type { Sql } from 'postgres';

export interface AuditQuery {
  institutionId: string;
  userId?: string;
  departmentId?: string;
  serverSlug?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditRow {
  id: string;
  userId: string | null;
  departmentId: string | null;
  serverSlug: string;
  toolName: string | null;
  method: string;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: Date;
}

export interface AuditSummary {
  totalRequests: number;
  successRate: number; // 0-1
  avgLatencyMs: number | null;
  topTools: Array<{ toolName: string; count: number }>;
  topUsers: Array<{ userId: string; count: number }>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class AuditService {
  constructor(private sql: Sql) {}

  async queryLogs(q: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = q.offset ?? 0;

    // Build WHERE clauses dynamically
    // We use a raw fragment approach: build conditions as an array and AND them.
    // postgres.js supports sql`` fragments that can be composed.
    const rows = await this.sql<
      {
        id: string;
        user_id: string | null;
        department_id: string | null;
        server_slug: string;
        tool_name: string | null;
        method: string;
        status_code: number | null;
        latency_ms: number | null;
        error: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, user_id, department_id, server_slug, tool_name,
             method, status_code, latency_ms, error, created_at
      FROM audit_log
      WHERE institution_id = ${q.institutionId}
        ${q.userId ? this.sql`AND user_id = ${q.userId}` : this.sql``}
        ${q.departmentId ? this.sql`AND department_id = ${q.departmentId}` : this.sql``}
        ${q.serverSlug ? this.sql`AND server_slug = ${q.serverSlug}` : this.sql``}
        ${q.startDate ? this.sql`AND created_at >= ${q.startDate}` : this.sql``}
        ${q.endDate ? this.sql`AND created_at <= ${q.endDate}` : this.sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.sql<[{ count: string }]>`
      SELECT COUNT(*) AS count
      FROM audit_log
      WHERE institution_id = ${q.institutionId}
        ${q.userId ? this.sql`AND user_id = ${q.userId}` : this.sql``}
        ${q.departmentId ? this.sql`AND department_id = ${q.departmentId}` : this.sql``}
        ${q.serverSlug ? this.sql`AND server_slug = ${q.serverSlug}` : this.sql``}
        ${q.startDate ? this.sql`AND created_at >= ${q.startDate}` : this.sql``}
        ${q.endDate ? this.sql`AND created_at <= ${q.endDate}` : this.sql``}
    `;

    const total = parseInt(countResult[0].count, 10);

    const mappedRows: AuditRow[] = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      departmentId: r.department_id,
      serverSlug: r.server_slug,
      toolName: r.tool_name,
      method: r.method,
      statusCode: r.status_code,
      latencyMs: r.latency_ms,
      error: r.error,
      createdAt: r.created_at,
    }));

    return { rows: mappedRows, total };
  }

  async getSummary(institutionId: string, days: number): Promise<AuditSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const statsResult = await this.sql<
      [{ total: string; success_count: string; avg_latency: string | null }]
    >`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300) AS success_count,
        AVG(latency_ms)::numeric(10,2) AS avg_latency
      FROM audit_log
      WHERE institution_id = ${institutionId}
        AND created_at >= ${since}
    `;

    const stats = statsResult[0];
    const total = parseInt(stats.total, 10);
    const successCount = parseInt(stats.success_count, 10);

    const topToolsResult = await this.sql<{ tool_name: string; count: string }[]>`
      SELECT tool_name, COUNT(*) AS count
      FROM audit_log
      WHERE institution_id = ${institutionId}
        AND created_at >= ${since}
        AND tool_name IS NOT NULL
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT 5
    `;

    const topUsersResult = await this.sql<{ user_id: string; count: string }[]>`
      SELECT user_id, COUNT(*) AS count
      FROM audit_log
      WHERE institution_id = ${institutionId}
        AND created_at >= ${since}
        AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY count DESC
      LIMIT 5
    `;

    return {
      totalRequests: total,
      successRate: total > 0 ? successCount / total : 0,
      avgLatencyMs: stats.avg_latency != null ? parseFloat(stats.avg_latency) : null,
      topTools: topToolsResult.map((r) => ({ toolName: r.tool_name, count: parseInt(r.count, 10) })),
      topUsers: topUsersResult.map((r) => ({ userId: r.user_id, count: parseInt(r.count, 10) })),
    };
  }

  async exportCsv(q: AuditQuery): Promise<string> {
    // For CSV export we bypass the pagination limit and fetch all matching rows.
    const rows = await this.sql<
      {
        id: string;
        user_id: string | null;
        department_id: string | null;
        server_slug: string;
        tool_name: string | null;
        method: string;
        status_code: number | null;
        latency_ms: number | null;
        error: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, user_id, department_id, server_slug, tool_name,
             method, status_code, latency_ms, error, created_at
      FROM audit_log
      WHERE institution_id = ${q.institutionId}
        ${q.userId ? this.sql`AND user_id = ${q.userId}` : this.sql``}
        ${q.departmentId ? this.sql`AND department_id = ${q.departmentId}` : this.sql``}
        ${q.serverSlug ? this.sql`AND server_slug = ${q.serverSlug}` : this.sql``}
        ${q.startDate ? this.sql`AND created_at >= ${q.startDate}` : this.sql``}
        ${q.endDate ? this.sql`AND created_at <= ${q.endDate}` : this.sql``}
      ORDER BY created_at DESC
    `;

    const header = 'id,user_id,department_id,server_slug,tool_name,method,status_code,latency_ms,error,created_at';
    const lines = rows.map((r) =>
      [
        csvCell(r.id),
        csvCell(r.user_id),
        csvCell(r.department_id),
        csvCell(r.server_slug),
        csvCell(r.tool_name),
        csvCell(r.method),
        csvCell(r.status_code),
        csvCell(r.latency_ms),
        csvCell(r.error),
        csvCell(r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
      ].join(','),
    );

    return [header, ...lines].join('\n');
  }
}

/**
 * Wrap a value in CSV-safe format: null becomes empty string,
 * strings containing commas/quotes/newlines are double-quoted.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
