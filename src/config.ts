/**
 * Environment configuration for Lantern.
 * Validates required env vars at startup and provides typed access.
 */

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '8080'), 10),
  host: optional('HOST', '0.0.0.0'),
  baseUrl: optional('BASE_URL', 'http://localhost:8080'),
  databaseUrl: optional('DATABASE_URL', 'postgres://lantern:lantern@localhost:5432/lantern'),
  masterKey: optional('MASTER_KEY', ''),
  jwtSecret: optional('JWT_SECRET', ''),
  logLevel: optional('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  multiTenant: optional('MULTI_TENANT', 'false') === 'true',
  // Azure SSO
  azureTenantId: optional('AZURE_TENANT_ID', ''),
  azureClientId: optional('AZURE_CLIENT_ID', ''),
  azureClientSecret: optional('AZURE_CLIENT_SECRET', ''),
  azureCallbackUrl: optional('AZURE_CALLBACK_URL', 'http://localhost:8080/auth/callback'),
  // M365 Graph
  microsoftGraphClientId: optional('MICROSOFT_GRAPH_CLIENT_ID', ''),
  microsoftGraphClientSecret: optional('MICROSOFT_GRAPH_CLIENT_SECRET', ''),
  // MCP server URLs
  serverUrls: {
    m365: optional('SERVER_URL_M365', 'http://m365-mcp:8080'),
  },
} as const;
