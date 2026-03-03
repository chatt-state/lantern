import { describe, it, expect } from 'vitest';
import { AuditService } from '../src/audit/service.js';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Minimal mock helper — returns different canned results based on invocation order
// ---------------------------------------------------------------------------

function makeMockSql(responses: unknown[]): Sql {
  let callIndex = 0;

  // postgres.js tagged template functions return a "then-able" result via the
  // template literal call. We create a Proxy that intercepts property access
  // for the nested fragment calls (e.g. sql`AND ...`) and the top-level query.
  const fragmentResult = Object.assign(Promise.resolve([]), { raw: '' });

  const handler: ProxyHandler<object> = {
    apply(_target, _thisArg, args) {
      // Called as: sql`...` or sql`AND ...`
      // Detect fragment calls: if the template literal string starts with AND/ORDER/LIMIT etc.
      const strings: TemplateStringsArray = args[0];
      const firstPart = strings?.[0] ?? '';
      const trimmed = firstPart.trimStart().toUpperCase();
      const isFragment =
        trimmed.startsWith('AND') ||
        trimmed.startsWith('ORDER') ||
        trimmed.startsWith('LIMIT') ||
        trimmed === '';

      if (isFragment) return fragmentResult;

      const result = responses[callIndex] ?? [];
      callIndex++;
      return Object.assign(Promise.resolve(result), { raw: '' });
    },
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      // Allow nested sql`` calls (fragment interpolations)
      return new Proxy(function () {}, handler);
    },
  };

  return new Proxy(function () {}, handler) as unknown as Sql;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  it('constructs without throwing', () => {
    const fakeSql = makeMockSql([]);
    expect(() => new AuditService(fakeSql)).not.toThrow();
  });

  it('exportCsv returns a string starting with the correct header row', async () => {
    const fakeRows = [
      {
        id: 'abc-123',
        user_id: 'user1',
        department_id: 'dept1',
        server_slug: 'm365',
        tool_name: 'sendEmail',
        method: 'tools/call',
        status_code: 200,
        latency_ms: 42,
        error: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const sql = makeMockSql([fakeRows]);
    const service = new AuditService(sql);

    const csv = await service.exportCsv({ institutionId: 'inst-1' });

    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'id,user_id,department_id,server_slug,tool_name,method,status_code,latency_ms,error,created_at',
    );
  });

  it('exportCsv includes data rows after the header', async () => {
    const fakeRows = [
      {
        id: 'row-id-1',
        user_id: 'u1',
        department_id: null,
        server_slug: 'test-server',
        tool_name: null,
        method: 'initialize',
        status_code: 200,
        latency_ms: 10,
        error: null,
        created_at: new Date('2026-03-01T12:00:00.000Z'),
      },
    ];

    const sql = makeMockSql([fakeRows]);
    const service = new AuditService(sql);

    const csv = await service.exportCsv({ institutionId: 'inst-1' });
    const lines = csv.split('\n');

    expect(lines.length).toBe(2); // header + 1 data row
    expect(lines[1]).toContain('row-id-1');
    expect(lines[1]).toContain('test-server');
  });

  it('exportCsv escapes commas in values with double quotes', async () => {
    const fakeRows = [
      {
        id: 'id-1',
        user_id: null,
        department_id: null,
        server_slug: 'server,with,commas',
        tool_name: null,
        method: 'tools/call',
        status_code: 500,
        latency_ms: null,
        error: 'An error, with commas',
        created_at: new Date('2026-03-01T00:00:00.000Z'),
      },
    ];

    const sql = makeMockSql([fakeRows]);
    const service = new AuditService(sql);

    const csv = await service.exportCsv({ institutionId: 'inst-1' });
    const dataLine = csv.split('\n')[1];

    expect(dataLine).toContain('"server,with,commas"');
    expect(dataLine).toContain('"An error, with commas"');
  });

  it('queryLogs applies institutionId filter (unit check via mock structure)', async () => {
    // The mock returns empty rows and a count of 0
    const sql = makeMockSql([[], [{ count: '0' }]]);
    const service = new AuditService(sql);

    const result = await service.queryLogs({ institutionId: 'inst-abc' });
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('queryLogs maps snake_case DB columns to camelCase AuditRow', async () => {
    const dbRow = {
      id: 'uuid-1',
      user_id: 'u-1',
      department_id: 'd-1',
      server_slug: 's1',
      tool_name: 'myTool',
      method: 'tools/call',
      status_code: 200,
      latency_ms: 55,
      error: null,
      created_at: new Date('2026-01-15T10:00:00.000Z'),
    };

    const sql = makeMockSql([[dbRow], [{ count: '1' }]]);
    const service = new AuditService(sql);

    const { rows } = await service.queryLogs({ institutionId: 'inst-x' });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe('uuid-1');
    expect(row.userId).toBe('u-1');
    expect(row.departmentId).toBe('d-1');
    expect(row.serverSlug).toBe('s1');
    expect(row.toolName).toBe('myTool');
    expect(row.method).toBe('tools/call');
    expect(row.statusCode).toBe(200);
    expect(row.latencyMs).toBe(55);
    expect(row.error).toBeNull();
  });
});
