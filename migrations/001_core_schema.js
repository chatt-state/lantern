/**
 * Core schema for Lantern.
 * Tables: institutions, users, departments, group_mappings,
 *         user_departments, server_access, tool_allowlists,
 *         user_credentials, oauth_clients, auth_codes, access_tokens,
 *         refresh_tokens, sessions, audit_log, admin_audit_log
 */

exports.up = (pgm) => {
  // institutions — one row per college/university
  pgm.createTable('institutions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    domain: { type: 'text', notNull: true, unique: true },
    azure_tenant_id: { type: 'text', notNull: true, unique: true },
    azure_client_id: { type: 'text', notNull: true },
    azure_client_secret_enc: { type: 'text', notNull: true }, // AES-256-GCM encrypted
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // users
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    azure_oid: { type: 'text', notNull: true }, // Azure AD object ID
    email: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    institution_admin: { type: 'boolean', notNull: true, default: false },
    active: { type: 'boolean', notNull: true, default: true },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('users', 'users_institution_azure_oid_unique', 'UNIQUE (institution_id, azure_oid)');

  // departments — maps to Azure AD groups
  pgm.createTable('departments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('departments', 'departments_institution_name_unique', 'UNIQUE (institution_id, name)');

  // group_mappings — Azure AD group display name → department + role
  // role values: 'member' | 'department_admin'
  pgm.createTable('group_mappings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    azure_group_name: { type: 'text', notNull: true },
    department_id: { type: 'uuid', notNull: true, references: 'departments', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'member' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('group_mappings', 'group_mappings_unique', 'UNIQUE (institution_id, azure_group_name, department_id)');

  // user_departments — resolved membership after group sync
  // role values: 'member' | 'department_admin'
  pgm.createTable('user_departments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    department_id: { type: 'uuid', notNull: true, references: 'departments', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'member' },
    manual_override: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('user_departments', 'user_departments_unique', 'UNIQUE (user_id, department_id)');

  // server_access — which departments can use which MCP servers
  pgm.createTable('server_access', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    department_id: { type: 'uuid', notNull: true, references: 'departments', onDelete: 'CASCADE' },
    server_slug: { type: 'text', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('server_access', 'server_access_unique', 'UNIQUE (department_id, server_slug)');

  // tool_allowlists — per-department per-server tool allowlists
  pgm.createTable('tool_allowlists', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    department_id: { type: 'uuid', notNull: true, references: 'departments', onDelete: 'CASCADE' },
    server_slug: { type: 'text', notNull: true },
    allowed_tools: { type: 'text[]', notNull: true, default: '{}' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('tool_allowlists', 'tool_allowlists_unique', 'UNIQUE (department_id, server_slug)');

  // user_credentials — AES-256-GCM encrypted per-user tokens (e.g. M365 OAuth tokens)
  pgm.createTable('user_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    server_slug: { type: 'text', notNull: true },
    ciphertext: { type: 'text', notNull: true }, // JSON blob, AES-256-GCM encrypted
    iv: { type: 'text', notNull: true },
    tag: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('user_credentials', 'user_credentials_unique', 'UNIQUE (user_id, server_slug)');

  // oauth_clients — registered MCP clients (Claude Desktop, etc.)
  // institution_id null = global client
  pgm.createTable('oauth_clients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', references: 'institutions', onDelete: 'CASCADE' },
    client_id: { type: 'text', notNull: true, unique: true },
    client_name: { type: 'text' },
    redirect_uris: { type: 'text[]', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // auth_codes — short-lived OAuth 2.1 authorization codes
  pgm.createTable('auth_codes', {
    code: { type: 'text', primaryKey: true },
    client_id: { type: 'text', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    redirect_uri: { type: 'text', notNull: true },
    code_challenge: { type: 'text', notNull: true },
    code_challenge_method: { type: 'text', notNull: true, default: 'S256' },
    scope: { type: 'text' },
    session_id: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // access_tokens — SHA-256 of the actual token stored as primary key
  pgm.createTable('access_tokens', {
    token_hash: { type: 'text', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    client_id: { type: 'text', notNull: true },
    scope: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // refresh_tokens
  pgm.createTable('refresh_tokens', {
    token_hash: { type: 'text', primaryKey: true },
    access_token_hash: { type: 'text', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    client_id: { type: 'text', notNull: true },
    scope: { type: 'text' },
    revoked: { type: 'boolean', notNull: true, default: false },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // sessions — web session storage
  pgm.createTable('sessions', {
    id: { type: 'text', primaryKey: true },
    user_id: { type: 'uuid', references: 'users', onDelete: 'CASCADE' },
    data: { type: 'jsonb', notNull: true, default: '{}' },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // audit_log — every MCP proxy request
  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    department_id: { type: 'uuid', references: 'departments', onDelete: 'SET NULL' },
    server_slug: { type: 'text', notNull: true },
    tool_name: { type: 'text' },
    method: { type: 'text', notNull: true },
    status_code: { type: 'integer' },
    latency_ms: { type: 'integer' },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // admin_audit_log — admin actions (role changes, config changes, etc.)
  pgm.createTable('admin_audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    actor_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    target_type: { type: 'text' },
    target_id: { type: 'uuid' },
    details: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  // drop in reverse order to respect foreign key constraints
  pgm.dropTable('admin_audit_log');
  pgm.dropTable('audit_log');
  pgm.dropTable('sessions');
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('access_tokens');
  pgm.dropTable('auth_codes');
  pgm.dropTable('oauth_clients');
  pgm.dropTable('user_credentials');
  pgm.dropTable('tool_allowlists');
  pgm.dropTable('server_access');
  pgm.dropTable('user_departments');
  pgm.dropTable('group_mappings');
  pgm.dropTable('departments');
  pgm.dropTable('users');
  pgm.dropTable('institutions');
};
