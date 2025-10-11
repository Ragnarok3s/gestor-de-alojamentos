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
    logActivity
  } = context;

  const rateService = createRateManagementService({ db, dayjs });
  const blockService = createUnitBlockService({ db, dayjs });
  const reviewService = createReviewService({ db, dayjs });
  const reportingService = createReportingService({ db, dayjs });

  router.use(requireLogin, requireBackofficeAccess);

  router.put('/rates/bulk', (req, res) => {
    try {
      const payload = rateService.normalizeBulkPayload(req.body || {});
      const rateIds = rateService.applyBulkUpdate(payload);
      const totalNights = payload.nights * payload.unitIds.length;
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'rates_bulk_updated', 'unit', null, {
          unitIds: payload.unitIds,
          nights: payload.nights,
          totalNights,
          priceCents: payload.priceCents
        });
      }
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
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'unit_block_created', 'unit', unitId, {
          blockId: block.id,
          nights: payload.nights,
          reasonLength: payload.reason.length
        });
      }
      return res.status(201).json({
        ok: true,
        block,
        summary: {
          nights: payload.nights
        }
      });
    } catch (err) {
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
    try {
      const reviewId = Number(req.params.id);
      if (!Number.isInteger(reviewId) || reviewId <= 0) {
        throw new ValidationError('Avaliação inválida.');
      }
      const responseText = req.body ? req.body.response : '';
      const updated = reviewService.respondToReview(reviewId, responseText, req.user ? req.user.id : null);
      if (req.user && req.user.id) {
        logActivity(req.user.id, 'review_replied', 'review', reviewId, {
          responseLength: responseText ? String(responseText).trim().length : 0
        });
      }
      return res.json({ ok: true, review: { ...updated, responded: true } });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get('/reports/weekly', (req, res) => {
    try {
      const from = req.query.from;
      const to = req.query.to;
      if (!from || !to) {
        throw new ValidationError('Datas "from" e "to" são obrigatórias.');
      }
      const snapshot = reportingService.computeWeeklySnapshot({ from, to });
      const format = (req.query.format || 'json').toLowerCase();

      if (req.user && req.user.id) {
        logActivity(req.user.id, 'weekly_report_exported', null, null, {
          from: snapshot.range.from,
          to: snapshot.range.to,
          format
        });
      }

      if (format === 'csv') {
        const csv = reportingService.toCsv(snapshot);
        const filename = `weekly_${snapshot.range.from}_${snapshot.range.to}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.send(`\uFEFF${csv}`);
      }

      if (format === 'pdf') {
        const pdf = reportingService.toPdf(snapshot);
        res.setHeader('Content-Type', 'application/pdf');
        const filename = `weekly_${snapshot.range.from}_${snapshot.range.to}.pdf`;
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.send(pdf);
      }

      return res.json({ ok: true, snapshot });
    } catch (err) {
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
