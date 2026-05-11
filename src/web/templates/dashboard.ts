import { layout, escHtml } from '../layout.js';
import type { LanternSession } from '../../auth/session.js';

export interface DashboardData {
  session: LanternSession;
  departments: Array<{ departmentId: string; departmentName: string; role: string }>;
  currentPath: string;
  baseUrl?: string;
  /** Slugs of BYOC vendors this user has already connected. */
  connectedVendorSlugs?: string[];
}

interface DashboardServer {
  slug: string;
  name: string;
  description: string;
  icon: string;
  /** Set for BYOC vendors that require credential entry via /settings/connections/<slug>/connect. */
  byoc?: boolean;
}

const SERVERS: DashboardServer[] = [
  {
    slug: 'm365',
    name: 'Microsoft 365',
    description: 'Users, mailboxes, Teams, OneDrive, licensing, and security posture.',
    icon: `<svg viewBox="0 0 20 20" width="20" height="20" fill="none"><rect x="1" y="1" width="7.5" height="7.5" rx="1" fill="#f25022"/><rect x="11.5" y="1" width="7.5" height="7.5" rx="1" fill="#7fba00"/><rect x="1" y="11.5" width="7.5" height="7.5" rx="1" fill="#00a4ef"/><rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1" fill="#ffb900"/></svg>`,
  },
  {
    slug: 'tdx',
    name: 'TeamDynamix',
    description: 'Tickets, knowledge base, assets, services, and staff directory.',
    icon: `<svg viewBox="0 0 20 20" width="20" height="20" fill="none"><circle cx="10" cy="10" r="9" stroke="#2563eb" stroke-width="1.5"/><path d="M6 10h8M10 6v8" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
  {
    slug: 'checkpoint-official',
    name: 'Check Point Cloud Infrastructure',
    description: 'Security posture, gateways, policies, and threat insights from Check Point Infinity Portal.',
    icon: `<svg viewBox="0 0 20 20" width="20" height="20" fill="none"><path d="M10 1l8 4v6c0 4.5-3.5 7-8 8-4.5-1-8-3.5-8-8V5l8-4z" stroke="#e63946" stroke-width="1.4" fill="rgba(230,57,70,0.08)"/></svg>`,
    byoc: true,
  },
];

export function dashboardPage(data: DashboardData): string {
  const { session, departments, currentPath, baseUrl = process.env.BASE_URL ?? 'http://localhost:8080', connectedVendorSlugs = [] } = data;
  const connectedSet = new Set(connectedVendorSlugs);

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

  const serverCards = SERVERS.map((s) => {
    const isConnected = !s.byoc || connectedSet.has(s.slug);
    const statusBadge = !s.byoc
      ? '<span style="margin-left:auto;background:rgba(34,197,94,0.1);color:var(--success);border:1px solid rgba(34,197,94,0.2);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">Active</span>'
      : isConnected
        ? '<span style="margin-left:auto;background:rgba(34,197,94,0.1);color:var(--success);border:1px solid rgba(34,197,94,0.2);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">Connected</span>'
        : '<span style="margin-left:auto;background:var(--bg-hover);color:var(--text-muted);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">Not connected</span>';

    const perVendorUrl = `${baseUrl}/v1/${s.slug}/mcp`;
    const actionRow = s.byoc && !isConnected
      ? `<a href="/settings/connections/${escHtml(s.slug)}/connect" class="btn btn-primary" style="font-size:12px;padding:6px 14px">Connect ${escHtml(s.name)}</a>`
      : `<code style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(perVendorUrl)}</code>
         <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px;flex-shrink:0" onclick="copyText('${escHtml(perVendorUrl)}', this, 'Copy URL')">Copy URL</button>
         ${s.byoc ? `<a href="/settings/connections/${escHtml(s.slug)}/connect" class="btn btn-ghost" style="font-size:12px;padding:6px 12px;flex-shrink:0">Manage</a>` : ''}`;

    return `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${s.icon}
        </div>
        <div>
          <div style="font-weight:600;font-size:14px">${escHtml(s.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:1px">${escHtml(s.description)}</div>
        </div>
        ${statusBadge}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${actionRow}
      </div>
    </div>
  `;
  }).join('');

  // ── Unified MCP endpoint banner ───────────────────────
  // Surfaced atop the per-vendor list so clients on /v1/mcp aggregate path
  // know it exists. Legacy /v1/:server/mcp remains live below.
  const unifiedUrl = `${baseUrl}/v1/mcp`;
  const unifiedCard = `
    <div class="card" style="margin-bottom:16px;border-color:var(--primary)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--bg);border:1px solid var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--primary);font-weight:700">⚡</div>
        <div>
          <div style="font-weight:600;font-size:14px">Unified Endpoint</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:1px">One URL for every connected server. Tool names are namespaced as <code>m365__</code>, <code>tdx__</code>, <code>checkpoint-official__</code>, etc.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <code style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(unifiedUrl)}</code>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px;flex-shrink:0" onclick="copyText('${escHtml(unifiedUrl)}', this, 'Copy URL')">Copy URL</button>
      </div>
    </div>
  `;

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

    <!-- Unified endpoint -->
    <h2 style="font-size:11px;font-weight:700;margin-bottom:14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px">Unified Endpoint</h2>
    ${unifiedCard}

    <!-- Available servers -->
    <h2 style="font-size:11px;font-weight:700;margin:24px 0 14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px">Available Servers</h2>
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
        <div class="code-block" id="code-config">${escHtml(SERVERS.map((s) => `claude mcp add ${s.slug} --transport http ${baseUrl}/v1/${s.slug}/mcp`).join('\n'))}</div>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px;margin-top:10px" onclick="copyText(document.getElementById('code-config').textContent, this, 'Copy commands')">Copy commands</button>
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
