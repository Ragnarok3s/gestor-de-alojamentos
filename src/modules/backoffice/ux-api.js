const express = require('express');
const { isKnownError, ValidationError } = require('../../services/errors');
const { createRateManagementService } = require('../../services/rate-management');
const { createUnitBlockService } = require('../../services/unit-blocks');
const { createReviewService } = require('../../services/review-center');
const { createReportingService } = require('../../services/reporting');

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
    otaDispatcher
  } = context;

  const rateService = createRateManagementService({ db, dayjs });
  const blockService = createUnitBlockService({ db, dayjs });
  const reviewService = createReviewService({ db, dayjs });
  const reportingService = createReportingService({ db, dayjs });

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
