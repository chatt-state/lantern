import { globalStyles } from '../styles.js';
import { escHtml } from '../layout.js';

const INTEGRATIONS = [
  {
    slug: 'm365',
    name: 'Microsoft 365',
    vendor: 'Microsoft',
    description:
      'User management, mailboxes, Teams, OneDrive, licensing, and security posture — powered by Microsoft Graph.',
    capabilities: ['User Management', 'Mailbox & Email', 'Teams Administration', 'OneDrive', 'Licensing'],
    status: 'available' as const,
  },
];

export function landingPage(opts: { baseUrl: string; institutionName?: string }): string {
  const { baseUrl, institutionName } = opts;

  const integrationCards = INTEGRATIONS.map(
    (int) => `
    <div class="int-card">
      <div class="int-header">
        <div class="int-icon">
          ${int.slug === 'm365' ? '<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" fill="#f25022"/><rect x="13" y="3" width="8" height="8" rx="1" fill="#7fba00"/><rect x="3" y="13" width="8" height="8" rx="1" fill="#00a4ef"/><rect x="13" y="13" width="8" height="8" rx="1" fill="#ffb900"/></svg>' : '📦'}
        </div>
        <div>
          <div class="int-name">${escHtml(int.name)}</div>
          <div class="int-vendor">${escHtml(int.vendor)}</div>
        </div>
        <span class="badge-status">Available</span>
      </div>
      <p class="int-desc">${escHtml(int.description)}</p>
      <div class="int-caps">
        ${int.capabilities.map((c) => `<span class="cap-tag">${escHtml(c)}</span>`).join('')}
      </div>
    </div>
  `,
  ).join('');

  const configJson = JSON.stringify(
    {
      mcpServers: {
        m365: {
          command: 'npx',
          args: ['-y', 'mcp-remote', `${baseUrl}/v1/m365/mcp`],
        },
      },
    },
    null,
    2,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lantern — AI-Powered MCP Gateway${institutionName ? ` · ${escHtml(institutionName)}` : ''}</title>
  <meta name="description" content="Connect your institution's AI tools to Claude with a single sign-on. Department-aware access control, Microsoft 365 integration, and more.">
  <style>
    ${globalStyles}

    /* ── Layout ── */
    .page { max-width: 1100px; margin: 0 auto; padding: 0 24px; }

    /* ── Nav ── */
    .nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 0; border-bottom: 1px solid var(--border);
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; color: var(--text); }
    .nav-logo .lantern-icon { font-size: 22px; }
    .nav-logo span { color: var(--accent); }
    .nav-actions { display: flex; align-items: center; gap: 12px; }

    /* ── Hero ── */
    .hero {
      text-align: center;
      padding: 80px 0 60px;
    }
    .hero-label {
      display: inline-block;
      background: rgba(99,102,241,0.12);
      color: var(--accent);
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 20px;
      padding: 4px 14px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .hero h1 {
      font-size: clamp(32px, 5vw, 54px);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.5px;
      margin-bottom: 20px;
      color: var(--text);
    }
    .hero h1 em { font-style: normal; color: var(--accent); }
    .hero p {
      font-size: 18px;
      color: var(--text-muted);
      max-width: 600px;
      margin: 0 auto 36px;
      line-height: 1.7;
    }
    .hero-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .btn-azure {
      display: inline-flex; align-items: center; gap: 10px;
      background: var(--accent); color: white;
      padding: 12px 28px; border-radius: 8px;
      font-size: 15px; font-weight: 600;
      transition: all 0.15s;
      border: none; cursor: pointer;
    }
    .btn-azure:hover { background: var(--accent-hover); color: white; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(99,102,241,0.35); }
    .btn-outline {
      display: inline-flex; align-items: center; gap: 8px;
      background: transparent; color: var(--text);
      padding: 12px 24px; border-radius: 8px;
      font-size: 15px; font-weight: 500;
      border: 1px solid var(--border);
      transition: all 0.15s;
    }
    .btn-outline:hover { background: var(--bg-hover); color: var(--text); border-color: var(--text-muted); }

    /* ── Steps ── */
    .section { padding: 64px 0; }
    .section-label {
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
    }
    .section-title {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 48px;
      color: var(--text);
    }
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
    .step-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      position: relative;
    }
    .step-num {
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(99,102,241,0.15);
      color: var(--accent);
      font-size: 13px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
    }
    .step-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .step-card p { font-size: 13px; color: var(--text-muted); line-height: 1.6; }

    /* ── Integrations ── */
    .int-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
    .int-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .int-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .int-icon { width: 44px; height: 44px; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .int-name { font-size: 15px; font-weight: 600; }
    .int-vendor { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .badge-status {
      margin-left: auto; flex-shrink: 0;
      background: rgba(34,197,94,0.1);
      color: var(--success);
      border: 1px solid rgba(34,197,94,0.2);
      padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 600;
    }
    .int-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 14px; }
    .int-caps { display: flex; flex-wrap: wrap; gap: 6px; }
    .cap-tag {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 4px; padding: 2px 8px;
      font-size: 11px; color: var(--text-muted);
    }

    /* ── Setup ── */
    .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 720px) { .setup-grid { grid-template-columns: 1fr; } }
    .setup-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .setup-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .setup-card p { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6; }
    .code-block {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.7;
      overflow-x: auto;
      color: var(--text);
      white-space: pre;
    }
    .code-block .kw { color: #818cf8; }
    .code-block .str { color: #86efac; }
    .copy-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 12px; padding: 6px 14px;
      background: transparent; border: 1px solid var(--border);
      border-radius: 6px; font-size: 12px; color: var(--text-muted);
      cursor: pointer; transition: all 0.15s;
    }
    .copy-btn:hover { background: var(--bg-hover); color: var(--text); }

    /* ── CTA Band ── */
    .cta-band {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      margin: 48px 0 64px;
    }
    .cta-band h2 { font-size: 26px; font-weight: 700; margin-bottom: 12px; }
    .cta-band p { color: var(--text-muted); margin-bottom: 28px; font-size: 15px; }

    /* ── Footer ── */
    .footer {
      border-top: 1px solid var(--border);
      padding: 28px 0;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 12px;
    }
    .footer-left { font-size: 13px; color: var(--text-muted); }
    .footer-right { display: flex; gap: 20px; font-size: 13px; }
    .footer-right a { color: var(--text-muted); }
    .footer-right a:hover { color: var(--text); }

    /* ── Divider ── */
    .divider { border: none; border-top: 1px solid var(--border); margin: 0; }
  </style>
</head>
<body>
  <div class="page">

    <!-- Nav -->
    <nav class="nav">
      <div class="nav-logo">
        <span class="lantern-icon">🔦</span>
        <span>Lantern</span>
        ${institutionName ? `<span style="color:var(--text-muted);font-size:13px;font-weight:400">· ${escHtml(institutionName)}</span>` : ''}
      </div>
      <div class="nav-actions">
        <a href="https://github.com/wyre-technology/lantern" target="_blank" rel="noopener" class="btn-outline" style="font-size:13px;padding:7px 16px">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.83-.26.83-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.54-1.38-1.33-1.74-1.33-1.74-1.08-.74.08-.73.08-.73 1.2.09 1.83 1.23 1.83 1.23 1.06 1.82 2.79 1.3 3.47.99.1-.77.41-1.3.74-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.004 2.04.14 3 .4 2.28-1.55 3.28-1.23 3.28-1.23.66 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
        <a href="/auth/login" class="btn-azure">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.4 24H0l8.8-15.3L13.6 0l10.4 18H13.2L8.8 9.7z" fill="#0072c6"/></svg>
          Sign in with Azure
        </a>
      </div>
    </nav>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-label">Open Source · Higher Education</div>
      <h1>AI tools for your campus,<br>secured by <em>Azure SSO</em></h1>
      <p>Lantern connects Microsoft 365 and your institution's systems to Claude — with department-level access control, full audit logging, and zero credential management for end users.</p>
      <div class="hero-actions">
        <a href="/auth/login" class="btn-azure">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11.4 24H0l8.8-15.3L13.6 0l10.4 18H13.2L8.8 9.7z" fill="#fff"/></svg>
          Sign in with your institution account
        </a>
        <a href="https://github.com/wyre-technology/lantern" target="_blank" rel="noopener" class="btn-outline">
          View on GitHub
        </a>
      </div>
    </section>

    <hr class="divider">

    <!-- How it works -->
    <section class="section">
      <div class="section-label">Getting Started</div>
      <div class="section-title">Three steps to AI-powered M365</div>
      <div class="steps">
        <div class="step-card">
          <div class="step-num">1</div>
          <h3>Sign in with Azure</h3>
          <p>Use your existing institution credentials — no new accounts, no passwords to remember. Azure Entra ID SSO handles authentication.</p>
        </div>
        <div class="step-card">
          <div class="step-num">2</div>
          <h3>Get access</h3>
          <p>Your department memberships in Azure AD determine which MCP tools you can use. Admins control the allowlist — you just show up.</p>
        </div>
        <div class="step-card">
          <div class="step-num">3</div>
          <h3>Connect Claude</h3>
          <p>Add a single line to Claude Desktop's config. OAuth 2.1 + PKCE handles the token negotiation automatically — no API keys to copy.</p>
        </div>
      </div>
    </section>

    <hr class="divider">

    <!-- Integrations -->
    <section class="section">
      <div class="section-label">Integrations</div>
      <div class="section-title">Available MCP Servers</div>
      <div class="int-grid">
        ${integrationCards}
      </div>
    </section>

    <hr class="divider">

    <!-- Setup guide -->
    <section class="section">
      <div class="section-label">Setup</div>
      <div class="section-title">Connect Claude Desktop</div>
      <div class="setup-grid">
        <div class="setup-card">
          <h3>Claude Desktop</h3>
          <p>Add this to your <code style="font-family:monospace;font-size:12px;background:var(--bg);padding:2px 6px;border-radius:4px">claude_desktop_config.json</code>. Sign in when prompted — your browser will handle the rest.</p>
          <div class="code-block" id="desktop-config">${escHtml(configJson)}</div>
          <button class="copy-btn" onclick="copyCode('desktop-config', this)">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy config
          </button>
        </div>
        <div class="setup-card">
          <h3>Claude Code (mcp-remote)</h3>
          <p>Add the MCP server directly to your Claude Code session using the <code style="font-family:monospace;font-size:12px;background:var(--bg);padding:2px 6px;border-radius:4px">mcp add</code> command.</p>
          <div class="code-block" id="code-config">claude mcp add m365 \\
  --transport http \\
  ${escHtml(`${baseUrl}/v1/m365/mcp`)}</div>
          <button class="copy-btn" onclick="copyCode('code-config', this)">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy command
          </button>
        </div>
      </div>
    </section>

    <!-- CTA band -->
    <div class="cta-band">
      <h2>Ready to get started?</h2>
      <p>Sign in with your institution account to connect Claude to your Microsoft 365 environment.</p>
      <a href="/auth/login" class="btn-azure" style="font-size:15px;padding:13px 32px">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11.4 24H0l8.8-15.3L13.6 0l10.4 18H13.2L8.8 9.7z" fill="#fff"/></svg>
        Sign in with Azure
      </a>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <div class="footer-left">
        🔦 Lantern ${institutionName ? `· ${escHtml(institutionName)}` : ''} · Open source under Apache 2.0
      </div>
      <div class="footer-right">
        <a href="https://github.com/wyre-technology/lantern" target="_blank" rel="noopener">GitHub</a>
        <a href="/settings">Dashboard</a>
        <a href="/health">Status</a>
      </div>
    </footer>
  </div>

  <script>
    function copyCode(id, btn) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.textContent).then(() => {
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy config';
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}
