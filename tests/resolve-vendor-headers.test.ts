import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { resolveVendorHeaders } from '../src/proxy/resolve-vendor-headers.js';

// A no-op Sql stub. The tdx vendor entry has no buildHeaders hook, so this
// path never touches the DB. The m365 path is exercised with empty masterKey
// so getM365Token returns null without DB access.
const stubSql = (() => ({})) as unknown as Sql;

describe('resolveVendorHeaders', () => {
  it('returns unknown_vendor discriminant for an unknown vendor slug', async () => {
    const result = await resolveVendorHeaders('user-1', 'nonexistent', {
      sql: stubSql,
      institutionId: 'inst-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && 'reason' in result) {
      expect(result.reason).toBe('unknown_vendor');
      expect(result.vendorSlug).toBe('nonexistent');
    }
  });

  it('returns standard gateway headers + container URL for tdx (no buildHeaders hook)', async () => {
    const result = await resolveVendorHeaders('user-1', 'tdx', {
      sql: stubSql,
      institutionId: 'inst-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolution.vendorSlug).toBe('tdx');
      expect(result.resolution.mcpPath).toBe('/mcp');
      expect(result.resolution.containerUrl).toBeTruthy();
      expect(result.resolution.headers).toMatchObject({
        'X-Lantern-User-Id': 'user-1',
        'X-Lantern-Institution-Id': 'inst-1',
      });
    }
  });

  it('m365 with empty masterKey returns standard headers only (no token leak attempt)', async () => {
    const result = await resolveVendorHeaders('user-1', 'm365', {
      sql: stubSql,
      institutionId: 'inst-1',
      masterKey: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolution.headers['X-Lantern-Access-Token']).toBeUndefined();
      expect(result.resolution.headers['X-Lantern-User-Id']).toBe('user-1');
    }
  });

  it('headers always include X-Lantern-User-Id and X-Lantern-Institution-Id', async () => {
    for (const slug of ['m365', 'tdx']) {
      const result = await resolveVendorHeaders('user-x', slug, {
        sql: stubSql,
        institutionId: 'inst-x',
        masterKey: '',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolution.headers['X-Lantern-User-Id']).toBe('user-x');
        expect(result.resolution.headers['X-Lantern-Institution-Id']).toBe('inst-x');
      }
    }
  });
});
