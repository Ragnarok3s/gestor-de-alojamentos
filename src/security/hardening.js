const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://staging.minha-app.com',
  'http://localhost:3000',
  'http://localhost:3001'
]);

function normalizeOrigins(rawValue = '') {
  const items = String(rawValue)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return new Set([...items, ...DEFAULT_ALLOWED_ORIGINS]);
}

function applySecurityHeaders(app, options = {}) {
  const {
    enableHsts = false,
    connectSrc = [],
    scriptSrc = [],
    imgSrc = [],
    styleSrc = [],
    permissionsPolicy = "accelerometer=(), camera=(), geolocation=('self'), gyroscope=(), microphone=(), payment=(), usb=()",
    referrerPolicy = 'strict-origin-when-cross-origin',
    crossOriginOpenerPolicy = 'same-origin'
  } = options;

  const connectDirectives = ["'self'", ...connectSrc.filter(Boolean)];
  const scriptDirectives = ["'self'", ...scriptSrc.filter(Boolean)];
  const imgDirectives = ["'self'", 'data:', ...imgSrc.filter(Boolean)];
  const styleDirectives = ["'self'", "'unsafe-inline'", ...styleSrc.filter(Boolean)];
  const fontDirectives = ["'self'", 'data:'];

  const cspValue = [
    "default-src 'self'",
    `script-src ${scriptDirectives.join(' ')}`,
    `style-src ${styleDirectives.join(' ')}`,
    `img-src ${imgDirectives.join(' ')}`,
    `connect-src ${connectDirectives.join(' ')}`,
    `font-src ${fontDirectives.join(' ')}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', cspValue);
    if (enableHsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', referrerPolicy);
    res.setHeader('Permissions-Policy', permissionsPolicy);
    res.setHeader('Cross-Origin-Opener-Policy', crossOriginOpenerPolicy);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
}

function createCorsMiddleware({ allowedOrigins }) {
  const origins = allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) {
      return next();
    }
    if (origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const requestHeaders = req.headers['access-control-request-headers'];
      res.setHeader(
        'Access-Control-Allow-Headers',
        requestHeaders || 'Content-Type, Authorization, X-CSRF-Token'
      );
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
      );
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
    }
    next();
  };
}

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 300 } = {}) {
  const hits = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [key, value] of hits.entries()) {
      if (value.expiresAt <= now) {
        hits.delete(key);
      }
    }
  }
  setInterval(cleanup, Math.max(windowMs, 60 * 1000)).unref();

  return function rateLimiter(req, res, next) {
    const identifier = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(identifier) || { count: 0, expiresAt: now + windowMs };
    if (record.expiresAt <= now) {
      record.count = 0;
      record.expiresAt = now + windowMs;
    }
    record.count += 1;
    hits.set(identifier, record);
    if (record.count > max) {
      const retryAfter = Math.ceil((record.expiresAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      return res.status(429).send('Too many requests');
    }
    next();
  };
}

module.exports = {
  applySecurityHeaders,
  createCorsMiddleware,
  createRateLimiter,
  normalizeOrigins
};
