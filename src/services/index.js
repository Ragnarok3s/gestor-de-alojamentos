const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');
const express = require('express');
const dayjs = require('../../server/dayjs');
const { initServices: legacyInitServices } = require('../../server/initServices');
const { featureFlags, isFeatureEnabled } = require('../../config/featureFlags');
const { createDatabase, tableHasColumn } = require('../infra/database');
const { createTenantService } = require('./tenants');
const { createSessionService } = require('./session');
const { createTwoFactorService } = require('./twoFactorService');
const { createRateRuleService } = require('./rate-rules');
const { createRatePlanService } = require('./rate-plans');
const { createChannelIntegrationService } = require('./channel-integrations');
const { createChannelContentService } = require('./channel-content');
const { createChannelSync } = require('./channel-sync');
const { createOtaDispatcher } = require('./ota-sync/dispatcher');
const { createOverbookingGuard } = require('./overbooking-guard');
const { createAutomationEngine } = require('../../server/automations/engine');
const emailAction = require('../../server/automations/actions/email');
const notifyAction = require('../../server/automations/actions/notify');
const xlsxAppendAction = require('../../server/automations/actions/xlsx.append');
const createHousekeepingTaskAction = require('../../server/automations/actions/create.housekeeping_task');
const priceOverrideAction = require('../../server/automations/actions/price.override');
const logActivityAction = require('../../server/automations/actions/log.activity');
const { createDecisionAssistant } = require('../../server/decisions/assistant');
const { applyRateRules } = require('../../server/services/pricing/rules');
const { createTelemetry } = require('./telemetry');
const { createPaymentService } = require('./payments');
const { createGuestPortalService } = require('./guest-portal');
const { createEmailTemplateService } = require('./email-templates');
const { createI18nService } = require('./i18n');
const { createMessageTemplateService } = require('./templates');
const { createReviewRequestService } = require('./review-requests');
const { createMailer } = require('./mailer');
const { createBookingEmailer } = require('./booking-emails');
const { buildUserNotifications } = require('./notifications');
const { geocodeAddress } = require('../../server/geocode');
const {
  MASTER_ROLE,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS
} = require('../security/permissions');

function loadSharp({ skipServerStart, logger }) {
  let sharp = null;
  try {
    // eslint-disable-next-line import/no-unresolved, global-require
    sharp = require('sharp');
  } catch (err) {
    if (!skipServerStart) {
      const warn = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console);
      warn(
        'Dependência opcional "sharp" não encontrada; as imagens não serão comprimidas automaticamente até ser instalada.'
      );
    }
  }
  return sharp;
}

function initServices({ config, logger }) {
  if (!config) {
    throw new Error('initServices: config é obrigatório');
  }

  const sharp = loadSharp({ skipServerStart: config.skipServerStart, logger });

  return legacyInitServices({
    express,
    dayjs,
    bcrypt,
    crypto,
    fs,
    fsp: fs.promises,
    path,
    multer,
    ExcelJS,
    sharp,
    SKIP_SERVER_BOOT: config.skipServerStart,
    logger,
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
    secureCookies: config.http.secureCookies,
    databasePath: config.paths.database,
    MASTER_ROLE,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    ALL_PERMISSIONS
  });
}

module.exports = { initServices };
