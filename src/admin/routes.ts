/**
 * Institution admin panel routes.
 * Handles departments, members, servers, and group mappings.
 * All routes require authentication and institution-admin role.
 * Note: /settings/admin/audit is handled separately by src/audit/routes.ts
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireAuth, requireInstitutionAdmin } from '../auth/middleware.js';
import { getSession } from '../auth/session.js';
import { layout, escHtml } from '../web/layout.js';
import { AuditService } from '../audit/service.js';
import { listServers } from '../proxy/server-registry.js';

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

export function adminRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const auditService = new AuditService(sql);

    // -----------------------------------------------------------------------
    // GET /settings/admin — Overview dashboard
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;

        const [memberResult, deptResult, serverAccessResult, summary] = await Promise.all([
          sql<[{ count: string }]>`SELECT COUNT(*) AS count FROM users WHERE institution_id = ${institutionId}`,
          sql<[{ count: string }]>`SELECT COUNT(*) AS count FROM departments WHERE institution_id = ${institutionId}`,
          sql<[{ count: string }]>`SELECT COUNT(DISTINCT server_slug) AS count FROM server_access WHERE institution_id = ${institutionId}`,
          auditService.getSummary(institutionId, 1),
        ]);

        const members = parseInt(memberResult[0].count, 10);
        const departments = parseInt(deptResult[0].count, 10);
        const activeServers = parseInt(serverAccessResult[0].count, 10);
        const requests24h = summary.totalRequests;
        const successPct = Math.round(summary.successRate * 100);

        const stats = [
          { label: 'Members', value: String(members), color: '' },
          { label: 'Departments', value: String(departments), color: '' },
          { label: 'Active Servers', value: String(activeServers), color: '' },
          { label: 'Requests (24 h)', value: String(requests24h), color: '' },
          {
            label: 'Success Rate',
            value: `${successPct}%`,
            color: successPct >= 90 ? 'var(--success)' : successPct >= 70 ? 'var(--warning)' : 'var(--danger)',
          },
        ];

        const statsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px">
          ${stats
            .map(
              (s) => `<div class="card" style="padding:16px">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${s.label}</div>
            <div style="font-size:28px;font-weight:700${s.color ? ';color:' + s.color : ''}">${escHtml(s.value)}</div>
          </div>`,
            )
            .join('')}
        </div>`;

        const quickLinks = [
          { href: '/settings/admin/departments', label: 'Manage Departments' },
          { href: '/settings/admin/members', label: 'Manage Members' },
          { href: '/settings/admin/servers', label: 'Manage Servers' },
          { href: '/settings/admin/audit', label: 'View Audit Log' },
        ];

        const linksHtml = `<div class="card">
          <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Quick Links</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${quickLinks.map((l) => `<a href="${l.href}" class="btn btn-ghost">${escHtml(l.label)}</a>`).join('')}
          </div>
        </div>`;

        const content = `
          <h1 class="page-title">Admin Overview</h1>
          ${statsHtml}
          ${linksHtml}`;

        return reply.type('text/html').send(
          layout({
            title: 'Admin Overview',
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/admin/departments — Department list
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin/departments',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const q = request.query as Record<string, string | undefined>;

        const departments = await sql<
          { id: string; name: string; description: string | null; member_count: string }[]
        >`
          SELECT d.id, d.name, d.description, COUNT(ud.user_id) AS member_count
          FROM departments d
          LEFT JOIN user_departments ud ON ud.department_id = d.id
          WHERE d.institution_id = ${institutionId}
          GROUP BY d.id, d.name, d.description
          ORDER BY d.name
        `;

        const tableRowsHtml =
          departments.length === 0
            ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px">No departments yet.</td></tr>`
            : departments
                .map(
                  (d) => `<tr>
                <td style="${tdStyle}">${escHtml(d.name)}</td>
                <td style="${tdStyle}">${d.description ? escHtml(d.description) : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td style="${tdStyle}">${d.member_count}</td>
                <td style="${tdStyle}">
                  <a href="/settings/admin/departments/${escHtml(d.id)}" class="btn btn-ghost" style="padding:4px 12px;font-size:12px">Manage</a>
                </td>
              </tr>`,
                )
                .join('');

        const createFormHtml = `
          <div class="card" style="margin-top:24px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Create Department</h2>
            <form method="post" action="/settings/admin/departments" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Name <span style="color:var(--danger)">*</span></label>
                <input name="name" required maxlength="100" placeholder="Department name"
                  style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:220px">
              </div>
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Description</label>
                <input name="description" maxlength="255" placeholder="Optional description"
                  style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:280px">
              </div>
              <button type="submit" class="btn btn-primary">Create</button>
            </form>
          </div>`;

        const content = `
          <h1 class="page-title">Departments</h1>
          ${flashBanner(q)}
          <div class="card" style="padding:0;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Name', 'Description', 'Members', 'Actions')}
              <tbody>${tableRowsHtml}</tbody>
            </table>
          </div>
          ${createFormHtml}`;

        return reply.type('text/html').send(
          layout({
            title: 'Departments',
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/departments',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/departments — Create department
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/departments',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const body = request.body as Record<string, string>;

        const name = (body.name ?? '').trim();
        const description = (body.description ?? '').trim() || null;

        if (!name) {
          return reply.redirect('/settings/admin/departments?error=Department+name+is+required');
        }
        if (name.length > 100) {
          return reply.redirect('/settings/admin/departments?error=Name+must+be+100+characters+or+fewer');
        }

        const [newDept] = await sql<[{ id: string }]>`
          INSERT INTO departments (institution_id, name, description)
          VALUES (${institutionId}, ${name}, ${description})
          RETURNING id
        `;

        await sql`
          INSERT INTO admin_audit_log (institution_id, actor_user_id, action, target_type, target_id, details)
          VALUES (${institutionId}, ${session.userId!}, 'create_department', 'department', ${newDept.id}, '{}'::jsonb)
        `;

        return reply.redirect('/settings/admin/departments?success=1');
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/admin/departments/:id — Department detail
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin/departments/:id',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const q = request.query as Record<string, string | undefined>;

        const [dept] = await sql<{ id: string; name: string; description: string | null }[]>`
          SELECT id, name, description FROM departments
          WHERE id = ${id} AND institution_id = ${institutionId}
        `;
        if (!dept) {
          return reply.status(404).type('text/html').send('<p>Department not found.</p>');
        }

        const [groupMappings, members, serverAccess, allServers] = await Promise.all([
          sql<{ id: string; group_display_name: string }[]>`
            SELECT id, group_display_name FROM group_mappings
            WHERE institution_id = ${institutionId} AND department_id = ${id}
            ORDER BY group_display_name
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
            WHERE institution_id = ${institutionId} AND department_id = ${id}
          `,
          Promise.resolve(listServers()),
        ]);

        const enabledSlugs = new Set(serverAccess.map((r) => r.server_slug));

        // Edit department form
        const editFormHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Edit Department</h2>
            <form method="post" action="/settings/admin/departments/${escHtml(id)}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Name <span style="color:var(--danger)">*</span></label>
                <input name="name" value="${escHtml(dept.name)}" required maxlength="100"
                  style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:220px">
              </div>
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Description</label>
                <input name="description" value="${escHtml(dept.description ?? '')}" maxlength="255"
                  style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:280px">
              </div>
              <button type="submit" class="btn btn-primary">Save</button>
            </form>
          </div>`;

        // Group mappings section
        const mappingRowsHtml =
          groupMappings.length === 0
            ? `<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:20px">No Azure AD group mappings.</td></tr>`
            : groupMappings
                .map(
                  (m) => `<tr>
                <td style="${tdStyle}">${escHtml(m.group_display_name)}</td>
                <td style="${tdStyle}">
                  <form method="post" action="/settings/admin/departments/${escHtml(id)}/group-mappings/delete" style="display:inline">
                    <input type="hidden" name="mappingId" value="${escHtml(m.id)}">
                    <button type="submit" class="btn btn-ghost" style="padding:3px 10px;font-size:12px;color:var(--danger);border-color:var(--danger)">Remove</button>
                  </form>
                </td>
              </tr>`,
                )
                .join('');

        const groupMappingsHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Azure AD Group Mappings</h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
              ${tableHead('Group Display Name', 'Actions')}
              <tbody>${mappingRowsHtml}</tbody>
            </table>
            <form method="post" action="/settings/admin/departments/${escHtml(id)}/group-mappings" style="display:flex;gap:8px;align-items:flex-end">
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px">Group Display Name</label>
                <input name="groupDisplayName" required placeholder="e.g. CS Faculty"
                  style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;color:var(--text);font-size:13px;width:260px">
              </div>
              <button type="submit" class="btn btn-primary">Add Mapping</button>
            </form>
          </div>`;

        // Members section
        const memberRowsHtml =
          members.length === 0
            ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No members in this department.</td></tr>`
            : members
                .map(
                  (m) => `<tr>
                <td style="${tdStyle}">${escHtml(m.display_name ?? '—')}</td>
                <td style="${tdStyle}">${escHtml(m.email)}</td>
                <td style="${tdStyle}"><span class="badge badge-member">${escHtml(m.role)}</span></td>
                <td style="${tdStyle}">${m.manual_override ? '<span style="color:var(--warning)">Manual</span>' : '<span style="color:var(--text-muted)">Auto</span>'}</td>
              </tr>`,
                )
                .join('');

        const membersHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Members</h2>
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Display Name', 'Email', 'Role', 'Override')}
              <tbody>${memberRowsHtml}</tbody>
            </table>
          </div>`;

        // Server access section
        const serverRowsHtml = allServers
          .map(
            (s) => `<tr>
            <td style="${tdStyle}">${escHtml(s.displayName)}</td>
            <td style="${tdStyle}"><code style="font-size:12px">${escHtml(s.slug)}</code></td>
            <td style="${tdStyle}">
              <form method="post" action="/settings/admin/departments/${escHtml(id)}/server-access">
                <input type="hidden" name="serverSlug" value="${escHtml(s.slug)}">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" name="enabled" value="on" ${enabledSlugs.has(s.slug) ? 'checked' : ''}
                    onchange="this.form.submit()">
                  <span style="font-size:12px">${enabledSlugs.has(s.slug) ? 'Enabled' : 'Disabled'}</span>
                </label>
              </form>
            </td>
          </tr>`,
          )
          .join('');

        const serverHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Server Access</h2>
            ${allServers.length === 0 ? '<p style="color:var(--text-muted)">No servers configured.</p>' : `
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Server', 'Slug', 'Access')}
              <tbody>${serverRowsHtml}</tbody>
            </table>`}
          </div>`;

        const content = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <a href="/settings/admin/departments" style="color:var(--text-muted);font-size:13px">← Departments</a>
            <h1 class="page-title" style="margin-bottom:0">${escHtml(dept.name)}</h1>
          </div>
          ${flashBanner(q)}
          ${editFormHtml}
          ${groupMappingsHtml}
          ${membersHtml}
          ${serverHtml}`;

        return reply.type('text/html').send(
          layout({
            title: dept.name,
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/departments',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/departments/:id — Update department
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/departments/:id',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, string>;

        const name = (body.name ?? '').trim();
        const description = (body.description ?? '').trim() || null;

        if (!name) {
          return reply.redirect(`/settings/admin/departments/${id}?error=Name+is+required`);
        }

        await sql`
          UPDATE departments
          SET name = ${name}, description = ${description}
          WHERE id = ${id} AND institution_id = ${institutionId}
        `;

        return reply.redirect(`/settings/admin/departments/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/departments/:id/group-mappings — Add group mapping
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/departments/:id/group-mappings',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, string>;

        const groupDisplayName = (body.groupDisplayName ?? '').trim();
        if (!groupDisplayName) {
          return reply.redirect(`/settings/admin/departments/${id}?error=Group+display+name+is+required`);
        }

        await sql`
          INSERT INTO group_mappings (institution_id, department_id, group_display_name)
          VALUES (${institutionId}, ${id}, ${groupDisplayName})
        `;

        return reply.redirect(`/settings/admin/departments/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/departments/:id/group-mappings/delete — Remove mapping
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/departments/:id/group-mappings/delete',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, string>;

        const mappingId = (body.mappingId ?? '').trim();
        if (mappingId) {
          await sql`
            DELETE FROM group_mappings
            WHERE id = ${mappingId} AND institution_id = ${institutionId}
          `;
        }

        return reply.redirect(`/settings/admin/departments/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/departments/:id/server-access — Toggle server access
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/departments/:id/server-access',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, string>;

        const serverSlug = (body.serverSlug ?? '').trim();
        const enabled = body.enabled === 'on';

        if (serverSlug) {
          if (enabled) {
            await sql`
              INSERT INTO server_access (institution_id, department_id, server_slug)
              VALUES (${institutionId}, ${id}, ${serverSlug})
              ON CONFLICT DO NOTHING
            `;
          } else {
            await sql`
              DELETE FROM server_access
              WHERE institution_id = ${institutionId} AND department_id = ${id} AND server_slug = ${serverSlug}
            `;
          }
        }

        return reply.redirect(`/settings/admin/departments/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/admin/members — Member list
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin/members',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const q = request.query as Record<string, string | undefined>;

        const members = await sql<
          {
            id: string;
            display_name: string | null;
            email: string;
            institution_admin: boolean;
            departments: string | null;
          }[]
        >`
          SELECT
            u.id,
            u.display_name,
            u.email,
            u.institution_admin,
            STRING_AGG(d.name, ', ' ORDER BY d.name) AS departments
          FROM users u
          LEFT JOIN user_departments ud ON ud.user_id = u.id
          LEFT JOIN departments d ON d.id = ud.department_id
          WHERE u.institution_id = ${institutionId}
          GROUP BY u.id, u.display_name, u.email, u.institution_admin
          ORDER BY u.display_name, u.email
        `;

        const tableRowsHtml =
          members.length === 0
            ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">No members found.</td></tr>`
            : members
                .map(
                  (m) => `<tr>
                <td style="${tdStyle}">${escHtml(m.display_name ?? '—')}</td>
                <td style="${tdStyle}">${escHtml(m.email)}</td>
                <td style="${tdStyle}">${m.institution_admin ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-member">Member</span>'}</td>
                <td style="${tdStyle}">${m.departments ? escHtml(m.departments) : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td style="${tdStyle}"><a href="/settings/admin/members/${escHtml(m.id)}" class="btn btn-ghost" style="padding:4px 12px;font-size:12px">View</a></td>
              </tr>`,
                )
                .join('');

        const content = `
          <h1 class="page-title">Members</h1>
          ${flashBanner(q)}
          <div class="card" style="padding:0;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Display Name', 'Email', 'Role', 'Departments', 'Actions')}
              <tbody>${tableRowsHtml}</tbody>
            </table>
          </div>`;

        return reply.type('text/html').send(
          layout({
            title: 'Members',
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/members',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/admin/members/:id — Member detail
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin/members/:id',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };
        const q = request.query as Record<string, string | undefined>;

        const [member] = await sql<
          { id: string; display_name: string | null; email: string; institution_admin: boolean }[]
        >`
          SELECT id, display_name, email, institution_admin
          FROM users
          WHERE id = ${id} AND institution_id = ${institutionId}
        `;

        if (!member) {
          return reply.status(404).type('text/html').send('<p>Member not found.</p>');
        }

        const deptMemberships = await sql<
          { department_id: string; department_name: string; role: string; manual_override: boolean }[]
        >`
          SELECT ud.department_id, d.name AS department_name, ud.role, ud.manual_override
          FROM user_departments ud
          JOIN departments d ON d.id = ud.department_id
          WHERE ud.user_id = ${id}
          ORDER BY d.name
        `;

        const deptRowsHtml =
          deptMemberships.length === 0
            ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px">No department memberships.</td></tr>`
            : deptMemberships
                .map(
                  (d) => `<tr>
                <td style="${tdStyle}"><a href="/settings/admin/departments/${escHtml(d.department_id)}">${escHtml(d.department_name)}</a></td>
                <td style="${tdStyle}"><span class="badge badge-member">${escHtml(d.role)}</span></td>
                <td style="${tdStyle}">${d.manual_override ? '<span style="color:var(--warning)">Manual</span>' : '<span style="color:var(--text-muted)">Auto</span>'}</td>
              </tr>`,
                )
                .join('');

        const adminToggleHtml = `
          <div class="card" style="margin-bottom:20px">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:8px">Institution Admin</h2>
            <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">
              Currently: ${member.institution_admin ? '<strong style="color:var(--accent)">Admin</strong>' : '<strong>Regular Member</strong>'}
            </p>
            <form method="post" action="/settings/admin/members/${escHtml(id)}/toggle-admin">
              <button type="submit" class="btn ${member.institution_admin ? 'btn-ghost' : 'btn-primary'}">
                ${member.institution_admin ? 'Revoke Admin' : 'Promote to Admin'}
              </button>
            </form>
          </div>`;

        const content = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <a href="/settings/admin/members" style="color:var(--text-muted);font-size:13px">← Members</a>
            <h1 class="page-title" style="margin-bottom:0">${escHtml(member.display_name ?? member.email)}</h1>
            ${member.institution_admin ? '<span class="badge badge-admin">Admin</span>' : ''}
          </div>
          ${flashBanner(q)}
          <div class="card" style="margin-bottom:20px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Display Name</div>
                <div>${escHtml(member.display_name ?? '—')}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Email</div>
                <div>${escHtml(member.email)}</div>
              </div>
            </div>
          </div>
          ${adminToggleHtml}
          <div class="card">
            <h2 style="font-size:15px;font-weight:600;margin-bottom:12px">Department Memberships</h2>
            <table style="width:100%;border-collapse:collapse">
              ${tableHead('Department', 'Role', 'Override')}
              <tbody>${deptRowsHtml}</tbody>
            </table>
          </div>`;

        return reply.type('text/html').send(
          layout({
            title: member.display_name ?? member.email,
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/members',
            content,
          }),
        );
      },
    );

    // -----------------------------------------------------------------------
    // POST /settings/admin/members/:id/toggle-admin — Toggle institution admin
    // -----------------------------------------------------------------------
    app.post(
      '/settings/admin/members/:id/toggle-admin',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const { id } = request.params as { id: string };

        const [updated] = await sql<[{ institution_admin: boolean }]>`
          UPDATE users
          SET institution_admin = NOT institution_admin
          WHERE id = ${id} AND institution_id = ${institutionId}
          RETURNING institution_admin
        `;

        if (updated) {
          const action = updated.institution_admin ? 'promote_admin' : 'demote_admin';
          await sql`
            INSERT INTO admin_audit_log (institution_id, actor_user_id, action, target_type, target_id, details)
            VALUES (${institutionId}, ${session.userId!}, ${action}, 'user', ${id}, '{}'::jsonb)
          `;
        }

        return reply.redirect(`/settings/admin/members/${id}?success=1`);
      },
    );

    // -----------------------------------------------------------------------
    // GET /settings/admin/servers — Server list with department access overview
    // -----------------------------------------------------------------------
    app.get(
      '/settings/admin/servers',
      { preHandler: [requireAuth, requireInstitutionAdmin] },
      async (request, reply) => {
        const session = getSession(request);
        const institutionId = session.institutionId!;
        const q = request.query as Record<string, string | undefined>;

        const servers = listServers();

        const [departments, allServerAccess] = await Promise.all([
          sql<{ id: string; name: string }[]>`
            SELECT id, name FROM departments
            WHERE institution_id = ${institutionId}
            ORDER BY name
          `,
          sql<{ department_id: string; server_slug: string }[]>`
            SELECT department_id, server_slug FROM server_access
            WHERE institution_id = ${institutionId}
          `,
        ]);

        // Build lookup: serverSlug -> Set of department IDs
        const accessMap = new Map<string, Set<string>>();
        for (const row of allServerAccess) {
          if (!accessMap.has(row.server_slug)) accessMap.set(row.server_slug, new Set());
          accessMap.get(row.server_slug)!.add(row.department_id);
        }

        const serverCardsHtml = servers
          .map((s) => {
            const enabledDepts = accessMap.get(s.slug) ?? new Set();
            const deptListHtml =
              departments.length === 0
                ? '<p style="color:var(--text-muted);font-size:13px">No departments.</p>'
                : `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                    ${tableHead('Department', 'Access')}
                    <tbody>
                      ${departments
                        .map(
                          (d) => `<tr>
                          <td style="${tdStyle}">${escHtml(d.name)}</td>
                          <td style="${tdStyle}">
                            ${enabledDepts.has(d.id) ? '<span class="badge badge-member">Enabled</span>' : '<span style="color:var(--text-muted);font-size:12px">Disabled</span>'}
                          </td>
                        </tr>`,
                        )
                        .join('')}
                    </tbody>
                  </table>`;

            return `<div class="card" style="margin-bottom:16px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div>
                  <strong>${escHtml(s.displayName)}</strong>
                  <code style="font-size:12px;color:var(--text-muted);margin-left:8px">${escHtml(s.slug)}</code>
                </div>
                <span class="badge ${enabledDepts.size > 0 ? 'badge-member' : ''}" style="${enabledDepts.size === 0 ? 'color:var(--text-muted);background:var(--bg-hover)' : ''}">
                  ${enabledDepts.size} / ${departments.length} dept${departments.length !== 1 ? 's' : ''}
                </span>
              </div>
              ${deptListHtml}
              <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">
                Manage access per department in <a href="/settings/admin/departments">Departments</a>.
              </p>
            </div>`;
          })
          .join('');

        const emptyHtml = servers.length === 0
          ? '<div class="card"><p style="color:var(--text-muted)">No servers configured.</p></div>'
          : serverCardsHtml;

        const content = `
          <h1 class="page-title">Servers</h1>
          ${flashBanner(q)}
          ${emptyHtml}`;

        return reply.type('text/html').send(
          layout({
            title: 'Servers',
            user: {
              displayName: session.displayName ?? session.email ?? 'Admin',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: '/settings/admin/servers',
            content,
          }),
        );
      },
    );
  };
}
