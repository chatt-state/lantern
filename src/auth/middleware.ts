import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from './session.js';
import { config } from '../config.js';
import type { Sql } from 'postgres';

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

export function requireSuperadmin(request: FastifyRequest, reply: FastifyReply): void {
  const session = getSession(request);
  if (!session.userId) {
    reply.redirect('/auth/login');
    return;
  }
  if (!config.superadminEmails.includes(session.email ?? '')) {
    reply.status(403).send({ error: 'Superadmin access required' });
  }
}

/**
 * Requires the user to be a department admin for the department in :departmentId param.
 * Institution admins pass automatically.
 * Requires the request to have already been through requireAuth.
 */
export function requireDepartmentAdmin(sql: Sql) {
  return async function (request: FastifyRequest<{ Params: { departmentId?: string } }>, reply: FastifyReply): Promise<void> {
    const session = getSession(request);
    if (!session.userId) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (session.institutionAdmin) return; // institution admins pass all dept checks

    const departmentId = request.params?.departmentId;
    if (!departmentId) {
      reply.status(400).send({ error: 'Missing departmentId parameter' });
      return;
    }

    const { DepartmentGuard } = await import('../rbac/department-guard.js');
    const guard = new DepartmentGuard(sql);
    const canAdmin = await guard.canAdminDepartment({
      userId: session.userId,
      departmentId,
      institutionAdmin: false,
    });

    if (!canAdmin) {
      reply.status(403).send({ error: 'Department admin role required' });
    }
  };
}
