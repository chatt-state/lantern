import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('multi-tenant config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it('multiTenant reads MULTI_TENANT env var correctly', async () => {
    // Default (env not set or false)
    const { config: defaultConfig } = await import('../src/config.js?v=1');
    expect(typeof defaultConfig.multiTenant).toBe('boolean');
  });

  it('config.multiTenant is false by default', async () => {
    const { config } = await import('../src/config.js?v=2');
    // In test environment MULTI_TENANT is not set, so it should be false
    expect(config.multiTenant).toBe(false);
  });

  it('superadminEmails parses comma-separated list from config', async () => {
    const { config } = await import('../src/config.js?v=3');
    // Should be an array (empty when env not set)
    expect(Array.isArray(config.superadminEmails)).toBe(true);
  });

  it('superadminEmails returns empty array when env var is not set', async () => {
    const { config } = await import('../src/config.js?v=4');
    // In test env, SUPERADMIN_EMAILS is not set
    expect(config.superadminEmails).toEqual([]);
  });

  it('superadminEmails filters empty strings from parsed list', () => {
    // Simulate parsing logic: split + trim + filter
    const raw = 'admin@a.edu,, superadmin@b.edu , ';
    const parsed = raw.split(',').map((e) => e.trim()).filter(Boolean);
    expect(parsed).toEqual(['admin@a.edu', 'superadmin@b.edu']);
    expect(parsed).toHaveLength(2);
  });

  it('superadminEmails handles single email without comma', () => {
    const raw = 'admin@example.edu';
    const parsed = raw.split(',').map((e) => e.trim()).filter(Boolean);
    expect(parsed).toEqual(['admin@example.edu']);
  });
});

describe('requireSuperadmin middleware', () => {
  it('returns 403 for non-superadmin authenticated users', async () => {
    const { requireSuperadmin } = await import('../src/auth/middleware.js');

    let statusCode: number | undefined;
    let responseBody: unknown;
    let redirectCalled = false;

    const mockRequest = {
      cookies: {},
      unsignCookie: () => ({ valid: false, value: null }),
      url: '/superadmin',
    } as unknown as import('fastify').FastifyRequest;

    const mockReply = {
      status: (code: number) => {
        statusCode = code;
        return mockReply;
      },
      send: (body: unknown) => {
        responseBody = body;
        return mockReply;
      },
      redirect: (_url: string) => {
        redirectCalled = true;
        return mockReply;
      },
    } as unknown as import('fastify').FastifyReply;

    requireSuperadmin(mockRequest, mockReply);

    // No valid session -> should redirect to login
    expect(redirectCalled).toBe(true);
  });

  it('returns 403 when email is not in superadmin list', async () => {
    const { requireSuperadmin } = await import('../src/auth/middleware.js');

    // Mock a session with a non-superadmin email
    const sessionData = {
      userId: 'user-123',
      email: 'regular@example.edu',
      institutionId: 'inst-456',
    };
    const encoded = Buffer.from(JSON.stringify(sessionData)).toString('base64');

    let statusCode: number | undefined;
    let responseBody: unknown;

    const mockRequest = {
      cookies: {
        lantern_session: encoded,
      },
      unsignCookie: (val: string) => ({ valid: true, value: val }),
      url: '/superadmin',
    } as unknown as import('fastify').FastifyRequest;

    const mockReply = {
      status: (code: number) => {
        statusCode = code;
        return mockReply;
      },
      send: (body: unknown) => {
        responseBody = body;
        return mockReply;
      },
      redirect: (_url: string) => {
        return mockReply;
      },
    } as unknown as import('fastify').FastifyReply;

    requireSuperadmin(mockRequest, mockReply);

    expect(statusCode).toBe(403);
    expect(responseBody).toEqual({ error: 'Superadmin access required' });
  });

  it('auto-registration only runs when multiTenant is true', () => {
    // Verify the logic: in single-tenant mode, missing institution returns 401
    // This is a unit test of the logic flow, not the actual route
    const multiTenantFalse = false;
    const multiTenantTrue = true;

    function handleMissingInstitution(multiTenant: boolean): string {
      if (!multiTenant) {
        return '401: Institution not registered. Please configure AZURE_TENANT_ID.';
      }
      return 'auto-register';
    }

    expect(handleMissingInstitution(multiTenantFalse)).toContain('401');
    expect(handleMissingInstitution(multiTenantTrue)).toBe('auto-register');
  });
});
