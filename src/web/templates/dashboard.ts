import { layout, escHtml } from '../layout.js';
import type { LanternSession } from '../../auth/session.js';

export interface DashboardData {
  session: LanternSession;
  departments: Array<{ departmentId: string; departmentName: string; role: string }>;
  currentPath: string;
  baseUrl?: string;
}

const SERVERS = [
  {
    slug: 'm365',
    name: 'Microsoft 365',
    description: 'Users, mailboxes, Teams, OneDrive, licensing, and security posture.',
    icon: `<svg viewBox="0 0 20 20" width="20" height="20" fill="none"><rect x="1" y="1" width="7.5" height="7.5" rx="1" fill="#f25022"/><rect x="11.5" y="1" width="7.5" height="7.5" rx="1" fill="#7fba00"/><rect x="1" y="11.5" width="7.5" height="7.5" rx="1" fill="#00a4ef"/><rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1" fill="#ffb900"/></svg>`,
  },
];

export function dashboardPage(data: DashboardData): string {
  const { session, departments, currentPath, baseUrl = process.env.BASE_URL ?? 'http://localhost:8080' } = data;

  // ── Departments section ──────────────────────────────
  const deptsHtml =
    departments.length === 0
      ? `<p style="color:var(--text-muted);font-size:13px">You haven't been assigned to any departments yet. Contact your institution administrator.</p>`
      : departments
          .map(
            (d) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:500;font-size:14px">${escHtml(d.departmentName)}</div>
          <span class="badge ${d.role === 'department_admin' ? 'badge-admin' : 'badge-member'}">${d.role === 'department_admin' ? 'Admin' : 'Member'}</span>
        </div>
      `,
          )
          .join('');

  // ── Server connection cards ──────────────────────────
  const desktopConfig = JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        SERVERS.map((s) => [
          s.slug,
          { command: 'npx', args: ['-y', 'mcp-remote', `${baseUrl}/v1/${s.slug}/mcp`] },
        ]),
      ),
    },
    null,
    2,
  );

  const serverCards = SERVERS.map(
    (s) => `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${s.icon}
        </div>
        <div>
          <div style="font-weight:600;font-size:14px">${escHtml(s.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:1px">${escHtml(s.description)}</div>
        </div>
        <span style="margin-left:auto;background:rgba(34,197,94,0.1);color:var(--success);border:1px solid rgba(34,197,94,0.2);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">Active</span>
      </div>
      <div style="display:flex;gap:8px">
        <code style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(`${baseUrl}/v1/${s.slug}/mcp`)}</code>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px;flex-shrink:0" onclick="copyText('${escHtml(`${baseUrl}/v1/${s.slug}/mcp`)}', this, 'Copy URL')">Copy URL</button>
      </div>
    </div>
  `,
  ).join('');

  const content = `
    <style>
      .connect-tabs { display:flex; gap:0; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:16px; width:fit-content; }
      .connect-tab { padding:7px 18px; font-size:13px; font-weight:500; background:transparent; border:none; cursor:pointer; color:var(--text-muted); transition:all 0.15s; }
      .connect-tab.active { background:var(--accent); color:white; }
      .connect-tab:not(.active):hover { background:var(--bg-hover); color:var(--text); }
      .tab-panel { display:none; }
      .tab-panel.active { display:block; }
      .code-block { background:var(--bg); border:1px solid var(--border); border-radius:var(--radius); padding:14px; font-size:12px; font-family:'SF Mono','Fira Code',monospace; line-height:1.7; overflow-x:auto; white-space:pre; color:var(--text); }
    </style>

    <h1 class="page-title">My Connections</h1>

    <!-- User identity card -->
    <div class="card" style="margin-bottom:24px;display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;border-radius:50%;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--accent);flex-shrink:0">${escHtml((session.displayName ?? 'U').charAt(0).toUpperCase())}</div>
      <div>
        <div style="font-weight:500;font-size:14px">${escHtml(session.displayName ?? 'User')}</div>
        <div style="color:var(--text-muted);font-size:12px">${escHtml(session.email ?? '')}</div>
      </div>
    </div>

    <!-- Available servers -->
    <h2 style="font-size:11px;font-weight:700;margin-bottom:14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px">Available Servers</h2>
    ${serverCards}

    <!-- Connect section -->
    <h2 style="font-size:11px;font-weight:700;margin:24px 0 14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px">Connect Claude</h2>
    <div class="card">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Add Lantern to Claude. You'll be prompted to sign in with your institution account on first use — <code style="font-size:11px;background:var(--bg);padding:2px 5px;border-radius:3px">mcp-remote</code> handles the OAuth flow automatically.</p>

      <div class="connect-tabs">
        <button class="connect-tab active" onclick="showTab(event, 'desktop')">Claude Desktop</button>
        <button class="connect-tab" onclick="showTab(event, 'code')">Claude Code</button>
      </div>

      <div id="tab-desktop" class="tab-panel active">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste into <code style="font-size:11px;background:var(--bg);padding:2px 5px;border-radius:3px">claude_desktop_config.json</code>:</p>
        <div class="code-block" id="desktop-config">${escHtml(desktopConfig)}</div>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px;margin-top:10px" onclick="copyText(document.getElementById('desktop-config').textContent, this, 'Copy config')">Copy config</button>
      </div>

      <div id="tab-code" class="tab-panel">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Run in your terminal:</p>
        <div class="code-block" id="code-config">${escHtml(`claude mcp add m365 --transport http ${baseUrl}/v1/m365/mcp`)}</div>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px;margin-top:10px" onclick="copyText(document.getElementById('code-config').textContent, this, 'Copy command')">Copy command</button>
      </div>
    </div>

    <!-- Departments -->
    <h2 style="font-size:11px;font-weight:700;margin:24px 0 14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px">My Departments</h2>
    <div class="card">
      ${deptsHtml}
    </div>

    <script>
      function showTab(e, name) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.connect-tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + name).classList.add('active');
        e.target.classList.add('active');
      }
      function copyText(text, btn, label) {
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = label; }, 2000);
        });
      }
    </script>
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
