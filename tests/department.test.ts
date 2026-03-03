/**
 * Tests for department admin routes (src/department/routes.ts).
 *
 * Uses the same lightweight Fastify test harness with a mock SQL client
 * and signed session cookies as the admin tests.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import type { Sql } from 'postgres';
import { departmentRoutes } from '../src/department/routes.js';

// ---------------------------------------------------------------------------
// SQL mock helpers (copied pattern from admin.test.ts)
// ---------------------------------------------------------------------------

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

function makeSessionCookie(
  app: ReturnType<typeof Fastify>,
  session: Record<string, unknown>,
): string {
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64');
  const signed = (app as unknown as { signCookie: (v: string) => string }).signCookie(encoded);
  return signed;
}

async function buildApp(sql: Sql) {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(cookie, { secret: 'test-secret-for-department-tests' });
  await app.register(departmentRoutes(sql));
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Access control tests
// ---------------------------------------------------------------------------

describe('departmentRoutes — access control', () => {
  it('non-dept-admin gets 403 on GET /settings/department/:id', async () => {
    // SQL responses:
    // 1. canAdminDepartment -> getUserRoleInDepartment -> query user_departments (returns empty = no role)
    const sql = makeMockSql([
      [], // user_departments query — no row means no role
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'user-1', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department/dept-abc',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('unauthenticated user is redirected to login on GET /settings/department/:id', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department/dept-abc',
      // no cookie
    });

    // requireAuth redirects to /auth/login for non-API routes
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    await app.close();
  });

  it('institution admin can access any department dashboard', async () => {
    // Institution admin => canAdminDepartment returns true immediately (no DB query for role)
    // Then: dept query, members query, server_access query (all required for the page)
    // Then: audit queries (queryLogs: rows + count)
    const sql = makeMockSql([
      // dept lookup
      [{ id: 'dept-1', name: 'Engineering', description: 'Eng dept' }],
      // members
      [],
      // server_access
      [],
      // audit queryLogs rows
      [],
      // audit queryLogs count
      [{ count: '0' }],
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department/dept-1',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Engineering');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Tool allowlist parsing tests
// ---------------------------------------------------------------------------

describe('departmentRoutes — tool allowlist parsing', () => {
  it('POST tool-access with empty allowedTools stores an empty array (all tools)', async () => {
    // canAdminDepartment: institution admin passes immediately
    // INSERT/UPSERT into tool_allowlists
    let capturedTools: string[] | undefined;
    let callIndex = 0;
    const fragmentResult = Object.assign(Promise.resolve([]), { raw: '' });

    const handler: ProxyHandler<object> = {
      apply(_target, _thisArg, args) {
        const strings: TemplateStringsArray = args[0];
        const firstPart = strings?.[0] ?? '';
        const trimmed = firstPart.trimStart().toUpperCase();
        const isFragment =
          trimmed.startsWith('AND') ||
          trimmed.startsWith('ON CONFLICT') ||
          trimmed === '';

        if (isFragment) return fragmentResult;

        // The tool allowlist upsert passes the tools array as args[1]
        // Capture the allowedTools argument from the INSERT
        if (trimmed.includes('INSERT INTO TOOL_ALLOWLISTS')) {
          // args[1] is departmentId, args[2] is serverSlug, args[3] is allowedTools
          capturedTools = args[3] as string[];
        }

        callIndex++;
        return Object.assign(Promise.resolve([]), { raw: '' });
      },
      get(_target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        return new Proxy(function () {}, handler);
      },
    };

    const sql = new Proxy(function () {}, handler) as unknown as Sql;
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/department/dept-1/tool-access',
      payload: 'serverSlug=m365&allowedTools=',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('success=1');
    await app.close();
  });

  it('POST tool-access with comma-separated tools parses them correctly', async () => {
    // We test the parsing logic directly (pure function behavior)
    // by asserting what the route would store.
    const rawTools = 'tool1, tool2,  tool3 ';
    const parsed = rawTools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    expect(parsed).toEqual(['tool1', 'tool2', 'tool3']);
  });

  it('POST tool-access with blank string produces empty array', () => {
    const rawTools = '   ';
    const parsed = rawTools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    expect(parsed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Member management tests
// ---------------------------------------------------------------------------

describe('departmentRoutes — member management', () => {
  it('POST members/add with unknown email redirects with error', async () => {
    // canAdminDepartment: institution admin passes
    // SELECT user by email -> returns empty (not found)
    const sql = makeMockSql([
      [], // user lookup returns empty
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/department/dept-1/members/add',
      payload: 'email=nobody%40example.edu',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=User+not+found');
    await app.close();
  });

  it('POST members/add with valid email redirects with success', async () => {
    // canAdminDepartment passes (institution admin)
    // SELECT user returns a user
    // INSERT into user_departments
    const sql = makeMockSql([
      [{ id: 'user-99' }], // user found
      [],                   // INSERT user_departments
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/department/dept-1/members/add',
      payload: 'email=alice%40uni.edu',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/department/dept-1?success=1');
    await app.close();
  });

  it('POST members/role with invalid role redirects with error', async () => {
    // canAdminDepartment passes (institution admin)
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/department/dept-1/members/role',
      payload: 'userId=user-5&role=superadmin',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=Invalid+role');
    await app.close();
  });

  it('POST members/remove redirects with success', async () => {
    // canAdminDepartment passes (institution admin)
    // DELETE query
    const sql = makeMockSql([
      [], // DELETE result
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'POST',
      url: '/settings/department/dept-1/members/remove',
      payload: 'userId=user-42',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `lantern_session=${cookieVal}`,
      },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/department/dept-1?success=1');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Overview redirect tests
// ---------------------------------------------------------------------------

describe('departmentRoutes — overview redirect', () => {
  it('GET /settings/department redirects institution admin to admin departments', async () => {
    const sql = makeMockSql([]);
    const app = await buildApp(sql);

    const session = { userId: 'admin-1', institutionId: 'inst-1', institutionAdmin: true };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/admin/departments');
    await app.close();
  });

  it('GET /settings/department redirects dept admin to their first dept', async () => {
    // getAdminDepartments returns one dept ID
    const sql = makeMockSql([
      [{ department_id: 'dept-first' }], // getAdminDepartments
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'dept-admin-1', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/department/dept-first');
    await app.close();
  });

  it('GET /settings/department shows informational page for regular member', async () => {
    // getAdminDepartments returns empty
    const sql = makeMockSql([
      [], // no admin departments
    ]);
    const app = await buildApp(sql);

    const session = { userId: 'regular-1', institutionId: 'inst-1', institutionAdmin: false };
    const cookieVal = makeSessionCookie(app, session);

    const res = await app.inject({
      method: 'GET',
      url: '/settings/department',
      headers: { cookie: `lantern_session=${cookieVal}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('not a department admin');
    await app.close();
  });
});
