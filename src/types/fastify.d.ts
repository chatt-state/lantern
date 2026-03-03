import type { TokenAuthResult } from '../rbac/token-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    tokenAuth?: TokenAuthResult;
  }
}
