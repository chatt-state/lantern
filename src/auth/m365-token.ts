import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Sql } from 'postgres';

const ALGORITHM = 'aes-256-gcm';

function encrypt(masterKey: string, userId: string, plaintext: string): { ciphertext: string; iv: string; tag: string } {
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

function decrypt(masterKey: string, userId: string, ciphertext: string, iv: string, tag: string): string {
  const key = scryptSync(masterKey, userId, 32);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(Buffer.from(ciphertext, 'hex')) + decipher.final('utf8');
}

export async function storeM365Token(
  sql: Sql,
  masterKey: string,
  opts: { userId: string; accessToken: string; refreshToken?: string; expiresAt: Date },
): Promise<void> {
  // Encrypt access token + expiry as JSON
  const accessPayload = JSON.stringify({ access_token: opts.accessToken, expires_at: opts.expiresAt.toISOString() });
  const { ciphertext, iv, tag } = encrypt(masterKey, opts.userId, accessPayload);

  // Encrypt refresh token separately
  let refreshData: string | null = null;
  if (opts.refreshToken) {
    const refreshEnc = encrypt(masterKey, opts.userId, opts.refreshToken);
    refreshData = JSON.stringify(refreshEnc);
  }

  await sql`
    INSERT INTO user_credentials (user_id, server_slug, ciphertext, iv, tag, refresh_data, expires_at)
    VALUES (${opts.userId}, 'm365', ${ciphertext}, ${iv}, ${tag}, ${refreshData}, ${opts.expiresAt})
    ON CONFLICT (user_id, server_slug) DO UPDATE
    SET ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        tag = EXCLUDED.tag,
        refresh_data = EXCLUDED.refresh_data,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
  `;
}

export async function getM365Token(sql: Sql, masterKey: string, userId: string): Promise<string | null> {
  const [row] = await sql<{ ciphertext: string; iv: string; tag: string; refresh_data: string | null; expires_at: Date | null }[]>`
    SELECT ciphertext, iv, tag, refresh_data, expires_at
    FROM user_credentials
    WHERE user_id = ${userId} AND server_slug = 'm365'
  `;
  if (!row) return null;

  // Check if token needs refresh (expires within 5 minutes)
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (row.expires_at && row.expires_at < fiveMinFromNow && row.refresh_data) {
    try {
      return await refreshM365Token(sql, masterKey, userId, row);
    } catch {
      // Fall through to use current token if refresh fails
    }
  }

  // Decrypt and return current access token
  try {
    const payload = JSON.parse(decrypt(masterKey, userId, row.ciphertext, row.iv, row.tag));
    return payload.access_token as string;
  } catch {
    return null;
  }
}

async function refreshM365Token(
  sql: Sql,
  masterKey: string,
  userId: string,
  row: { refresh_data: string | null },
): Promise<string> {
  if (!row.refresh_data) throw new Error('No refresh token available');

  // Decrypt refresh token
  const refreshEnc = JSON.parse(row.refresh_data) as { ciphertext: string; iv: string; tag: string };
  const refreshToken = decrypt(masterKey, userId, refreshEnc.ciphertext, refreshEnc.iv, refreshEnc.tag);

  // Use openid-client to refresh
  const { getAzureClient } = await import('./azure.js');
  const client = await getAzureClient();
  const tokenSet = await client.refresh(refreshToken);

  if (!tokenSet.access_token) throw new Error('Refresh returned no access token');

  const expiresAt = new Date(Date.now() + (tokenSet.expires_in ?? 3600) * 1000);

  await storeM365Token(sql, masterKey, {
    userId,
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token ?? refreshToken, // keep old refresh token if not rotated
    expiresAt,
  });

  return tokenSet.access_token;
}
