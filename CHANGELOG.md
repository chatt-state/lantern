# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Standalone M365 MCP server — Mail, Calendar, OneDrive, and Directory tools (Task 9)
  - `src/servers/m365/auth.ts` — AES-256-GCM credential encryption utilities (`encryptToken`, `decryptToken`) with per-user key derivation via `scryptSync`
  - `src/servers/m365/tools/mail.ts` — `listMail`, `getMail`, `searchMail`, `sendMail` via Microsoft Graph
  - `src/servers/m365/tools/calendar.ts` — `listEvents` (next N days), `createEvent` with attendees/timezone support
  - `src/servers/m365/tools/files.ts` — `listFiles` (root or folder), `getFile` for OneDrive items
  - `src/servers/m365/tools/directory.ts` — `getUser` (by email or display name), `listUsers` with `$search` support
  - `src/servers/m365/server.ts` — `createM365Server()` factory; registers 10 MCP tools using Zod schemas; reads access token from `X-Lantern-Access-Token` header (injected by gateway proxy)
  - `src/servers/m365/http.ts` — stateless MCP Streamable HTTP transport on port 8080 (`POST /mcp`, `GET /health`) using `node:http`
  - `src/servers/m365/index.ts` — entry point for standalone container process
  - `src/servers/m365/Dockerfile` — `node:22-alpine` image; copies compiled output from `dist/servers/m365`
  - `tests/m365.test.ts` — 6 tests covering encryption round-trip, random IV uniqueness, wrong-key rejection, and server instantiation
  - Added `@modelcontextprotocol/sdk` dependency
- Audit logging query service, CSV export, and admin UI viewer (Task 10)
  - `src/audit/service.ts` — `AuditService` with `queryLogs` (paginated, filterable), `getSummary` (24 h stats), and `exportCsv`; all queries strictly scoped to `institutionId`
  - `src/audit/routes.ts` — Fastify plugin adding `GET /settings/admin/audit` (HTML table with filter form, summary stats, pagination) and `GET /settings/admin/audit/export` (CSV download); both require institution-admin role
  - Wired `auditRoutes(sql)` into `src/index.ts`
  - Removed `/settings/admin/audit` stub from `src/web/routes.ts` — now handled by dedicated module
  - 6 new unit tests in `tests/audit.test.ts` covering constructor, CSV header/data rows, comma escaping, and `queryLogs` column mapping
- OAuth 2.1 + PKCE server for Claude Desktop/Code authentication
  - `GET /.well-known/oauth-authorization-server` — RFC 8414 server metadata endpoint
  - `POST /oauth/register` — RFC 7591 Dynamic Client Registration
  - `GET /oauth/authorize` — Authorization endpoint; enforces S256 PKCE, bounces unauthenticated users to Azure SSO
  - `POST /oauth/token` — Token exchange (authorization_code) and refresh_token grant with automatic refresh token rotation
  - `POST /oauth/revoke` — RFC 7009 token revocation (always returns 200)
  - `src/oauth/token-store.ts` — DB-backed store for clients, auth codes, access tokens (JWT/HS256 + DB hash), and refresh tokens
  - `src/oauth/metadata.ts` — well-known metadata route plugin
  - `src/oauth/routes.ts` — full OAuth 2.1 route plugin wired into Fastify
  - PKCE S256 RFC 7636 test vector assertion in `tests/oauth.test.ts`
