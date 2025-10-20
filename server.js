const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
require('dayjs/locale/pt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const multer = require('multer');
const ExcelJS = require('exceljs');
const SKIP_SERVER_BOOT = process.env.SKIP_SERVER_START === '1';
let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  if (!SKIP_SERVER_BOOT) {
    console.warn(
      'Dependência opcional "sharp" não encontrada; as imagens não serão comprimidas automaticamente até ser instalada.'
    );
  }
}
dayjs.extend(minMax);
dayjs.locale('pt');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { configureMiddleware } = require('./server/configureMiddleware');
const { createTenantResolver } = require('./server/resolveTenant');
const { geocodeAddress } = require('./server/geocode');
const { initServices } = require('./server/initServices');
const { registerRoutes } = require('./server/registerRoutes');
const { startServer } = require('./server/startServer');

const registerAuthRoutes = require('./src/modules/auth');
const registerFrontoffice = require('./src/modules/frontoffice');
const registerBackoffice = require('./src/modules/backoffice');
const registerOwnersPortal = require('./src/modules/owners');
const registerInternalTelemetry = require('./src/modules/internal/telemetry');
const registerAccountModule = require('./src/modules/account');
const registerTenantAdminModule = require('./src/modules/admin/tenants');
// Legacy alias retained for environments still referencing the older payments
// module hook name. Ensures pm2 or other runners with stale bundles do not
// crash while the new tenant admin module rolls out.
const registerPaymentsModule = registerTenantAdminModule;
const { featureFlags, isFeatureEnabled } = require('./config/featureFlags');
const { createDatabase, tableHasColumn } = require('./src/infra/database');
const { createTenantService } = require('./src/services/tenants');
const { createSessionService } = require('./src/services/session');
const { createTwoFactorService } = require('./src/services/twoFactorService');
const { buildUserNotifications } = require('./src/services/notifications');
const { createCsrfProtection } = require('./src/security/csrf');
const { createEmailTemplateService } = require('./src/services/email-templates');
const { createI18nService } = require('./src/services/i18n');
const { createMessageTemplateService } = require('./src/services/templates');
const { createReviewRequestService } = require('./src/services/review-requests');
const { createMailer } = require('./src/services/mailer');
const { createBookingEmailer } = require('./src/services/booking-emails');
const { createRateRuleService } = require('./src/services/rate-rules');
const { createRatePlanService } = require('./src/services/rate-plans');
const { createChannelIntegrationService } = require('./src/services/channel-integrations');
const { createChannelContentService } = require('./src/services/channel-content');
const { createChannelSync } = require('./src/services/channel-sync');
const { createOtaDispatcher } = require('./src/services/ota-sync/dispatcher');
const { createOverbookingGuard } = require('./src/services/overbooking-guard');
const { createAutomationEngine } = require('./server/automations/engine');
const emailAction = require('./server/automations/actions/email');
const notifyAction = require('./server/automations/actions/notify');
const xlsxAppendAction = require('./server/automations/actions/xlsx.append');
const createHousekeepingTaskAction = require('./server/automations/actions/create.housekeeping_task');
const priceOverrideAction = require('./server/automations/actions/price.override');
const logActivityAction = require('./server/automations/actions/log.activity');
const { createDecisionAssistant } = require('./server/decisions/assistant');
const { applyRateRules } = require('./server/services/pricing/rules');
const { createTelemetry } = require('./src/services/telemetry');
const { createPaymentService } = require('./src/services/payments');
const { createGuestPortalService } = require('./src/services/guest-portal');
const {
  MASTER_ROLE,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS
} = require('./src/security/permissions');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const secureCookies =
  !!process.env.FORCE_SECURE_COOKIE || (!!process.env.SSL_KEY_PATH && !!process.env.SSL_CERT_PATH);
const csrfProtection = createCsrfProtection({ secureCookies });

// Configurar middlewares globais, parsing de requests e protecções base.
configureMiddleware({
  app,
  express,
  cookieParser,
  csrfProtection,
  publicDir: PUBLIC_DIR,
  fs
});

// Inicializar serviços de domínio, integrações e utilitários de suporte.
const services = initServices({
  app,
  express,
  dayjs,
  bcrypt,
  crypto,
  fs,
  fsp,
  path,
  multer,
  ExcelJS,
  sharp,
  SKIP_SERVER_BOOT,
  featureFlags,
  isFeatureEnabled,
  createDatabase,
  tableHasColumn,
  createTenantService,
  createSessionService,
  createTwoFactorService,
  createRateRuleService,
  createRatePlanService,
  createChannelIntegrationService,
  createChannelContentService,
  createChannelSync,
  createOtaDispatcher,
  createOverbookingGuard,
  createAutomationEngine,
  emailAction,
  notifyAction,
  xlsxAppendAction,
  createHousekeepingTaskAction,
  priceOverrideAction,
  logActivityAction,
  createDecisionAssistant,
  applyRateRules,
  createTelemetry,
  createPaymentService,
  createGuestPortalService,
  createEmailTemplateService,
  createI18nService,
  createMessageTemplateService,
  createReviewRequestService,
  createMailer,
  createBookingEmailer,
  buildUserNotifications,
  geocodeAddress,
  secureCookies,
  MASTER_ROLE,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS
});

const { context, db, tenantService, guestPortalService, requireScope, buildUserContext } = services;

// Resolver tenant e aplicar middleware multi-tenant por pedido.
const { resolveTenantDomain, resolveTenantForRequest, tenantMiddleware } = createTenantResolver({
  tenantService
});

context.resolveTenantDomain = resolveTenantDomain;
context.resolveTenantForRequest = resolveTenantForRequest;
context.secureCookies = secureCookies;
context.csrfProtection = csrfProtection;

app.use(tenantMiddleware);

// Registar rotas de autenticação, frontoffice, backoffice e restantes módulos.
registerRoutes({
  app,
  context,
  routes: {
    registerAuthRoutes,
    registerAccountModule,
    registerFrontoffice,
    registerPaymentsModule,
    registerOwnersPortal,
    registerInternalTelemetry,
    registerBackoffice,
    registerTenantAdminModule
  }
});

// Arrancar servidor HTTP/HTTPS conforme configuração detectada.
startServer({ app, fs, https });

if (process.env.SKIP_SERVER_START === '1') {
  Object.assign(app, { db, requireScope, buildUserContext, tenantService, guestPortalService });
}

module.exports = app;
