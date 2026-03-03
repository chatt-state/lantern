/**
 * Checks tool allowlists from the database.
 * An empty allowlist means ALL tools are permitted for a given department+server.
 */
import type { Sql } from 'postgres';

export class AllowlistService {
  constructor(private readonly sql: Sql) {}

  /**
   * Returns the set of allowed tools for a department+server combination.
   * Empty set means ALL tools are allowed (no restriction configured).
   */
  async getAllowedTools(departmentId: string, serverSlug: string): Promise<Set<string>> {
    const [row] = await this.sql<Array<{ allowed_tools: string[] }>>`
      SELECT allowed_tools FROM tool_allowlists
      WHERE department_id = ${departmentId} AND server_slug = ${serverSlug}
    `;
    if (!row || row.allowed_tools.length === 0) return new Set(); // empty = all allowed
    return new Set(row.allowed_tools);
  }

  /**
   * Returns true if the tool is allowed for the given department+server.
   * If no allowlist is configured, all tools are allowed.
   */
  async isToolAllowed(departmentId: string, serverSlug: string, toolName: string): Promise<boolean> {
    const allowed = await this.getAllowedTools(departmentId, serverSlug);
    if (allowed.size === 0) return true; // no restriction
    return allowed.has(toolName);
  }

  /**
   * Returns true if the user has server access through any of their departments.
   */
  async hasServerAccess(userId: string, institutionId: string, serverSlug: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM server_access sa
      JOIN user_departments ud ON ud.department_id = sa.department_id
      WHERE ud.user_id = ${userId}
        AND sa.server_slug = ${serverSlug}
        AND sa.enabled = true
      LIMIT 1
    `;
    return row != null;
  }

  /**
   * Gets the first department where the user has access to the server.
   * Used for audit logging context.
   */
  async getUserDepartmentForServer(userId: string, serverSlug: string): Promise<string | null> {
    const [row] = await this.sql<Array<{ department_id: string }>>`
      SELECT ud.department_id FROM user_departments ud
      JOIN server_access sa ON sa.department_id = ud.department_id
      WHERE ud.user_id = ${userId}
        AND sa.server_slug = ${serverSlug}
        AND sa.enabled = true
      ORDER BY ud.created_at
      LIMIT 1
    `;
    return row?.department_id ?? null;
  }
}
