/**
 * Vendor-specific request header + URL resolver for the unified /v1/mcp route.
 *
 * Lantern-domain-correct shape — NOT a port of mcp-gateway's `injectCredentials`.
 * See AUDIT-2026-05-11 §3.4a for the rename rationale.
 *
 * Returns a discriminated union:
 *   - { ok: true, resolution }              — ready to proxy
 *   - { ok: false, reauth: true, ... }      — BYOC vendor, user has no creds; tell client to connect
 *   - { ok: false, reason: 'unknown_vendor' } — slug not in VENDORS table
 *
 * Caller has already verified the bearer in preHandler — `userId` is trusted.
 * No internal bearer re-verification, no second DB token lookup.
 */
import type { Sql } from 'postgres';
import { config } from '../config.js';
import { getVendor } from './vendor-config.js';
import { loadVendorCredentials } from '../credentials/vendor-credentials.js';
import { getBearerToken } from '../credentials/get-bearer-token.js';

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

export type ResolveResult =
  | { ok: true; resolution: VendorResolution }
  | { ok: false; reauth: true; vendorSlug: string; missingFields: string[] }
  | { ok: false; reason: 'unknown_vendor'; vendorSlug: string };

export async function resolveVendorHeaders(
  userId: string,
  vendorSlug: string,
  ctx: ResolveVendorHeadersContext,
): Promise<ResolveResult> {
  const vendor = getVendor(vendorSlug);
  if (!vendor) {
    return { ok: false, reason: 'unknown_vendor', vendorSlug };
  }

  const masterKey = ctx.masterKey ?? config.masterKey;

  // Standard gateway headers — vendors NEVER see the user's Lantern bearer.
  const headers: Record<string, string> = {
    'X-Lantern-User-Id': userId,
    'X-Lantern-Institution-Id': ctx.institutionId,
  };

  // BYOC path: load encrypted creds, mint OAuth bearer, inject.
  let credentials: Record<string, string> | undefined;
  if (vendor.oauthConfig) {
    const stored = await loadVendorCredentials(ctx.sql, masterKey, { userId, vendorSlug });
    const missingFields = computeMissingFields(vendor.fields ?? [], stored);
    if (missingFields.length > 0) {
      return { ok: false, reauth: true, vendorSlug, missingFields };
    }
    credentials = stored!;
    try {
      const bearer = await getBearerToken({
        vendorSlug,
        userId,
        creds: credentials,
        oauthConfig: vendor.oauthConfig,
      });
      headers[vendor.oauthConfig.bearerHeader] = `Bearer ${bearer.token}`;
    } catch {
      // Mint failed — surface as reauth so the user can re-enter credentials.
      // Generic message; no leak of vendor-side error text.
      return {
        ok: false,
        reauth: true,
        vendorSlug,
        missingFields: vendor.fields?.filter((f) => f.required).map((f) => f.key) ?? [],
      };
    }
  }

  if (vendor.buildHeaders) {
    const vendorHeaders = await vendor.buildHeaders({
      userId,
      institutionId: ctx.institutionId,
      sql: ctx.sql,
      masterKey,
      credentials,
    });
    Object.assign(headers, vendorHeaders);
  }

  return {
    ok: true,
    resolution: {
      vendorSlug,
      containerUrl: vendor.containerUrl,
      mcpPath: vendor.mcpPath ?? '/mcp',
      headers,
    },
  };
}

function computeMissingFields(
  fields: Array<{ key: string; required: boolean }>,
  stored: Record<string, string> | null,
): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    if (!stored || !stored[field.key] || stored[field.key].length === 0) {
      missing.push(field.key);
    }
  }
  return missing;
}
