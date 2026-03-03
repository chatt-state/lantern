exports.up = (pgm) => {
  // Add external_id to departments for Azure SCIM group object ID
  pgm.addColumn('departments', {
    external_id: { type: 'text' },
    active: { type: 'boolean', notNull: true, default: true },
  });

  // SCIM provisioning tokens
  pgm.createTable('scim_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    institution_id: { type: 'uuid', notNull: true, references: 'institutions', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
  });
  pgm.createIndex('scim_tokens', 'institution_id');
};

exports.down = (pgm) => {
  pgm.dropTable('scim_tokens');
  pgm.dropColumn('departments', 'active');
  pgm.dropColumn('departments', 'external_id');
};
