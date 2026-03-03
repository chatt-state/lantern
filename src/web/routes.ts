import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { getSession } from '../auth/session.js';
import { GroupSyncService } from '../graph/group-sync.js';
import { dashboardPage } from './templates/dashboard.js';

export function webRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const groupSync = new GroupSyncService(sql);

    // Root redirect
    app.get('/', async (request, reply) => {
      const session = getSession(request);
      return reply.redirect(session.userId ? '/settings' : '/auth/login');
    });

    // GET /settings — personal dashboard
    app.get('/settings', async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) return reply.redirect('/auth/login');

      const departments = await groupSync.getUserDepartments(session.userId);

      return reply.type('text/html').send(
        dashboardPage({
          session,
          departments,
          currentPath: '/settings',
        }),
      );
    });

    // GET /settings/department — department overview (stub for now)
    app.get('/settings/department', async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) return reply.redirect('/auth/login');
      return reply
        .type('text/html')
        .send(
          `<!DOCTYPE html><html><body><p>Department view coming soon. <a href="/settings">Back</a></p></body></html>`,
        );
    });

    // GET /settings/admin — institution admin panel (stub)
    app.get('/settings/admin', async (request, reply) => {
      const session = getSession(request);
      if (!session.userId) return reply.redirect('/auth/login');
      if (!session.institutionAdmin)
        return reply.status(403).type('text/html').send('<p>Access denied.</p>');
      return reply
        .type('text/html')
        .send(
          `<!DOCTYPE html><html><body><p>Admin panel coming soon (Task 12). <a href="/settings">Back</a></p></body></html>`,
        );
    });

    // Admin sub-routes — all stub for now, implemented in Task 12
    for (const path of [
      '/settings/admin/departments',
      '/settings/admin/members',
      '/settings/admin/servers',
      '/settings/admin/audit',
    ]) {
      app.get(path, async (request, reply) => {
        const session = getSession(request);
        if (!session.userId) return reply.redirect('/auth/login');
        if (!session.institutionAdmin)
          return reply.status(403).type('text/html').send('<p>Access denied.</p>');
        return reply
          .type('text/html')
          .send(
            `<!DOCTYPE html><html><body><p>Coming soon. <a href="/settings/admin">Back</a></p></body></html>`,
          );
      });
    }
  };
}
