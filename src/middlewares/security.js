const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

function setNoIndex(res) {
  if (!res || typeof res.set !== 'function') {
    return;
  }
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

function isFeatureActive({ featureFlag, isEnabled }) {
  if (!featureFlag) {
    return true;
  }
  if (typeof isEnabled === 'function') {
    return !!isEnabled(featureFlag);
  }
  return true;
}

function verifySignedQuery(options = {}) {
  const {
    featureFlag,
    isEnabled,
    maxAgeMs = 60_000,
    getSecret,
    secret: staticSecret,
    onFailure,
    onSuccess,
    assign
  } = options;

  function resolveSecret(req) {
    if (typeof getSecret === 'function') {
      return getSecret(req);
    }
    if (typeof staticSecret === 'string' && staticSecret) {
      return staticSecret;
    }
    return process.env.EXPORT_SIGNING_KEY;
  }

  function fail(req, res, statusCode, message, reason) {
    if (typeof onFailure === 'function') {
      try {
        onFailure(req, res, reason || 'invalid');
      } catch (err) {
        // ignore logging failures
      }
    }
    res.status(statusCode).send(message);
  }

  return function signedQueryMiddleware(req, res, next) {
    if (!isFeatureActive({ featureFlag, isEnabled })) {
      return next();
    }

    const signingSecret = resolveSecret(req);
    if (!signingSecret) {
      return fail(req, res, 503, 'Exportação temporariamente indisponível (configuração).', 'missing_secret');
    }

    const rawYm = typeof req.query.ym === 'string' ? req.query.ym.trim() : '';
    const rawMonths = typeof req.query.months === 'string' || typeof req.query.months === 'number'
      ? String(req.query.months).trim()
      : '';
    const tsValue = typeof req.query.ts === 'string' || typeof req.query.ts === 'number'
      ? Number(req.query.ts)
      : NaN;
    const rawSig = typeof req.query.sig === 'string' ? req.query.sig.trim().toLowerCase() : '';

    if (!/^\d{4}-\d{2}$/.test(rawYm)) {
      return fail(req, res, 400, 'Parâmetros inválidos para exportação.', 'invalid_ym');
    }

    const monthsInt = Number(rawMonths);
    if (!Number.isInteger(monthsInt) || monthsInt < 1 || monthsInt > 12) {
      return fail(req, res, 400, 'Número de meses inválido.', 'invalid_months');
    }

    if (!Number.isFinite(tsValue) || tsValue <= 0) {
      return fail(req, res, 400, 'Timestamp inválido.', 'invalid_timestamp');
    }

    const now = Date.now();
    if (now - tsValue > maxAgeMs || tsValue - now > maxAgeMs) {
      return fail(req, res, 403, 'Assinatura expirada. Gere um novo link e tente novamente.', 'expired');
    }

    if (!/^[a-f0-9]{64}$/.test(rawSig)) {
      return fail(req, res, 400, 'Assinatura inválida.', 'invalid_signature_format');
    }

    const payload = `ym=${rawYm}&months=${monthsInt}&ts=${tsValue}`;
    const expectedSig = crypto.createHmac('sha256', signingSecret).update(payload).digest('hex');

    let signaturesMatch = false;
    try {
      const providedBuffer = Buffer.from(rawSig, 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');
      if (providedBuffer.length === expectedBuffer.length) {
        signaturesMatch = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
      }
    } catch (err) {
      signaturesMatch = false;
    }

    if (!signaturesMatch) {
      return fail(req, res, 403, 'Assinatura inválida.', 'invalid_signature');
    }

    if (assign && typeof assign === 'function') {
      try {
        assign(req, { ym: rawYm, months: monthsInt, ts: tsValue, signature: rawSig });
      } catch (err) {
        // ignore assignment errors
      }
    } else {
      req.signedQuery = { ym: rawYm, months: monthsInt, ts: tsValue, signature: rawSig };
    }

    if (typeof onSuccess === 'function') {
      try {
        onSuccess(req, res);
      } catch (err) {
        // ignore logging failures
      }
    }

    next();
  };
}

function rateLimitByUserRoute(options = {}) {
  const {
    featureFlag,
    isEnabled,
    windowMs = 60_000,
    max = 5,
    message = 'Too many requests. Please try again later.',
    handler,
    onLimit
  } = options;

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => {
      if (req && req.user && req.user.id) {
        return `user:${req.user.id}`;
      }
      if (req && req.sessionID) {
        return `session:${req.sessionID}`;
      }
      if (req && req.ip) {
        return `ip:${req.ip}`;
      }
      return 'anonymous';
    },
    handler: handler
      ? handler
      : (req, res, next, context) => {
          if (typeof message === 'function') {
            return res.status(429).send(message(req, res, context));
          }
          res.status(429).send(message);
        },
    onLimitReached: onLimit || null
  });

  return function rateLimitedMiddleware(req, res, next) {
    if (!isFeatureActive({ featureFlag, isEnabled })) {
      return next();
    }
    return limiter(req, res, next);
  };
}

module.exports = {
  setNoIndex,
  verifySignedQuery,
  rateLimitByUserRoute
};
