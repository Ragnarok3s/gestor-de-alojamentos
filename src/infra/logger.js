const baseLogger = require('../../server/logger');

function createLogger() {
  return baseLogger;
}

module.exports = { createLogger };
