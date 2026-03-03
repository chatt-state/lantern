import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  effectiveRole,
  getRolePermissions,
  Permissions,
} from '../src/rbac/roles.js';

describe('RBAC roles', () => {
  it('institution_admin has all permissions', () => {
    expect(hasPermission('institution_admin', Permissions.MANAGE_DEPARTMENTS)).toBe(true);
    expect(hasPermission('institution_admin', Permissions.VIEW_ALL_AUDIT)).toBe(true);
    expect(hasPermission('institution_admin', Permissions.USE_TOOLS)).toBe(true);
  });

  it('department_admin has dept permissions but not institution permissions', () => {
    expect(hasPermission('department_admin', Permissions.MANAGE_TOOL_ACCESS)).toBe(true);
    expect(hasPermission('department_admin', Permissions.USE_TOOLS)).toBe(true);
    expect(hasPermission('department_admin', Permissions.MANAGE_DEPARTMENTS)).toBe(false);
    expect(hasPermission('department_admin', Permissions.VIEW_ALL_AUDIT)).toBe(false);
  });

  it('member can only use tools', () => {
    expect(hasPermission('member', Permissions.USE_TOOLS)).toBe(true);
    expect(hasPermission('member', Permissions.MANAGE_TOOL_ACCESS)).toBe(false);
    expect(hasPermission('member', Permissions.MANAGE_DEPARTMENTS)).toBe(false);
  });

  it('effectiveRole returns institution_admin when flag is set', () => {
    expect(effectiveRole(true, [])).toBe('institution_admin');
    expect(effectiveRole(true, ['member'])).toBe('institution_admin');
  });

  it('effectiveRole returns department_admin if any dept role is admin', () => {
    expect(effectiveRole(false, ['member', 'department_admin'])).toBe('department_admin');
  });

  it('effectiveRole returns member as fallback', () => {
    expect(effectiveRole(false, ['member'])).toBe('member');
    expect(effectiveRole(false, [])).toBe('member');
  });
});
