import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../src/db/index.js';

describe('db module', () => {
  afterEach(async () => {
    // reset singleton so each test starts clean
    await closeDb();
  });

  it('throws if DATABASE_URL is not set', () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => getDb()).toThrow('DATABASE_URL is not set');
    process.env.DATABASE_URL = original;
  });
});
