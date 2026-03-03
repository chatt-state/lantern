/**
 * Audit logging helper for the MCP proxy.
 * All proxy requests are logged to audit_log; failures in logging must never fail the request.
 */
import type { Sql } from 'postgres';

export interface AuditEntry {
  institutionId: string;
  userId?: string;
  departmentId?: string;
  serverSlug: string;
  toolName?: string;
  method: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

export async function logAuditEntry(sql: Sql, entry: AuditEntry): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_log (
        institution_id, user_id, department_id, server_slug, tool_name,
        method, status_code, latency_ms, error
      ) VALUES (
        ${entry.institutionId},
        ${entry.userId ?? null},
        ${entry.departmentId ?? null},
        ${entry.serverSlug},
        ${entry.toolName ?? null},
        ${entry.method},
        ${entry.statusCode ?? null},
        ${entry.latencyMs ?? null},
        ${entry.error ?? null}
      )
    `;
  } catch {
    // Audit logging must never fail a request
  }
}
