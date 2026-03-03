import type { FastifyInstance } from 'fastify';
import { getAzureClient, buildAuthorizationUrl, generateAuthParams } from './azure.js';
import { getSession, setSession, clearSession } from './session.js';
import { UserService } from './user-service.js';
import { InstitutionService } from './institution-service.js';
import { GroupSyncService } from '../graph/group-sync.js';
import { config } from '../config.js';
import type { Sql } from 'postgres';

export function authRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const userService = new UserService(sql);
    const institutionService = new InstitutionService(sql);

    // GET /auth/login — redirect to Azure SSO
    app.get('/auth/login', async (request, reply) => {
      const { state, nonce, codeVerifier, codeChallenge } = generateAuthParams();

      // Store state + verifier in session for validation on callback
      const session = getSession(request);
      setSession(reply, {
        ...session,
        oauthState: state,
        oauthCodeVerifier: codeVerifier,
      });

      const authUrl = await buildAuthorizationUrl({ state, nonce, codeChallenge });
      return reply.redirect(authUrl);
    });

    // GET /auth/callback — Azure OIDC callback
    app.get('/auth/callback', async (request, reply) => {
      const session = getSession(request);
      const {
        oauthState: sessionState,
        oauthCodeVerifier: codeVerifier,
        pendingAuthSessionId,
      } = session;

      if (!sessionState || !codeVerifier) {
        return reply.status(400).send({ error: 'Invalid session state' });
      }

      try {
        const client = await getAzureClient();
        const params = client.callbackParams(request.url);

        // Validate state matches
        if (params.state !== sessionState) {
          return reply.status(400).send({ error: 'State mismatch — possible CSRF' });
        }

        const tokenSet = await client.callback(config.azureCallbackUrl, params, {
          state: sessionState,
          code_verifier: codeVerifier,
        });

        const claims = tokenSet.claims();
        const azureTenantId = claims.tid as string;
        const azureOid = claims.oid as string;

        if (!azureTenantId || !azureOid) {
          return reply.status(400).send({ error: 'Missing required claims in token' });
        }

        // Look up institution
        const institution = await institutionService.findByTenantId(azureTenantId);

        if (!institution) {
          const msg = config.multiTenant
            ? 'Institution not registered. Please contact your administrator.'
            : 'Institution not registered';
          return reply.status(403).send({ error: msg });
        }

        // Upsert the user
        const user = await userService.upsertUser(institution.id, {
          oid: azureOid,
          email: claims.email as string | undefined,
          preferred_username: claims.preferred_username as string | undefined,
          name: claims.name as string | undefined,
          tid: azureTenantId,
        });

        // Sync Azure AD groups → department memberships (non-blocking)
        try {
          const groupSync = new GroupSyncService(sql);
          if (tokenSet.access_token) {
            await groupSync.syncUserGroups({
              userId: user.id,
              institutionId: institution.id,
              accessToken: tokenSet.access_token,
            });
          }
        } catch (err) {
          app.log.warn({ err }, 'Group sync failed — login continues');
        }

        // Set authenticated session
        const newSession = {
          userId: user.id,
          institutionId: institution.id,
          azureOid: user.azure_oid,
          email: user.email,
          displayName: user.display_name,
          institutionAdmin: user.institution_admin,
          pendingAuthSessionId,
        };
        setSession(reply, newSession);

        // If we were in an OAuth 2.1 flow, redirect back to complete it
        if (pendingAuthSessionId) {
          return reply.redirect(`/oauth/complete?session_id=${pendingAuthSessionId}`);
        }

        return reply.redirect('/settings');
      } catch (err) {
        app.log.error({ err }, 'Azure OIDC callback error');
        return reply.status(500).send({ error: 'Authentication failed' });
      }
    });

    // GET /auth/logout
    app.get('/auth/logout', async (request, reply) => {
      clearSession(reply);

      // Redirect to Azure logout endpoint to clear SSO session too
      const tenantId = config.azureTenantId || 'common';
      const postLogoutUrl = encodeURIComponent(config.baseUrl);
      const logoutUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutUrl}`;

      return reply.redirect(logoutUrl);
    });
  };
}
