/**
 * Vendor-specific request header + URL resolver for the unified /v1/mcp route.
 *
 * This function is lantern's domain-correct shape — NOT a port of mcp-gateway's
 * `injectCredentials`. mcp-gateway's function name carries BYOC-vault semantics
 * (resolve user-stored credentials from a per-user vault, mint bearer tokens,
 * inject as headers) that do not apply in lantern's single-tenant higher-ed
 * domain. lantern has no BYOC vault; vendor auth is server config.
 *
 * Contract:
 *   - Caller has already verified the bearer in preHandler. `userId` is trusted.
 *   - Returns `{headers, containerUrl}` ready for the upstream fetch.
 *   - No internal bearer re-verification (sub-pattern: don't re-verify what
 *     preHandler guaranteed).
 *   - Returns `null` if the vendor slug is unknown.
 */
import type { Sql } from 'postgres';
import { config } from '../config.js';
import { getVendor } from './vendor-config.js';

export interface ResolveVendorHeadersContext {
  sql: Sql;
  institutionId: string;
  /** Override for tests. Defaults to `config.masterKey`. */
  masterKey?: string;
}

export interface VendorResolution {
  vendorSlug: string;
  containerUrl: string;
  mcpPath: string;
  headers: Record<string, string>;
}

export async function resolveVendorHeaders(
  userId: string,
  vendorSlug: string,
  ctx: ResolveVendorHeadersContext,
): Promise<VendorResolution | null> {
  const vendor = getVendor(vendorSlug);
  if (!vendor) return null;

  // Standard gateway headers — same as the per-vendor route's forwarded headers,
  // minus hop-by-hop and the user's bearer (vendors do not see the user's Lantern token).
  const headers: Record<string, string> = {
    'X-Lantern-User-Id': userId,
    'X-Lantern-Institution-Id': ctx.institutionId,
  };

  if (vendor.buildHeaders) {
    const vendorHeaders = await vendor.buildHeaders({
      userId,
      institutionId: ctx.institutionId,
      sql: ctx.sql,
      masterKey: ctx.masterKey ?? config.masterKey,
    });
    Object.assign(headers, vendorHeaders);
  }

  return {
    vendorSlug,
    containerUrl: vendor.containerUrl,
    mcpPath: vendor.mcpPath ?? '/mcp',
    headers,
  };
}
