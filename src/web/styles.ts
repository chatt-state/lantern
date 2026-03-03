export const globalStyles = `
  :root {
    --bg: #0f1117;
    --bg-card: #1a1d27;
    --bg-hover: #22263a;
    --border: #2d3148;
    --text: #e8eaf0;
    --text-muted: #7b82a0;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #ef4444;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f4f5f9;
      --bg-card: #ffffff;
      --bg-hover: #f0f1f7;
      --border: #e2e4ef;
      --text: #1a1d27;
      --text-muted: #6b7280;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.6; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent-hover); }
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius); border: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.15s; }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--bg-hover); color: var(--text); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-admin { background: rgba(99,102,241,0.15); color: var(--accent); }
  .badge-member { background: rgba(34,197,94,0.1); color: var(--success); }
`;
