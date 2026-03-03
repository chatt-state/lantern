/**
 * Department admin panel routes.
 * Handles member management, tool allowlists, and dept-scoped audit logs.
 * All routes require authentication; department-specific routes additionally
 * require the user to be a department admin (or institution admin) for that dept.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireAuth } from '../auth/middleware.js';
import { getSession } from '../auth/session.js';
import { layout, escHtml } from '../web/layout.js';
import { DepartmentGuard } from '../rbac/department-guard.js';
import { AuditService } from '../audit/service.js';

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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function departmentRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const guard = new DepartmentGuard(sql);
    const auditService = new AuditService(sql);

    // -----------------------------------------------------------------------
    // GET /settings/department — overview redirect
    // -----------------------------------------------------------------------
    app.get('/settings/department', { preHandler: [requireAuth] }, async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) return reply.redirect('/auth/login');

      // Institution admins go to the institution admin dept list
      if (session.institutionAdmin) {
        return reply.redirect('/settings/admin/departments');
      }

      // Check if user is a dept admin anywhere
      const adminDepts = await guard.getAdminDepartments(session.userId);
      if (adminDepts.length > 0) {
        return reply.redirect(`/settings/department/${adminDepts[0]}`);
      }

      // Not a dept admin — show informational page
      const content = `
        <h1 class="page-title">Department</h1>
        <div class="card">
          <p style="color:var(--text-muted)">You are not a department admin for any department.</p>
          <p style="margin-top:12px;font-size:13px;color:var(--text-muted)">
            Contact your institution admin to be assigned as a department admin.
          </p>
          <a href="/settings" class="btn btn-ghost" style="margin-top:16px">Back to Dashboard</a>
        </div>`;

      return reply.type('text/html').send(
        layout({
          title: 'Department',
          user: {
            displayName: session.displayName ?? session.email ?? 'User',
            email: session.email ?? '',
            institutionAdmin: session.institutionAdmin ?? false,
          },
          currentPath: '/settings/department',
          content,
        }),
      );
    });

    // -----------------------------------------------------------------------
    // GET /settings/department/:id — Department admin dashboard
    // -----------------------------------------------------------------------
    app.get('/settings/department/:id', { preHandler: [requireAuth] }, async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) return reply.redirect('/auth/login');

      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string | undefined>;

      // Authorization check
      const canAdmin = await guard.canAdminDepartment({
        userId: session.userId,
        departmentId: id,
        institutionAdmin: session.institutionAdmin ?? false,
      });
      if (!canAdmin) {
        return reply.status(403).type('text/html').send('<p>You do not have permission to administer this department.</p>');
      }

      const institutionId = session.institutionId!;

      const [deptRows, members, serverAccess] = await Promise.all([
        sql<{ id: string; name: string; description: string | null }[]>`
          SELECT id, name, description FROM departments
          WHERE id = ${id} AND institution_id = ${institutionId}
        `,
        sql<{ user_id: string; display_name: string | null; email: string; role: string; manual_override: boolean }[]>`
          SELECT u.id AS user_id, u.display_name, u.email, ud.role, ud.manual_override
          FROM user_departments ud
          JOIN users u ON u.id = ud.user_id
          WHERE ud.department_id = ${id}
          ORDER BY u.display_name, u.email
        `,
        sql<{ server_slug: string }[]>`
          SELECT server_slug FROM server_access
          WHERE institution_id = ${institutionId} AND department_id = ${id} AND enabled = true
        `,
      ]);

      const dept = deptRows[0];
      if (!dept) {
        return reply.status(404).type('text/html').send('<p>Department not found.</p>');
      }

      // Fetch tool allowlists for each server this dept has access to
      const allowlistRows =
        serverAccess.length > 0
          ? await sql<{ server_slug: string; allowed_tools: string[] }[]>`
              SELECT server_slug, allowed_tools FROM tool_allowlists
              WHERE department_id = ${id}
                AND server_slug = ANY(${serverAccess.map((r) => r.server_slug)})
            `
          : [];

      const allowlistMap = new Map<string, string[]>(allowlistRows.map((r) => [r.server_slug, r.allowed_tools]));

      // Audit log (last 20)
      const { rows: auditRows } = await auditService.queryLogs({
        institutionId,
        departmentId: id,
        limit: 20,
      });

      // --- Members section ---
      const memberRowsHtml =
        members.length === 0
          ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No members in this department.</td></tr>`
          : members
              .map(
                (m) => `<tr>
              <td style="${tdStyle}">${escHtml(m.display_name ?? '—')}</td>
              <td style="${tdStyle}">${escHtml(m.email)}</td>
              <td style="${tdStyle}">
                <span class="badge badge-member">${escHtml(m.role)}</span>
                ${m.manual_override ? ' <span title="Manual override" style="color:var(--warning)">★</span>' : ''}
              </td>
              <td style="${tdStyle}">
                <form method="post" action="/settings/department/${escHtml(id)}/members/role" style="display:inline">
                  <input type="hidden" name="userId" value="${escHtml(m.user_id)}">
                  <select name="role" onchange="this.form.submit()"
                    style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:4px 8px;color:var(--text);font-size:12px">
                    <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
                    <option value="department_admin" ${m.role === 'department_admin' ? 'selected' : ''}>Dept Admin</option>
                  </select>
                </form>
              </td>
              <td style="${tdStyle}">
                <form method="post" action="/settings/department/${escHtml(id)}/members/remove" style="display:inline">
                  <input type="hidden" name="userId" value="${escHtml(m.user_id)}">
                  <button type="submit" class="btn btn-ghost"
                    style="padding:3px 10px;font-size:12px;color:var(--danger);border-color:var(--danger)">Remove</button>
                </form>
              </td>
            </tr>`,
              )
              .join('');

      const membersHtml = `
        <div class="card" style="margin-bottom:20px">
          <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Members</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            ${tableHead('Display Name', 'Email', 'Role', 'Change Role', 'Actions')}
            <tbody>${memberRowsHtml}</tbody>
          </table>
          <form method="post" action="/settings/department/${escHtml(id)}/members/add"
            style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
            <div>
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Add member by email</label>
              <input name="email" type="email" required placeholder="user@institution.edu"
                style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:260px">
            </div>
            <button type="submit" class="btn btn-primary">Add Member</button>
          </form>
        </div>`;

      // --- Tool allowlists section ---
      const toolAccessHtml =
        serverAccess.length === 0
          ? `<div class="card" style="margin-bottom:20px">
              <h2 style="font-size:15px;font-weight:600;margin-bottom:8px">Tool Allowlists</h2>
              <p style="color:var(--text-muted);font-size:13px">No servers are enabled for this department.</p>
            </div>`
          : `<div class="card" style="margin-bottom:20px">
              <h2 style="font-size:15px;font-weight:600;margin-bottom:16px">Tool Allowlists</h2>
              ${serverAccess
                .map((s) => {
                  const current = allowlistMap.get(s.server_slug) ?? [];
                  const currentVal = current.length > 0 ? current.join(', ') : '';
                  const displayLabel = current.length === 0 ? 'All tools (no restriction)' : current.join(', ');
                  return `
                  <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--border)">
                    <div style="font-weight:600;margin-bottom:4px">
                      <code style="font-size:13px">${escHtml(s.server_slug)}</code>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
                      Currently: ${escHtml(displayLabel)}
                    </div>
                    <form method="post" action="/settings/department/${escHtml(id)}/tool-access"
                      style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
                      <input type="hidden" name="serverSlug" value="${escHtml(s.server_slug)}">
                      <div>
                        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">
                          Allowed tools (comma-separated, leave blank for all)
                        </label>
                        <textarea name="allowedTools" rows="2"
                          style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:360px;resize:vertical"
                          placeholder="e.g. read_email, send_email">${escHtml(currentVal)}</textarea>
                      </div>
                      <button type="submit" class="btn btn-primary" style="align-self:flex-end">Save</button>
                    </form>
                  </div>`;
                })
                .join('')}
            </div>`;

      // --- Audit log section ---
      const auditRowsHtml =
        auditRows.length === 0
          ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No recent activity.</td></tr>`
          : auditRows
              .map(
                (r) => `<tr>
              <td style="${tdStyle}" title="${escHtml(r.createdAt.toISOString())}">${escHtml(r.createdAt.toLocaleString())}</td>
              <td style="${tdStyle}"><code style="font-size:12px">${escHtml(r.serverSlug)}</code></td>
              <td style="${tdStyle}">${r.toolName ? escHtml(r.toolName) : '<span style="color:var(--text-muted)">—</span>'}</td>
              <td style="${tdStyle}">${r.statusCode != null ? String(r.statusCode) : '—'}</td>
              <td style="${tdStyle}">${r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</td>
            </tr>`,
              )
              .join('');

      const auditHtml = `
        <div class="card" style="margin-bottom:20px">
          <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Recent Activity (last 20)</h2>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Time', 'Server', 'Tool', 'Status', 'Latency')}
              <tbody>${auditRowsHtml}</tbody>
            </table>
          </div>
        </div>`;

      const content = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/settings/department" style="color:var(--text-muted);font-size:13px">← Departments</a>
          <h1 class="page-title" style="margin-bottom:0">${escHtml(dept.name)}</h1>
        </div>
        ${dept.description ? `<p style="color:var(--text-muted);margin-bottom:20px">${escHtml(dept.description)}</p>` : ''}
        ${flashBanner(q)}
        ${membersHtml}
        ${toolAccessHtml}
        ${auditHtml}`;

      return reply.type('text/html').send(
        layout({
          title: dept.name,
          user: {
            displayName: session.displayName ?? session.email ?? 'User',
            email: session.email ?? '',
            institutionAdmin: session.institutionAdmin ?? false,
          },
          currentPath: '/settings/department',
          content,
        }),
      );
    });

    // -----------------------------------------------------------------------
    // POST /settings/department/:id/members/add — Add member
    // -----------------------------------------------------------------------
    app.post(
      '/settings/department/:id/members/add',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');

        const { id } = request.params as { id: string };

        const canAdmin = await guard.canAdminDepartment({
          userId: session.userId,
          departmentId: id,
          institutionAdmin: session.institutionAdmin ?? false,
        });
        if (!canAdmin) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        const body = request.body as Record<string, string>;
        const email = (body.email ?? '').trim().toLowerCase();

        if (!email) {
          return reply.redirect(`/settings/department/${id}?error=Email+is+required`);
        }

        const institutionId = session.institutionId!;

        const [user] = await sql<{ id: string }[]>`
          SELECT id FROM users
          WHERE email = ${email} AND institution_id = ${institutionId}
        `;

        if (!user) {
          return reply.redirect(`/settings/department/${id}?error=User+not+found`);
        }

        await sql`
          INSERT INTO user_departments (user_id, department_id, role, manual_override)
          VALUES (${user.id}, ${id}, 'member', true)
          ON CONFLICT (user_id, department_id) DO NOTHING
        `;

        return reply.redirect(`/settings/department/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/department/:id/members/remove — Remove member
    // -----------------------------------------------------------------------
    app.post(
      '/settings/department/:id/members/remove',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');

        const { id } = request.params as { id: string };

        const canAdmin = await guard.canAdminDepartment({
          userId: session.userId,
          departmentId: id,
          institutionAdmin: session.institutionAdmin ?? false,
        });
        if (!canAdmin) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        const body = request.body as Record<string, string>;
        const userId = (body.userId ?? '').trim();

        if (userId) {
          const institutionId = session.institutionId!;
          await sql`
            DELETE FROM user_departments
            WHERE user_id = ${userId}
              AND department_id = ${id}
              AND department_id IN (
                SELECT id FROM departments WHERE institution_id = ${institutionId}
              )
          `;
        }

        return reply.redirect(`/settings/department/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/department/:id/members/role — Change member role
    // -----------------------------------------------------------------------
    app.post(
      '/settings/department/:id/members/role',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');

        const { id } = request.params as { id: string };

        const canAdmin = await guard.canAdminDepartment({
          userId: session.userId,
          departmentId: id,
          institutionAdmin: session.institutionAdmin ?? false,
        });
        if (!canAdmin) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        const body = request.body as Record<string, string>;
        const userId = (body.userId ?? '').trim();
        const role = (body.role ?? '').trim();

        if (!userId) {
          return reply.redirect(`/settings/department/${id}?error=Missing+userId`);
        }
        if (role !== 'member' && role !== 'department_admin') {
          return reply.redirect(`/settings/department/${id}?error=Invalid+role`);
        }

        await sql`
          UPDATE user_departments
          SET role = ${role}
          WHERE user_id = ${userId} AND department_id = ${id}
        `;

        return reply.redirect(`/settings/department/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/department/:id/tool-access — Tool allowlist config page
    // -----------------------------------------------------------------------
    app.get(
      '/settings/department/:id/tool-access',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');

        const { id } = request.params as { id: string };
        const q = request.query as Record<string, string | undefined>;

        const canAdmin = await guard.canAdminDepartment({
          userId: session.userId,
          departmentId: id,
          institutionAdmin: session.institutionAdmin ?? false,
        });
        if (!canAdmin) {
          return reply.status(403).type('text/html').send('<p>Forbidden.</p>');
        }

        const institutionId = session.institutionId!;

        const [deptRows, serverAccess] = await Promise.all([
          sql<{ id: string; name: string }[]>`
            SELECT id, name FROM departments
            WHERE id = ${id} AND institution_id = ${institutionId}
          `,
          sql<{ server_slug: string }[]>`
            SELECT server_slug FROM server_access
            WHERE institution_id = ${institutionId} AND department_id = ${id} AND enabled = true
          `,
        ]);

        const dept = deptRows[0];
        if (!dept) {
          return reply.status(404).type('text/html').send('<p>Department not found.</p>');
        }

        const allowlistRows =
          serverAccess.length > 0
            ? await sql<{ server_slug: string; allowed_tools: string[] }[]>`
                SELECT server_slug, allowed_tools FROM tool_allowlists
                WHERE department_id = ${id}
                  AND server_slug = ANY(${serverAccess.map((r) => r.server_slug)})
              `
            : [];

        const allowlistMap = new Map<string, string[]>(allowlistRows.map((r) => [r.server_slug, r.allowed_tools]));

        const serversHtml =
          serverAccess.length === 0
            ? '<p style="color:var(--text-muted)">No servers are enabled for this department.</p>'
            : serverAccess
                .map((s) => {
                  const current = allowlistMap.get(s.server_slug) ?? [];
                  const currentVal = current.length > 0 ? current.join(', ') : '';
                  const displayLabel = current.length === 0 ? 'All tools (no restriction)' : current.join(', ');
                  return `
                  <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid var(--border)">
                    <div style="font-weight:600;font-size:14px;margin-bottom:4px">
                      <code>${escHtml(s.server_slug)}</code>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
                      Currently allowed: ${escHtml(displayLabel)}
                    </div>
                    <form method="post" action="/settings/department/${escHtml(id)}/tool-access"
                      style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
                      <input type="hidden" name="serverSlug" value="${escHtml(s.server_slug)}">
                      <div>
                        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">
                          Allowed tools (comma-separated, leave blank for all)
                        </label>
                        <textarea name="allowedTools" rows="3"
                          style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:400px;resize:vertical"
                          placeholder="e.g. read_email, send_email, list_calendar">${escHtml(currentVal)}</textarea>
                      </div>
                      <button type="submit" class="btn btn-primary" style="align-self:flex-end">Save Allowlist</button>
                    </form>
                  </div>`;
                })
                .join('');

        const content = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <a href="/settings/department/${escHtml(id)}" style="color:var(--text-muted);font-size:13px">← ${escHtml(dept.name)}</a>
            <h1 class="page-title" style="margin-bottom:0">Tool Access</h1>
          </div>
          ${flashBanner(q)}
          <div class="card">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:16px">Server Tool Allowlists</h2>
            <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
              Leave blank to allow all tools. Enter a comma-separated list to restrict access.
            </p>
            ${serversHtml}
          </div>`;

        return reply.type('text/html').send(
          layout({
            title: `Tool Access — ${dept.name}`,
            user: {
              displayName: session.displayName ?? session.email ?? 'User',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/department',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/department/:id/tool-access — Update tool allowlist
    // -----------------------------------------------------------------------
    app.post(
      '/settings/department/:id/tool-access',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');

        const { id } = request.params as { id: string };

        const canAdmin = await guard.canAdminDepartment({
          userId: session.userId,
          departmentId: id,
          institutionAdmin: session.institutionAdmin ?? false,
        });
        if (!canAdmin) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        const body = request.body as Record<string, string>;
        const serverSlug = (body.serverSlug ?? '').trim();

        if (!serverSlug) {
          return reply.redirect(`/settings/department/${id}/tool-access?error=Missing+server+slug`);
        }

        // Parse allowed tools: trim, split, filter empty strings
        const rawTools = body.allowedTools ?? '';
        const allowedTools = rawTools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        // Empty array = all tools allowed (store as PostgreSQL empty array '{}')
        await sql`
          INSERT INTO tool_allowlists (department_id, server_slug, allowed_tools)
          VALUES (${id}, ${serverSlug}, ${allowedTools})
          ON CONFLICT (department_id, server_slug)
          DO UPDATE SET allowed_tools = ${allowedTools}
        `;

        return reply.redirect(`/settings/department/${id}/tool-access?success=1`);
      },
    );
  };
}
