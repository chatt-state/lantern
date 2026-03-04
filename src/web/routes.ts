import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { getSession } from '../auth/session.js';
import { GroupSyncService } from '../graph/group-sync.js';
import { dashboardPage } from './templates/dashboard.js';
import { landingPage } from './templates/landing.js';
import { config } from '../config.js';

export function webRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const groupSync = new GroupSyncService(sql);

    // Root — show landing page for anonymous users, redirect to settings if logged in
    app.get('/', async (request, reply) => {
      const session = getSession(request);
      if (session.userId) return reply.redirect('/settings');
      return reply.type('text/html').send(landingPage({ baseUrl: config.baseUrl }));
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

    // Note: /settings/department and sub-routes are handled by departmentRoutes (src/department/routes.ts)
    // Note: /settings/admin and sub-routes are handled by adminRoutes (src/admin/routes.ts)
    // Note: /settings/admin/audit is handled by auditRoutes (src/audit/routes.ts)
  };
}
