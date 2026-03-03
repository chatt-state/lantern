/**
 * Performance indexes for Lantern.
 * Covers: tenant isolation lookups, OAuth flows, audit queries.
 */

exports.up = (pgm) => {
  // tenant isolation lookups
  pgm.createIndex('users', 'institution_id');
  pgm.createIndex('users', ['institution_id', 'azure_oid']);
  pgm.createIndex('departments', 'institution_id');
  pgm.createIndex('group_mappings', 'institution_id');
  pgm.createIndex('user_departments', 'user_id');
  pgm.createIndex('user_departments', 'department_id');

  // OAuth lookups
  pgm.createIndex('auth_codes', 'expires_at');
  pgm.createIndex('access_tokens', 'expires_at');
  pgm.createIndex('access_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'expires_at');
  pgm.createIndex('sessions', 'expires_at');
  pgm.createIndex('sessions', 'user_id');

  // audit queries
  pgm.createIndex('audit_log', ['institution_id', 'created_at']);
  pgm.createIndex('audit_log', 'user_id');
  pgm.createIndex('admin_audit_log', ['institution_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('admin_audit_log', ['institution_id', 'created_at']);
  pgm.dropIndex('audit_log', 'user_id');
  pgm.dropIndex('audit_log', ['institution_id', 'created_at']);
  pgm.dropIndex('sessions', 'user_id');
  pgm.dropIndex('sessions', 'expires_at');
  pgm.dropIndex('refresh_tokens', 'expires_at');
  pgm.dropIndex('refresh_tokens', 'user_id');
  pgm.dropIndex('access_tokens', 'user_id');
  pgm.dropIndex('access_tokens', 'expires_at');
  pgm.dropIndex('auth_codes', 'expires_at');
  pgm.dropIndex('user_departments', 'department_id');
  pgm.dropIndex('user_departments', 'user_id');
  pgm.dropIndex('group_mappings', 'institution_id');
  pgm.dropIndex('departments', 'institution_id');
  pgm.dropIndex('users', ['institution_id', 'azure_oid']);
  pgm.dropIndex('users', 'institution_id');
};
