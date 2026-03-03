# Lantern — Product Requirements Document

**Status**: Draft
**Date**: 2026-03-02
**Author**: Chattanooga State Community College / Wyre Technology

---

## Overview

Lantern is an open-source MCP (Model Context Protocol) gateway designed for higher education institutions. It gives faculty, staff, and administrators access to AI-powered tools through Claude Desktop and Claude Code, authenticated via their institution's existing Microsoft credentials — no new accounts, no new passwords.

Built on the patterns of [mcp-gateway](https://github.com/wyre-technology/mcp-gateway), Lantern replaces the MSP-centric vendor integrations with higher-ed systems (M365, Canvas, Banner, etc.) and swaps Auth0 for Azure Entra ID SSO, making Azure AD the single source of truth for users, departments, and roles.

**Name**: `lantern`
**GitHub**: `chatt-state/lantern`
**npm / Docker image**: `lantern` / `ghcr.io/chatt-state/lantern`
**License**: Apache-2.0
**Tagline**: *AI tooling for higher ed — deployed in an afternoon.*

---

## Problem

Community colleges and universities want to give their staff and faculty access to AI tools, but face three blockers:

1. **Authentication friction** — IT won't approve a new identity provider. Everything must go through their existing Azure Entra ID.
2. **Governance gap** — No way to control which departments can access which AI tools, or audit what was done.
3. **Integration complexity** — Wiring Claude up to Banner, Canvas, SharePoint, and Teams requires custom development most IT shops can't afford.

---

## Goals

- Any community college IT admin can go from zero to a running gateway in **under 2 hours** using Docker Compose.
- Users log in with their **existing Microsoft credentials** — no new accounts.
- **Azure AD groups automatically become departments** — no manual role assignment.
- Full audit trail of every MCP tool call, tied to user and department.
- **Open source** — colleges can fork, extend, and contribute back.
- Institutions that can't run their own infra can connect to a **shared hosted instance**.

---

## Non-Goals (v1)

- **No billing system** — open source self-hosted is free. Hosted tier pricing is a separate discussion.
- **No ERP/SIS integrations** — Banner, Colleague, PeopleSoft are on the roadmap; excluded from v1 due to FERPA complexity.
- **No LMS integrations** — Canvas, Blackboard, Moodle planned for v1.1.
- **No student-facing access** — v1 targets faculty and staff only. Student access is a v2 consideration with additional FERPA guardrails.

---

## Deployment Models

### Model A: Self-Hosted (Primary)

Each institution runs their own instance. A college's IT admin:

1. Clones the repo (or pulls the Docker image from GHCR)
2. Copies `.env.example` → `.env`, fills in Azure tenant ID and app credentials
3. Runs `docker compose up`
4. Points DNS at the gateway

The gateway handles everything else: SSO, group sync, MCP proxying, audit logging.

**Requirements**: Docker-capable server (VM, on-prem, or any cloud). 2 CPU / 4 GB RAM minimum.

**Azure app registration**: Each institution registers their own Entra ID app in their own Azure portal. This keeps credential control entirely within the institution — no third-party holds their tenant credentials.

### Model B: Shared Hosted (Secondary)

Institutions that can't run their own infra connect to a shared gateway operated by CHSCC.

- Institution registers with their **Azure tenant ID** + **verified domain**
- Their users authenticate via their own Azure SSO — each institution registers their own Entra ID app pointing at the shared Lantern instance
- Data is isolated per tenant (tenant-scoped row-level security in PostgreSQL)
- Community colleges get free access; cost-recovery model for larger universities (TBD)

The shared instance runs the same open-source codebase — no proprietary fork.

---

## Architecture

```
Claude Desktop / Claude Code
    |
    +-- (1) GET /v1/m365/mcp  (no token)
    |       -> 401 + WWW-Authenticate header
    |
    +-- (2) OAuth 2.1 + PKCE dance
    |       -> Browser opens Azure SSO login
    |       -> User authenticates with institution credentials
    |       -> Gateway syncs their Azure AD groups → departments/roles
    |       -> Issues JWT access token
    |
    +-- (3) GET /v1/m365/mcp  (Bearer token)
            -> Validates JWT, checks department tool access
            -> Proxies to MCP server container
            -> Logs request to audit trail
            -> Returns MCP tool results
```

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 22 + TypeScript | Matches mcp-gateway, proven at scale |
| HTTP framework | Fastify | Fast, schema-validated, mcp-gateway pattern |
| Database | PostgreSQL 16 | Robust, open source, row-level security for multi-tenant |
| Auth | Azure Entra ID OIDC | Institution's existing IdP — zero new accounts |
| Group sync | Microsoft Graph API | Reads Azure AD groups, maps to departments |
| MCP containers | Docker (sidecar model) | Same pattern as mcp-gateway |
| Deployment | Docker Compose | Single command, no Kubernetes required |

### Key Differences from mcp-gateway

| Feature | mcp-gateway | Lantern |
|---------|-------------|---------|
| User auth | Auth0 OIDC | Azure Entra ID OIDC |
| Role source | Manual assignment | Azure AD group sync |
| Billing | Stripe | None (open source) |
| Tenant model | Single org per install | Multi-tenant (shared hosted) |
| Target integrations | MSP tools | Higher-ed systems |
| License | Apache-2.0 | Apache-2.0 |

---

## Access Control Model

### Roles

| Role | Scope | Capabilities |
|------|-------|-------------|
| **Institution Admin** | Institution-wide | Full control: configure SSO, manage departments, manage server access, view all audit logs |
| **Department Admin** | One department | Manage members within department, configure tool allowlists for department |
| **Member** | One department | Use tools they've been granted access to |

### Azure AD Group Sync

On every login, the gateway:

1. Calls Microsoft Graph `GET /me/memberOf` to retrieve the user's groups
2. Maps Azure AD group display names to Lantern departments using a configurable mapping table
3. Creates departments that don't exist yet (auto-provisioning)
4. Assigns the user the appropriate role within each department

**Mapping config** (managed in admin UI, stored in DB):

```yaml
group_mappings:
  - azure_group: "IT Staff"
    department: "Information Technology"
    role: member
  - azure_group: "IT Admins"
    department: "Information Technology"
    role: department_admin
  - azure_group: "Faculty"
    department: "Academic Affairs"
    role: member
```

Unmapped groups are ignored. A user with no mapped groups gets read-only access with no tool permissions until an Institution Admin assigns them manually.

---

## Features

### 1. Azure SSO (v1)

- Standard OIDC flow via Azure Entra ID (formerly Azure Active Directory)
- Supports both **single-tenant** (one college, one Azure tenant) and **multi-tenant** (shared hosted, each college's own Azure tenant pointing at the shared instance)
- No Auth0 dependency
- Session cookies + JWT access tokens (same pattern as mcp-gateway)

**Setup requirements for each institution's IT admin**:
1. Register an Entra ID app in their Azure portal
2. Grant `User.Read` and `GroupMember.Read.All` API permissions
3. Set redirect URI to `https://<gateway-url>/auth/callback`
4. Paste Client ID, Client Secret, and Tenant ID into `.env` (self-hosted) or institution registration form (hosted)

The docs include a step-by-step Azure portal walkthrough with screenshots.

### 2. Department & Group Sync (v1)

- Groups pulled from Azure AD on every login (no periodic sync daemon needed)
- Department auto-creation on first group encounter
- Manual override: Institution Admin can reassign users to different departments or roles regardless of AD group
- Department deletion is non-destructive — members moved to "Unassigned"
- Group mapping UI in admin dashboard — no YAML file editing required

### 3. MCP Proxy + Tool Access Control (v1)

Same proven pattern from mcp-gateway:

- OAuth 2.1 + PKCE for Claude Desktop/Code → Lantern auth
- JWT validates on every MCP request
- Per-department, per-server tool allowlists
- Tool cache (5-minute TTL) to avoid hammering upstream MCP servers

### 4. M365 MCP Server (v1)

The first bundled MCP server. Surfaces Microsoft 365 capabilities to Claude:

- **Mail** — read, search, send (with explicit permission grants per department)
- **Calendar** — read/write calendar events, scheduling assistance
- **Files** — OneDrive and SharePoint file access
- **Teams** — channel messages, meeting summaries
- **Directory** — look up colleagues, org chart navigation

Auth: The gateway handles OAuth 2.0 consent for Microsoft Graph on the user's behalf. Users authorize once through the Lantern UI; the gateway stores and refreshes tokens using AES-256-GCM encryption.

### 5. Audit Logging (v1)

Every MCP tool call logged:

- User ID + display name
- Department
- Server + tool name
- Request timestamp + latency
- Success/error status
- (Optional) request/response payload hash for integrity verification

Exportable as CSV. Institution Admin sees all departments; Department Admin sees their department only.

### 6. Institution Admin Dashboard (v1)

Web UI (server-rendered Fastify templates, same pattern as mcp-gateway):

- **Overview** — active users, request volume (7d/30d), top tools
- **Departments** — list, create, configure Azure AD group mappings
- **Members** — search users, reassign departments/roles, deactivate
- **Servers** — enable/disable MCP servers, configure per-department access
- **Tool Access** — per-department tool allowlists
- **Audit Log** — filterable, exportable as CSV

### 7. Multi-Tenant Support for Shared Hosted (v1 — hosted mode only)

When `MULTI_TENANT=true`:

- Institution registration: provide Azure tenant ID + verified domain
- Row-level security: all DB queries scoped to `institution_id`
- Institution Admins can only see their own institution's data
- Shared MCP server containers, token isolation per tenant

---

## FERPA Compliance Posture

Lantern v1 is designed to handle **employee/faculty data only** — no student records. The following is included in the v1 documentation and codebase:

### What Lantern Accesses (v1)

| Data Source | What's Accessed | FERPA Applicability |
|-------------|-----------------|---------------------|
| Azure AD | User profile, group memberships | No — employee directory data |
| M365 Mail | The authenticated user's own mailbox | No — employee personal data |
| M365 Calendar | The authenticated user's own calendar | No — employee personal data |
| OneDrive/SharePoint | Files the user has access to | Depends on file content — admins must configure tool allowlists to restrict sensitive SharePoint sites |
| Teams | Channels the user is a member of | No — employee communication data |

### What Lantern Does NOT Access (v1)

- Student Information Systems (Banner, Colleague, PeopleSoft)
- Grade data
- Enrollment records
- Financial aid records
- Any data covered under FERPA §99.3 "Education Records"

### Institutional Responsibility

Lantern is a tool; FERPA compliance is the institution's responsibility. Institutions should:

1. Review which SharePoint sites and Teams channels they grant access to via tool allowlists
2. Ensure only appropriate staff roles have access to sensitive server integrations
3. Use the audit log to monitor for unusual access patterns
4. Consult their FERPA compliance officer before enabling v2 ERP integrations

### v2+ ERP Integrations

When Banner/Colleague integrations are added (v2), a full FERPA compliance framework will be required including: consent documentation, data minimization by default, institutional data agreements, and audit trail requirements exceeding what v1 provides.

---

## Open Source Strategy

### Governance

- **Led by**: Chattanooga State Community College (CHSCC) with technical support from Wyre Technology
- **Planned donation**: CHSCC intends to donate the project to [Internet2](https://internet2.edu) or [Apereo Foundation](https://apereo.org) once the project has demonstrated community adoption (target: after v1.0 stable release). Both organizations have precedent accepting open-source higher-ed infrastructure (Shibboleth at Internet2; CAS, OpenLRS at Apereo).
- **Interim governance**: CHSCC maintains final merge authority during incubation. External PRs welcome.

### Repository

- **GitHub org**: `chatt-state`
- **Repo**: `chatt-state/lantern`
- **License**: Apache-2.0
- **Contributing**: CONTRIBUTING.md with PR guidelines, code style, and DCO sign-off requirement
- **Issues**: GitHub Issues (bug reports, feature requests)
- **Discussions**: GitHub Discussions (community support, deployment questions)

### Distribution

- **Docker images**: `ghcr.io/chatt-state/lantern` (GitHub Container Registry)
- **Releases**: Semantic versioning, GitHub Releases with changelogs
- **Docs site**: Astro-based, covers self-hosted setup, Azure app registration walkthrough, adding custom MCP servers, FERPA posture

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `BASE_URL` | — | Public-facing URL (e.g. `https://ai.chattanoogastate.edu`) |
| `MASTER_KEY` | — | 32-byte hex encryption master key |
| `JWT_SECRET` | — | 32-byte hex JWT signing key |
| `DATABASE_URL` | `postgres://lantern:lantern@postgres:5432/lantern` | PostgreSQL connection URL |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Azure SSO (required)

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Azure AD tenant ID — institution's own GUID, or `common` for multi-tenant hosted mode |
| `AZURE_CLIENT_ID` | Entra ID app client ID (institution registers their own app) |
| `AZURE_CLIENT_SECRET` | Entra ID app client secret |
| `AZURE_CALLBACK_URL` | OIDC callback (e.g. `https://ai.mycollege.edu/auth/callback`) |

### Multi-Tenant Hosted Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTI_TENANT` | `false` | Set `true` to enable multi-tenant mode |

### M365 MCP Server

| Variable | Description |
|----------|-------------|
| `SERVER_URL_M365` | URL of M365 MCP container (default: `http://m365-mcp:8080`) |
| `MICROSOFT_GRAPH_CLIENT_ID` | Entra ID app for Microsoft Graph OAuth (can share with `AZURE_CLIENT_ID` if scopes are combined) |
| `MICROSOFT_GRAPH_CLIENT_SECRET` | Entra ID app secret for Microsoft Graph OAuth |

---

## Security

- **User authentication**: Azure Entra ID OIDC — no credentials stored in Lantern
- **Credential encryption**: AES-256-GCM with per-user PBKDF2 key derivation (100k iterations, SHA-512)
- **OAuth 2.1**: PKCE with S256 code challenge (mandatory per MCP spec)
- **JWT access tokens**: HS256 signed, configurable TTL
- **Refresh token rotation**: Old token revoked on every use
- **Role-based access**: Institution Admin / Department Admin / Member
- **Audit logging**: All MCP requests + all admin actions
- **No student data in v1**: FERPA scope explicitly excluded (see FERPA section)

---

## Success Metrics (v1)

- A new IT admin with no prior MCP knowledge can deploy a working instance in **≤ 2 hours** following the README
- Azure SSO login works for **99%+ of standard Entra ID tenants**
- Group sync correctly maps AD groups to departments **on first login**
- All MCP requests appear in the audit log within **1 second** of completion
- Zero credential plaintext stored at rest

---

## API Surface

### Core

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `ALL` | `/v1/:server/mcp` | Bearer | MCP proxy |

### OAuth 2.1 (Claude Desktop/Code ↔ Lantern)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/.well-known/oauth-authorization-server` | No | OAuth metadata (RFC 8414) |
| `POST` | `/oauth/register` | No | Dynamic Client Registration |
| `GET` | `/oauth/authorize` | No | Authorization (PKCE required) |
| `POST` | `/oauth/token` | No | Token exchange / refresh |
| `POST` | `/oauth/revoke` | No | Token revocation |

### Azure SSO

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/auth/login` | No | Redirect to Azure SSO |
| `GET` | `/auth/callback` | No | Azure OIDC callback |
| `GET` | `/auth/logout` | Session | Logout + session clear |

### Web UI

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | Session | Dashboard / redirect to login |
| `GET` | `/settings` | Session | Personal connections + M365 auth |
| `GET` | `/settings/department` | Session | Department tool overview |
| `GET` | `/settings/admin` | Session + Admin | Institution admin panel |
| `GET` | `/settings/admin/departments` | Session + Admin | Department + group mapping management |
| `GET` | `/settings/admin/members` | Session + Admin | Member management |
| `GET` | `/settings/admin/servers` | Session + Admin | Server access control |
| `GET` | `/settings/admin/tool-access` | Session + Admin | Tool allowlists |
| `GET` | `/settings/admin/audit` | Session + Admin | Audit log viewer |

### Institution API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/departments` | Session | List departments |
| `GET` | `/api/departments/:id/members` | Session + DeptAdmin | List members |
| `PUT` | `/api/departments/:id/tool-access/:server` | Session + DeptAdmin | Set tool allowlist |
| `GET` | `/api/departments/:id/tool-access/:server` | Session + DeptAdmin | Get tool allowlist |
| `GET` | `/api/members` | Session + Admin | Search members |
| `PATCH` | `/api/members/:userId` | Session + Admin | Update member role/dept |
| `GET` | `/api/group-mappings` | Session + Admin | List Azure AD group mappings |
| `PUT` | `/api/group-mappings` | Session + Admin | Update group mappings |
| `GET` | `/api/audit` | Session + Admin | Audit log (JSON/CSV) |
| `GET` | `/api/servers` | Session | List available MCP servers |

---

## MCP Integrations Roadmap

| Server | v1 | v1.1 | v2 |
|--------|----|----|------|
| Microsoft 365 (Mail, Calendar, Files, Teams) | ✅ | | |
| SharePoint | ✅ | | |
| Canvas LMS | | ✅ | |
| Blackboard | | ✅ | |
| Moodle | | ✅ | |
| Workday (HR) | | ✅ | |
| Library Systems (Ex Libris, Alma) | | ✅ | |
| Ellucian Banner | | | ✅ |
| Ellucian Colleague | | | ✅ |
| PeopleSoft | | | ✅ |

---

## Milestones

| Milestone | Scope |
|-----------|-------|
| **v0.1 — Foundation** | Repo scaffold, Fastify + TypeScript + PostgreSQL, Azure OIDC login, OAuth 2.1 + PKCE, health check, Docker Compose |
| **v0.2 — Access Control** | Department model, Azure AD group sync, role-based access, group mapping UI |
| **v0.3 — M365 MCP** | M365 MCP container, credential flow, tool proxy, tool allowlists |
| **v0.4 — Audit & Admin** | Full audit logging, admin dashboard, audit CSV export |
| **v1.0 — Stable** | Docs site, CONTRIBUTING.md, FERPA documentation, security review, hosted mode, public GitHub release, Internet2/Apereo outreach |
| **v1.1 — LMS** | Canvas, Blackboard, Moodle MCP servers |
| **v2.0 — ERP** | Banner, Colleague with full FERPA compliance framework |
