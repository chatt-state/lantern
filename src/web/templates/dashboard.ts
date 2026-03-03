import { layout, escHtml } from '../layout.js';
import type { LanternSession } from '../../auth/session.js';

export interface DashboardData {
  session: LanternSession;
  departments: Array<{ departmentId: string; departmentName: string; role: string }>;
  currentPath: string;
}

export function dashboardPage(data: DashboardData): string {
  const { session, departments, currentPath } = data;

  const deptsHtml =
    departments.length === 0
      ? `<p style="color:var(--text-muted)">You haven't been assigned to any departments yet. Contact your institution administrator.</p>`
      : departments
          .map(
            (d) => `
        <div class="card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-weight:500">${escHtml(d.departmentName)}</div>
            <div style="color:var(--text-muted);font-size:12px;margin-top:2px">Your role</div>
          </div>
          <span class="badge ${d.role === 'department_admin' ? 'badge-admin' : 'badge-member'}">${d.role === 'department_admin' ? 'Admin' : 'Member'}</span>
        </div>
      `,
          )
          .join('');

  const content = `
    <h1 class="page-title">My Connections</h1>
    <div class="card" style="margin-bottom:24px">
      <div style="font-size:16px;font-weight:500;margin-bottom:4px">Welcome, ${escHtml(session.displayName ?? 'User')}</div>
      <div style="color:var(--text-muted)">${escHtml(session.email ?? '')}</div>
    </div>
    <h2 style="font-size:15px;font-weight:600;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Your Departments</h2>
    ${deptsHtml}
    <div style="margin-top:24px">
      <h2 style="font-size:15px;font-weight:600;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Connect Claude</h2>
      <div class="card">
        <p style="margin-bottom:12px">Add Lantern to Claude Desktop by adding this to your <code>claude_desktop_config.json</code>:</p>
        <pre style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:12px;overflow-x:auto">{
  "mcpServers": {
    "m365": {
      "url": "${escHtml(process.env.BASE_URL ?? 'http://localhost:8080')}/v1/m365/mcp"
    }
  }
}</pre>
      </div>
    </div>
  `;

  return layout({
    title: 'My Connections',
    user: {
      displayName: session.displayName ?? 'User',
      email: session.email ?? '',
      institutionAdmin: session.institutionAdmin ?? false,
    },
    currentPath,
    content,
  });
}
