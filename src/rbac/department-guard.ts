import type { Sql } from 'postgres';
import type { DepartmentRole } from './roles.js';

export class DepartmentGuard {
  constructor(private readonly sql: Sql) {}

  /**
   * Returns the user's role in a specific department, or null if they have no access.
   * Institution admins are treated as having department_admin in all departments.
   */
  async getUserRoleInDepartment(params: {
    userId: string;
    departmentId: string;
    institutionAdmin: boolean;
  }): Promise<DepartmentRole | null> {
    if (params.institutionAdmin) return 'department_admin';

    const [row] = await this.sql<Array<{ role: string }>>`
      SELECT ud.role
      FROM user_departments ud
      JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id = ${params.userId}
        AND ud.department_id = ${params.departmentId}
    `;

    if (!row) return null;
    return row.role as DepartmentRole;
  }

  /**
   * Returns true if the user can administer a specific department.
   */
  async canAdminDepartment(params: {
    userId: string;
    departmentId: string;
    institutionAdmin: boolean;
  }): Promise<boolean> {
    const role = await this.getUserRoleInDepartment(params);
    return role === 'department_admin';
  }

  /**
   * Returns all department IDs where the user has department_admin role.
   */
  async getAdminDepartments(userId: string): Promise<string[]> {
    const rows = await this.sql<Array<{ department_id: string }>>`
      SELECT department_id FROM user_departments
      WHERE user_id = ${userId} AND role = 'department_admin'
    `;
    return rows.map((r) => r.department_id);
  }
}
