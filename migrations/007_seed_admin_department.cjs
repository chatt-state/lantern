/**
 * Seed: promote institution admin.
 *
 * Sets aaron.sachs@chattanoogastate.edu as institution_admin.
 * Department memberships are restored via SCIM re-sync (restart the Azure AD sync job).
 *
 * Root cause of missing memberships: the group sync at login deletes all non-manual
 * user_departments when no group_mappings are configured (empty else branch).
 * Fix for that is in group-sync.ts (007 addresses admin access; fix is in code).
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users
    SET institution_admin = true, updated_at = NOW()
    WHERE email = 'aaron.sachs@chattanoogastate.edu'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE users
    SET institution_admin = false, updated_at = NOW()
    WHERE email = 'aaron.sachs@chattanoogastate.edu'
  `);
};
