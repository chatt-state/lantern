import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';

describe('config', () => {
  it('exports expected shape', () => {
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('baseUrl');
    expect(config).toHaveProperty('databaseUrl');
    expect(config).toHaveProperty('logLevel');
    expect(config).toHaveProperty('multiTenant');
    expect(config).toHaveProperty('azureTenantId');
    expect(typeof config.port).toBe('number');
    expect(typeof config.multiTenant).toBe('boolean');
  });
});
