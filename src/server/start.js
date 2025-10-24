const http = require('http');
const https = require('https');
const fs = require('fs');

const { loadConfig } = require('../config');
const { createLogger } = require('../infra/logger');
const { initServices } = require('../services');
const { createApp } = require('../app/createApp');

function createHttpServer({ app, config, logger }) {
  const { keyPath, certPath } = config.http.ssl || {};
  const port = config.http.port;

  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    const server = https.createServer(options, app);
    server.listen(port, () => logger.info({ port }, 'server_started_https'));
    return server;
  }

  const server = http.createServer(app);
  server.listen(port, () => logger.info({ port }, 'server_started_http'));
  return server;
}

async function start() {
  const config = loadConfig();
  const logger = createLogger(config);
  if (logger && typeof logger.bindConsole === 'function') {
    logger.bindConsole();
  }

  const services = initServices({ config, logger });
  const app = createApp({ config, logger, services });

  const close = async () => {
    if (services && typeof services.shutdown === 'function') {
      await services.shutdown();
    }
  };

  if (config.skipServerStart) {
    logger.info('SKIP_SERVER_START=1 - servidor inicializado sem escutar porta');
    return { app, config, services, close };
  }

  const server = createHttpServer({ app, config, logger });

  let shuttingDown = false;
  const signals = ['SIGINT', 'SIGTERM'];
  const signalHandlers = [];

  const gracefulShutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown_start');
    const timeout = setTimeout(() => {
      logger.error('shutdown_timeout');
      process.exit(1);
    }, 10_000);

    Promise.resolve()
      .then(
        () =>
          new Promise(resolve => {
            server.close(err => {
              if (err) {
                logger.error('server_close_failed', { error: err });
              }
              resolve();
            });
          })
      )
      .then(close)
      .then(() => {
        clearTimeout(timeout);
        logger.info('shutdown_complete');
        process.exit(0);
      })
      .catch(err => {
        clearTimeout(timeout);
        logger.error('shutdown_failed', { error: err });
        process.exit(1);
      });
  };

  signals.forEach(signal => {
    const handler = () => gracefulShutdown(signal);
    signalHandlers.push({ signal, handler });
    process.on(signal, handler);
  });

  return {
    app,
    config,
    services,
    server,
    close: async () => {
      signalHandlers.forEach(({ signal, handler }) => process.removeListener(signal, handler));
      await new Promise(resolve => {
        server.close(err => {
          if (err) {
            logger.error('server_close_failed', { error: err });
          }
          resolve();
        });
      });
      await close();
    }
  };
}

module.exports = { start };
