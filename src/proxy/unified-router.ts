/**
 * Unified MCP endpoint — POST /v1/mcp aggregates every vendor the user has
 * access to behind a single JSON-RPC route. Tool names are prefixed
 * `{vendorSlug}__{toolName}` to namespace across vendors.
 *
 * Sits alongside the legacy per-vendor route (`/v1/:server/mcp`); both routes
 * are live during transition. Single-tenant simplifications preserved per
 * AUDIT-2026-05-11:
 *   - No BYOC credentials; vendor auth is server-config (see vendor-config.ts).
 *   - Tool allowlist scoping by institution + department (preserved verbatim).
 *   - No rate-limiting on /v1/* — matches legacy route behavior.
 *
 * Dispatched JSON-RPC methods:
 *   - `initialize` → gateway-local response (gateway IS the MCP server here)
 *   - `tools/list` → fan-out to all accessible vendors, prefix + filter, merge
 *   - `tools/call` → parse prefix, route to vendor, allowlist-check, proxy
 *   - `notifications/initialized` → no-op (client-to-server notification)
 *   - everything else → JSON-RPC method-not-found
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { requireBearerAuth, type TokenAuthResult } from '../rbac/token-auth.js';
import { UserService } from '../auth/user-service.js';
import { AllowlistService } from './allowlist-service.js';
import { logAuditEntry } from './audit.js';
import { listVendors, splitPrefixedToolName, prefixToolName, type VendorConfig } from './vendor-config.js';
import { resolveVendorHeaders } from './resolve-vendor-headers.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const GATEWAY_SERVER_INFO = {
  name: 'lantern-gateway',
  version: '1.0.0',
};

const PROTOCOL_VERSION = '2024-11-05';

const UPSTREAM_TIMEOUT_MS = 30_000;

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/**
 * Unwrap an upstream MCP response that may be either application/json or the
 * Streamable HTTP SSE framing (`event: message\ndata: {...}\n\n`).
 */
function parseUpstreamBody(text: string): unknown {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) return JSON.parse(dataLines[dataLines.length - 1]);
  }
  return JSON.parse(text);
}

async function callVendorMcp(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const bodyStr = JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await response.text();
  const data = text ? parseUpstreamBody(text) : null;
  return { status: response.status, data };
}

/**
 * Initialize an MCP session against an upstream and return its tools/list.
 * Used during tools/list aggregation. Honors the standard MCP handshake
 * (initialize → notifications/initialized → tools/list) so vendors that
 * enforce the lifecycle stay happy. Stateless vendors ignore the handshake.
 */
async function fetchVendorTools(
  vendorSlug: string,
  vendorUrl: string,
  baseHeaders: Record<string, string>,
): Promise<UpstreamTool[]> {
  try {
    const init = await callVendorMcp(vendorUrl, baseHeaders, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: GATEWAY_SERVER_INFO },
    });
    if (init.status >= 400) return [];

    // notifications/initialized is fire-and-forget; ignore failures.
    try {
      await callVendorMcp(vendorUrl, baseHeaders, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      });
    } catch {
      // fire-and-forget
    }

    const list = await callVendorMcp(vendorUrl, baseHeaders, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    if (list.status >= 400) return [];
    const tools = (list.data as { result?: { tools?: UpstreamTool[] } })?.result?.tools ?? [];
    return Array.isArray(tools) ? tools : [];
  } catch {
    return [];
  }
}

interface VendorAccessContext {
  vendor: VendorConfig;
  departmentId: string | null;
  allowedTools: Set<string>;
}

/**
 * For the authenticated user, return the vendors they can access plus the
 * department + allowlist that scopes each. Used by both tools/list aggregation
 * and tools/call routing.
 */
async function getAccessibleVendors(
  sql: Sql,
  userId: string,
  institutionId: string,
  allowlistService: AllowlistService,
): Promise<VendorAccessContext[]> {
  const result: VendorAccessContext[] = [];
  for (const vendor of listVendors()) {
    const hasAccess = await allowlistService.hasServerAccess(userId, institutionId, vendor.slug);
    if (!hasAccess) continue;
    const departmentId = await allowlistService.getUserDepartmentForServer(userId, vendor.slug);
    const allowedTools = departmentId
      ? await allowlistService.getAllowedTools(departmentId, vendor.slug)
      : new Set<string>();
    result.push({ vendor, departmentId, allowedTools });
  }
  return result;
}

interface UnifiedDeps {
  sql: Sql;
  allowlistService: AllowlistService;
  userService: UserService;
}

export function unifiedProxyRoutes(sql: Sql) {
  const allowlistService = new AllowlistService(sql);
  const userService = new UserService(sql);
  const deps: UnifiedDeps = { sql, allowlistService, userService };

  const bearerAuth = requireBearerAuth(sql);

  return async function (app: FastifyInstance) {
    // Bearer auth is wired as a route-level preHandler rather than a
    // plugin-level hook with URL early-return. Same auth boundary, but the
    // auth requirement is visibly colocated with each route's registration
    // (Fastify-native shape — boss observation A, PR #1 review).

    // GET /v1/mcp — SSE heartbeat for mcp-remote clients.
    app.get('/v1/mcp', { preHandler: bearerAuth }, async (request, reply) => {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.writeHead(200);
      reply.raw.write(':ok\n\n');
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(':heartbeat\n\n');
        else clearInterval(heartbeat);
      }, 30_000);
      request.raw.on('close', () => clearInterval(heartbeat));
    });

    // POST /v1/mcp — JSON-RPC dispatch.
    app.post('/v1/mcp', { preHandler: bearerAuth }, async (request, reply) => {
      const startTime = Date.now();
      const tokenAuth = (request as FastifyRequest & { tokenAuth?: TokenAuthResult }).tokenAuth;
      if (!tokenAuth) {
        return reply
          .status(401)
          .header('WWW-Authenticate', 'Bearer realm="Lantern", error="invalid_token"')
          .send({ error: 'invalid_token' });
      }

      const body = request.body as JsonRpcRequest | undefined;
      if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
        return reply.status(400).send(jsonRpcError(body?.id ?? null, -32600, 'Invalid Request'));
      }

      const user = await deps.userService.findById(tokenAuth.userId);
      if (!user) {
        return reply.status(401).send(jsonRpcError(body.id, -32001, 'User not found'));
      }
      const institutionId = user.institution_id;

      switch (body.method) {
        case 'initialize':
          return reply.send(
            jsonRpcResult(body.id, {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: GATEWAY_SERVER_INFO,
            }),
          );

        case 'notifications/initialized':
          // Client-to-server notification; no response body per JSON-RPC.
          return reply.status(204).send();

        case 'tools/list': {
          const accessible = await getAccessibleVendors(sql, user.id, institutionId, deps.allowlistService);
          const merged: UpstreamTool[] = [];
          for (const { vendor, allowedTools } of accessible) {
            const result = await resolveVendorHeaders(user.id, vendor.slug, {
              sql,
              institutionId,
            });
            // BYOC vendor without credentials, or unknown — silently skip in aggregation.
            // Per scope doc §2.7 two-stage gate: reauth/missing-creds surfaces on tools/call,
            // not as a fan-out failure on tools/list.
            if (!result.ok) continue;
            const { resolution } = result;
            const vendorUrl = `${resolution.containerUrl}${resolution.mcpPath}`;
            const tools = await fetchVendorTools(vendor.slug, vendorUrl, resolution.headers);
            for (const tool of tools) {
              if (allowedTools.size > 0 && !allowedTools.has(tool.name)) continue;
              merged.push({ ...tool, name: prefixToolName(vendor.slug, tool.name) });
            }
          }
          return reply.send(jsonRpcResult(body.id, { tools: merged }));
        }

        case 'tools/call': {
          const params = body.params as { name?: string; arguments?: unknown } | undefined;
          const prefixed = params?.name;
          if (!prefixed) {
            return reply.send(jsonRpcError(body.id, -32602, 'Missing tool name'));
          }
          const split = splitPrefixedToolName(prefixed);
          if (!split) {
            return reply.send(
              jsonRpcError(body.id, -32602, `Tool name must be prefixed with '<vendor>__': ${prefixed}`),
            );
          }
          const { vendorSlug, toolName } = split;

          const hasAccess = await deps.allowlistService.hasServerAccess(user.id, institutionId, vendorSlug);
          if (!hasAccess) {
            await logAuditEntry(sql, {
              institutionId,
              userId: user.id,
              serverSlug: vendorSlug,
              toolName,
              method: 'POST',
              statusCode: 403,
              latencyMs: Date.now() - startTime,
              error: 'server_access_denied',
            });
            return reply.send(jsonRpcError(body.id, -32000, `Server '${vendorSlug}' is not permitted for your account`));
          }
          const departmentId = await deps.allowlistService.getUserDepartmentForServer(user.id, vendorSlug);
          if (departmentId) {
            const allowed = await deps.allowlistService.isToolAllowed(departmentId, vendorSlug, toolName);
            if (!allowed) {
              await logAuditEntry(sql, {
                institutionId,
                userId: user.id,
                departmentId,
                serverSlug: vendorSlug,
                toolName,
                method: 'POST',
                statusCode: 403,
                latencyMs: Date.now() - startTime,
                error: 'tool_access_denied',
              });
              return reply.send(
                jsonRpcError(body.id, -32000, `Tool '${toolName}' is not permitted for your department`),
              );
            }
          }

          const result = await resolveVendorHeaders(user.id, vendorSlug, {
            sql,
            institutionId,
          });
          if (!result.ok && 'reason' in result) {
            return reply.send(jsonRpcError(body.id, -32601, `Unknown vendor: ${vendorSlug}`));
          }
          if (!result.ok && 'reauth' in result) {
            await logAuditEntry(sql, {
              institutionId,
              userId: user.id,
              departmentId: departmentId ?? undefined,
              serverSlug: vendorSlug,
              toolName,
              method: 'POST',
              statusCode: 401,
              latencyMs: Date.now() - startTime,
              error: 'reauth_required',
            });
            // Generic message — must not leak token/credential info per scope doc §4 step 7.
            return reply.send(
              jsonRpcError(body.id, -32000, `You need to connect ${vendorSlug} before using it`, {
                reauth_url: `/settings/connections/${vendorSlug}/connect`,
                missing_fields: result.missingFields,
              }),
            );
          }
          const { resolution } = result as { ok: true; resolution: { containerUrl: string; mcpPath: string; headers: Record<string, string> } };
          const vendorUrl = `${resolution.containerUrl}${resolution.mcpPath}`;

          // Forward the upstream call with the unprefixed tool name.
          let statusCode = 502;
          try {
            const upstream = await callVendorMcp(vendorUrl, resolution.headers, {
              jsonrpc: '2.0',
              id: body.id ?? null,
              method: 'tools/call',
              params: { name: toolName, arguments: params?.arguments ?? {} },
            });
            statusCode = upstream.status;
            await logAuditEntry(sql, {
              institutionId,
              userId: user.id,
              departmentId: departmentId ?? undefined,
              serverSlug: vendorSlug,
              toolName,
              method: 'POST',
              statusCode,
              latencyMs: Date.now() - startTime,
            });
            return reply.send(upstream.data);
          } catch (err) {
            const detail = err instanceof Error ? err.message : 'upstream_error';
            await logAuditEntry(sql, {
              institutionId,
              userId: user.id,
              departmentId: departmentId ?? undefined,
              serverSlug: vendorSlug,
              toolName,
              method: 'POST',
              statusCode: 502,
              latencyMs: Date.now() - startTime,
              error: detail,
            });
            return reply.status(502).send(jsonRpcError(body.id, -32000, 'Upstream vendor unreachable', detail));
          }
        }

        default:
          return reply.send(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
      }
    });
  };
}
