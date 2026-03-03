# Deployment Guide

## Prerequisites

- Docker Engine 24+
- Docker Compose v2 (`docker compose` not `docker-compose`)

## Quick Start

```bash
# 1. Copy the example env file and fill in required values
cp .env.example .env
$EDITOR .env

# 2. Start everything (postgres, migrations, gateway, m365-mcp)
docker compose up -d

# 3. Verify all services are healthy
docker compose ps
```

The gateway will be available at `http://<host>:${PORT:-8080}`.

## Required Variables

Before first boot, set these in `.env`:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Password for the managed postgres service |
| `MASTER_KEY` | 32-byte hex key used to encrypt stored tokens |
| `JWT_SECRET` | Secret for signing gateway JWT sessions |
| `AZURE_TENANT_ID` | Entra ID tenant GUID |
| `AZURE_CLIENT_ID` | App registration client ID |
| `AZURE_CLIENT_SECRET` | App registration client secret |
| `AZURE_CALLBACK_URL` | Must match the redirect URI registered in Azure (e.g. `https://lantern.example.edu/auth/callback`) |
| `BASE_URL` | Public URL of the gateway (used in OAuth metadata) |

### Azure App Registration

1. Go to [portal.azure.com](https://portal.azure.com) > Entra ID > App registrations > New registration.
2. Set the redirect URI to the value of `AZURE_CALLBACK_URL`.
3. Under "Certificates & secrets", create a client secret and copy it to `AZURE_CLIENT_SECRET`.
4. Copy the Application (client) ID to `AZURE_CLIENT_ID` and the Directory (tenant) ID to `AZURE_TENANT_ID`.
5. Grant API permissions: `openid`, `profile`, `email`, `User.Read`.

For the M365 MCP server, create a second app registration (or reuse the same one) and set `MICROSOFT_GRAPH_CLIENT_ID` / `MICROSOFT_GRAPH_CLIENT_SECRET`. Required Graph permissions: `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `Files.Read`, `User.Read.All`.

## Development Mode

Uses `tsx watch` for hot reload and exposes postgres on port 5432:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Upgrading

```bash
docker compose pull          # pull updated base images (if using pre-built images)
docker compose build         # rebuild from source
docker compose up -d         # recreate changed containers; migrations run automatically
```

## Troubleshooting

**View logs**

```bash
docker compose logs -f lantern
docker compose logs migrate
```

**Check service health**

```bash
docker compose ps
curl http://localhost:8080/health
```

**Reset the database** (destructive — deletes all data)

```bash
docker compose down -v       # removes containers and the pgdata volume
docker compose up -d
```

**Migration failures**

```bash
docker compose run --rm migrate npm run migrate
```
