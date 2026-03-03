import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

describe('PKCE verification', () => {
  it('S256 challenge matches verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = createHash('sha256').update(verifier).digest('base64url');
    // This is the test vector from RFC 7636
    expect(expected).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
