'use strict';

function defaultKeyGenerator(req) {
  if (req && req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  if (req && req.ip) {
    return req.ip;
  }
  return 'anonymous';
}

function isFunction(fn) {
  return typeof fn === 'function';
}

function rateLimit(options = {}) {
  const windowMs = typeof options.windowMs === 'number' && options.windowMs > 0 ? options.windowMs : 60000;
  const max = typeof options.max === 'number' && options.max > 0 ? Math.floor(options.max) : 5;
  const keyGenerator = isFunction(options.keyGenerator) ? options.keyGenerator : defaultKeyGenerator;
  const handler = isFunction(options.handler)
    ? options.handler
    : (req, res) => {
        res.status(429).send('Too many requests');
      };
  const skip = isFunction(options.skip) ? options.skip : () => false;
  const requestWasSuccessful = isFunction(options.requestWasSuccessful)
    ? options.requestWasSuccessful
    : (_req, res) => res.statusCode < 400;
  const requestWasFailure = isFunction(options.requestWasFailure)
    ? options.requestWasFailure
    : (_req, res) => res.statusCode >= 400;
  const skipFailedRequests = !!options.skipFailedRequests;
  const skipSuccessfulRequests = !!options.skipSuccessfulRequests;
  const onLimitReached = isFunction(options.onLimitReached) ? options.onLimitReached : null;
  const standardHeaders = !!options.standardHeaders;
  const legacyHeaders = !!options.legacyHeaders;

  const hits = new Map();

  function scheduleReset(key, state) {
    if (state.timeout) {
      clearTimeout(state.timeout);
    }
    const timeout = setTimeout(() => {
      hits.delete(key);
    }, state.resetTime - Date.now());
    if (timeout.unref) {
      timeout.unref();
    }
    state.timeout = timeout;
  }

  function setHeaders(res, state) {
    const remaining = Math.max(max - state.count, 0);
    if (standardHeaders) {
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', Math.ceil(state.resetTime / 1000));
    }
    if (legacyHeaders) {
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      const retryAfter = Math.max(Math.ceil((state.resetTime - Date.now()) / 1000), 0);
      res.setHeader('Retry-After', String(retryAfter));
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    if (skip(req, res)) {
      return next();
    }

    const key = keyGenerator(req, res);
    const now = Date.now();
    let state = hits.get(key);

    if (!state || state.resetTime <= now) {
      state = {
        count: 0,
        resetTime: now + windowMs,
        timeout: null
      };
    }

    state.count += 1;
    state.resetTime = now + windowMs;
    scheduleReset(key, state);
    hits.set(key, state);

    if (state.count > max) {
      if (onLimitReached) {
        onLimitReached(req, res, options);
      }
      setHeaders(res, state);
      return handler(req, res, next, {
        limit: max,
        current: state.count,
        remaining: Math.max(max - state.count, 0),
        resetTime: new Date(state.resetTime)
      });
    }

    const originalReset = state.resetTime;

    res.on('finish', () => {
      if (!hits.has(key)) {
        return;
      }
      const latest = hits.get(key);
      if (!latest || latest.resetTime !== originalReset) {
        return;
      }
      let shouldDecrement = false;
      if (skipSuccessfulRequests && requestWasSuccessful(req, res)) {
        shouldDecrement = true;
      } else if (skipFailedRequests && requestWasFailure(req, res)) {
        shouldDecrement = true;
      }
      if (shouldDecrement) {
        latest.count = Math.max(latest.count - 1, 0);
        hits.set(key, latest);
      }
    });

    next();
  };
}

module.exports = rateLimit;
module.exports.default = rateLimit;
module.exports.rateLimit = rateLimit;
