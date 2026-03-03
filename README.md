# Lantern

**AI tooling for higher ed — deployed in an afternoon.**

Lantern is an open-source MCP (Model Context Protocol) gateway built for community colleges and
universities. It wraps your institution's data sources and tools behind a single, authenticated
gateway — with Azure Active Directory SSO baked in from day one.

## Overview

- Single gateway for all MCP-compatible AI tools
- Azure AD / Entra ID SSO out of the box
- Rate limiting and audit logging per user
- Docker-first deployment — no Kubernetes required
- Apache-2.0 licensed and community-driven

## Quick Start

```bash
git clone https://github.com/chatt-state/lantern.git
cd lantern
cp .env.example .env   # fill in Azure credentials and DB URL
docker compose up
```

Lantern listens on port 8080 by default. Visit `http://localhost:8080/health` to confirm it is
running.

## Azure SSO Setup

1. In the Azure portal, register a new application under your tenant.
2. Set the redirect URI to `https://<your-domain>/auth/callback`.
3. Copy the **Client ID**, **Tenant ID**, and create a **Client Secret**.
4. Add these values to your `.env` file:

```env
AZURE_CLIENT_ID=...
AZURE_TENANT_ID=...
AZURE_CLIENT_SECRET=...
```

5. Grant the app `User.Read` delegated permission and grant admin consent.

## Configuration

Full configuration reference lives in [`docs/configuration.md`](docs/configuration.md).

Key environment variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AZURE_CLIENT_ID` | Azure app registration client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_CLIENT_SECRET` | Azure app client secret |
| `PORT` | HTTP port (default: 8080) |

## License

Apache-2.0 — Copyright 2026 Chattanooga State Community College.
See [LICENSE](LICENSE) for full terms.
