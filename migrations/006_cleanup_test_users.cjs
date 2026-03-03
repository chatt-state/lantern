exports.up = (pgm) => {
  // Remove test users created during SCIM integration debugging
  pgm.sql(`
    DELETE FROM users
    WHERE azure_oid IN ('test-oid-999', 'test-oid-888', 'test-oid-777')
       OR email IN ('test@test.com', 'test2@test.com', 'test3@test.com')
  `);
};

exports.down = () => {
  // No rollback — test users should not be re-created
};
