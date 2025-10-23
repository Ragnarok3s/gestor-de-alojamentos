const crypto = require('crypto');

const logger = require('../logger');

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const providedId = req.get && req.get('x-request-id');
  const requestId = providedId || crypto.randomUUID();

  logger.runWithContext({ requestId }, () => {
    req.requestId = requestId;
    res.locals.requestId = requestId;

    logger.info(`→ ${req.method} ${req.originalUrl}`, {
      requestId,
      ip: req.ip
    });

    res.on('finish', () => {
      logger.info(`← ${req.method} ${req.originalUrl}`, {
        requestId,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        logger.warn(`↯ ${req.method} ${req.originalUrl} connection closed prematurely`, {
          requestId,
          status: res.statusCode
        });
      }
    });

    res.on('error', err => {
      logger.error(`Response stream error for ${req.method} ${req.originalUrl}`, {
        requestId,
        error: err
      });
    });

    next();
  });
}

module.exports = { requestLogger };
