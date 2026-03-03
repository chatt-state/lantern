/**
 * M365 MCP Server — entry point.
 *
 * Standalone process that exposes Microsoft 365 capabilities (Mail, Calendar,
 * OneDrive, Directory) via the MCP Streamable HTTP transport.
 *
 * Environment variables:
 *   PORT            — HTTP port (default 8080)
 *   MASTER_KEY      — AES-256 master key for credential encryption
 *   M365_CLIENT_ID  — Azure app client ID (informational; tokens come from gateway)
 *   M365_CLIENT_SECRET — Azure app client secret (informational)
 *   M365_TENANT_ID  — Azure tenant ID (informational)
 *
 * The server receives delegated access tokens via the X-Lantern-Access-Token
 * header injected by the Lantern gateway proxy.
 *
 * Import side-effect: starts the HTTP server.
 */
export * from './server.js';
import './http.js';
