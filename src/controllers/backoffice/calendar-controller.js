'use strict';

const { serverRender } = require('../../middlewares/telemetry');
const { createCalendarRepository } = require('../../db/calendar/calendar-repository');
const {
  createCalendarService,
  CalendarValidationError,
  CalendarConflictError,
  CalendarNotFoundError
} = require('../../services/calendar/calendar-service');
const { renderCalendarPage } = require('../../views/calendar/calendar-page');
const { renderUnitCard } = require('../../views/calendar/unit-card');

function registerCalendarController(app, context) {
  if (!app) throw new Error('registerCalendarController: app é obrigatório');
  if (!context) throw new Error('registerCalendarController: context é obrigatório');

  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    formatMonthYear,
    resolveBrandingForRequest,
    requireLogin,
    requirePermission,
    userCan,
    rateQuote,
    overbookingGuard,
    otaDispatcher,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    insertBlockStmt,
    deleteLockByBookingStmt,
    logChange,
    overlaps,
    renderModalShell,
    isFlagEnabled,
    ensureNoIndex: ensureNoIndexHeader
  } = context;

  if (typeof ensureNoIndexHeader !== 'function') throw new Error('registerCalendarController: ensureNoIndex é obrigatório');
  if (typeof isFlagEnabled !== 'function') throw new Error('registerCalendarController: isFlagEnabled é obrigatório');

  const calendarRepository = createCalendarRepository({
    db,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    insertBlockStmt,
    deleteLockByBookingStmt
  });

  const calendarService = createCalendarService({
    dayjs,
    rateQuote,
    overbookingGuard,
    otaDispatcher,
    logChange,
    calendarRepository
  });

  app.get('/calendar', requireLogin, requirePermission('calendar.view'), (req, res) => {
    ensureNoIndexHeader(res);

    const featureFlags = {
      enableUnitCardModal: isFlagEnabled('FEATURE_CALENDAR_UNIT_CARD_MODAL'),
      enableExportShortcuts: isFlagEnabled('FEATURE_NAV_EXPORT_SHORTCUTS')
    };

    const permissions = {
      canRescheduleCalendar: userCan(req.user, 'calendar.reschedule'),
      canExportCalendar: userCan(req.user, 'bookings.export')
    };

    const data = calendarService.buildCalendarState({ query: req.query || {} });

    const { body } = renderCalendarPage({
      html,
      esc,
      dayjs,
      formatMonthYear,
      renderModalShell,
      data,
      featureFlags,
      permissions
    });

    serverRender('route:/calendar');
    res.send(layout({
      title: 'Mapa de Reservas',
      user: req.user,
      activeNav: 'calendar',
      branding: resolveBrandingForRequest(req),
      pageClass: 'page-backoffice page-calendar',
      body
    }));
  });

  app.get('/calendar/unit/:id/card', requireLogin, requirePermission('calendar.view'), (req, res) => {
    ensureNoIndexHeader(res);
    try {
      const data = calendarService.getUnitCardData({ unitId: Number(req.params.id), ym: req.query.ym });
      const htmlContent = renderUnitCard({
        unit: data.unit,
        month: data.month,
        bookingRows: data.bookingRows,
        unitBlocks: data.unitBlocks,
        legacyBlocks: data.legacyBlocks,
        notesMeta: data.notesMeta,
        dayjs,
        esc,
        overlaps
      });
      res.send(htmlContent);
    } catch (err) {
      if (err instanceof CalendarNotFoundError) return res.status(404).send('');
      throw err;
    }
  });

  app.post('/calendar/booking/:id/reschedule', requireLogin, requirePermission('calendar.reschedule'), (req, res) => {
    try {
      const result = calendarService.rescheduleBooking({
        bookingId: Number(req.params.id),
        checkin: req.body && req.body.checkin,
        checkout: req.body && req.body.checkout,
        actorId: req.user ? req.user.id : null
      });
      res.json({ ok: true, message: 'Reserva reagendada.', unit_id: result.unitId });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        return res.status(404).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarValidationError) {
        return res.status(400).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarConflictError) {
        return res.status(409).json({ ok: false, message: err.message });
      }
      throw err;
    }
  });

  app.post('/calendar/booking/:id/cancel', requireLogin, requirePermission('calendar.cancel'), (req, res) => {
    try {
      const result = calendarService.cancelBooking({
        bookingId: Number(req.params.id),
        actorId: req.user ? req.user.id : null
      });
      res.json({ ok: true, message: 'Reserva cancelada.', unit_id: result.unitId });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        return res.status(404).json({ ok: false, message: err.message });
      }
      throw err;
    }
  });

  app.post('/calendar/block/:id/reschedule', requireLogin, requirePermission('calendar.block.manage'), (req, res) => {
    try {
      const result = calendarService.rescheduleBlock({
        blockId: Number(req.params.id),
        start: req.body && req.body.start_date,
        end: req.body && req.body.end_date,
        actorId: req.user ? req.user.id : null
      });
      res.json({ ok: true, message: 'Bloqueio atualizado.', unit_id: result.unitId });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        return res.status(404).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarValidationError) {
        return res.status(400).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarConflictError) {
        return res.status(409).json({ ok: false, message: err.message });
      }
      throw err;
    }
  });

  app.post('/calendar/unit/:unitId/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
    try {
      const result = calendarService.createBlock({
        unitId: Number(req.params.unitId),
        start: req.body && req.body.start_date,
        end: req.body && req.body.end_date,
        actorId: req.user ? req.user.id : null
      });
      res.json({ ok: true, message: 'Bloqueio criado.', unit_id: result.unitId });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        return res.status(404).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarValidationError) {
        return res.status(400).json({ ok: false, message: err.message });
      }
      if (err instanceof CalendarConflictError) {
        return res.status(409).json({ ok: false, message: err.message });
      }
      throw err;
    }
  });

  app.delete('/calendar/block/:id', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
    try {
      const result = calendarService.deleteBlock({
        blockId: Number(req.params.id),
        actorId: req.user ? req.user.id : null
      });
      res.json({ ok: true, message: 'Bloqueio removido.', unit_id: result.unitId });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        return res.status(404).json({ ok: false, message: err.message });
      }
      throw err;
    }
  });
}

module.exports = { registerCalendarController };
