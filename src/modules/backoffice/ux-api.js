const express = require('express');
const { isKnownError, ValidationError } = require('../../services/errors');
const { createRateManagementService } = require('../../services/rate-management');
const { createUnitBlockService } = require('../../services/unit-blocks');
const { createReviewService } = require('../../services/review-center');
const { createReportingService } = require('../../services/reporting');
const { createRevenueReportingService } = require('../../services/reporting-revenue');

function handleError(res, err) {
  if (isKnownError(err)) {
    return res.status(err.status).json({ ok: false, error: err.message, details: err.details || null });
  }
  console.error('[ux-api] erro inesperado', err);
  return res.status(500).json({ ok: false, error: 'Ocorreu um erro inesperado.' });
}

module.exports = function registerUxApi(app, context) {
  const router = express.Router();
  const {
    requireLogin,
    requireBackofficeAccess,
    dayjs,
    db,
    logActivity,
    telemetry,
    otaDispatcher,
    messageTemplates,
    reviewRequestService,
    ratePlanService,
    userCan
  } = context;

  const rateService = createRateManagementService({ db, dayjs });
  const blockService = createUnitBlockService({ db, dayjs });
  const reviewService = createReviewService({ db, dayjs });
  const reportingService = createReportingService({ db, dayjs });
  const revenueReportingService = createRevenueReportingService({ db, dayjs });

  router.use(requireLogin, requireBackofficeAccess);

  function emitTelemetry(eventName, { req, startedAt, success, meta } = {}) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
      return;
    }
    const durationMs = startedAt ? Date.now() - startedAt : null;
    const propertyId = req && Object.prototype.hasOwnProperty.call(req, 'brandingPropertyId')
      ? req.brandingPropertyId
      : null;
    telemetry.emit(eventName, {
      userId: req && req.user ? req.user.id || null : null,
      propertyId,
      timestamp: startedAt ? new Date(startedAt).toISOString() : undefined,
      durationMs,
      success,
      meta
    });
  }

  function ensureCanManageRates(req, res) {
    if (!userCan || typeof userCan !== 'function') return true;
    if (userCan(req.user, 'rates.manage')) return true;
    res.status(403).json({ ok: false, error: 'Sem permissão para gerir tarifários.' });
    return false;
  }

  router.put('/rates/bulk', (req, res) => {
    const startedAt = Date.now();
    try {
      const payload = rateService.normalizeBulkPayload(req.body || {});
      const rateIds = rateService.applyBulkUpdate(payload);
      const totalNights = payload.nights * payload.unitIds.length;
      const meta = {
        unitIds: payload.unitIds,
        nights: payload.nights,
        totalNights,
        priceCents: payload.priceCents
      };
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'rates_bulk_updated', 'unit', null, meta);
      }
      if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
        payload.unitIds.forEach(unitId => {
          otaDispatcher.pushUpdate({
            unitId,
            type: 'rate.change',
            payload: {
              startDate: payload.startDate,
              endDateExclusive: payload.endDateExclusive,
              priceCents: payload.priceCents
            }
          });
        });
      }
      emitTelemetry('rates_bulk_updated', { req, startedAt, success: true, meta });
      return res.json({
        ok: true,
        rateIds,
        summary: {
          units: payload.unitIds.length,
          nights: totalNights,
          priceCents: payload.priceCents
        }
      });
    } catch (err) {
      emitTelemetry('rates_bulk_updated', {
        req,
        startedAt,
        success: false,
        meta: {
          error: err && err.message ? err.message : 'Erro inesperado',
          bodyShape: req && req.body ? Object.keys(req.body) : null
        }
      });
      return handleError(res, err);
    }
  });

  router.post('/rates/bulk/undo', (req, res) => {
    try {
      const removed = rateService.undoBulkUpdate(req.body?.rateIds || []);
      return res.json({ ok: true, removed });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get('/rate-plans', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const propertyId = req.query && req.query.propertyId != null ? req.query.propertyId : null;
      const plans = ratePlanService.listPlans({ propertyId, includeInactive: true });
      return res.json({ ok: true, plans });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post('/rate-plans', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const plan = ratePlanService.createPlan(req.body || {});
      return res.status(201).json({ ok: true, plan });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.put('/rate-plans/:id', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const plan = ratePlanService.updatePlan(req.params.id, req.body || {});
      return res.json({ ok: true, plan });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.delete('/rate-plans/:id', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const removed = ratePlanService.deletePlan(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get('/rate-plans/:id/restrictions', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const restrictions = ratePlanService.listRestrictions(req.params.id);
      return res.json({ ok: true, restrictions });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post('/rate-plans/:id/restrictions', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const restriction = ratePlanService.createRestriction({ ...req.body, ratePlanId: req.params.id });
      return res.status(201).json({ ok: true, restriction });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.put('/rate-restrictions/:id', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const restriction = ratePlanService.updateRestriction(req.params.id, req.body || {});
      return res.json({ ok: true, restriction });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.delete('/rate-restrictions/:id', (req, res) => {
    if (!ensureCanManageRates(req, res)) return;
    try {
      const removed = ratePlanService.deleteRestriction(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get('/revenue/calendar', (req, res) => {
    try {
      const start = typeof req.query.start === 'string' ? req.query.start : undefined;
      const end = typeof req.query.end === 'string' ? req.query.end : undefined;
      const pickupWindowsRaw = req.query.pickupWindows;
      const pickupWindows = [];
      if (Array.isArray(pickupWindowsRaw)) {
        pickupWindowsRaw.forEach(value => {
          if (typeof value === 'string') {
            value
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
              .forEach(item => pickupWindows.push(item));
          }
        });
      } else if (typeof pickupWindowsRaw === 'string') {
        pickupWindowsRaw
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
          .forEach(item => pickupWindows.push(item));
      }

      const payload = revenueReportingService.getCalendar({
        startDate: start,
        endDate: end,
        pickupWindows
      });

      return res.json({ ok: true, ...payload });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post('/units/:unitId/blocks', (req, res) => {
    const startedAt = Date.now();
    try {
      const unitId = Number(req.params.unitId);
      if (!Number.isInteger(unitId) || unitId <= 0) {
        throw new ValidationError('Unidade inválida.');
      }
      const payload = blockService.normalizeBlockPayload(req.body || {});
      const block = blockService.createBlock({
        unitId,
        startDate: payload.startDate,
        endDateExclusive: payload.endDateExclusive,
        reason: payload.reason,
        userId: req.user ? req.user.id : null
      });
      const meta = {
        blockId: block.id,
        unitId,
        nights: payload.nights,
        reasonLength: payload.reason.length
      };
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'unit_block_created', 'unit', unitId, meta);
      }
      if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
        otaDispatcher.pushUpdate({
          unitId,
          type: 'block.create',
          payload: {
            startDate: payload.startDate,
            endDateExclusive: payload.endDateExclusive,
            reason: payload.reason
          }
        });
      }
      emitTelemetry('unit_block_created', { req, startedAt, success: true, meta });
      return res.status(201).json({
        ok: true,
        block,
        summary: {
          nights: payload.nights
        }
      });
    } catch (err) {
      emitTelemetry('unit_block_created', {
        req,
        startedAt,
        success: false,
        meta: {
          error: err && err.message ? err.message : 'Erro inesperado',
          unitId: Number.isInteger(Number(req.params.unitId)) ? Number(req.params.unitId) : null
        }
      });
      return handleError(res, err);
    }
  });

  router.get('/reviews', (req, res) => {
    try {
      const filter = typeof req.query.filter === 'string' ? req.query.filter : '';
      const onlyNegative = filter === 'negative';
      const onlyRecent = filter === 'recent';
      const reviews = reviewService.listReviews({ onlyNegative, onlyRecent });
      return res.json({ ok: true, reviews });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post('/reviews/:id/respond', (req, res) => {
    const startedAt = Date.now();
    try {
      const reviewId = Number(req.params.id);
      if (!Number.isInteger(reviewId) || reviewId <= 0) {
        throw new ValidationError('Avaliação inválida.');
      }
      const responseText = req.body ? req.body.response : '';
      const updated = reviewService.respondToReview(reviewId, responseText, req.user ? req.user.id : null);
      const meta = {
        reviewId,
        responseLength: responseText ? String(responseText).trim().length : 0
      };
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'review_replied', 'review', reviewId, meta);
      }
      emitTelemetry('review_replied', { req, startedAt, success: true, meta });
      return res.json({ ok: true, review: { ...updated, responded: true } });
    } catch (err) {
      emitTelemetry('review_replied', {
        req,
        startedAt,
        success: false,
        meta: {
          error: err && err.message ? err.message : 'Erro inesperado',
          reviewId: Number.isInteger(Number(req.params.id)) ? Number(req.params.id) : null
        }
      });
      return handleError(res, err);
    }
  });

  router.post('/reviews/request/:bookingId', async (req, res) => {
    const startedAt = Date.now();
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ ok: false, error: 'Identificador de reserva inválido.' });
    }

    try {
      if (!reviewRequestService || typeof reviewRequestService.requestReviewForBooking !== 'function') {
        throw new Error('Serviço de pedidos de review indisponível.');
      }
      const allowRetry = req.body && (req.body.allowRetry === true || req.body.force === true);
      const minHoursBetween = req.body && Number.isFinite(Number(req.body.minHoursBetween))
        ? Math.max(1, Number(req.body.minHoursBetween))
        : reviewRequestService.constants.MIN_HOURS_BETWEEN_REQUESTS;

      const result = await reviewRequestService.requestReviewForBooking({
        bookingId,
        requestedBy: req.user && req.user.id ? req.user.id : null,
        allowRetry,
        minHoursBetween
      });

      emitTelemetry('review_request_triggered', {
        req,
        startedAt,
        success: true,
        meta: { bookingId, language: result.language }
      });

      return res.json({ ok: true, request: result });
    } catch (err) {
      emitTelemetry('review_request_triggered', {
        req,
        startedAt,
        success: false,
        meta: { bookingId, error: err && err.message ? err.message : 'erro' }
      });
      return handleError(res, err);
    }
  });

  router.post('/templates/test', (req, res) => {
    try {
      const key = String(req.body && req.body.templateKey ? req.body.templateKey : '').trim();
      if (!key) {
        throw new ValidationError('Modelo obrigatório.');
      }
      const language = typeof req.body.language === 'string' ? req.body.language : '';
      const guestLanguage = typeof req.body.guestLanguage === 'string' ? req.body.guestLanguage : '';
      const guestMessage = typeof req.body.guestMessage === 'string' ? req.body.guestMessage : '';
      const fallbackLanguages = Array.isArray(req.body.fallbackLanguages)
        ? req.body.fallbackLanguages.map(value => String(value || '')).filter(Boolean)
        : undefined;
      const rawVariables = req.body && typeof req.body.variables === 'object' && !Array.isArray(req.body.variables)
        ? req.body.variables
        : {};
      const variables = {};
      Object.keys(rawVariables || {}).forEach(name => {
        variables[name] = rawVariables[name];
      });
      const bodyOverride = typeof req.body.body === 'string' ? req.body.body : undefined;

      const result = messageTemplates.renderTemplate(key, {
        language,
        guestLanguage,
        sampleText: guestMessage,
        fallbackLanguages,
        variables,
        bodyOverride
      });
      if (!result) {
        throw new ValidationError('Modelo desconhecido.');
      }

      return res.json({
        ok: true,
        preview: result.body,
        language: result.language,
        languageLabel: messageTemplates.languageLabel(result.language),
        languageSource: result.languageSource,
        detectedLanguage: result.detectedLanguage ? result.detectedLanguage.language : null,
        detectedLanguageLabel:
          result.detectedLanguage && result.detectedLanguage.language
            ? messageTemplates.languageLabel(result.detectedLanguage.language)
            : null,
        detectedLanguageScore: result.detectedLanguage ? result.detectedLanguage.score : null
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get('/reports/weekly', async (req, res) => {
    const startedAt = Date.now();
    try {
      const from = req.query.from;
      const to = req.query.to;
      if (!from || !to) {
        throw new ValidationError('Datas "from" e "to" são obrigatórias.');
      }
      const snapshot = reportingService.computeWeeklySnapshot({ from, to });
      const format = (req.query.format || 'json').toLowerCase();
      const meta = {
        from: snapshot.range.from,
        to: snapshot.range.to,
        format
      };

      if (req.user && req.user.id) {
        logActivity(req.user.id, 'weekly_report_exported', null, null, meta);
      }

      if (format === 'csv') {
        const csv = reportingService.toCsv(snapshot);
        const filename = `weekly_${snapshot.range.from}_${snapshot.range.to}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        emitTelemetry('weekly_report_exported', { req, startedAt, success: true, meta });
        return res.send(`\uFEFF${csv}`);
      }

      if (format === 'pdf') {
        const pdf = await reportingService.toPdf(snapshot);
        res.setHeader('Content-Type', 'application/pdf');
        const filename = `weekly_${snapshot.range.from}_${snapshot.range.to}.pdf`;
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        emitTelemetry('weekly_report_exported', { req, startedAt, success: true, meta });
        return res.send(pdf);
      }

      emitTelemetry('weekly_report_exported', { req, startedAt, success: true, meta });
      return res.json({ ok: true, snapshot });
    } catch (err) {
      emitTelemetry('weekly_report_exported', {
        req,
        startedAt,
        success: false,
        meta: {
          error: err && err.message ? err.message : 'Erro inesperado',
          format: (req.query && req.query.format ? String(req.query.format) : 'json').toLowerCase()
        }
      });
      return handleError(res, err);
    }
  });

  router.get('/kpis/summary', (req, res) => {
    try {
      const summary = reportingService.computeKpiSummary();
      return res.json({ ok: true, summary });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.use('/admin/api', router);
};
