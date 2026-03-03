import { globalStyles } from './styles.js';

export interface LayoutOptions {
  title: string;
  user: { displayName: string; email: string; institutionAdmin: boolean };
  currentPath: string;
  content: string;
}

export function layout(opts: LayoutOptions): string {
  const { title, user, currentPath, content } = opts;

  const navItems = [
    { href: '/settings', label: 'My Connections', icon: '⚡' },
    { href: '/settings/department', label: 'Department', icon: '🏛️' },
    ...(user.institutionAdmin
      ? [
          { href: '/settings/admin', label: 'Admin', icon: '⚙️' },
          { href: '/settings/admin/departments', label: '↳ Departments', icon: '' },
          { href: '/settings/admin/members', label: '↳ Members', icon: '' },
          { href: '/settings/admin/servers', label: '↳ Servers', icon: '' },
          { href: '/settings/admin/audit', label: '↳ Audit Log', icon: '' },
        ]
      : []),
  ];

  const navHtml = navItems
    .map((item) => {
      const active = currentPath === item.href || currentPath.startsWith(item.href + '/');
      return `<a href="${item.href}" class="nav-item ${active ? 'active' : ''}">${item.icon ? `<span>${item.icon}</span>` : ''} ${item.label}</a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} — Lantern</title>
  <style>
    ${globalStyles}
    .app { display: flex; min-height: 100vh; }
    .sidebar { width: 220px; background: var(--bg-card); border-right: 1px solid var(--border); padding: 20px 0; display: flex; flex-direction: column; flex-shrink: 0; }
    .sidebar-logo { padding: 0 20px 20px; font-size: 18px; font-weight: 700; color: var(--text); border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .sidebar-logo span { color: var(--accent); }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 20px; color: var(--text-muted); transition: all 0.15s; font-size: 13px; }
    .nav-item:hover { background: var(--bg-hover); color: var(--text); }
    .nav-item.active { background: rgba(99,102,241,0.1); color: var(--accent); font-weight: 500; }
    .sidebar-footer { margin-top: auto; padding: 16px 20px; border-top: 1px solid var(--border); }
    .user-info { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .main { flex: 1; padding: 32px; overflow-y: auto; max-width: 960px; }
    .page-title { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
    @media (max-width: 640px) {
      .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
      .app { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="app">
    <nav class="sidebar">
      <div class="sidebar-logo">🔦 <span>Lantern</span></div>
      ${navHtml}
      <div class="sidebar-footer">
        <div class="user-info">${escHtml(user.displayName)}<br><small>${escHtml(user.email)}</small></div>
        ${user.institutionAdmin ? '<div class="badge badge-admin" style="margin-bottom:8px">Admin</div>' : ''}
        <a href="/auth/logout" class="btn btn-ghost" style="width:100%;justify-content:center;font-size:12px">Sign out</a>
      </div>
    </nav>
    <main class="main">${content}</main>
  </div>
</body>
</html>`;
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
