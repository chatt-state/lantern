/**
 * RBAC role definitions for Lantern.
 */

export type InstitutionRole = 'institution_admin';
export type DepartmentRole = 'department_admin' | 'member';
export type AnyRole = InstitutionRole | DepartmentRole;

/**
 * Permission definitions — what each role can do.
 */
export const Permissions = {
  // Institution-level
  MANAGE_DEPARTMENTS: 'manage_departments',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_SERVERS: 'manage_servers',
  VIEW_ALL_AUDIT: 'view_all_audit',
  MANAGE_GROUP_MAPPINGS: 'manage_group_mappings',
  // Department-level
  MANAGE_DEPT_MEMBERS: 'manage_dept_members',
  MANAGE_TOOL_ACCESS: 'manage_tool_access',
  VIEW_DEPT_AUDIT: 'view_dept_audit',
  // MCP usage
  USE_TOOLS: 'use_tools',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

// What institution admins can do
const INSTITUTION_ADMIN_PERMISSIONS: Set<Permission> = new Set([
  Permissions.MANAGE_DEPARTMENTS,
  Permissions.MANAGE_MEMBERS,
  Permissions.MANAGE_SERVERS,
  Permissions.VIEW_ALL_AUDIT,
  Permissions.MANAGE_GROUP_MAPPINGS,
  Permissions.MANAGE_DEPT_MEMBERS,
  Permissions.MANAGE_TOOL_ACCESS,
  Permissions.VIEW_DEPT_AUDIT,
  Permissions.USE_TOOLS,
]);

// What department admins can do (within their department)
const DEPARTMENT_ADMIN_PERMISSIONS: Set<Permission> = new Set([
  Permissions.MANAGE_DEPT_MEMBERS,
  Permissions.MANAGE_TOOL_ACCESS,
  Permissions.VIEW_DEPT_AUDIT,
  Permissions.USE_TOOLS,
]);

// What members can do
const MEMBER_PERMISSIONS: Set<Permission> = new Set([
  Permissions.USE_TOOLS,
]);

export function getRolePermissions(role: AnyRole): Set<Permission> {
  switch (role) {
    case 'institution_admin': return INSTITUTION_ADMIN_PERMISSIONS;
    case 'department_admin': return DEPARTMENT_ADMIN_PERMISSIONS;
    case 'member': return MEMBER_PERMISSIONS;
  }
}

/**
 * Returns true if the given role has the given permission.
 */
export function hasPermission(role: AnyRole, permission: Permission): boolean {
  return getRolePermissions(role).has(permission);
}

/**
 * Returns the effective role for a user:
 * - institution_admin if they are an institution admin
 * - department_admin if they are a dept admin in any department
 * - member otherwise
 * Used for quick permission checks that don't need department scoping.
 */
export function effectiveRole(institutionAdmin: boolean, deptRoles: DepartmentRole[]): AnyRole {
  if (institutionAdmin) return 'institution_admin';
  if (deptRoles.includes('department_admin')) return 'department_admin';
  return 'member';
}
