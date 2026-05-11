import { describe, it, expect } from 'vitest';
import { getVendor } from '../src/proxy/vendor-config.js';
import { _cacheKeyFor } from '../src/credentials/get-bearer-token.js';

describe('checkpoint-official VendorConfig entry', () => {
  it('is registered in VENDORS', () => {
    const v = getVendor('checkpoint-official');
    expect(v).not.toBeNull();
  });

  it('uses the vendor-hosted MCP URL (no sidecar)', () => {
    const v = getVendor('checkpoint-official')!;
    expect(v.containerUrl).toBe('https://cloudinfra-gw.portal.checkpoint.com');
    expect(v.mcpPath).toBeUndefined(); // defaults to /mcp via resolveVendorHeaders
  });

  it('declares oauthConfig with the three required field keys', () => {
    const v = getVendor('checkpoint-official')!;
    expect(v.oauthConfig).toBeDefined();
    expect(v.oauthConfig!.authUrlField).toBe('authUrl');
    expect(v.oauthConfig!.clientIdField).toBe('clientId');
    expect(v.oauthConfig!.clientSecretField).toBe('clientSecret');
    expect(v.oauthConfig!.bearerHeader).toBe('Authorization');
  });

  it('declares fields[] matching the oauthConfig keys, with clientSecret marked secret', () => {
    const v = getVendor('checkpoint-official')!;
    expect(v.fields).toBeDefined();
    const byKey = new Map(v.fields!.map((f) => [f.key, f]));
    expect(byKey.has('authUrl')).toBe(true);
    expect(byKey.has('clientId')).toBe(true);
    expect(byKey.has('clientSecret')).toBe(true);
    expect(byKey.get('clientSecret')!.secret).toBe(true);
    // All three required.
    expect(v.fields!.every((f) => f.required)).toBe(true);
  });

  it('has no buildHeaders hook (OAuth path handles header injection)', () => {
    const v = getVendor('checkpoint-official')!;
    expect(v.buildHeaders).toBeUndefined();
  });
});

describe('bearer-token cache key', () => {
  it('is deterministic for the same vendor + user + creds', () => {
    const a = _cacheKeyFor('vendor', 'user', { authUrl: 'u', clientId: 'c', clientSecret: 's' });
    const b = _cacheKeyFor('vendor', 'user', { authUrl: 'u', clientId: 'c', clientSecret: 's' });
    expect(a).toBe(b);
  });

  it('changes when credentials change (rotation invalidates cache implicitly)', () => {
    const a = _cacheKeyFor('vendor', 'user', { authUrl: 'u', clientId: 'c', clientSecret: 's1' });
    const b = _cacheKeyFor('vendor', 'user', { authUrl: 'u', clientId: 'c', clientSecret: 's2' });
    expect(a).not.toBe(b);
  });

  it('is independent across users (no cross-user cache collision)', () => {
    const a = _cacheKeyFor('vendor', 'user-a', { x: 'y' });
    const b = _cacheKeyFor('vendor', 'user-b', { x: 'y' });
    expect(a).not.toBe(b);
  });

  it('is independent across vendors', () => {
    const a = _cacheKeyFor('vendor-a', 'user', { x: 'y' });
    const b = _cacheKeyFor('vendor-b', 'user', { x: 'y' });
    expect(a).not.toBe(b);
  });
});
