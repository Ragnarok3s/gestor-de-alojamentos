if (require.main === module) {
  const { start } = require('./src/server/start');
  start().catch(err => {
    console.error('Falha ao iniciar servidor:', err);
    process.exit(1);
  });
} else {
  const { createAppWithDefaults } = require('./src/index');
  const { app } = createAppWithDefaults();
  module.exports = app;
}
