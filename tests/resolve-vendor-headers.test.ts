import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { resolveVendorHeaders, computeMissingFields } from '../src/proxy/resolve-vendor-headers.js';

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

describe('computeMissingFields (leak-vector pin)', () => {
  // Walter fold 2026-05-11: assert missingFields output contains field KEYS
  // not field VALUES. If this test fails after a future refactor, the
  // reauth-sentinel leak-vector guarantee is broken.
  const checkpointFields = [
    { key: 'authUrl', required: true },
    { key: 'clientId', required: true },
    { key: 'clientSecret', required: true },
  ];

  it('returns all required field keys when nothing is stored', () => {
    const missing = computeMissingFields(checkpointFields, null);
    expect(missing).toEqual(['authUrl', 'clientId', 'clientSecret']);
  });

  it('returns only the keys that are missing from stored creds', () => {
    const missing = computeMissingFields(checkpointFields, {
      authUrl: 'https://auth.example/api/keys/abc',
      clientId: 'cid-123',
    });
    expect(missing).toEqual(['clientSecret']);
  });

  it('treats empty-string field values as missing (not just undefined)', () => {
    const missing = computeMissingFields(checkpointFields, {
      authUrl: 'https://auth.example',
      clientId: '',
      clientSecret: 'abc',
    });
    expect(missing).toEqual(['clientId']);
  });

  it('NEVER returns credential values — only field keys (leak-vector invariant)', () => {
    const sensitiveStored = {
      authUrl: '',
      clientId: 'super-secret-id',
      clientSecret: 'super-secret-key',
    };
    const missing = computeMissingFields(checkpointFields, sensitiveStored);
    expect(missing).toEqual(['authUrl']);
    // Belt-and-suspenders: ensure no stored value escapes via missingFields.
    expect(missing).not.toContain('super-secret-id');
    expect(missing).not.toContain('super-secret-key');
    for (const entry of missing) {
      expect(checkpointFields.some((f) => f.key === entry)).toBe(true);
    }
  });

  it('skips non-required fields even when missing', () => {
    const fieldsWithOptional = [
      { key: 'authUrl', required: true },
      { key: 'optionalNote', required: false },
    ];
    const missing = computeMissingFields(fieldsWithOptional, null);
    expect(missing).toEqual(['authUrl']);
  });
});
