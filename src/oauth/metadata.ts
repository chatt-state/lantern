import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export function metadataRoutes() {
  return async function (app: FastifyInstance) {
    app.get('/.well-known/oauth-authorization-server', async () => ({
      issuer: config.baseUrl,
      authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
      token_endpoint: `${config.baseUrl}/oauth/token`,
      registration_endpoint: `${config.baseUrl}/oauth/register`,
      revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }));
  };
}
