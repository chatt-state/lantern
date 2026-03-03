exports.up = (pgm) => {
  pgm.addColumns('user_credentials', {
    refresh_data: { type: 'text' },
    expires_at: { type: 'timestamptz' },
  });
};
exports.down = (pgm) => {
  pgm.dropColumns('user_credentials', ['refresh_data', 'expires_at']);
};
