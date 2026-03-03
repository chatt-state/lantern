/**
 * Credential encryption utilities for M365 server.
 * Stores/retrieves encrypted user tokens in the database using AES-256-GCM.
 *
 * Note: The M365 server receives delegated access tokens via the
 * X-Lantern-Access-Token header injected by the gateway proxy.
 * These utilities handle persisting tokens for future use.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Derive a 32-byte AES key from the master key, scoped to a specific user. */
function deriveKey(masterKey: string, userId: string): Buffer {
  return scryptSync(masterKey, userId, 32);
}

export interface EncryptedToken {
  iv: string;       // hex
  tag: string;      // hex
  ciphertext: string; // hex
}

/** Encrypts a token payload using AES-256-GCM. */
export function encryptToken(plaintext: string, masterKey: string, userId: string): EncryptedToken {
  const key = deriveKey(masterKey, userId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

/** Decrypts an AES-256-GCM encrypted token payload. */
export function decryptToken(
  encrypted: EncryptedToken,
  masterKey: string,
  userId: string,
): string {
  const key = deriveKey(masterKey, userId);
  const iv = Buffer.from(encrypted.iv, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}
