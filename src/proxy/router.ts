/**
 * MCP Proxy Router — ALL /v1/:server/mcp
 *
 * Validates the Bearer token, checks server + tool access, forwards the
 * request to the upstream MCP container, and logs everything to audit_log.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireBearerAuth } from '../rbac/token-auth.js';
import { UserService } from '../auth/user-service.js';
import { AllowlistService } from './allowlist-service.js';
import { ToolCache } from './tool-cache.js';
import { logAuditEntry } from './audit.js';
import { getServer } from './server-registry.js';

export function proxyRoutes(sql: Sql) {
  const toolCache = new ToolCache();
  const allowlistService = new AllowlistService(sql);
  const userService = new UserService(sql);

  return async function (app: FastifyInstance) {
    // Apply Bearer auth to all /v1/* routes
    app.addHook('preHandler', requireBearerAuth(sql));

    // Handle ALL methods on /v1/:server/mcp
    app.all<{ Params: { server: string } }>('/v1/:server/mcp', async (request, reply) => {
      const startTime = Date.now();
      const { server: serverSlug } = request.params;
      const tokenAuth = request.tokenAuth!;

      // Look up the server
      const mcpServer = getServer(serverSlug);
      if (!mcpServer) {
        return reply.status(404).send({ error: 'unknown_server', server: serverSlug });
      }

      // Look up the user to get their institution
      const user = await userService.findById(tokenAuth.userId);
      if (!user) {
        return reply.status(401).send({ error: 'invalid_token', detail: 'User not found' });
      }

      // Check server access
      const hasAccess = await allowlistService.hasServerAccess(user.id, user.institution_id, serverSlug);
      if (!hasAccess) {
        await logAuditEntry(sql, {
          institutionId: user.institution_id,
          userId: user.id,
          serverSlug,
          method: request.method,
          statusCode: 403,
          latencyMs: Date.now() - startTime,
          error: 'server_access_denied',
        });
        return reply.status(403).send({ error: 'server_access_denied' });
      }

      const departmentId =
        (await allowlistService.getUserDepartmentForServer(user.id, serverSlug)) ?? undefined;

      // For tools/call — check tool allowlist before forwarding
      let toolName: string | undefined;
      if (request.method === 'POST') {
        try {
          const body = request.body as any;
          if (body?.method === 'tools/call' && body?.params?.name) {
            toolName = body.params.name as string;
            if (departmentId) {
              const allowed = await allowlistService.isToolAllowed(departmentId, serverSlug, toolName);
              if (!allowed) {
                await logAuditEntry(sql, {
                  institutionId: user.institution_id,
                  userId: user.id,
                  departmentId,
                  serverSlug,
                  toolName,
                  method: request.method,
                  statusCode: 403,
                  latencyMs: Date.now() - startTime,
                  error: 'tool_access_denied',
                });
                return reply.status(403).send({
                  jsonrpc: '2.0',
                  id: (body as any).id,
                  error: { code: -32600, message: `Tool '${toolName}' is not permitted for your department` },
                });
              }
            }
          }
        } catch {
          // Body parsing failed — let the upstream handle it
        }
      }

      // Forward to upstream MCP server
      const upstreamUrl = `${mcpServer.upstreamUrl}/mcp`;

      // Build forwarded headers (strip hop-by-hop and sensitive headers, add forwarding headers)
      const forwardHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        const lower = key.toLowerCase();
        if (['host', 'connection', 'authorization', 'content-length'].includes(lower)) continue;
        if (value) forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      forwardHeaders['X-Forwarded-For'] = request.ip;
      forwardHeaders['X-Lantern-User-Id'] = user.id;
      forwardHeaders['X-Lantern-Institution-Id'] = user.institution_id;

      let statusCode = 502;
      let upstreamError: string | undefined;

      try {
        const bodyStr = request.body ? JSON.stringify(request.body) : undefined;
        if (bodyStr) forwardHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();

        const upstreamResponse = await fetch(upstreamUrl, {
          method: request.method,
          headers: forwardHeaders,
          body: bodyStr,
          signal: AbortSignal.timeout(30_000), // 30s timeout
        });

        statusCode = upstreamResponse.status;

        // Stream response headers back
        for (const [key, value] of upstreamResponse.headers.entries()) {
          const lower = key.toLowerCase();
          if (['connection', 'transfer-encoding'].includes(lower)) continue;
          reply.header(key, value);
        }

        reply.status(statusCode);

        // Read response body
        const responseBody = await upstreamResponse.text();

        // For tools/list — filter response to show only allowed tools
        if (request.method === 'POST' && departmentId) {
          try {
            const parsed = JSON.parse(responseBody);
            if (parsed?.result?.tools) {
              const allowed = await allowlistService.getAllowedTools(departmentId, serverSlug);
              if (allowed.size > 0) {
                parsed.result.tools = (parsed.result.tools as any[]).filter((t) => allowed.has(t.name));
                const filtered = JSON.stringify(parsed);
                await logAuditEntry(sql, {
                  institutionId: user.institution_id,
                  userId: user.id,
                  departmentId,
                  serverSlug,
                  toolName,
                  method: request.method,
                  statusCode,
                  latencyMs: Date.now() - startTime,
                });
                return reply.send(filtered);
              }
            }
          } catch {
            // Not JSON or no tools key — return as-is
          }
        }

        await logAuditEntry(sql, {
          institutionId: user.institution_id,
          userId: user.id,
          departmentId,
          serverSlug,
          toolName,
          method: request.method,
          statusCode,
          latencyMs: Date.now() - startTime,
        });

        return reply.send(responseBody);
      } catch (err) {
        upstreamError = err instanceof Error ? err.message : 'upstream_error';
        statusCode = 502;

        await logAuditEntry(sql, {
          institutionId: user.institution_id,
          userId: user.id,
          departmentId,
          serverSlug,
          toolName,
          method: request.method,
          statusCode,
          latencyMs: Date.now() - startTime,
          error: upstreamError,
        });

        return reply.status(502).send({ error: 'upstream_error', detail: upstreamError });
      }
    });
  };
}
