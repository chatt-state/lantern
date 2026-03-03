/**
 * Tests for institution admin panel routes (src/admin/routes.ts).
 *
 * We use a lightweight Fastify test harness with a mock SQL client and
 * a mock session cookie so we can exercise auth guards and business logic
 * without a real database.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import type { Sql } from 'postgres';
import { adminRoutes } from '../src/admin/routes.js';

// ---------------------------------------------------------------------------
// SQL mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal postgres.js mock that returns `responses` in order
 * for non-fragment template literal calls. Fragment calls (AND …, empty, etc.)
 * return an empty resolved Promise so they can be safely interpolated.
 */
function makeMockSql(responses: unknown[]): Sql {
  let callIndex = 0;
  const fragmentResult = Object.assign(Promise.resolve([]), { raw: '' });

  const handler: ProxyHandler<object> = {
    apply(_target, _thisArg, args) {
      const strings: TemplateStringsArray = args[0];
      const firstPart = strings?.[0] ?? '';
      const trimmed = firstPart.trimStart().toUpperCase();
      const isFragment =
        trimmed.startsWith('AND') ||
        trimmed.startsWith('ORDER') ||
        trimmed.startsWith('LIMIT') ||
        trimmed.startsWith('ON CONFLICT') ||
        trimmed === '';

      if (isFragment) return fragmentResult;

      const result = responses[callIndex] ?? [];
      callIndex++;
      return Object.assign(Promise.resolve(result), { raw: '' });
    },
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      return new Proxy(function () {}, handler);
    },
  };

  return new Proxy(function () {}, handler) as unknown as Sql;
}

/** Build a signed session cookie value the same way src/auth/session.ts does. */
function makeSessionCookie(
  app: ReturnType<typeof Fastify>,
  session: Record<string, unknown>,
): string {
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64');
  // @fastify/cookie signs with HMAC using the secret passed to register
  const signed = (app as unknown as { signCookie: (v: string) => string }).signCookie(encoded);
  return signed;
}

// ---------------------------------------------------------------------------
// Test harness factory
// ---------------------------------------------------------------------------

async function buildApp(sql: Sql) {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(cookie, { secret: 'test-secret-for-admin-tests' });
  await app.register(adminRoutes(sql));
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adminRoutes — access control', () => {
  it('returns 403 for a non-admin authenticated user on GET /settings/admin', async () => {
    // SQL mock: overview queries — memberCount, deptCount, serverAccessCount, audit getSummary (3 queries)
    const sql = makeMockSql([
      [{ count: '5' }],
      [{ count: '2' }],
      [{ count: '1' }],
      [{ total: '0', success_count: '0', avg_latency: null }],
      [],
      [],
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'user-1', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns 403 for a non-admin user on GET /settings/admin/departments', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'user-2', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/departments',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns 403 for a non-admin user on GET /settings/admin/members', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'user-3', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/members',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns 403 for a non-admin user on GET /settings/admin/servers', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'user-4', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/servers',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('adminRoutes — department creation', () => {
  it('POST /settings/admin/departments with missing name redirects with error', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/admin/departments',
      payload: 'description=Some+description',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=');
    expect(res.headers.location).toContain('name+is+required');
    await app.close();
  });

  it('POST /settings/admin/departments with valid name redirects to departments list', async () => {
    // Responses: INSERT departments RETURNING id, INSERT admin_audit_log
    const sql = makeMockSql([[{ id: 'new-dept-uuid' }], []]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/admin/departments',
      payload: 'name=Engineering&description=Eng+dept',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/admin/departments?success=1');
    await app.close();
  });
});

describe('adminRoutes — department detail', () => {
  it('GET /settings/admin/departments/:id returns 404 when department not found', async () => {
    // SQL returns empty for department lookup
    const sql = makeMockSql([[]]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/departments/nonexistent-id',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /settings/admin/departments/:id renders page for existing department', async () => {
    const sql = makeMockSql([
      // department lookup
      [{ id: 'dept-1', name: 'Computer Science', description: 'CS dept' }],
      // group_mappings
      [{ id: 'map-1', group_display_name: 'CS Faculty' }],
      // user_departments JOIN users
      [{ user_id: 'u1', display_name: 'Alice', email: 'alice@example.edu', role: 'member', manual_override: false }],
      // server_access
      [{ server_slug: 'm365' }],
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/departments/dept-1',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Computer Science');
    expect(res.body).toContain('CS Faculty');
    expect(res.body).toContain('alice@example.edu');
    await app.close();
  });
});

describe('adminRoutes — member management', () => {
  it('GET /settings/admin/members returns 200 with member table for admin', async () => {
    const sql = makeMockSql([
      [
        { id: 'u1', display_name: 'Bob Smith', email: 'bob@uni.edu', institution_admin: false, departments: 'CS,Math' },
      ],
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/members',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Bob Smith');
    expect(res.body).toContain('bob@uni.edu');
    await app.close();
  });

  it('GET /settings/admin/members/:id returns 404 when user not found', async () => {
    const sql = makeMockSql([[]]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/admin/members/nonexistent-user',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /settings/admin/members/:id/toggle-admin redirects on success', async () => {
    const sql = makeMockSql([
      // UPDATE users RETURNING institution_admin
      [{ institution_admin: true }],
      // INSERT admin_audit_log
      [],
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/admin/members/user-42/toggle-admin',
      payload: '',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/admin/members/user-42?success=1');
    await app.close();
  });
});
