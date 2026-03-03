import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from './session.js';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = getSession(request);
  if (!session.userId) {
    // For API routes return JSON, for UI routes redirect to login
    const isApiRoute = request.url.startsWith('/api/');
    if (isApiRoute) {
      reply.status(401).send({ error: 'Unauthorized' });
    } else {
      reply.redirect('/auth/login');
    }
  }
}

export async function requireInstitutionAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = getSession(request);
  if (!session.userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  if (!session.institutionAdmin) {
    reply.status(403).send({ error: 'Institution admin role required' });
  }
}
