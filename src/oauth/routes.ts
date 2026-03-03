import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { TokenStore } from './token-store.js';
import { getSession, setSession } from '../auth/session.js';
import type { Sql } from 'postgres';

function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return computed === codeChallenge;
}

export function oauthRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const tokenStore = new TokenStore(sql);

    // POST /oauth/register — Dynamic Client Registration (RFC 7591)
    app.post<{
      Body: {
        client_name?: string;
        redirect_uris?: string[];
        grant_types?: string[];
        response_types?: string[];
      };
    }>('/oauth/register', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const { client_name, redirect_uris = [] } = request.body ?? {};
      const clientId = randomBytes(16).toString('hex');

      await tokenStore.registerClient({
        clientId,
        clientName: client_name,
        redirectUris: redirect_uris,
      });

      return reply.status(201).send({
        client_id: clientId,
        client_name,
        redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    });

    // GET /oauth/authorize — Authorization endpoint (PKCE required)
    app.get<{
      Querystring: {
        client_id?: string;
        redirect_uri?: string;
        response_type?: string;
        state?: string;
        code_challenge?: string;
        code_challenge_method?: string;
        scope?: string;
      };
    }>('/oauth/authorize', async (request, reply) => {
      const {
        client_id,
        redirect_uri,
        response_type,
        state,
        code_challenge,
        code_challenge_method,
        scope,
      } = request.query;

      // Validate required params
      if (!client_id || !redirect_uri || response_type !== 'code') {
        return reply.status(400).send({ error: 'invalid_request', error_description: 'Missing required parameters' });
      }
      if (!code_challenge || code_challenge_method !== 'S256') {
        return reply.status(400).send({ error: 'invalid_request', error_description: 'PKCE with S256 is required' });
      }

      const client = await tokenStore.getClient(client_id);
      if (!client) {
        return reply.status(400).send({ error: 'invalid_client' });
      }

      // Check if user is already logged in
      const session = getSession(request);

      if (!session.userId) {
        // Store OAuth params in session, redirect to Azure SSO
        const pendingSessionId = randomBytes(16).toString('hex');

        setSession(reply, {
          ...session,
          pendingAuthSessionId: pendingSessionId,
          oauthState: state,
        });

        // Encode all OAuth params so they survive the login redirect
        const encodedParams = Buffer.from(JSON.stringify({
          clientId: client_id, redirectUri: redirect_uri, codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method, scope, state, pendingSessionId,
        })).toString('base64');

        return reply.redirect(`/auth/login?oauth_params=${encodeURIComponent(encodedParams)}`);
      }

      // User is logged in — issue authorization code
      const code = await tokenStore.createAuthCode({
        clientId: client_id,
        userId: session.userId,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        scope,
        sessionId: session.pendingAuthSessionId,
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);

      return reply.redirect(redirectUrl.toString());
    });

    // GET /oauth/complete — Called after Azure SSO login completes during OAuth flow
    app.get<{ Querystring: { session_id?: string } }>('/oauth/complete', async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) {
        return reply.status(401).send({ error: 'Not authenticated' });
      }
      // Redirect back to authorize — the session is now populated
      return reply.redirect('/oauth/authorize?' + new URLSearchParams({
        // We can't fully reconstruct the original params here without storing them
        // This is a simplified flow — a production version would store params in DB
        client_id: 'unknown',
      }).toString());
    });

    // POST /oauth/token — Token exchange and refresh
    app.post<{
      Body: {
        grant_type?: string;
        code?: string;
        redirect_uri?: string;
        client_id?: string;
        code_verifier?: string;
        refresh_token?: string;
      };
    }>('/oauth/token', {
      config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } = request.body ?? {};

      if (grant_type === 'authorization_code') {
        if (!code || !redirect_uri || !client_id || !code_verifier) {
          return reply.status(400).send({ error: 'invalid_request', error_description: 'Missing required parameters' });
        }

        const authCode = await tokenStore.consumeAuthCode(code);
        if (!authCode) {
          return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
        }

        if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
          return reply.status(400).send({ error: 'invalid_grant', error_description: 'Client or redirect URI mismatch' });
        }

        // Verify PKCE
        if (!verifyPkce(code_verifier, authCode.code_challenge, authCode.code_challenge_method)) {
          return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }

        const accessToken = await tokenStore.createAccessToken({
          userId: authCode.user_id,
          clientId: client_id,
          scope: authCode.scope,
        });

        const accessTokenHash = createHash('sha256').update(accessToken).digest('hex');

        const refreshToken = await tokenStore.createRefreshToken({
          accessTokenHash,
          userId: authCode.user_id,
          clientId: client_id,
          scope: authCode.scope,
        });

        return {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: authCode.scope,
        };
      }

      if (grant_type === 'refresh_token') {
        if (!refresh_token) {
          return reply.status(400).send({ error: 'invalid_request' });
        }

        const result = await tokenStore.rotateRefreshToken(refresh_token);
        if (!result) {
          return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
        }

        return {
          access_token: result.newAccessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: result.newRefreshToken,
          scope: result.scope,
        };
      }

      return reply.status(400).send({ error: 'unsupported_grant_type' });
    });

    // POST /oauth/revoke — Token revocation (RFC 7009)
    app.post<{ Body: { token?: string } }>('/oauth/revoke', async (request, reply) => {
      const { token } = request.body ?? {};
      if (token) {
        await tokenStore.revokeToken(token);
      }
      // Always return 200 per RFC 7009
      return reply.status(200).send({});
    });
  };
}
