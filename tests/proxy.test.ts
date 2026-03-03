import { describe, it, expect } from 'vitest';
import { ToolCache } from '../src/proxy/tool-cache.js';
import { getServer, listServers } from '../src/proxy/server-registry.js';

describe('server registry', () => {
  it('returns null for unknown server', () => {
    expect(getServer('nonexistent')).toBeNull();
  });

  it('returns m365 server', () => {
    const server = getServer('m365');
    expect(server).not.toBeNull();
    expect(server?.slug).toBe('m365');
    expect(server?.displayName).toBe('Microsoft 365');
  });

  it('lists at least one server', () => {
    expect(listServers().length).toBeGreaterThan(0);
  });
});

describe('ToolCache', () => {
  it('returns empty array when server is unreachable', async () => {
    const cache = new ToolCache();
    const tools = await cache.getTools('test', 'http://localhost:19999'); // nothing listening
    expect(Array.isArray(tools)).toBe(true);
    // Should return [] gracefully, not throw
  });
});
