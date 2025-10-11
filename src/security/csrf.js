const crypto = require('crypto');

const DEFAULT_COOKIE_NAME = 'csrf_token';
const DEFAULT_FORM_FIELD = '_csrf';
const DEFAULT_HEADER = 'x-csrf-token';

function createCsrfProtection(options = {}) {
  const cookieName = options.cookieName || DEFAULT_COOKIE_NAME;
  const formField = options.formField || DEFAULT_FORM_FIELD;
  const headerName = options.headerName || DEFAULT_HEADER;
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: !!options.secureCookies,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  };

  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function timingSafeEqual(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') return false;
    try {
      const exp = Buffer.from(expected, 'hex');
      const act = Buffer.from(actual, 'hex');
      return exp.length === act.length && crypto.timingSafeEqual(exp, act);
    } catch (_) {
      return false;
    }
  }

  function ensureToken(req, res) {
    let token = req.cookies[cookieName];
    if (!token) {
      token = generateToken();
      res.cookie(cookieName, token, cookieOptions);
    }
    res.locals.csrfToken = token;
    req.csrfToken = () => token;
    return token;
  }

  function rotateToken(req, res) {
    const token = generateToken();
    res.cookie(cookieName, token, cookieOptions);
    res.locals.csrfToken = token;
    req.csrfToken = () => token;
    return token;
  }

  function validateRequest(req) {
    const stored = req.cookies[cookieName];
    if (!stored) return false;
    const provided =
      (req.body && req.body[formField]) ||
      req.get(headerName) ||
      req.headers[headerName];
    if (!provided) return false;
    return timingSafeEqual(String(stored), String(provided));
  }

  function middleware(req, res, next) {
    ensureToken(req, res);
    next();
  }

  return {
    ensureToken,
    rotateToken,
    validateRequest,
    middleware,
    options: { cookieName, formField, headerName },
  };
}

module.exports = {
  createCsrfProtection,
};

