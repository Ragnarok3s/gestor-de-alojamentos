const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');

const { requestLogger } = require('../../server/middleware/requestLogger');
const { configureMiddleware } = require('../../server/configureMiddleware');
const { createErrorHandler } = require('../../server/middleware/errorHandler');
const { createTenantResolver } = require('../../server/resolveTenant');
const { registerRoutes } = require('../../server/registerRoutes');
const registerAuthRoutes = require('../modules/auth');
const registerFrontoffice = require('../modules/frontoffice');
const registerBackoffice = require('../modules/backoffice');
const registerOwnersPortal = require('../modules/owners');
const registerInternalTelemetry = require('../modules/internal/telemetry');
const registerAccountModule = require('../modules/account');
const registerTenantAdminModule = require('../modules/admin/tenants');
const registerPaymentsModule = registerTenantAdminModule;
const { createCsrfProtection } = require('../security/csrf');
const { initServices } = require('../services');
const { loadConfig } = require('../config');
const { createLogger } = require('../infra/logger');

function applyMiddleware(app, entries = []) {
  entries.forEach(entry => {
    if (!entry || typeof entry.handler !== 'function') return;
    if (entry.path) {
      app.use(entry.path, entry.handler);
    } else {
      app.use(entry.handler);
    }
  });
}

function applyRoutes(app, entries = []) {
  entries.forEach(entry => {
    if (!entry || typeof entry.handler !== 'function') return;
    const method = entry.method && typeof entry.method === 'string' ? entry.method.toLowerCase() : 'use';
    if (typeof app[method] !== 'function') {
      throw new Error(`Método de rota não suportado: ${entry.method}`);
    }
    app[method](entry.path, entry.handler);
  });
}

function createApp(options = {}) {
  const resolvedConfig = options.config || loadConfig();
  const resolvedLogger = options.logger || createLogger(resolvedConfig);
  const resolvedServices = options.services || initServices({ config: resolvedConfig, logger: resolvedLogger });

  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger);

  const csrfProtection = createCsrfProtection({ secureCookies: resolvedConfig.http.secureCookies });

  configureMiddleware({
    app,
    express,
    cookieParser,
    csrfProtection,
    publicDir: resolvedConfig.paths.publicDir,
    fs
  });

  applyMiddleware(app, resolvedServices.appMiddleware);
  applyRoutes(app, resolvedServices.appRoutes);

  const { resolveTenantDomain, resolveTenantForRequest, tenantMiddleware } = createTenantResolver({
    tenantService: resolvedServices.tenantService
  });

  const context = resolvedServices.context;
  context.resolveTenantDomain = resolveTenantDomain;
  context.resolveTenantForRequest = resolveTenantForRequest;
  context.secureCookies = resolvedConfig.http.secureCookies;
  context.csrfProtection = csrfProtection;

  app.use(tenantMiddleware);

  const routeRegistry =
    options.routes || {
      registerAuthRoutes,
      registerAccountModule,
      registerFrontoffice,
      registerPaymentsModule,
      registerOwnersPortal,
      registerInternalTelemetry,
      registerBackoffice,
      registerTenantAdminModule
    };

  registerRoutes({
    app,
    context,
    routes: routeRegistry
  });

  app.use(
    createErrorHandler({
      layout: context.layout,
      logger: resolvedLogger
    })
  );

  if (resolvedConfig.skipServerStart) {
    Object.assign(app, {
      db: resolvedServices.db,
      requireScope: resolvedServices.requireScope,
      buildUserContext: resolvedServices.buildUserContext,
      tenantService: resolvedServices.tenantService,
      guestPortalService: resolvedServices.guestPortalService
    });
  }

  app.locals.config = resolvedConfig;
  app.locals.services = resolvedServices;

  return app;
}

module.exports = { createApp };
