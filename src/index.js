const { start } = require('./server/start');
const { loadConfig } = require('./config');
const { createLogger } = require('./infra/logger');
const { initServices } = require('./services');
const { createApp } = require('./app/createApp');

function createAppWithDefaults(options = {}) {
  const config = options.config || loadConfig();
  const logger = options.logger || createLogger(config);
  const services = options.services || initServices({ config, logger });
  const app = createApp({ config, logger, services });
  return { app, config, logger, services };
}

if (require.main === module) {
  start().catch(err => {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  });
}

module.exports = { start, createAppWithDefaults };
