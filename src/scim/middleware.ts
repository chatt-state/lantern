import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';

declare module 'fastify' {
  interface FastifyRequest {
    scimInstitutionId?: string;
  }
}

export function createScimAuth(sql: Sql) {
  return async function scimAuth(request: FastifyRequest, reply: FastifyReply) {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing Bearer token' });
    }
    const rawToken = auth.slice(7);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const [row] = await sql<{ id: string; institution_id: string }[]>`
      SELECT id, institution_id FROM scim_tokens WHERE token_hash = ${tokenHash}
    `;
    if (!row) {
      return reply.status(401).send({ error: 'Invalid SCIM token' });
    }

    // Update last_used_at in background
    sql`UPDATE scim_tokens SET last_used_at = NOW() WHERE id = ${row.id}`.catch(() => {});

    request.scimInstitutionId = row.institution_id;
  };
}
