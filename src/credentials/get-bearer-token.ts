/**
 * Mint an OAuth 2.0 client_credentials Bearer token for a BYOC vendor and
 * cache it via `BearerTokenCache` (with promise-coalescing).
 *
 * Vendor's Auth URL contract (Check Point Infinity Portal, verified
 * 2026-05-11): POST a JSON body `{clientId, accessKey}` (Check Point's field
 * naming; we map from generic `clientIdField`/`clientSecretField` →
 * `clientId`/`accessKey`) and receive a JSON response containing the
 * `success`, `data.token`, `data.expiresIn` (seconds).
 *
 * If/when a future BYOC vendor uses a different request body shape or response
 * format, lift the per-vendor variation into the `OAuthClientCredsConfig`
 * interface (e.g. `bodyFormat: 'json-checkpoint' | 'form-urlencoded'`) and
 * branch here. For v1, only Check Point is on this path.
 */
import type { OAuthClientCredsConfig } from '../proxy/vendor-config.js';
import { sharedBearerTokenCache, type CachedBearer } from './bearer-token-cache.js';
import { createHash } from 'node:crypto';

const MINT_TIMEOUT_MS = 15_000;
// 1 hour fallback when the vendor doesn't return a usable expiresIn.
const DEFAULT_TTL_SECONDS = 3600;

interface CheckpointAuthResponse {
  success?: boolean;
  data?: {
    token?: string;
    expiresIn?: number;
    csrf?: string;
  };
  message?: string;
}

function cacheKeyFor(vendorSlug: string, userId: string, creds: Record<string, string>): string {
  // Hash the credential payload so credential rotation in-place invalidates
  // the cache key naturally. Use SHA-256 over a deterministic JSON sort.
  const sorted = Object.keys(creds).sort();
  const blob = JSON.stringify(sorted.map((k) => [k, creds[k]]));
  const hash = createHash('sha256').update(blob).digest('hex').slice(0, 16);
  return `${vendorSlug}:${userId}:${hash}`;
}

export async function getBearerToken(params: {
  vendorSlug: string;
  userId: string;
  creds: Record<string, string>;
  oauthConfig: OAuthClientCredsConfig;
}): Promise<CachedBearer> {
  const { vendorSlug, userId, creds, oauthConfig } = params;
  const authUrl = creds[oauthConfig.authUrlField];
  const clientId = creds[oauthConfig.clientIdField];
  const clientSecret = creds[oauthConfig.clientSecretField];
  if (!authUrl || !clientId || !clientSecret) {
    throw new Error('Missing required credential fields for OAuth mint');
  }

  const key = cacheKeyFor(vendorSlug, userId, creds);
  return sharedBearerTokenCache.getOrMint(
    key,
    async () => mintCheckpoint(authUrl, clientId, clientSecret),
    oauthConfig.refreshBufferSeconds,
  );
}

async function mintCheckpoint(
  authUrl: string,
  clientId: string,
  accessKey: string,
): Promise<CachedBearer> {
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, accessKey }),
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OAuth mint failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  const body = (await response.json()) as CheckpointAuthResponse;
  if (body.success === false || !body.data?.token) {
    throw new Error(`OAuth mint failed: ${body.message ?? 'no token in response'}`);
  }
  const ttlSeconds = body.data.expiresIn && body.data.expiresIn > 0 ? body.data.expiresIn : DEFAULT_TTL_SECONDS;
  return {
    token: body.data.token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

/** For tests. */
export function _cacheKeyFor(vendorSlug: string, userId: string, creds: Record<string, string>): string {
  return cacheKeyFor(vendorSlug, userId, creds);
}
