import { describe, it, expect } from 'vitest';
import { BearerTokenCache } from '../src/credentials/bearer-token-cache.js';

describe('BearerTokenCache', () => {
  it('caches a minted bearer and returns it on hit', async () => {
    const cache = new BearerTokenCache();
    let mintCalls = 0;
    const mint = async () => {
      mintCalls += 1;
      return { token: 'tok-1', expiresAt: Date.now() + 3600_000 };
    };
    const a = await cache.getOrMint('k1', mint);
    const b = await cache.getOrMint('k1', mint);
    expect(a.token).toBe('tok-1');
    expect(b.token).toBe('tok-1');
    expect(mintCalls).toBe(1);
  });

  it('re-mints when cached bearer has less than the buffer remaining', async () => {
    const cache = new BearerTokenCache();
    let mintCalls = 0;
    // First mint expires in 10s; default buffer is 60s → next call must re-mint.
    const mint = async () => {
      mintCalls += 1;
      return { token: `tok-${mintCalls}`, expiresAt: Date.now() + 10_000 };
    };
    await cache.getOrMint('k1', mint);
    const b = await cache.getOrMint('k1', mint);
    expect(b.token).toBe('tok-2');
    expect(mintCalls).toBe(2);
  });

  it('coalesces concurrent first-miss requests: N concurrent = 1 mint call', async () => {
    const cache = new BearerTokenCache();
    let mintCalls = 0;
    const mint = async () => {
      mintCalls += 1;
      // Simulate slow vendor mint
      await new Promise((r) => setTimeout(r, 50));
      return { token: 'tok-shared', expiresAt: Date.now() + 3600_000 };
    };
    const results = await Promise.all(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => cache.getOrMint('k1', mint)),
    );
    expect(mintCalls).toBe(1);
    expect(results.every((r) => r.token === 'tok-shared')).toBe(true);
  });

  it('invalidate forces a fresh mint on next call', async () => {
    const cache = new BearerTokenCache();
    let mintCalls = 0;
    const mint = async () => {
      mintCalls += 1;
      return { token: `tok-${mintCalls}`, expiresAt: Date.now() + 3600_000 };
    };
    await cache.getOrMint('k1', mint);
    cache.invalidate('k1');
    const b = await cache.getOrMint('k1', mint);
    expect(b.token).toBe('tok-2');
    expect(mintCalls).toBe(2);
  });

  it('clear drops all cached entries', async () => {
    const cache = new BearerTokenCache();
    const mint = async () => ({ token: 't', expiresAt: Date.now() + 3600_000 });
    await cache.getOrMint('a', mint);
    await cache.getOrMint('b', mint);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('does not coalesce after the in-flight promise resolves', async () => {
    const cache = new BearerTokenCache();
    let mintCalls = 0;
    const mint = async () => {
      mintCalls += 1;
      return { token: `tok-${mintCalls}`, expiresAt: Date.now() + 10_000 };
    };
    // First mint (expires soon, but cache buffer puts us past the threshold);
    // wait, then call again — the SECOND call should see expired-by-buffer cache
    // and mint fresh, NOT receive a stale in-flight Promise.
    await cache.getOrMint('k1', mint);
    cache.invalidate('k1'); // simulate vendor-side rotation
    const b = await cache.getOrMint('k1', mint);
    expect(b.token).toBe('tok-2');
  });
});
