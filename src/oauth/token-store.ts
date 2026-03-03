import type { Sql } from 'postgres';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ACCESS_TOKEN_TTL = 3600;      // 1 hour
const REFRESH_TOKEN_TTL = 2592000;  // 30 days
const AUTH_CODE_TTL = 300;          // 5 minutes

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export class TokenStore {
  constructor(private readonly sql: Sql) {}

  // ---------------------------------------------------------------------------
  // OAuth Clients
  // ---------------------------------------------------------------------------

  async registerClient(params: {
    clientId: string;
    clientName?: string;
    redirectUris: string[];
    institutionId?: string;
  }) {
    const [client] = await this.sql`
      INSERT INTO oauth_clients (client_id, client_name, redirect_uris, institution_id)
      VALUES (${params.clientId}, ${params.clientName ?? null}, ${params.redirectUris}, ${params.institutionId ?? null})
      ON CONFLICT (client_id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        redirect_uris = EXCLUDED.redirect_uris
      RETURNING *
    `;
    return client;
  }

  async getClient(clientId: string) {
    const [client] = await this.sql`
      SELECT * FROM oauth_clients WHERE client_id = ${clientId}
    `;
    return client ?? null;
  }

  // ---------------------------------------------------------------------------
  // Authorization Codes
  // ---------------------------------------------------------------------------

  async createAuthCode(params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string;
    sessionId?: string;
  }): Promise<string> {
    const code = generateToken(32);
    const expiresAt = new Date(Date.now() + AUTH_CODE_TTL * 1000);

    await this.sql`
      INSERT INTO auth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, session_id, expires_at)
      VALUES (${code}, ${params.clientId}, ${params.userId}, ${params.redirectUri},
              ${params.codeChallenge}, ${params.codeChallengeMethod},
              ${params.scope ?? null}, ${params.sessionId ?? null}, ${expiresAt})
    `;
    return code;
  }

  async consumeAuthCode(code: string) {
    const [row] = await this.sql`
      DELETE FROM auth_codes
      WHERE code = ${code} AND expires_at > now()
      RETURNING *
    `;
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Access Tokens
  // ---------------------------------------------------------------------------

  async createAccessToken(params: {
    userId: string;
    clientId: string;
    scope?: string;
  }): Promise<string> {
    const secret = config.jwtSecret || 'dev-jwt-secret-change-me';
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);

    const payload = {
      sub: params.userId,
      client_id: params.clientId,
      scope: params.scope,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
    const tokenHash = hashToken(token);

    await this.sql`
      INSERT INTO access_tokens (token_hash, user_id, client_id, scope, expires_at)
      VALUES (${tokenHash}, ${params.userId}, ${params.clientId}, ${params.scope ?? null}, ${expiresAt})
    `;

    return token;
  }

  async verifyAccessToken(token: string): Promise<{ userId: string; clientId: string; scope?: string } | null> {
    const secret = config.jwtSecret || 'dev-jwt-secret-change-me';
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as {
        sub: string;
        client_id: string;
        scope?: string;
      };

      // Also check DB (token could be revoked)
      const tokenHash = hashToken(token);
      const [row] = await this.sql`
        SELECT * FROM access_tokens WHERE token_hash = ${tokenHash} AND expires_at > now()
      `;
      if (!row) return null;

      return { userId: payload.sub, clientId: payload.client_id, scope: payload.scope };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Refresh Tokens
  // ---------------------------------------------------------------------------

  async createRefreshToken(params: {
    accessTokenHash: string;
    userId: string;
    clientId: string;
    scope?: string;
  }): Promise<string> {
    const token = generateToken(48);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await this.sql`
      INSERT INTO refresh_tokens (token_hash, access_token_hash, user_id, client_id, scope, expires_at)
      VALUES (${tokenHash}, ${params.accessTokenHash}, ${params.userId}, ${params.clientId},
              ${params.scope ?? null}, ${expiresAt})
    `;
    return token;
  }

  async rotateRefreshToken(oldToken: string): Promise<{
    newAccessToken: string;
    newRefreshToken: string;
    userId: string;
    clientId: string;
    scope?: string;
  } | null> {
    const oldHash = hashToken(oldToken);

    const [old] = await this.sql`
      UPDATE refresh_tokens SET revoked = true
      WHERE token_hash = ${oldHash} AND revoked = false AND expires_at > now()
      RETURNING *
    `;
    if (!old) return null;

    // Revoke old access token
    await this.sql`DELETE FROM access_tokens WHERE token_hash = ${old.access_token_hash}`;

    const newAccessToken = await this.createAccessToken({
      userId: old.user_id,
      clientId: old.client_id,
      scope: old.scope,
    });
    const newAccessHash = hashToken(newAccessToken);

    const newRefreshToken = await this.createRefreshToken({
      accessTokenHash: newAccessHash,
      userId: old.user_id,
      clientId: old.client_id,
      scope: old.scope,
    });

    return {
      newAccessToken,
      newRefreshToken,
      userId: old.user_id,
      clientId: old.client_id,
      scope: old.scope,
    };
  }

  async revokeToken(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await this.sql`DELETE FROM access_tokens WHERE token_hash = ${tokenHash}`;
    await this.sql`UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${tokenHash}`;
  }
}
