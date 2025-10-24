const path = require('path');

function parsePort(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`PORT inválido: ${value}`);
  }
  return Math.trunc(parsed);
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const port = parsePort(env.PORT, 3000);
  const sslKeyPath = env.SSL_KEY_PATH || null;
  const sslCertPath = env.SSL_CERT_PATH || null;
  const skipServerStart = env.SKIP_SERVER_START === '1';
  const forceSecureCookie = env.FORCE_SECURE_COOKIE === '1' || env.FORCE_SECURE_COOKIE === 'true';
  const secureCookies = forceSecureCookie || (!!sslKeyPath && !!sslCertPath);
  const projectRoot = path.resolve(__dirname, '..', '..');
  const publicDir = path.join(projectRoot, 'public');
  const databasePath = env.DATABASE_PATH || 'booking_engine.db';

  return Object.freeze({
    env: nodeEnv,
    skipServerStart,
    http: {
      port,
      ssl: {
        keyPath: sslKeyPath,
        certPath: sslCertPath
      },
      secureCookies
    },
    paths: {
      projectRoot,
      publicDir,
      database: databasePath
    }
  });
}

module.exports = { loadConfig };
