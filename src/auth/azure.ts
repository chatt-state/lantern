import { Issuer, generators, type Client } from 'openid-client';
import { config } from '../config.js';

let _client: Client | null = null;

/**
 * Returns the issuer URL for Azure Entra ID.
 * - Single-tenant: https://login.microsoftonline.com/{tenantId}/v2.0
 * - Multi-tenant:  https://login.microsoftonline.com/common/v2.0
 */
function getIssuerUrl(): string {
  const tenantId = config.azureTenantId || 'common';
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

export async function getAzureClient(): Promise<Client> {
  if (_client) return _client;

  const issuerUrl = getIssuerUrl();
  const issuer = await Issuer.discover(issuerUrl);

  _client = new issuer.Client({
    client_id: config.azureClientId,
    client_secret: config.azureClientSecret,
    redirect_uris: [config.azureCallbackUrl],
    response_types: ['code'],
  });

  return _client;
}

export function generateAuthParams(): {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  return { state, nonce, codeVerifier, codeChallenge };
}

/**
 * Build the authorization URL for Azure SSO.
 * Requests openid, profile, email, and offline_access scopes.
 */
export async function buildAuthorizationUrl(params: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<string> {
  const client = await getAzureClient();
  return client.authorizationUrl({
    scope: 'openid profile email offline_access User.Read Mail.ReadBasic Calendars.Read Files.Read Sites.Read.All GroupMember.Read.All',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
  });
}
