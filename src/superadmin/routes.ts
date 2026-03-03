/**
 * Superadmin routes for multi-tenant Lantern deployments.
 * All routes require authentication and superadmin status (email in SUPERADMIN_EMAILS).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireAuth, requireSuperadmin } from '../auth/middleware.js';
import { getSession } from '../auth/session.js';
import { escHtml } from '../web/layout.js';
import { globalStyles } from '../web/styles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flashBanner(query: Record<string, string | undefined>): string {
  if (query.success) {
    return `<div style="background:rgba(34,197,94,0.1);border:1px solid var(--success);color:var(--success);border-radius:var(--radius);padding:10px 16px;margin-bottom:20px">
      ${escHtml(query.success === '1' ? 'Changes saved successfully.' : query.success)}
    </div>`;
  }
  if (query.error) {
    return `<div style="background:rgba(239,68,68,0.1);border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius);padding:10px 16px;margin-bottom:20px">
      ${escHtml(query.error)}
    </div>`;
  }
  return '';
}

const thStyle = 'padding:10px 12px;text-align:left;font-weight:600;font-size:13px';
const tdStyle = 'padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px';

function tableHead(...cols: string[]): string {
  return `<thead><tr style="border-bottom:1px solid var(--border);background:var(--bg-hover)">${cols.map((c) => `<th style="${thStyle}">${c}</th>`).join('')}</tr></thead>`;
}

function superadminLayout(opts: {
  title: string;
  user: { displayName: string; email: string };
  currentPath: string;
  content: string;
}): string {
  const { title, user, currentPath, content } = opts;

  const navItems = [
    { href: '/superadmin', label: 'Institutions' },
  ];

  const navHtml = navItems
    .map((item) => {
      const active = currentPath === item.href || currentPath.startsWith(item.href + '/');
      return `<a href="${item.href}" class="nav-item ${active ? 'active' : ''}">${item.label}</a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} — Lantern Superadmin</title>
  <style>
    ${globalStyles}
    .app { display: flex; min-height: 100vh; }
    .sidebar { width: 220px; background: var(--bg-card); border-right: 1px solid var(--border); padding: 20px 0; display: flex; flex-direction: column; flex-shrink: 0; }
    .sidebar-logo { padding: 0 20px 20px; font-size: 18px; font-weight: 700; color: var(--text); border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .sidebar-logo span { color: var(--accent); }
    .sidebar-badge { display: inline-block; background: rgba(239,68,68,0.15); color: #ef4444; border-radius: 4px; font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 20px; color: var(--text-muted); transition: all 0.15s; font-size: 13px; }
    .nav-item:hover { background: var(--bg-hover); color: var(--text); }
    .nav-item.active { background: rgba(99,102,241,0.1); color: var(--accent); font-weight: 500; }
    .sidebar-footer { margin-top: auto; padding: 16px 20px; border-top: 1px solid var(--border); }
    .user-info { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .main { flex: 1; padding: 32px; overflow-y: auto; max-width: 960px; }
    .page-title { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="app">
    <nav class="sidebar">
      <div class="sidebar-logo">🔦 <span>Lantern</span><span class="sidebar-badge">Superadmin</span></div>
      ${navHtml}
      <div class="sidebar-footer">
        <div class="user-info">${escHtml(user.displayName)}<br><small>${escHtml(user.email)}</small></div>
        <a href="/settings" class="btn btn-ghost" style="width:100%;justify-content:center;font-size:12px;margin-bottom:6px">My Settings</a>
        <a href="/auth/logout" class="btn btn-ghost" style="width:100%;justify-content:center;font-size:12px">Sign out</a>
      </div>
    </nav>
    <main class="main">${content}</main>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function superadminRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {

    // -----------------------------------------------------------------------
    // GET /superadmin — Institution list dashboard
    // -----------------------------------------------------------------------
    app.get(
      '/superadmin',
      { preHandler: [requireAuth, requireSuperadmin] },
      async (request, reply) => {
        const session = getSession(request);
        const q = request.query as Record<string, string | undefined>;

        const institutions = await sql<{
          id: string;
          name: string;
          azure_tenant_id: string;
          verified: boolean;
          member_count: string;
          created_at: Date;
        }[]>`
          SELECT
            i.id,
            i.name,
            i.azure_tenant_id,
            i.verified,
            COUNT(u.id) AS member_count,
            i.created_at
          FROM institutions i
          LEFT JOIN users u ON u.institution_id = i.id
          GROUP BY i.id, i.name, i.azure_tenant_id, i.verified, i.created_at
          ORDER BY i.created_at DESC
        `;

        const tableRowsHtml =
          institutions.length === 0
            ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">No institutions registered yet.</td></tr>`
            : institutions
                .map(
                  (inst) => `<tr>
                <td style="${tdStyle}"><a href="/superadmin/institutions/${escHtml(inst.id)}">${escHtml(inst.name)}</a></td>
                <td style="${tdStyle}"><code style="font-size:11px">${escHtml(inst.azure_tenant_id)}</code></td>
                <td style="${tdStyle}">${inst.verified ? '<span style="color:var(--success)">Verified</span>' : '<span style="color:var(--text-muted)">Unverified</span>'}</td>
                <td style="${tdStyle}">${inst.member_count}</td>
                <td style="${tdStyle}" style="font-size:11px;color:var(--text-muted)">${new Date(inst.created_at).toLocaleDateString()}</td>
                <td style="${tdStyle}">
                  <form method="post" action="/superadmin/institutions/${escHtml(inst.id)}/verify" style="display:inline">
                    <button type="submit" class="btn btn-ghost" style="padding:3px 10px;font-size:12px">
                      ${inst.verified ? 'Unverify' : 'Verify'}
                    </button>
                  </form>
                  <form method="post" action="/superadmin/institutions/${escHtml(inst.id)}/delete" style="display:inline;margin-left:4px"
                    onsubmit="return confirm('Delete institution ${escHtml(inst.name)}? This cannot be undone.')">
                    <button type="submit" class="btn btn-ghost" style="padding:3px 10px;font-size:12px;color:var(--danger);border-color:var(--danger)">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>`,
                )
                .join('');

        const content = `
          <h1 class="page-title">Institutions</h1>
          ${flashBanner(q)}
          <div class="card" style="padding:0;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Name', 'Azure Tenant ID', 'Status', 'Members', 'Registered', 'Actions')}
              <tbody>${tableRowsHtml}</tbody>
            </table>
          </div>`;

        return reply.type('text/html').send(
          superadminLayout({
            title: 'Institutions',
            user: {
              displayName: session.displayName ?? session.email ?? 'Superadmin',
              email: session.email ?? '',
            },
            currentPath: '/superadmin',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // POST /superadmin/institutions/:id/verify — Toggle verified status
    // -----------------------------------------------------------------------
    app.post(
      '/superadmin/institutions/:id/verify',
      { preHandler: [requireAuth, requireSuperadmin] },
      async (request, reply) => {
        const { id } = request.params as { id: string };

        await sql`
          UPDATE institutions
          SET verified = NOT verified
          WHERE id = ${id}
        `;

        return reply.redirect('/superadmin?success=1');
      },
    );

    // -----------------------------------------------------------------------
    // POST /superadmin/institutions/:id/delete — Delete institution
    // -----------------------------------------------------------------------
    app.post(
      '/superadmin/institutions/:id/delete',
      { preHandler: [requireAuth, requireSuperadmin] },
      async (request, reply) => {
        const session = getSession(request);
        const { id } = request.params as { id: string };

        // Prevent deleting the institution the superadmin belongs to
        if (session.institutionId === id) {
          return reply.redirect('/superadmin?error=Cannot+delete+your+own+institution');
        }

        await sql`
          DELETE FROM institutions WHERE id = ${id}
        `;

        return reply.redirect('/superadmin?success=Institution+deleted');
      },
    );

    // -----------------------------------------------------------------------
    // GET /superadmin/institutions/:id — Institution detail
    // -----------------------------------------------------------------------
    app.get(
      '/superadmin/institutions/:id',
      { preHandler: [requireAuth, requireSuperadmin] },
      async (request, reply) => {
        const session = getSession(request);
        const { id } = request.params as { id: string };
        const q = request.query as Record<string, string | undefined>;

        const [institution] = await sql<{
          id: string;
          name: string;
          azure_tenant_id: string;
          verified: boolean;
          created_at: Date;
        }[]>`
          SELECT id, name, azure_tenant_id, verified, created_at
          FROM institutions
          WHERE id = ${id}
        `;

        if (!institution) {
          return reply.status(404).type('text/html').send('<p>Institution not found.</p>');
        }

        const [memberCountResult, deptCountResult, recentAudit] = await Promise.all([
          sql<[{ count: string }]>`SELECT COUNT(*) AS count FROM users WHERE institution_id = ${id}`,
          sql<[{ count: string }]>`SELECT COUNT(*) AS count FROM departments WHERE institution_id = ${id}`,
          sql<{ id: string; action: string; created_at: Date }[]>`
            SELECT id, action, created_at
            FROM admin_audit_log
            WHERE institution_id = ${id}
            ORDER BY created_at DESC
            LIMIT 10
          `,
        ]);

        const memberCount = parseInt(memberCountResult[0].count, 10);
        const deptCount = parseInt(deptCountResult[0].count, 10);

        const infoHtml = `
          <div class="card" style="margin-bottom:20px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Name</div>
                <div>${escHtml(institution.name)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Azure Tenant ID</div>
                <code style="font-size:12px">${escHtml(institution.azure_tenant_id)}</code>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Status</div>
                <div>${institution.verified ? '<span style="color:var(--success)">Verified</span>' : '<span style="color:var(--text-muted)">Unverified</span>'}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Registered</div>
                <div>${new Date(institution.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Members</div>
                <div>${memberCount}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Departments</div>
                <div>${deptCount}</div>
              </div>
            </div>
          </div>`;

        const auditRowsHtml =
          recentAudit.length === 0
            ? `<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:20px">No audit log entries.</td></tr>`
            : recentAudit
                .map(
                  (entry) => `<tr>
                <td style="${tdStyle}">${escHtml(entry.action)}</td>
                <td style="${tdStyle};font-size:11px;color:var(--text-muted)">${new Date(entry.created_at).toLocaleString()}</td>
              </tr>`,
                )
                .join('');

        const auditHtml = `
          <div class="card">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Recent Audit Log</h2>
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Action', 'Timestamp')}
              <tbody>${auditRowsHtml}</tbody>
            </table>
          </div>`;

        const actionsHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Actions</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <form method="post" action="/superadmin/institutions/${escHtml(id)}/verify" style="display:inline">
                <button type="submit" class="btn btn-primary">
                  ${institution.verified ? 'Unverify Institution' : 'Verify Institution'}
                </button>
              </form>
              <form method="post" action="/superadmin/institutions/${escHtml(id)}/delete" style="display:inline"
                onsubmit="return confirm('Delete institution ${escHtml(institution.name)}? This cannot be undone.')">
                <button type="submit" class="btn btn-ghost" style="color:var(--danger);border-color:var(--danger)">
                  Delete Institution
                </button>
              </form>
            </div>
          </div>`;

        const content = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <a href="/superadmin" style="color:var(--text-muted);font-size:13px">← Institutions</a>
            <h1 class="page-title" style="margin-bottom:0">${escHtml(institution.name)}</h1>
          </div>
          ${flashBanner(q)}
          ${infoHtml}
          ${actionsHtml}
          ${auditHtml}`;

        return reply.type('text/html').send(
          superadminLayout({
            title: institution.name,
            user: {
              displayName: session.displayName ?? session.email ?? 'Superadmin',
              email: session.email ?? '',
            },
            currentPath: '/superadmin/institutions',
            content,
          }),
        );
      },
    );
  };
}
