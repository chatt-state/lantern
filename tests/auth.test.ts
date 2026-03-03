import { describe, it, expect } from 'vitest';
import { generateAuthParams } from '../src/auth/azure.js';

describe('auth utils', () => {
  it('generateAuthParams returns required fields', () => {
    const params = generateAuthParams();
    expect(params).toHaveProperty('state');
    expect(params).toHaveProperty('nonce');
    expect(params).toHaveProperty('codeVerifier');
    expect(params).toHaveProperty('codeChallenge');
    expect(params.state.length).toBeGreaterThan(0);
    expect(params.codeVerifier.length).toBeGreaterThan(0);
    expect(params.codeChallenge.length).toBeGreaterThan(0);
    // state and nonce should be different each call
    const params2 = generateAuthParams();
    expect(params.state).not.toBe(params2.state);
  });
});
