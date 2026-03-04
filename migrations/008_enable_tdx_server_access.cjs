/**
 * Enable TDX and M365 server access for all active SCIM-provisioned departments.
 *
 * The server_access table gates proxy access — without a row here, the proxy
 * returns 403 even if the user has a valid token. This migration seeds both
 * server slugs for any department that doesn't already have them.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO server_access (department_id, server_slug, enabled)
    SELECT d.id, s.slug, true
    FROM departments d
    CROSS JOIN (VALUES ('m365'), ('tdx')) AS s(slug)
    WHERE d.active = true
    ON CONFLICT (department_id, server_slug) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM server_access
    WHERE server_slug IN ('m365', 'tdx')
  `);
};
