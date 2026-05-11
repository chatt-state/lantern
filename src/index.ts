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
import { metadataRoutes } from './oauth/metadata.js';
import { oauthRoutes } from './oauth/routes.js';
import { proxyRoutes } from './proxy/router.js';
import { unifiedProxyRoutes } from './proxy/unified-router.js';
import { connectionsRoutes } from './connections/routes.js';
import { webRoutes } from './web/routes.js';
import { auditRoutes } from './audit/routes.js';
import { adminRoutes } from './admin/routes.js';
import { departmentRoutes } from './department/routes.js';
import { superadminRoutes } from './superadmin/routes.js';
import { scimRoutes } from './scim/routes.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.logLevel === 'debug'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  ignoreTrailingSlash: true,
});

// Azure AD SCIM sends Content-Type: application/scim+json — register before plugins
app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, JSON.parse(body as string));
  } catch (err: unknown) {
    done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
  }
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

// Web UI — dashboard and navigation
await app.register(webRoutes(sql));

// OAuth 2.1 + PKCE server (RFC 8414 metadata + RFC 7591 registration + token endpoints)
await app.register(metadataRoutes());
await app.register(oauthRoutes(sql));

// Audit log viewer and CSV export — institution admins only
await app.register(auditRoutes(sql));

// Institution admin panel — departments, members, servers, group mappings
await app.register(adminRoutes(sql));

// Department admin panel — member management, tool allowlists, dept audit log
await app.register(departmentRoutes(sql));

// Superadmin panel — multi-tenant management (SUPERADMIN_EMAILS)
await app.register(superadminRoutes(sql));

// SCIM 2.0 provisioning bridge — Azure AD → departments/users
await app.register(scimRoutes(sql));

// MCP proxy (legacy per-vendor) — authenticated, sits at /v1/:server/mcp
await app.register(proxyRoutes(sql));

// MCP proxy (unified) — authenticated, sits at /v1/mcp; aggregates all vendors.
// See src/proxy/unified-router.ts and AUDIT-2026-05-11 for the port rationale.
await app.register(unifiedProxyRoutes(sql));

// Per-user vendor credential entry routes for BYOC vendors (oauthConfig set).
// See src/connections/routes.ts and scope doc 2026-05-11-checkpoint-byoc-extension-scope.md.
await app.register(connectionsRoutes(sql));

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
