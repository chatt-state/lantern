/**
 * Vendor configuration table — single source of truth for the unified /v1/mcp endpoint.
 *
 * This is lantern's port of mcp-gateway's `VENDORS` pattern, reshaped for the
 * single-tenant higher-ed domain:
 *   - No BYOC credentials (vendor auth is server config, not per-user vault).
 *   - No OAuth-per-vendor flow (Azure SSO covers user auth at the gateway edge).
 *   - No `validate` / `fields` UI hooks (no BYOC entry surface).
 *   - No billing / categorization metadata (no multi-org commerce).
 *
 * Adding a vendor:
 *   1. Add an entry to `VENDORS` below with `slug`, `displayName`, `containerUrl`.
 *   2. Add `config.serverUrls.<slug>` in `src/config.ts` from a new `SERVER_URL_<SLUG>` env var.
 *   3. (Optional) Add a per-vendor `buildHeaders` hook for vendor-specific header injection
 *      (e.g. M365 per-user delegated token).
 *
 * The legacy per-vendor route (`/v1/:server/mcp`) consults its own `server-registry.ts`
 * and is preserved during transition. See AUDIT-2026-05-11 §3.3 for rollout shape.
 */
import type { Sql } from 'postgres';
import { config } from '../config.js';
import { getM365Token } from '../auth/m365-token.js';

/**
 * Per-vendor header-build context. The `userId` is already preHandler-verified —
 * `buildHeaders` MUST NOT re-verify the bearer or perform a second DB token lookup.
 */
export interface VendorHeaderContext {
  userId: string;
  institutionId: string;
  sql: Sql;
  masterKey: string;
}

export interface VendorConfig {
  slug: string;
  displayName: string;
  /**
   * Static upstream URL for the vendor's MCP server. Sidecar containers
   * (e.g. m365-mcp:8080) live here. Reserved for future `resolveContainerUrl`
   * hook when/if lantern grows per-tenant URL derivation.
   */
  containerUrl: string;
  /**
   * Path suffix appended to `containerUrl`. Defaults to '/mcp' (Streamable HTTP).
   * Set to '/sse' for vendors that only expose SSE transport.
   */
  mcpPath?: string;
  /**
   * Reserved: when a stateful vendor (requires Mcp-Session-Id from `initialize`)
   * is added, set true and route through a session pool. Not used in the
   * initial unified-route port; m365 and tdx are both stateless.
   */
  isStateful?: boolean;
  /**
   * Async hook to construct vendor-specific request headers. Called once per
   * proxied request. Use for per-user delegated tokens (M365) or any
   * server-config-driven header derivation. Returns the headers to MERGE on top
   * of the gateway's standard headers (X-Lantern-User-Id, X-Lantern-Institution-Id).
   */
  buildHeaders?: (ctx: VendorHeaderContext) => Promise<Record<string, string>>;
}

export const VENDORS: Record<string, VendorConfig> = {
  m365: {
    slug: 'm365',
    displayName: 'Microsoft 365',
    containerUrl: config.serverUrls.m365,
    async buildHeaders(ctx) {
      const empty: Record<string, string> = {};
      if (!ctx.masterKey) return empty;
      try {
        const token = await getM365Token(ctx.sql, ctx.masterKey, ctx.userId);
        return token ? { 'X-Lantern-Access-Token': token } : empty;
      } catch {
        // Token unavailable — upstream will surface auth error.
        return empty;
      }
    },
  },
  tdx: {
    slug: 'tdx',
    displayName: 'TeamDynamix',
    containerUrl: config.serverUrls.tdx,
  },
};

export function getVendor(slug: string): VendorConfig | null {
  return VENDORS[slug] ?? null;
}

export function listVendors(): VendorConfig[] {
  return Object.values(VENDORS);
}

export function getVendorSlugs(): string[] {
  return Object.keys(VENDORS);
}

/**
 * Split a prefixed tool name into `{vendorSlug, toolName}`. Tool names can
 * contain `__` (e.g. `m365__get_user__profile`), so we split ONLY on the first
 * `__` and treat everything after as the tool name. Returns `null` if the name
 * is not prefixed.
 *
 * GOTCHA per audit §3.3 #2: do not use `split('__')` — that would corrupt tool
 * names containing additional `__` sequences.
 */
export function splitPrefixedToolName(prefixed: string): { vendorSlug: string; toolName: string } | null {
  const idx = prefixed.indexOf('__');
  if (idx <= 0 || idx === prefixed.length - 2) return null;
  return {
    vendorSlug: prefixed.slice(0, idx),
    toolName: prefixed.slice(idx + 2),
  };
}

export function prefixToolName(vendorSlug: string, toolName: string): string {
  return `${vendorSlug}__${toolName}`;
}
