/**
 * Migration 003: Superadmin and registration tables for multi-tenant mode.
 * Adds superadmin_emails, registration_tokens, and verified column to institutions.
 */

exports.up = (pgm) => {
  // Track superadmin emails (env-configured, but also storable in DB for audit)
  pgm.createTable('superadmin_emails', {
    email: { type: 'text', primaryKey: true },
    added_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // registration_tokens — for future invite-based registration flows
  pgm.createTable('registration_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', references: 'institutions', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // verified column on institutions — superadmin can verify/unverify institutions
  pgm.addColumn('institutions', {
    verified: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('institutions', 'verified');
  pgm.dropTable('registration_tokens');
  pgm.dropTable('superadmin_emails');
};
