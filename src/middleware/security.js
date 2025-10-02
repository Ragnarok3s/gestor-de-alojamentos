function setSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-XSS-Protection', '0');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function createRateLimiter({ windowMs, max, message }) {
  const store = new Map();

  function cleanup(key, now) {
    const entry = store.get(key);
    if (!entry) return;
    if (now > entry.expires) {
      store.delete(key);
    }
  }

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    cleanup(key, now);
    const current = store.get(key) || { count: 0, expires: now + windowMs };
    if (current.count >= max) {
      return res.status(429).send(message || 'Too many requests. Try again later.');
    }
    current.count += 1;
    store.set(key, current);
    next();
  };
}

function applySecurity(app) {
  app.disable('x-powered-by');
  app.use(setSecurityHeaders);
  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Demasiadas tentativas de login. Tente novamente mais tarde.',
  });
  return { loginLimiter };
}

module.exports = applySecurity;
