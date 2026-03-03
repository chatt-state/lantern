/**
 * Lantern — MCP Gateway for Higher Education
 * Main entry point: starts Fastify server and registers all routes/plugins.
 */

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { authRoutes } from './auth/routes.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.logLevel === 'debug'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

await app.register(formbody);
await app.register(cookie, { secret: config.jwtSecret || 'dev-secret-change-me' });
await app.register(cors, { origin: [config.baseUrl, 'http://localhost:8080'] });
await app.register(rateLimit, { global: false });

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const sql = getDb(config.databaseUrl);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Auth routes (login, callback, logout)
await app.register(authRoutes(sql));

// Health check — unauthenticated
app.get('/health', async () => {
  let dbOk = false;
  try {
    await sql`SELECT 1`;
    dbOk = true;
  } catch {
    // db unreachable — still return 200 with db: false
  }
  return {
    status: 'ok',
    db: dbOk,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? 'unknown',
  };
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async () => {
  app.log.info('Shutting down...');
  await app.close();
  await closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Lantern listening on ${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
