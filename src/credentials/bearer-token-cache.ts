/**
 * In-process bearer-token cache for vendors that use OAuth 2.0
 * client_credentials grant (vendors with `oauthConfig` set in vendor-config.ts).
 *
 * Single-instance scope per scope doc §2.6 decision point (iii):
 *   - Cache survives only while the gateway process is running.
 *   - If lantern horizontally scales, migrate to a DB-backed cache via the
 *     user_credentials.expires_at column.
 *
 * Promise-coalescing per scope doc §4 step 5 (boss sharpener):
 *   - If a mint is already in flight for a given cache key, return the existing
 *     Promise rather than start a second POST to the vendor's Auth URL.
 *   - N concurrent first-requests-after-miss = 1 vendor-side handshake, not N.
 */

export interface CachedBearer {
  token: string;
  expiresAt: number; // epoch ms
}

interface PendingMint {
  promise: Promise<CachedBearer>;
}

export class BearerTokenCache {
  private readonly cache = new Map<string, CachedBearer>();
  private readonly pending = new Map<string, PendingMint>();

  /**
   * TTL safety buffer — return cache miss if the cached token has less than
   * `bufferSeconds` of life remaining. Forces a refresh slightly before
   * expiry so requests in-flight at expiry-time don't see 401s.
   */
  private readonly defaultBufferSeconds = 60;

  /**
   * Get a cached bearer or mint a new one. `key` MUST uniquely identify the
   * credential set (e.g. `<vendorSlug>:<userId>:<credHash>`). The `mint`
   * callback performs the actual fetch — it is invoked at most once per key
   * per in-flight period.
   */
  async getOrMint(
    key: string,
    mint: () => Promise<CachedBearer>,
    bufferSeconds = this.defaultBufferSeconds,
  ): Promise<CachedBearer> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - now > bufferSeconds * 1000) {
      return cached;
    }

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight.promise;

    const promise = (async () => {
      try {
        const bearer = await mint();
        this.cache.set(key, bearer);
        return bearer;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, { promise });
    return promise;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  /** For tests. */
  size(): number {
    return this.cache.size;
  }
}

// Shared instance for the unified router. One per gateway process.
export const sharedBearerTokenCache = new BearerTokenCache();
