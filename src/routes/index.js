const { createUploadMiddleware, exposeUploads } = require('../uploads');
const {
  requireLogin: buildRequireLogin,
  requireAdmin: buildRequireAdmin,
  resolveUser,
} = require('../middleware/auth');

const registerAuthRoutes = require('./auth');
const registerFrontOfficeRoutes = require('./front-office');
const registerCalendarRoutes = require('./calendar');
const registerExportRoutes = require('./export');
const registerAdminDashboardRoutes = require('./admin-dashboard');
const registerAdminBookingsRoutes = require('./admin-bookings');
const registerAdminUsersRoutes = require('./admin-users');
const registerDebugRoutes = require('./debug');

function setupRoutes(app, { db, upload, loginLimiter } = {}) {
  if (!db) throw new Error('Database connection is required to setup routes');

  const uploadMiddleware = upload || createUploadMiddleware();
  exposeUploads(app);

  const requireLogin = buildRequireLogin(db);
  const requireAdmin = buildRequireAdmin(db);
  const loginRateLimiter = loginLimiter || ((req, res, next) => next());
  const secureCookie =
    !!process.env.FORCE_SECURE_COOKIE || (!!process.env.SSL_KEY_PATH && !!process.env.SSL_CERT_PATH);
  const sessionCookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookie };

  const context = {
    db,
    uploadMiddleware,
    requireLogin,
    requireAdmin,
    resolveUser,
    loginRateLimiter,
    sessionCookieOptions,
  };

  registerAuthRoutes(app, context);
  registerFrontOfficeRoutes(app, context);
  registerCalendarRoutes(app, context);
  registerExportRoutes(app, context);
  registerAdminDashboardRoutes(app, context);
  registerAdminBookingsRoutes(app, context);
  registerAdminUsersRoutes(app, context);
  registerDebugRoutes(app);
}

module.exports = setupRoutes;
