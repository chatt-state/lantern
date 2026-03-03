# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
