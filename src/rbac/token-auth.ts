import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Sql } from 'postgres';
import { TokenStore } from '../oauth/token-store.js';

export interface TokenAuthResult {
  userId: string;
  clientId: string;
  scope?: string;
}

/**
 * Extracts and validates the Bearer token from the Authorization header.
 * Returns the token payload or null.
 */
export async function verifyBearerToken(
  request: FastifyRequest,
  sql: Sql,
): Promise<TokenAuthResult | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const tokenStore = new TokenStore(sql);
  return tokenStore.verifyAccessToken(token);
}

/**
 * Fastify preHandler that requires a valid Bearer token.
 * Attaches the token payload to request.tokenAuth for downstream use.
 */
export function requireBearerAuth(sql: Sql) {
  return async function (request: FastifyRequest & { tokenAuth?: TokenAuthResult }, reply: FastifyReply): Promise<void> {
    const result = await verifyBearerToken(request, sql);
    if (!result) {
      reply
        .status(401)
        .header('WWW-Authenticate', 'Bearer realm="Lantern", error="invalid_token"')
        .send({ error: 'invalid_token' });
      return;
    }
    request.tokenAuth = result;
  };
}
