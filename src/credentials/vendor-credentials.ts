/**
 * Per-user encrypted credential storage for BYOC vendors (vendors with
 * `oauthConfig` set in vendor-config.ts).
 *
 * Reuses the `user_credentials` table that already powers M365 delegated
 * tokens. Payload shape is opaque JSON (confirmed at migration
 * 001_core_schema.cjs:99 — column comment "JSON blob, AES-256-GCM encrypted").
 * For BYOC vendors the JSON payload is `{<fieldKey>: <fieldValue>, ...}`
 * matching VendorConfig.fields[].
 *
 * `refresh_data` and `expires_at` columns stay NULL for BYOC vendors —
 * Check Point's OAuth client_credentials grant has no refresh token, and the
 * credential lifetime is "until user disconnects." Bearer-token TTL is
 * handled separately by BearerTokenCache, not by these columns.
 *
 * Encryption matches the existing m365-token.ts pattern: AES-256-GCM with
 * `scryptSync(masterKey, userId, 32)` key derivation. MASTER_KEY remains the
 * single-deployment encryption key per the audit-locked baseline (see
 * scope doc §3 PRESERVED list).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Sql } from 'postgres';

const ALGORITHM = 'aes-256-gcm';

function encrypt(
  masterKey: string,
  userId: string,
  plaintext: string,
): { ciphertext: string; iv: string; tag: string } {
  const key = scryptSync(masterKey, userId, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decrypt(
  masterKey: string,
  userId: string,
  ciphertext: string,
  iv: string,
  tag: string,
): string {
  const key = scryptSync(masterKey, userId, 32);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(Buffer.from(ciphertext, 'hex')) + decipher.final('utf8');
}

/**
 * Store (insert-or-update) per-user vendor credentials. `creds` is a plain
 * object of field-key → field-value matching the vendor's `fields[]` schema.
 * The whole object is JSON-stringified, encrypted, and written.
 */
export async function storeVendorCredentials(
  sql: Sql,
  masterKey: string,
  opts: { userId: string; vendorSlug: string; creds: Record<string, string> },
): Promise<void> {
  const payload = JSON.stringify(opts.creds);
  const { ciphertext, iv, tag } = encrypt(masterKey, opts.userId, payload);
  await sql`
    INSERT INTO user_credentials (user_id, server_slug, ciphertext, iv, tag, refresh_data, expires_at)
    VALUES (${opts.userId}, ${opts.vendorSlug}, ${ciphertext}, ${iv}, ${tag}, NULL, NULL)
    ON CONFLICT (user_id, server_slug) DO UPDATE
    SET ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        tag = EXCLUDED.tag,
        refresh_data = NULL,
        expires_at = NULL,
        updated_at = NOW()
  `;
}

/**
 * Load + decrypt per-user vendor credentials. Returns null if not present.
 */
export async function loadVendorCredentials(
  sql: Sql,
  masterKey: string,
  opts: { userId: string; vendorSlug: string },
): Promise<Record<string, string> | null> {
  const [row] = await sql<{ ciphertext: string; iv: string; tag: string }[]>`
    SELECT ciphertext, iv, tag
    FROM user_credentials
    WHERE user_id = ${opts.userId} AND server_slug = ${opts.vendorSlug}
  `;
  if (!row) return null;
  try {
    const plaintext = decrypt(masterKey, opts.userId, row.ciphertext, row.iv, row.tag);
    const parsed = JSON.parse(plaintext);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    // Corrupted ciphertext or wrong master key — treat as missing rather than throw.
    return null;
  }
}

/**
 * Delete per-user vendor credentials. Returns true if a row was removed.
 */
export async function deleteVendorCredentials(
  sql: Sql,
  opts: { userId: string; vendorSlug: string },
): Promise<boolean> {
  const result = await sql`
    DELETE FROM user_credentials
    WHERE user_id = ${opts.userId} AND server_slug = ${opts.vendorSlug}
  `;
  return result.count > 0;
}

/**
 * Cheap presence check. Use to gate hasCredentials (the second stage of the
 * two-stage gate per scope doc §2.7) without loading + decrypting.
 */
export async function hasVendorCredentials(
  sql: Sql,
  opts: { userId: string; vendorSlug: string },
): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM user_credentials
    WHERE user_id = ${opts.userId} AND server_slug = ${opts.vendorSlug}
    LIMIT 1
  `;
  return row != null;
}
