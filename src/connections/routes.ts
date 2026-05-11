/**
 * Per-user vendor credential entry UI routes for BYOC vendors (vendors with
 * `oauthConfig` set in vendor-config.ts).
 *
 * Routes:
 *   GET  /settings/connections/<slug>/connect      — form
 *   POST /settings/connections/<slug>/connect      — validate + encrypt + store + audit
 *   POST /settings/connections/<slug>/disconnect   — delete + audit
 *
 * Three guards per scope doc §4 step 7 (Walter folds 2026-05-11):
 *   1. GET handler MUST require `hasServerAccess` — 403 if denied.
 *      Prevents wasted vendor-side OAuth handshakes + audit noise from users
 *      who lack access to the vendor.
 *   2. POST handler MUST re-check `hasServerAccess` at creation time. Closes
 *      the race where a user gets temporary access → connects creds → access
 *      revoked → orphan creds remain in DB.
 *   3. Error/reauth shape MUST NOT leak token or credential info. Messages
 *      read "you need to connect <vendor>" — never "token X expired" etc.
 *      Test coverage asserts the error-body shape.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireAuth } from '../auth/middleware.js';
import { getSession } from '../auth/session.js';
import { layout, escHtml } from '../web/layout.js';
import { getVendor, type VendorConfig, type VendorField } from '../proxy/vendor-config.js';
import { AllowlistService } from '../proxy/allowlist-service.js';
import { UserService } from '../auth/user-service.js';
import {
  storeVendorCredentials,
  deleteVendorCredentials,
  hasVendorCredentials,
} from '../credentials/vendor-credentials.js';
import { logAuditEntry } from '../proxy/audit.js';
import { config } from '../config.js';

interface FlashQuery {
  success?: string;
  error?: string;
  missing?: string;
}

function flashBanner(query: FlashQuery): string {
  if (query.success) {
    return `<div style="background:rgba(34,197,94,0.1);border:1px solid var(--success);color:var(--success);border-radius:var(--radius);padding:10px 16px;margin-bottom:20px">
      ${escHtml(query.success === '1' ? 'Connection saved.' : query.success)}
    </div>`;
  }
  if (query.error) {
    return `<div style="background:rgba(239,68,68,0.1);border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius);padding:10px 16px;margin-bottom:20px">
      ${escHtml(query.error)}
    </div>`;
  }
  return '';
}

function fieldInputHtml(field: VendorField, focused: boolean): string {
  const inputType = field.secret ? 'password' : 'text';
  const focusAttr = focused ? ' autofocus' : '';
  const requiredAttr = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${escHtml(field.placeholder)}"` : '';
  const help = field.helpText
    ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escHtml(field.helpText)}</div>`
    : '';
  return `<div style="margin-bottom:16px">
    <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">
      ${escHtml(field.label)}${field.required ? '<span style="color:var(--danger)"> *</span>' : ''}
    </label>
    <input
      type="${inputType}"
      name="${escHtml(field.key)}"
      autocomplete="off"
      ${focusAttr}${requiredAttr}${placeholder}
      style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;color:var(--text);font-size:13px;font-family:${field.secret ? 'monospace' : 'inherit'}"
    >
    ${help}
  </div>`;
}

function connectFormHtml(
  vendor: VendorConfig,
  alreadyConnected: boolean,
  focusField: string | undefined,
  query: FlashQuery,
): string {
  const fields = vendor.fields ?? [];
  return `
    <h1 class="page-title">Connect ${escHtml(vendor.displayName)}</h1>
    ${flashBanner(query)}
    <div class="card">
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
        ${alreadyConnected
          ? `You already have ${escHtml(vendor.displayName)} connected. Submitting the form below will replace the stored credentials.`
          : `Enter your ${escHtml(vendor.displayName)} API credentials. These are encrypted with AES-256-GCM and decrypted only when proxying your tool calls.`}
      </p>
      <form method="post" action="/settings/connections/${escHtml(vendor.slug)}/connect">
        ${fields.map((f) => fieldInputHtml(f, f.key === focusField)).join('')}
        <div style="display:flex;gap:8px;align-items:center;margin-top:24px">
          <button type="submit" class="btn btn-primary">Save Connection</button>
          ${alreadyConnected
            ? `<form method="post" action="/settings/connections/${escHtml(vendor.slug)}/disconnect" style="display:inline">
                 <button type="submit" class="btn btn-ghost" style="color:var(--danger)" onclick="return confirm('Disconnect ${escHtml(vendor.displayName)}?')">Disconnect</button>
               </form>`
            : ''}
          <a href="/settings" class="btn btn-ghost">Cancel</a>
        </div>
      </form>
    </div>`;
}

export function connectionsRoutes(sql: Sql) {
  const allowlistService = new AllowlistService(sql);
  const userService = new UserService(sql);

  return async function (app: FastifyInstance) {
    // ---------------------------------------------------------------------
    // GET /settings/connections/:slug/connect — form
    // ---------------------------------------------------------------------
    app.get<{ Params: { slug: string }; Querystring: FlashQuery }>(
      '/settings/connections/:slug/connect',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        const slug = request.params.slug;
        const vendor = getVendor(slug);
        if (!vendor || !vendor.oauthConfig || !vendor.fields) {
          return reply.status(404).type('text/html').send('<p>Unknown vendor or vendor does not support connection management.</p>');
        }

        // Guard 1 (Walter fold): require hasServerAccess on GET.
        const user = await userService.findById(session.userId!);
        if (!user) {
          return reply.status(401).type('text/html').send('<p>Session invalid.</p>');
        }
        const hasAccess = await allowlistService.hasServerAccess(user.id, user.institution_id, slug);
        if (!hasAccess) {
          return reply.status(403).type('text/html').send(
            layout({
              title: 'Access Denied',
              user: {
                displayName: session.displayName ?? session.email ?? 'User',
                email: session.email ?? '',
                institutionAdmin: session.institutionAdmin ?? false,
              },
              currentPath: `/settings/connections/${slug}/connect`,
              content: `<h1 class="page-title">Access Denied</h1>
                <div class="card">
                  <p>Your department does not have access to ${escHtml(vendor.displayName)}. Contact your institution administrator if you believe this is an error.</p>
                </div>`,
            }),
          );
        }

        const alreadyConnected = await hasVendorCredentials(sql, { userId: user.id, vendorSlug: slug });
        return reply.type('text/html').send(
          layout({
            title: `Connect ${vendor.displayName}`,
            user: {
              displayName: session.displayName ?? session.email ?? 'User',
              email: session.email ?? '',
              institutionAdmin: session.institutionAdmin ?? false,
            },
            currentPath: `/settings/connections/${slug}/connect`,
            content: connectFormHtml(vendor, alreadyConnected, request.query.missing, request.query),
          }),
        );
      },
    );

    // ---------------------------------------------------------------------
    // POST /settings/connections/:slug/connect — validate + encrypt + store
    // ---------------------------------------------------------------------
    app.post<{ Params: { slug: string }; Body: Record<string, string | undefined> }>(
      '/settings/connections/:slug/connect',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        const slug = request.params.slug;
        const vendor = getVendor(slug);
        if (!vendor || !vendor.oauthConfig || !vendor.fields) {
          return reply.redirect('/settings?error=Unknown+vendor');
        }

        const user = await userService.findById(session.userId!);
        if (!user) {
          return reply.status(401).redirect('/auth/login');
        }

        // Guard 2 (Walter fold): re-check hasServerAccess at creation time.
        // Closes the race where temp access → connect → access revoked → orphan creds.
        const hasAccess = await allowlistService.hasServerAccess(user.id, user.institution_id, slug);
        if (!hasAccess) {
          return reply.redirect(`/settings/connections/${slug}/connect?error=Access+denied`);
        }

        // Collect required field values; reject if any required field empty.
        const creds: Record<string, string> = {};
        const missing: string[] = [];
        for (const field of vendor.fields) {
          const value = request.body[field.key];
          if (typeof value !== 'string' || value.length === 0) {
            if (field.required) missing.push(field.key);
            continue;
          }
          creds[field.key] = value;
        }
        if (missing.length > 0) {
          // Generic error — do not echo back submitted (potentially secret) values.
          return reply.redirect(
            `/settings/connections/${slug}/connect?error=Missing+required+fields&missing=${encodeURIComponent(missing[0])}`,
          );
        }

        await storeVendorCredentials(sql, config.masterKey, {
          userId: user.id,
          vendorSlug: slug,
          creds,
        });
        await logAuditEntry(sql, {
          institutionId: user.institution_id,
          userId: user.id,
          serverSlug: slug,
          method: 'CONNECT',
          statusCode: 200,
        });
        return reply.redirect(`/settings/connections/${slug}/connect?success=1`);
      },
    );

    // ---------------------------------------------------------------------
    // POST /settings/connections/:slug/disconnect — delete + audit
    // ---------------------------------------------------------------------
    app.post<{ Params: { slug: string } }>(
      '/settings/connections/:slug/disconnect',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const session = getSession(request);
        const slug = request.params.slug;
        const vendor = getVendor(slug);
        if (!vendor || !vendor.oauthConfig) {
          return reply.redirect('/settings?error=Unknown+vendor');
        }
        const user = await userService.findById(session.userId!);
        if (!user) return reply.status(401).redirect('/auth/login');

        await deleteVendorCredentials(sql, { userId: user.id, vendorSlug: slug });
        await logAuditEntry(sql, {
          institutionId: user.institution_id,
          userId: user.id,
          serverSlug: slug,
          method: 'DISCONNECT',
          statusCode: 200,
        });
        return reply.redirect('/settings?success=Disconnected');
      },
    );
  };
}
