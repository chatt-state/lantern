/**
 * Audit log viewer and CSV export routes for institution admins.
 * All routes require authentication and institution-admin role.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireAuth, requireInstitutionAdmin } from '../auth/middleware.js';
import { getSession } from '../auth/session.js';
import { layout, escHtml } from '../web/layout.js';
import { AuditService } from './service.js';

const PAGE_SIZE = 50;

export function auditRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const auditService = new AuditService(sql);

    // -------------------------------------------------------------------------
    // GET /settings/admin/audit — HTML audit log viewer
    // -------------------------------------------------------------------------
    app.get(
      '/settings/admin/audit',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;

        const query = request.query as Record<string, string | undefined>;
        const userId = query.userId?.trim() || undefined;
        const serverSlug = query.serverSlug?.trim() || undefined;
        const rawStart = query.startDate?.trim();
        const rawEnd = query.endDate?.trim();
        const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);

        const startDate = rawStart ? parseDate(rawStart) : undefined;
        const endDate = rawEnd ? parseDate(rawEnd) : undefined;

        const offset = (page - 1) * PAGE_SIZE;

        const [{ rows, total }, summary] = await Promise.all([
          auditService.queryLogs({
            institutionId,
            userId,
            serverSlug,
            startDate,
            endDate,
            limit: PAGE_SIZE,
            offset,
          }),
          auditService.getSummary(institutionId, 1),
        ]);

        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        // Build filter query string for pagination links
        const filterParams = new URLSearchParams();
        if (userId) filterParams.set('userId', userId);
        if (serverSlug) filterParams.set('serverSlug', serverSlug);
        if (rawStart) filterParams.set('startDate', rawStart);
        if (rawEnd) filterParams.set('endDate', rawEnd);

        const paginationBase = filterParams.toString()
          ? `/settings/admin/audit?${filterParams.toString()}&page=`
          : '/settings/admin/audit?page=';

        const exportParams = new URLSearchParams(filterParams);
        const exportUrl = `/settings/admin/audit/export?${exportParams.toString()}`;

        const successPct = Math.round(summary.successRate * 100);
        const avgLatency =
          summary.avgLatencyMs != null ? `${Math.round(summary.avgLatencyMs)} ms` : '—';

        const statsHtml = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
            <div class="card" style="padding:16px">
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Requests (24 h)</div>
              <div style="font-size:24px;font-weight:700">${summary.totalRequests}</div>
            </div>
            <div class="card" style="padding:16px">
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Success Rate</div>
              <div style="font-size:24px;font-weight:700;color:${successPct >= 90 ? 'var(--success)' : successPct >= 70 ? 'var(--warning)' : 'var(--danger)'}">${successPct}%</div>
            </div>
            <div class="card" style="padding:16px">
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Avg Latency</div>
              <div style="font-size:24px;font-weight:700">${escHtml(avgLatency)}</div>
            </div>
          </div>`;

        const filterHtml = `
          <form method="get" action="/settings/admin/audit" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:20px">
            <div>
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">User ID</label>
              <input name="userId" value="${escHtml(userId ?? '')}" placeholder="filter by user" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;color:var(--text);font-size:13px;width:180px">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Server</label>
              <input name="serverSlug" value="${escHtml(serverSlug ?? '')}" placeholder="e.g. m365" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;color:var(--text);font-size:13px;width:120px">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">From</label>
              <input type="date" name="startDate" value="${escHtml(rawStart ?? '')}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;color:var(--text);font-size:13px">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">To</label>
              <input type="date" name="endDate" value="${escHtml(rawEnd ?? '')}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;color:var(--text);font-size:13px">
            </div>
            <button type="submit" class="btn btn-primary" style="height:34px">Filter</button>
            <a href="/settings/admin/audit" class="btn btn-ghost" style="height:34px">Clear</a>
            <a href="${escHtml(exportUrl)}" class="btn btn-ghost" style="height:34px;margin-left:auto">Export CSV</a>
          </form>`;

        const tableRows =
          rows.length === 0
            ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">No audit entries found.</td></tr>`
            : rows
                .map((r) => {
                  const statusClass =
                    r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300
                      ? 'var(--success)'
                      : r.statusCode != null && r.statusCode >= 400
                        ? 'var(--danger)'
                        : 'var(--text-muted)';
                  return `<tr>
                  <td style="white-space:nowrap;color:var(--text-muted);font-size:12px">${escHtml(formatDate(r.createdAt))}</td>
                  <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.userId ?? '')}">${escHtml(r.userId ?? '—')}</td>
                  <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.departmentId ?? '')}">${escHtml(r.departmentId ?? '—')}</td>
                  <td>${escHtml(r.serverSlug)}</td>
                  <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.toolName ?? '—')}</td>
                  <td><code style="font-size:11px">${escHtml(r.method)}</code></td>
                  <td style="color:${statusClass};font-weight:600">${r.statusCode != null ? String(r.statusCode) : '—'}</td>
                  <td style="text-align:right">${r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</td>
                </tr>`;
                })
                .join('');

        const paginationHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;font-size:13px;color:var(--text-muted)">
            <span>Showing ${offset + 1}–${Math.min(offset + rows.length, total)} of ${total} entries</span>
            <div style="display:flex;gap:8px">
              ${page > 1 ? `<a href="${escHtml(paginationBase + String(page - 1))}" class="btn btn-ghost" style="padding:4px 12px">← Prev</a>` : ''}
              <span style="padding:4px 8px">Page ${page} / ${totalPages}</span>
              ${page < totalPages ? `<a href="${escHtml(paginationBase + String(page + 1))}" class="btn btn-ghost" style="padding:4px 12px">Next →</a>` : ''}
            </div>
          </div>`;

        const content = `
          <h1 class="page-title">Audit Log</h1>
          ${statsHtml}
          ${filterHtml}
          <div class="card" style="padding:0;overflow:hidden">
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="border-bottom:1px solid var(--border);background:var(--bg-hover)">
                    <th style="padding:10px 12px;text-align:left;font-weight:600;white-space:nowrap">Time</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">User</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">Department</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">Server</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">Tool</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">Method</th>
                    <th style="padding:10px 12px;text-align:left;font-weight:600">Status</th>
                    <th style="padding:10px 12px;text-align:right;font-weight:600">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>
          </div>
          ${paginationHtml}`;

        return reply.type('text/html').send(
          layout({
            title: 'Audit Log',
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/audit',
            content,
          }),
        );
      },
    );

    // -------------------------------------------------------------------------
    // GET /settings/admin/audit/export — CSV download
    // -------------------------------------------------------------------------
    app.get(
      '/settings/admin/audit/export',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;

        const query = request.query as Record<string, string | undefined>;
        const userId = query.userId?.trim() || undefined;
        const serverSlug = query.serverSlug?.trim() || undefined;
        const rawStart = query.startDate?.trim();
        const rawEnd = query.endDate?.trim();

        const startDate = rawStart ? parseDate(rawStart) : undefined;
        const endDate = rawEnd ? parseDate(rawEnd) : undefined;

        const csv = await auditService.exportCsv({
          institutionId,
          userId,
          serverSlug,
          startDate,
          endDate,
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        return reply
          .type('text/csv')
          .header('Content-Disposition', `attachment; filename="audit-${dateStr}.csv"`)
          .send(csv);
      },
    );
  };
}

/** Parse a date string; return undefined if the result is not a valid Date. */
function parseDate(s: string): Date | undefined {
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Format a Date for display in the UI table. */
function formatDate(d: Date): string {
  try {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return String(d);
  }
}
