'use strict';

const { ConflictError } = require('../errors');

class CalendarError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'CALENDAR_ERROR';
  }
}

class CalendarValidationError extends CalendarError {
  constructor(message) {
    super(message, 'CALENDAR_VALIDATION_ERROR');
  }
}

class CalendarConflictError extends CalendarError {
  constructor(message) {
    super(message, 'CALENDAR_CONFLICT');
  }
}

class CalendarNotFoundError extends CalendarError {
  constructor(message) {
    super(message, 'CALENDAR_NOT_FOUND');
  }
}

function createCalendarService({
  dayjs,
  rateQuote,
  overbookingGuard,
  otaDispatcher,
  logChange,
  calendarRepository
}) {
  if (!dayjs) throw new Error('createCalendarService: dayjs é obrigatório');
  if (!rateQuote) throw new Error('createCalendarService: rateQuote é obrigatório');
  if (!overbookingGuard) throw new Error('createCalendarService: overbookingGuard é obrigatório');
  if (!logChange) throw new Error('createCalendarService: logChange é obrigatório');
  if (!calendarRepository) throw new Error('createCalendarService: calendarRepository é obrigatório');

  function buildCalendarState({ query }) {
    const ym = query && query.ym;
    const base = ym ? dayjs(`${ym}-01`) : dayjs().startOf('month');
    const month = base.startOf('month');
    const prev = month.subtract(1, 'month').format('YYYY-MM');
    const next = month.add(1, 'month').format('YYYY-MM');

    const properties = calendarRepository.listProperties();
    const propertyMap = new Map(properties.map(p => [p.id, p.name]));

    let propertyId = query && query.property ? Number(query.property) : null;
    if (Number.isNaN(propertyId) || !propertyMap.has(propertyId)) {
      propertyId = properties[0] ? properties[0].id : null;
    }

    const units = propertyId ? calendarRepository.listUnitsByProperty(propertyId) : [];

    const rawFilters = {
      start: query && query.start ? String(query.start) : '',
      end: query && query.end ? String(query.end) : '',
      unit: query && query.unit ? String(query.unit) : '',
      q: query && query.q ? String(query.q).trim() : ''
    };

    let startDate = rawFilters.start && dayjs(rawFilters.start, 'YYYY-MM-DD', true).isValid()
      ? dayjs(rawFilters.start)
      : month;
    let endDate = rawFilters.end && dayjs(rawFilters.end, 'YYYY-MM-DD', true).isValid()
      ? dayjs(rawFilters.end)
      : month.endOf('month');

    if (endDate.isBefore(startDate)) {
      endDate = startDate;
    }

    startDate = startDate.startOf('day');
    endDate = endDate.startOf('day');

    const endExclusive = endDate.add(1, 'day');

    let selectedUnitId = null;
    if (rawFilters.unit) {
      const parsedUnit = Number(rawFilters.unit);
      if (!Number.isNaN(parsedUnit) && units.some(u => u.id === parsedUnit)) {
        selectedUnitId = parsedUnit;
      }
    }

    const searchTerm = rawFilters.q ? rawFilters.q.toLowerCase() : '';

    const bookings = propertyId
      ? calendarRepository.listBookings({
          propertyId,
          start: startDate.format('YYYY-MM-DD'),
          end: endExclusive.format('YYYY-MM-DD'),
          unitId: selectedUnitId,
          searchTerm
        })
      : [];

    const enrichedBookings = bookings.map(row => ({
      ...row,
      nights: Math.max(1, dayjs(row.checkout).diff(dayjs(row.checkin), 'day')),
      checkin_iso: dayjs(row.checkin).format('YYYY-MM-DD'),
      checkout_iso: dayjs(row.checkout).format('YYYY-MM-DD'),
      checkin_label: dayjs(row.checkin).format('DD/MM'),
      checkout_label: dayjs(row.checkout).format('DD/MM')
    }));

    const confirmedCount = enrichedBookings.filter(b => (b.status || '').toUpperCase() === 'CONFIRMED').length;
    const pendingCount = enrichedBookings.filter(b => (b.status || '').toUpperCase() === 'PENDING').length;
    const totalNights = enrichedBookings.reduce((sum, b) => sum + (b.nights || 0), 0);
    const uniqueUnits = new Set(enrichedBookings.map(b => b.unit_id)).size;

    const queryState = {
      ym: month.format('YYYY-MM'),
      property: propertyId ? String(propertyId) : '',
      unit: selectedUnitId ? String(selectedUnitId) : '',
      q: rawFilters.q || '',
      start: rawFilters.start || '',
      end: rawFilters.end || ''
    };

    const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;

    return {
      month,
      prev,
      next,
      properties,
      propertyMap,
      propertyId,
      units,
      rawFilters,
      startDate,
      endDate,
      endExclusive,
      selectedUnitId,
      selectedUnit,
      searchTerm,
      bookings: enrichedBookings,
      confirmedCount,
      pendingCount,
      totalNights,
      uniqueUnits,
      queryState
    };
  }

  function getUnitCardData({ unitId, ym }) {
    const month = (ym ? dayjs(`${ym}-01`) : dayjs().startOf('month')).startOf('month');
    const unit = calendarRepository.findUnitWithProperty(unitId);
    if (!unit) {
      throw new CalendarNotFoundError('Unidade não encontrada.');
    }

    const bookingRows = calendarRepository.listBookingsForUnit(unit.id);
    const unitBlocks = calendarRepository.listUnitBlocks(unit.id);
    const legacyBlocks = calendarRepository.listLegacyBlocks(unit.id);
    const bookingIds = bookingRows.filter(row => row && row.id != null).map(row => row.id);
    const notesMeta = calendarRepository.getBookingNotesMeta(bookingIds);

    return { month, unit, bookingRows, unitBlocks, legacyBlocks, notesMeta };
  }

  function rescheduleBooking({ bookingId, checkin, checkout, actorId }) {
    const booking = calendarRepository.getBookingWithPricing(bookingId);
    if (!booking) throw new CalendarNotFoundError('Reserva não encontrada.');

    if (!checkin || !checkout) {
      throw new CalendarValidationError('Datas inválidas.');
    }

    if (!dayjs(checkout).isAfter(dayjs(checkin))) {
      throw new CalendarValidationError('checkout deve ser > checkin');
    }

    const conflict = calendarRepository.findBookingConflict({
      unitId: booking.unit_id,
      bookingId: booking.id,
      checkin,
      checkout
    });
    if (conflict) {
      throw new CalendarConflictError('Conflito com outra reserva.');
    }

    const blockConflict = calendarRepository.findBlockConflictForBooking({
      unitId: booking.unit_id,
      checkin,
      checkout
    });
    if (blockConflict) {
      throw new CalendarConflictError('As novas datas estão bloqueadas.');
    }

    const quote = rateQuote(booking.unit_id, checkin, checkout, booking.base_price_cents);
    if (quote.nights < quote.minStayReq) {
      throw new CalendarValidationError(`Estadia mínima: ${quote.minStayReq} noites.`);
    }

    try {
      overbookingGuard.reserveSlot({
        unitId: booking.unit_id,
        from: checkin,
        to: checkout,
        bookingId: booking.id,
        actorId: actorId || null
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        throw new CalendarConflictError('Conflito com outra reserva ou bloqueio.');
      }
      throw err;
    }

    calendarRepository.updateBookingDates({
      bookingId: booking.id,
      checkin,
      checkout,
      totalCents: quote.total_cents
    });

    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate({
        unitId: booking.unit_id,
        type: 'booking.reschedule',
        payload: { bookingId: booking.id, checkin, checkout }
      });
    }

    logChange(
      actorId || null,
      'booking',
      booking.id,
      'reschedule',
      { checkin: booking.checkin, checkout: booking.checkout, total_cents: booking.total_cents },
      { checkin, checkout, total_cents: quote.total_cents }
    );

    return { unitId: booking.unit_id };
  }

  function cancelBooking({ bookingId, actorId }) {
    const booking = calendarRepository.findBookingById(bookingId);
    if (!booking) throw new CalendarNotFoundError('Reserva não encontrada.');

    calendarRepository.deleteBookingById(bookingId);
    calendarRepository.deleteLockForBooking(bookingId);

    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate({
        unitId: booking.unit_id,
        type: 'booking.cancel',
        payload: { bookingId: booking.id }
      });
    }

    logChange(actorId || null, 'booking', booking.id, 'cancel', {
      checkin: booking.checkin,
      checkout: booking.checkout,
      guest_name: booking.guest_name,
      status: booking.status,
      unit_id: booking.unit_id
    }, null);

    return { unitId: booking.unit_id };
  }

  function rescheduleBlock({ blockId, start, end, actorId }) {
    const block = calendarRepository.findBlockById(blockId);
    if (!block) throw new CalendarNotFoundError('Bloqueio não encontrado.');

    if (!start || !end) {
      throw new CalendarValidationError('Datas inválidas.');
    }

    if (!dayjs(end).isAfter(dayjs(start))) {
      throw new CalendarValidationError('end_date deve ser > start_date');
    }

    const bookingConflict = calendarRepository.findBookingConflictForBlock({
      unitId: block.unit_id,
      start,
      end
    });
    if (bookingConflict) {
      throw new CalendarConflictError('Existem reservas neste período.');
    }

    const blockConflict = calendarRepository.findBlockConflict({
      unitId: block.unit_id,
      blockId: block.id,
      start,
      end
    });
    if (blockConflict) {
      throw new CalendarConflictError('Conflito com outro bloqueio.');
    }

    calendarRepository.updateBlockDates({ blockId: block.id, start, end });

    logChange(
      actorId || null,
      'block',
      block.id,
      'reschedule',
      { start_date: block.start_date, end_date: block.end_date },
      { start_date: start, end_date: end }
    );

    return { unitId: block.unit_id };
  }

  function createBlock({ unitId, start, end, actorId }) {
    const unit = calendarRepository.findUnitById(unitId);
    if (!unit) throw new CalendarNotFoundError('Unidade não encontrada.');

    if (!start || !end) {
      throw new CalendarValidationError('Datas inválidas.');
    }

    if (!dayjs(end).isAfter(dayjs(start))) {
      throw new CalendarValidationError('end_date deve ser > start_date');
    }

    const bookingConflict = calendarRepository.findBookingConflictForBlock({ unitId, start, end });
    if (bookingConflict) {
      throw new CalendarConflictError('Existem reservas nestas datas.');
    }

    const blockConflict = calendarRepository.findBlockConflict({ unitId, blockId: null, start, end });
    if (blockConflict) {
      throw new CalendarConflictError('Já existe um bloqueio neste período.');
    }

    const inserted = calendarRepository.insertBlock({ unitId, start, end });

    logChange(actorId || null, 'block', inserted.lastInsertRowid, 'create', null, {
      start_date: start,
      end_date: end,
      unit_id: unitId
    });

    return { unitId, blockId: inserted.lastInsertRowid };
  }

  function deleteBlock({ blockId, actorId }) {
    const block = calendarRepository.findBlockById(blockId);
    if (!block) throw new CalendarNotFoundError('Bloqueio não encontrado.');

    calendarRepository.deleteBlockById(block.id);

    logChange(
      actorId || null,
      'block',
      block.id,
      'delete',
      { start_date: block.start_date, end_date: block.end_date },
      null
    );

    return { unitId: block.unit_id };
  }

  return {
    buildCalendarState,
    getUnitCardData,
    rescheduleBooking,
    cancelBooking,
    rescheduleBlock,
    createBlock,
    deleteBlock
  };
}

module.exports = {
  createCalendarService,
  CalendarError,
  CalendarValidationError,
  CalendarConflictError,
  CalendarNotFoundError
};
