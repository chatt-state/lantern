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

      // Store state + verifier + nonce in session for validation on callback
      const session = getSession(request);
      setSession(reply, {
        ...session,
        oauthState: state,
        oauthCodeVerifier: codeVerifier,
        oauthNonce: nonce,
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
        oauthNonce: sessionNonce,
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
          nonce: sessionNonce,
        });

        const claims = tokenSet.claims();
        const azureTenantId = claims.tid as string;
        const azureOid = claims.oid as string;

        if (!azureTenantId || !azureOid) {
          return reply.status(400).send({ error: 'Missing required claims in token' });
        }

        // Look up institution
        let institution = await institutionService.findByTenantId(azureTenantId);

        if (!institution) {
          if (!config.multiTenant) {
            return reply.status(401).send({
              error: 'Institution not registered. Please configure AZURE_TENANT_ID.',
            });
          }

          // Multi-tenant: auto-register the institution on first login
          // Derive a reasonable institution name from the email domain or tenant ID
          const email = (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined) ?? '';
          const domain = email.includes('@') ? email.split('@')[1] : azureTenantId;

          console.log(`[multi-tenant] Auto-registering new institution for tenant ${azureTenantId} (domain: ${domain})`);

          await sql`
            INSERT INTO institutions (name, azure_tenant_id, domain, azure_client_id, azure_client_secret_enc, verified)
            VALUES (${domain}, ${azureTenantId}, ${domain}, '', '', false)
            ON CONFLICT (azure_tenant_id) DO NOTHING
          `;

          institution = await institutionService.findByTenantId(azureTenantId);

          if (!institution) {
            return reply.status(500).send({ error: 'Failed to register institution' });
          }

          console.log(`[multi-tenant] Registered institution ${institution.id} for tenant ${azureTenantId}`);
        }

        // Check if this is the first user for this institution (will become admin)
        const [existingUserCount] = await sql<[{ count: string }]>`
          SELECT COUNT(*) AS count FROM users WHERE institution_id = ${institution.id}
        `;
        const isFirstUser = parseInt(existingUserCount.count, 10) === 0;

        // Upsert the user
        const user = await userService.upsertUser(institution.id, {
          oid: azureOid,
          email: claims.email as string | undefined,
          preferred_username: claims.preferred_username as string | undefined,
          name: claims.name as string | undefined,
          tid: azureTenantId,
        });

        // In multi-tenant mode, promote the first user of a new institution to admin
        if (isFirstUser && config.multiTenant) {
          await sql`
            UPDATE users SET institution_admin = true WHERE id = ${user.id}
          `;
          user.institution_admin = true;
          console.log(`[multi-tenant] Promoted first user ${user.id} to institution admin for ${institution.id}`);
        }

        // Store M365 delegated token for per-user Graph access
        if (tokenSet.access_token && config.masterKey) {
          try {
            const { storeM365Token } = await import('./m365-token.js');
            await storeM365Token(sql, config.masterKey, {
              userId: user.id,
              accessToken: tokenSet.access_token,
              refreshToken: tokenSet.refresh_token,
              expiresAt: new Date(Date.now() + ((tokenSet.expires_in ?? 3600) as number) * 1000),
            });
          } catch (err) {
            app.log.warn({ err }, 'Failed to store M365 token — login continues');
          }
        }

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
