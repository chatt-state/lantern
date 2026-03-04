import type { Sql } from 'postgres';
import type { GroupMapping, UserDepartment } from '../db/schema.js';
import { getUserGroups } from './client.js';

export interface SyncResult {
  groupsFound: number;
  departmentsAssigned: string[];
  rolesApplied: Record<string, string>;
}

export class GroupSyncService {
  constructor(private readonly sql: Sql) {}

  /**
   * Syncs a user's Azure AD groups to their Lantern department memberships.
   * Called after successful Azure SSO login.
   *
   * Flow:
   * 1. Fetch user's Azure AD groups via Graph API
   * 2. Look up mappings in group_mappings table
   * 3. Upsert user_departments rows (skip if manual_override = true)
   * 4. Remove stale non-override department memberships
   */
  async syncUserGroups(params: {
    userId: string;
    institutionId: string;
    accessToken: string;
  }): Promise<SyncResult> {
    const { userId, institutionId, accessToken } = params;

    // Fetch groups from Azure AD
    let azureGroups: string[];
    try {
      azureGroups = await getUserGroups(accessToken);
    } catch (err) {
      // Graph API failure should not block login — log and return empty sync
      console.error('Graph API group fetch failed:', err);
      return { groupsFound: 0, departmentsAssigned: [], rolesApplied: {} };
    }

    if (azureGroups.length === 0) {
      return { groupsFound: 0, departmentsAssigned: [], rolesApplied: {} };
    }

    // Look up mappings for this institution
    const mappings = await this.sql<(GroupMapping & { department_name: string })[]>`
      SELECT gm.*, d.name as department_name
      FROM group_mappings gm
      JOIN departments d ON d.id = gm.department_id
      WHERE gm.institution_id = ${institutionId}
        AND gm.azure_group_name = ANY(${azureGroups})
    `;

    if (mappings.length === 0) {
      return { groupsFound: azureGroups.length, departmentsAssigned: [], rolesApplied: {} };
    }

    const departmentsAssigned: string[] = [];
    const rolesApplied: Record<string, string> = {};

    // Upsert user_departments for each matched mapping
    for (const mapping of mappings) {
      // Don't overwrite manual overrides
      const existing = await this.sql<UserDepartment[]>`
        SELECT * FROM user_departments
        WHERE user_id = ${userId} AND department_id = ${mapping.department_id}
      `;

      if (existing[0]?.manual_override) {
        // Respect manual override — don't change role
        continue;
      }

      await this.sql`
        INSERT INTO user_departments (user_id, department_id, role, manual_override)
        VALUES (${userId}, ${mapping.department_id}, ${mapping.role}, false)
        ON CONFLICT (user_id, department_id) DO UPDATE SET
          role = EXCLUDED.role,
          updated_at = now()
        WHERE user_departments.manual_override = false
      `;

      const deptName = mapping.department_name ?? mapping.department_id;
      departmentsAssigned.push(deptName);
      rolesApplied[deptName] = mapping.role;
    }

    // Remove stale non-override memberships (departments where user no longer has a matching group).
    // Only clean up if we actually matched at least one mapping — if no group_mappings are
    // configured, skip cleanup entirely to preserve SCIM-provisioned memberships.
    const mappedDeptIds = mappings.map((m) => m.department_id);
    if (mappedDeptIds.length > 0) {
      await this.sql`
        DELETE FROM user_departments
        WHERE user_id = ${userId}
          AND manual_override = false
          AND department_id NOT IN ${this.sql(mappedDeptIds)}
      `;
    }

    return {
      groupsFound: azureGroups.length,
      departmentsAssigned,
      rolesApplied,
    };
  }

  /**
   * Returns a user's current department memberships with department names.
   */
  async getUserDepartments(
    userId: string,
  ): Promise<Array<{ departmentId: string; departmentName: string; role: string }>> {
    const rows = await this.sql<Array<{ department_id: string; name: string; role: string }>>`
      SELECT ud.department_id, d.name, ud.role
      FROM user_departments ud
      JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id = ${userId}
      ORDER BY d.name
    `;
    return rows.map((r) => ({ departmentId: r.department_id, departmentName: r.name, role: r.role }));
  }
}
