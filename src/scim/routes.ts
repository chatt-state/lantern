import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Sql } from 'postgres';
import { createScimAuth } from './middleware.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow { id: string; azure_oid: string; email: string; display_name: string; active: boolean }
interface DeptRow { id: string; external_id: string | null; name: string }
interface MemberRow { id: string; email: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a simple SCIM filter like: fieldName eq "value" */
function parseFilter(filter: string | undefined): { field: string; value: string } | null {
  if (!filter) return null;
  const m = filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/i);
  if (!m) return null;
  return { field: m[1], value: m[2] };
}

function listResponse(resources: unknown[]) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: resources.length,
    Resources: resources,
  };
}

function scimUser(u: UserRow) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: u.id,
    externalId: u.azure_oid,
    userName: u.email,
    displayName: u.display_name,
    active: u.active,
    meta: { resourceType: 'User', location: `/scim/v2/Users/${u.id}` },
  };
}

function scimGroup(d: DeptRow, members: { value: string; display: string }[]) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: d.id,
    externalId: d.external_id,
    displayName: d.name,
    members,
    meta: { resourceType: 'Group', location: `/scim/v2/Groups/${d.id}` },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function scimRoutes(sql: Sql) {
  return async function (app: FastifyInstance) {
    const scimAuth = createScimAuth(sql);

    // -----------------------------------------------------------------------
    // Discovery (no auth)
    // -----------------------------------------------------------------------

    app.get('/scim/v2/ServiceProviderConfig', async () => ({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Authentication via Bearer token' }],
    }));

    app.get('/scim/v2/Schemas', async () => ({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      Resources: [
        { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User' },
        { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group' },
      ],
    }));

    app.get('/scim/v2/ResourceTypes', async () => ({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      Resources: [
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User' },
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group' },
      ],
    }));

    // -----------------------------------------------------------------------
    // Users (auth required)
    // -----------------------------------------------------------------------

    app.get('/scim/v2/Users', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const filter = parseFilter((request.query as { filter?: string }).filter);

      let users;
      if (filter?.field === 'externalId') {
        users = await sql<UserRow[]>`SELECT * FROM users WHERE institution_id = ${instId} AND azure_oid = ${filter.value}`;
      } else if (filter?.field === 'userName') {
        users = await sql<UserRow[]>`SELECT * FROM users WHERE institution_id = ${instId} AND email = ${filter.value}`;
      } else {
        users = await sql<UserRow[]>`SELECT * FROM users WHERE institution_id = ${instId} ORDER BY created_at LIMIT 200`;
      }
      return listResponse(users.map(scimUser));
    });

    app.get('/scim/v2/Users/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const [user] = await sql<UserRow[]>`SELECT * FROM users WHERE id = ${id} AND institution_id = ${instId}`;
      if (!user) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });
      return scimUser(user);
    });

    app.post('/scim/v2/Users', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const body = request.body as { externalId?: string; userName?: string; displayName?: string; active?: boolean };
      const externalId = body.externalId ?? '';
      const email = body.userName ?? '';
      const displayName = body.displayName ?? email;
      const active = body.active !== false;

      // Check for conflict
      const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE institution_id = ${instId} AND azure_oid = ${externalId}`;
      if (existing) return reply.status(409).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User already exists', status: '409' });

      const [user] = await sql<UserRow[]>`
        INSERT INTO users (institution_id, azure_oid, email, display_name, active)
        VALUES (${instId}, ${externalId}, ${email}, ${displayName}, ${active})
        RETURNING *
      `;
      return reply.status(201).send(scimUser(user));
    });

    app.patch('/scim/v2/Users/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const body = request.body as { Operations?: { op: string; path?: string; value?: unknown }[] };

      const [user] = await sql<UserRow[]>`SELECT * FROM users WHERE id = ${id} AND institution_id = ${instId}`;
      if (!user) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });

      for (const op of body.Operations ?? []) {
        const opName = op.op.toLowerCase();
        if (opName === 'replace') {
          const val = op.value as Record<string, unknown> | undefined;
          if (op.path === 'active' || val?.active !== undefined) {
            const active = op.path === 'active' ? op.value as boolean : val!.active as boolean;
            await sql`UPDATE users SET active = ${active}, updated_at = NOW() WHERE id = ${id}`;
          }
          if (op.path === 'displayName' || val?.displayName !== undefined) {
            const dn = op.path === 'displayName' ? op.value as string : val!.displayName as string;
            await sql`UPDATE users SET display_name = ${dn}, updated_at = NOW() WHERE id = ${id}`;
          }
          if (op.path === 'userName' || val?.userName !== undefined) {
            const un = op.path === 'userName' ? op.value as string : val!.userName as string;
            await sql`UPDATE users SET email = ${un}, updated_at = NOW() WHERE id = ${id}`;
          }
        }
      }

      const [updated] = await sql<UserRow[]>`SELECT * FROM users WHERE id = ${id}`;
      return scimUser(updated);
    });

    app.delete('/scim/v2/Users/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE id = ${id} AND institution_id = ${instId}`;
      if (!user) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });

      await sql`UPDATE users SET active = false, updated_at = NOW() WHERE id = ${id}`;
      return reply.status(204).send();
    });

    // -----------------------------------------------------------------------
    // Groups (auth required)
    // -----------------------------------------------------------------------

    async function getGroupMembers(deptId: string) {
      const rows = await sql<MemberRow[]>`
        SELECT u.id, u.email FROM user_departments ud
        JOIN users u ON u.id = ud.user_id
        WHERE ud.department_id = ${deptId}
      `;
      return rows.map((r) => ({ value: r.id, display: r.email }));
    }

    app.get('/scim/v2/Groups', { preHandler: scimAuth }, async (request: FastifyRequest) => {
      const instId = request.scimInstitutionId!;
      const filter = parseFilter((request.query as { filter?: string }).filter);

      let depts;
      if (filter?.field === 'displayName') {
        depts = await sql<DeptRow[]>`SELECT * FROM departments WHERE institution_id = ${instId} AND name = ${filter.value}`;
      } else if (filter?.field === 'externalId') {
        depts = await sql<DeptRow[]>`SELECT * FROM departments WHERE institution_id = ${instId} AND external_id = ${filter.value}`;
      } else {
        depts = await sql<DeptRow[]>`SELECT * FROM departments WHERE institution_id = ${instId} ORDER BY created_at LIMIT 200`;
      }

      const resources = await Promise.all(depts.map(async (d) => scimGroup(d, await getGroupMembers(d.id))));
      return listResponse(resources);
    });

    app.get('/scim/v2/Groups/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const [dept] = await sql<DeptRow[]>`SELECT * FROM departments WHERE id = ${id} AND institution_id = ${instId}`;
      if (!dept) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Group not found', status: '404' });
      return scimGroup(dept, await getGroupMembers(dept.id));
    });

    app.post('/scim/v2/Groups', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const body = request.body as { displayName?: string; externalId?: string; members?: { value: string }[] };
      const name = body.displayName ?? '';
      const externalId = body.externalId ?? null;

      // Check for conflict
      const [existing] = await sql<{ id: string }[]>`SELECT id FROM departments WHERE institution_id = ${instId} AND name = ${name}`;
      if (existing) return reply.status(409).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Group already exists', status: '409' });

      const [dept] = await sql<DeptRow[]>`
        INSERT INTO departments (institution_id, name, external_id)
        VALUES (${instId}, ${name}, ${externalId})
        RETURNING *
      `;

      // Add members if provided
      if (body.members?.length) {
        for (const m of body.members) {
          const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE azure_oid = ${m.value} AND institution_id = ${instId}`;
          if (user) {
            await sql`
              INSERT INTO user_departments (user_id, department_id, role)
              VALUES (${user.id}, ${dept.id}, 'member')
              ON CONFLICT (user_id, department_id) DO NOTHING
            `;
          }
        }
      }

      return reply.status(201).send(scimGroup(dept, await getGroupMembers(dept.id)));
    });

    app.patch('/scim/v2/Groups/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const body = request.body as { Operations?: { op: string; path?: string; value?: unknown }[] };

      const [dept] = await sql<DeptRow[]>`SELECT * FROM departments WHERE id = ${id} AND institution_id = ${instId}`;
      if (!dept) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Group not found', status: '404' });

      for (const op of body.Operations ?? []) {
        const opName = op.op.toLowerCase();

        if (opName === 'replace' && op.path === 'displayName') {
          await sql`UPDATE departments SET name = ${op.value as string}, updated_at = NOW() WHERE id = ${id}`;
        }

        if (opName === 'add' && op.path === 'members') {
          const members = op.value as { value: string }[];
          for (const m of members) {
            const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE azure_oid = ${m.value} AND institution_id = ${instId}`;
            if (user) {
              await sql`
                INSERT INTO user_departments (user_id, department_id, role)
                VALUES (${user.id}, ${id}, 'member')
                ON CONFLICT (user_id, department_id) DO NOTHING
              `;
            }
          }
        }

        if (opName === 'remove') {
          // Handle both: path = "members" with value array, and path = 'members[value eq "xxx"]'
          if (op.path === 'members' && op.value) {
            const members = op.value as { value: string }[];
            for (const m of members) {
              const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE azure_oid = ${m.value} AND institution_id = ${instId}`;
              if (user) {
                await sql`DELETE FROM user_departments WHERE user_id = ${user.id} AND department_id = ${id}`;
              }
            }
          } else if (op.path?.startsWith('members[')) {
            // Parse: members[value eq "azure-oid"]
            const match = op.path.match(/members\[value\s+eq\s+"([^"]+)"\]/i);
            if (match) {
              const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE azure_oid = ${match[1]} AND institution_id = ${instId}`;
              if (user) {
                await sql`DELETE FROM user_departments WHERE user_id = ${user.id} AND department_id = ${id}`;
              }
            }
          }
        }
      }

      const [updated] = await sql<DeptRow[]>`SELECT * FROM departments WHERE id = ${id}`;
      return scimGroup(updated, await getGroupMembers(id));
    });

    app.delete('/scim/v2/Groups/:id', { preHandler: scimAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      const instId = request.scimInstitutionId!;
      const { id } = request.params as { id: string };
      const [dept] = await sql<{ id: string }[]>`SELECT id FROM departments WHERE id = ${id} AND institution_id = ${instId}`;
      if (!dept) return reply.status(404).send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Group not found', status: '404' });

      await sql`UPDATE departments SET active = false, updated_at = NOW() WHERE id = ${id}`;
      return reply.status(204).send();
    });
  };
}
