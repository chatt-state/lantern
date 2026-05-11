import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { resolveVendorHeaders } from '../src/proxy/resolve-vendor-headers.js';

// A no-op Sql stub. The tdx vendor entry has no buildHeaders hook, so this
// path never touches the DB. The m365 path is exercised separately with a
// per-test masterKey override + a stub for getM365Token via a fake Sql.
const stubSql = (() => ({})) as unknown as Sql;

describe('resolveVendorHeaders', () => {
  it('returns null for an unknown vendor slug', async () => {
    const result = await resolveVendorHeaders('user-1', 'nonexistent', {
      sql: stubSql,
      institutionId: 'inst-1',
    });
    expect(result).toBeNull();
  });

  it('returns standard gateway headers + container URL for tdx (no buildHeaders hook)', async () => {
    const result = await resolveVendorHeaders('user-1', 'tdx', {
      sql: stubSql,
      institutionId: 'inst-1',
    });
    expect(result).not.toBeNull();
    expect(result?.vendorSlug).toBe('tdx');
    expect(result?.mcpPath).toBe('/mcp');
    expect(result?.containerUrl).toBeTruthy();
    expect(result?.headers).toMatchObject({
      'X-Lantern-User-Id': 'user-1',
      'X-Lantern-Institution-Id': 'inst-1',
    });
  });

  it('m365 with empty masterKey returns standard headers only (no token leak attempt)', async () => {
    const result = await resolveVendorHeaders('user-1', 'm365', {
      sql: stubSql,
      institutionId: 'inst-1',
      masterKey: '',
    });
    expect(result).not.toBeNull();
    expect(result?.headers['X-Lantern-Access-Token']).toBeUndefined();
    expect(result?.headers['X-Lantern-User-Id']).toBe('user-1');
  });

  it('headers always include X-Lantern-User-Id and X-Lantern-Institution-Id', async () => {
    for (const slug of ['m365', 'tdx']) {
      const result = await resolveVendorHeaders('user-x', slug, {
        sql: stubSql,
        institutionId: 'inst-x',
        masterKey: '',
      });
      expect(result?.headers['X-Lantern-User-Id']).toBe('user-x');
      expect(result?.headers['X-Lantern-Institution-Id']).toBe('inst-x');
    }
  });
});
