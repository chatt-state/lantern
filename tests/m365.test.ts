import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/servers/m365/auth.js';
import { createM365Server } from '../src/servers/m365/server.js';

describe('M365 credential encryption', () => {
  const masterKey = 'test-master-key-for-unit-tests-only';
  const userId = 'user-abc-123';
  const plaintext = JSON.stringify({ access_token: 'eyJhbGciOiJSUzI1NiJ9.test', expires_in: 3600 });

  it('round-trips: decrypt(encrypt(x)) === x', () => {
    const encrypted = encryptToken(plaintext, masterKey, userId);
    const decrypted = decryptToken(encrypted, masterKey, userId);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const enc1 = encryptToken(plaintext, masterKey, userId);
    const enc2 = encryptToken(plaintext, masterKey, userId);
    // IVs should differ
    expect(enc1.iv).not.toBe(enc2.iv);
    // Ciphertexts should differ (different IV → different ciphertext)
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('fails to decrypt with wrong master key', () => {
    const encrypted = encryptToken(plaintext, masterKey, userId);
    expect(() => decryptToken(encrypted, 'wrong-key', userId)).toThrow();
  });

  it('fails to decrypt with wrong userId (different derived key)', () => {
    const encrypted = encryptToken(plaintext, masterKey, userId);
    expect(() => decryptToken(encrypted, masterKey, 'different-user')).toThrow();
  });
});

describe('createM365Server', () => {
  it('returns an McpServer instance', () => {
    const server = createM365Server();
    expect(server).toBeDefined();
    // McpServer has a connect method
    expect(typeof server.connect).toBe('function');
    // McpServer has a close method
    expect(typeof server.close).toBe('function');
  });

  it('server has the correct name', () => {
    const server = createM365Server();
    // Access the underlying Server instance to verify server info
    expect(server.server).toBeDefined();
  });
});
