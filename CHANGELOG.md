# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unified MCP endpoint `/v1/mcp`** — aggregates all vendors (m365, tdx) behind a single JSON-RPC route. Tool names are prefixed `{vendorSlug}__{toolName}` to namespace across vendors; allowlist filtering applies post-aggregation with prefix-aware lookup.
  - `src/proxy/vendor-config.ts` — `VendorConfig` interface and `VENDORS` table (single source of truth, simplified from mcp-gateway's pattern for the single-tenant higher-ed domain — no BYOC creds, no OAuth-per-vendor, no validate/fields hooks). Includes `splitPrefixedToolName` with split-once semantics (tool names can contain `__`).
  - `src/proxy/resolve-vendor-headers.ts` — replaces mcp-gateway's `injectCredentials` with a lantern-domain-correct shape. Takes already-verified userId from preHandler, returns `{headers, containerUrl}` via per-vendor `buildHeaders` hook. No internal bearer re-verification.
  - `src/proxy/unified-router.ts` — POST `/v1/mcp` JSON-RPC dispatch (initialize, tools/list aggregate, tools/call prefix-route, notifications/initialized no-op); GET `/v1/mcp` SSE heartbeat for mcp-remote.
  - M365 per-user delegated token injection lifted from `src/proxy/router.ts` inline branch into the m365 entry's `buildHeaders` hook — preserves the per-vendor route's behavior unchanged; the unified route uses the hook.
  - Legacy `/v1/:server/mcp` route stays live during transition. Clients can migrate at their own pace.
  - No rate limiting on `/v1/mcp` — matches existing `/v1/*` behavior at HEAD `9caa423` (verified: `src/index.ts:51` registers rate-limit with `global: false`; only `/oauth` routes opt in).

- **SCIM 2.0 Provisioning Bridge** — Azure AD Enterprise App pushes groups→departments and users automatically; 54 Technology Division staff provisioned on first sync
  - `migrations/004_scim.cjs` — adds `scim_tokens` table (hashed Bearer tokens for SCIM auth) and `external_id`/`active` columns on `departments`
  - `src/scim/middleware.ts` — SHA-256 Bearer token validation against `scim_tokens`, updates `last_used_at`
  - `src/scim/routes.ts` — full SCIM 2.0 endpoint set at `/scim/`: ServiceProviderConfig, Schemas, Users (GET/POST/PATCH), Groups (GET/POST/PATCH/DELETE)
  - SCIM PATCH Groups handles Azure `Add`/`Remove` member operations → syncs `user_departments`; also handles `members[value eq "oid"]` filter syntax
  - Admin UI: `GET/POST /settings/admin/scim` — generate tokens (shown once), revoke tokens, copy SCIM endpoint URL
  - Navigation: added SCIM Tokens link to admin sidebar and overview quick links
  - `ignoreTrailingSlash: true` on Fastify — Azure AD credential probe appends trailing slash
  - `application/scim+json` content-type parser registered before plugins — Azure sends this MIME type on all write operations
  - BaseAddress configured as `https://lantern.chattstate.edu` (no path) — `customappsso` template appends `/scim/` automatically

- **Per-User Delegated M365 Tokens** — each staff member's M365 MCP calls use their own Azure Graph token
  - `migrations/005_user_m365_tokens.cjs` — adds `refresh_data` and `expires_at` columns to `user_credentials`
  - `src/auth/m365-token.ts` — `storeM365Token` / `getM365Token` using AES-256-GCM with per-user key derivation; auto-refreshes tokens expiring within 5 minutes
  - `src/auth/azure.ts` — extended OIDC scope to request Graph delegated permissions (`User.Read`, `Mail.ReadBasic`, `Calendars.Read`, `Files.Read`, `Sites.Read.All`, `GroupMember.Read.All`)
  - `src/auth/routes.ts` — stores M365 tokens after SSO callback (non-blocking)
  - `src/proxy/router.ts` — injects `X-Lantern-Access-Token` header with user's Graph token before forwarding to M365 MCP server

- **TDX MCP Server** — TeamDynamix ITSM integration (tickets, KB, assets, services, people)
  - `src/servers/tdx/auth.ts` — `TdxAuthService`: BEID application-level auth with 7-hour token cache and automatic re-login
  - `src/servers/tdx/client.ts` — `TdxClient`: typed fetch wrapper for TDX REST API (tickets, knowledge base, assets, services, people)
  - `src/servers/tdx/server.ts` — `createTdxServer()`: 11 MCP tools (`search_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `search_knowledge_base`, `get_article`, `search_assets`, `get_asset`, `list_services`, `get_service`, `search_people`)
  - `src/servers/tdx/http.ts` — stateless MCP Streamable HTTP transport (same pattern as M365 server)
  - `src/servers/tdx/Dockerfile` — multi-stage `node:22-alpine` build
  - `src/proxy/server-registry.ts` — registered `tdx` server slug
  - `src/config.ts` — `SERVER_URL_TDX` environment variable

- Docker Compose deployment configuration (Task 14)
  - `docker-compose.yml` — four-service stack: `postgres` (PostgreSQL 16 Alpine with health check), `migrate` (runs `npm run migrate` against postgres, exits cleanly), `lantern` (gateway; waits for migrate to complete), `m365-mcp` (internal-only MCP server; waits for lantern to be healthy)
  - `docker-compose.dev.yml` — development overlay: exposes postgres on port 5432, overrides lantern command to `tsx watch` hot reload, sets `DEBUG=*` and `LOG_LEVEL=debug`
  - `docs/deployment.md` — deployment guide covering prerequisites, quick start, Azure app registration, upgrades, and common troubleshooting steps
  - Added `POSTGRES_PASSWORD` variable to `.env.example` for the managed postgres service

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
