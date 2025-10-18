const { ValidationError } = require('./errors');

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas

function parseDateStrict(value, dayjs) {
  if (!value) {
    throw new ValidationError('Data obrigatória em falta.');
  }
  const parsed = dayjs(value, 'YYYY-MM-DD', true);
  if (!parsed.isValid()) {
    throw new ValidationError('Data inválida.');
  }
  return parsed.startOf('day');
}

function normalizePickupWindows(input) {
  const values = Array.isArray(input) ? input : [];
  const unique = new Set();
  values.forEach(value => {
    const number = Number.parseInt(value, 10);
    if (Number.isFinite(number) && number > 0 && number <= 180) {
      unique.add(number);
    }
  });
  if (!unique.size) {
    unique.add(7);
    unique.add(30);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function createRevenueReportingService({ db, dayjs }) {
  if (!db) throw new Error('Database connection is required');
  if (!dayjs) throw new Error('dayjs instance is required');

  const unitsStmt = db.prepare('SELECT id, base_price_cents FROM units');
  const bookingsStmt = db.prepare(
    `SELECT id, unit_id, checkin, checkout, total_cents, status, created_at
       FROM bookings
      WHERE status NOT IN ('CANCELLED', 'CANCELED')
        AND checkin < ?
        AND checkout > ?`
  );
  const blocksStmt = db.prepare(
    `SELECT unit_id, start_date, end_date
       FROM blocks
      WHERE start_date < ?
        AND end_date > ?`
  );
  const unitBlocksStmt = db.prepare(
    `SELECT unit_id, start_date, end_date
       FROM unit_blocks
      WHERE start_date < ?
        AND end_date > ?`
  );

  const dayCache = new Map();

  function getUnitsContext() {
    const rows = unitsStmt.all();
    const units = Array.isArray(rows) ? rows : [];
    const totalUnits = units.length;
    const avgBasePriceCents = totalUnits
      ? Math.round(
          units.reduce((sum, unit) => sum + Number(unit.base_price_cents || 0), 0) /
            Math.max(totalUnits, 1)
        )
      : 0;
    return { totalUnits, avgBasePriceCents };
  }

  function enumerateDays(start, endExclusive) {
    const dayCount = Math.max(endExclusive.diff(start, 'day'), 0);
    const days = [];
    for (let offset = 0; offset < dayCount; offset += 1) {
      days.push(start.add(offset, 'day'));
    }
    return days;
  }

  function computeBlocksIndex(start, endExclusive) {
    const keyStart = start.format('YYYY-MM-DD');
    const keyEnd = endExclusive.format('YYYY-MM-DD');
    const blockRows = blocksStmt.all(keyEnd, keyStart);
    const unitBlockRows = unitBlocksStmt.all(keyEnd, keyStart);
    const combined = [...(Array.isArray(blockRows) ? blockRows : []), ...(Array.isArray(unitBlockRows) ? unitBlockRows : [])];
    const index = new Map();

    combined.forEach(row => {
      if (!row || !row.unit_id) return;
      const blockStart = dayjs(row.start_date);
      const blockEnd = dayjs(row.end_date);
      if (!blockStart.isValid() || !blockEnd.isValid()) return;
      const effectiveStart = blockStart.isAfter(start) ? blockStart : start;
      const effectiveEnd = blockEnd.isBefore(endExclusive) ? blockEnd : endExclusive;
      if (!effectiveEnd.isAfter(effectiveStart)) return;
      for (let cursor = effectiveStart; cursor.isBefore(effectiveEnd); cursor = cursor.add(1, 'day')) {
        const key = cursor.format('YYYY-MM-DD');
        if (!index.has(key)) {
          index.set(key, new Set());
        }
        index.get(key).add(row.unit_id);
      }
    });

    return index;
  }

  function computeBookingsSlice(start, endExclusive) {
    const keyStart = start.format('YYYY-MM-DD');
    const keyEnd = endExclusive.format('YYYY-MM-DD');
    const rows = bookingsStmt.all(keyEnd, keyStart);
    return Array.isArray(rows) ? rows : [];
  }

  function buildDayBase({ date, totalUnits, avgBasePriceCents }) {
    return {
      date,
      display: dayjs(date).format('DD/MM'),
      weekday: WEEKDAY_LABELS[dayjs(date).day()],
      totalUnits,
      blockedCount: 0,
      unitsAvailable: totalUnits,
      revenueCents: 0,
      nightsSold: 0,
      bookingsCount: 0,
      bookingCreations: [],
      avgBasePriceCents,
      adrCents: 0,
      revparCents: 0,
      occupancyRate: 0,
      alerts: [],
      alertDetails: [],
      isFrozen: false
    };
  }

  function finalizeDay(base) {
    const { revenueCents, nightsSold, unitsAvailable } = base;
    base.adrCents = nightsSold > 0 ? Math.round(revenueCents / Math.max(nightsSold, 1)) : 0;
    base.revparCents = unitsAvailable > 0 ? Math.round(revenueCents / Math.max(unitsAvailable, 1)) : 0;
    base.occupancyRate = unitsAvailable > 0 ? Math.min(nightsSold / Math.max(unitsAvailable, 1), 1) : 0;
    return base;
  }

  function evaluateAlerts(base) {
    const alerts = [];
    const details = [];
    const avgBase = base.avgBasePriceCents || 0;
    const adrEuros = base.adrCents / 100;
    const avgBaseEuros = avgBase / 100;

    if (base.unitsAvailable > 0 && base.nightsSold === 0) {
      alerts.push({ type: 'gap' });
      details.push('Sem reservas para esta data.');
    }

    if (base.nightsSold > 0 && avgBase > 0) {
      if (base.occupancyRate >= 0.8 && base.adrCents < Math.round(avgBase * 0.9)) {
        alerts.push({ type: 'underpricing' });
        details.push(
          `Ocupação elevada (${Math.round(base.occupancyRate * 100)}%) com ADR abaixo da tarifa base média (€${adrEuros.toFixed(
            2
          )} vs €${avgBaseEuros.toFixed(2)}).`
        );
      }
      if (base.occupancyRate <= 0.3 && base.adrCents > Math.round(avgBase * 1.2)) {
        alerts.push({ type: 'overpricing' });
        details.push(
          `Ocupação baixa (${Math.round(base.occupancyRate * 100)}%) com ADR acima da tarifa base média (€${adrEuros.toFixed(
            2
          )} vs €${avgBaseEuros.toFixed(2)}).`
        );
      }
    }

    base.alerts = alerts;
    base.alertDetails = details;
    return base;
  }

  function computeCalendar({ startDate, endDate, pickupWindows }) {
    const start = parseDateStrict(startDate, dayjs);
    const end = parseDateStrict(endDate, dayjs);
    if (end.isBefore(start)) {
      throw new ValidationError('Data final deve ser posterior à inicial.');
    }
    if (end.diff(start, 'day') + 1 > 120) {
      throw new ValidationError('Intervalo máximo de 120 dias.');
    }

    const windows = normalizePickupWindows(pickupWindows);
    const endExclusive = end.add(1, 'day');

    const { totalUnits, avgBasePriceCents } = getUnitsContext();
    const days = enumerateDays(start, endExclusive);
    const blockIndex = computeBlocksIndex(start, endExclusive);
    const bookings = computeBookingsSlice(start, endExclusive);

    const dayMap = new Map();
    const recalcKeys = new Set();

    days.forEach(day => {
      const dateKey = day.format('YYYY-MM-DD');
      const cached = dayCache.get(dateKey);
      const isCacheValid = cached && Date.now() - cached.generatedAt < CACHE_TTL_MS;
      if (isCacheValid) {
        const cachedBase = cached.base || {};
        const base = {
          ...cachedBase,
          bookingCreations: Array.isArray(cachedBase.bookingCreations)
            ? [...cachedBase.bookingCreations]
            : [],
          alerts: Array.isArray(cachedBase.alerts)
            ? cachedBase.alerts.map(alert => ({ ...alert }))
            : [],
          alertDetails: Array.isArray(cachedBase.alertDetails)
            ? [...cachedBase.alertDetails]
            : [],
          isFrozen: true
        };
        dayMap.set(dateKey, base);
        return;
      }
      const base = buildDayBase({ date: dateKey, totalUnits, avgBasePriceCents });
      dayMap.set(dateKey, base);
      recalcKeys.add(dateKey);
    });

    recalcKeys.forEach(dateKey => {
      const record = dayMap.get(dateKey);
      if (!record) return;
      record.blockedCount = blockIndex.has(dateKey) ? blockIndex.get(dateKey).size : 0;
      record.unitsAvailable = Math.max(record.totalUnits - record.blockedCount, 0);
      record.revenueCents = 0;
      record.nightsSold = 0;
      record.bookingsCount = 0;
      record.bookingCreations = [];
      record.alerts = [];
      record.alertDetails = [];
    });

    bookings.forEach(booking => {
      if (!booking) return;
      const stayStart = dayjs(booking.checkin);
      const stayEnd = dayjs(booking.checkout);
      if (!stayStart.isValid() || !stayEnd.isValid()) return;
      const stayNights = Math.max(stayEnd.diff(stayStart, 'day'), 1);
      const nightlyRate = Math.round(Number(booking.total_cents || 0) / Math.max(stayNights, 1));
      const effectiveStart = stayStart.isAfter(start) ? stayStart : start;
      const effectiveEnd = stayEnd.isBefore(endExclusive) ? stayEnd : endExclusive;
      if (!effectiveEnd.isAfter(effectiveStart)) return;

      for (let cursor = effectiveStart; cursor.isBefore(effectiveEnd); cursor = cursor.add(1, 'day')) {
        const dateKey = cursor.format('YYYY-MM-DD');
        const record = dayMap.get(dateKey);
        if (!record || record.isFrozen) continue;
        record.revenueCents += nightlyRate;
        record.nightsSold += 1;
        if (stayStart.format('YYYY-MM-DD') === dateKey) {
          record.bookingsCount += 1;
          if (booking.created_at) {
            record.bookingCreations.push(booking.created_at);
          }
        }
      }
    });

    const calendarDays = [];
    days.forEach(day => {
      const dateKey = day.format('YYYY-MM-DD');
      const record = dayMap.get(dateKey);
      if (!record) return;
      if (!record.isFrozen) {
        finalizeDay(record);
        evaluateAlerts(record);
        const { isFrozen, bookingCreations, alerts, alertDetails, ...rest } = record;
        dayCache.set(dateKey, {
          generatedAt: Date.now(),
          base: {
            ...rest,
            bookingCreations: Array.isArray(bookingCreations) ? [...bookingCreations] : [],
            alerts: Array.isArray(alerts) ? alerts.map(alert => ({ ...alert })) : [],
            alertDetails: Array.isArray(alertDetails) ? [...alertDetails] : []
          }
        });
        record.isFrozen = isFrozen;
        record.bookingCreations = Array.isArray(bookingCreations) ? bookingCreations : [];
        record.alerts = Array.isArray(alerts) ? alerts : [];
        record.alertDetails = Array.isArray(alertDetails) ? alertDetails : [];
      }
      const pickups = {};
      windows.forEach(window => {
        const threshold = day.subtract(window, 'day');
        const dayEnd = day.endOf('day');
        const count = record.bookingCreations.filter(createdAt => {
          const created = dayjs(createdAt);
          if (!created.isValid()) return false;
          return created.isAfter(threshold) && created.isSameOrBefore(dayEnd);
        }).length;
        pickups[String(window)] = count;
      });
      calendarDays.push({
        date: record.date,
        display: record.display,
        weekday: record.weekday,
        revenueCents: record.revenueCents,
        nightsSold: record.nightsSold,
        unitsAvailable: record.unitsAvailable,
        adrCents: record.adrCents,
        revparCents: record.revparCents,
        occupancyRate: record.occupancyRate,
        bookingsCount: record.bookingsCount,
        pickups,
        alerts: record.alerts,
        alertDetails: record.alertDetails
      });
      delete record.isFrozen;
    });

    const summary = calendarDays.reduce(
      (acc, day) => {
        acc.revenueCents += day.revenueCents || 0;
        acc.nightsSold += day.nightsSold || 0;
        acc.nightsAvailable += day.unitsAvailable || 0;
        Object.keys(day.pickups || {}).forEach(windowKey => {
          const value = Number(day.pickups[windowKey] || 0);
          acc.pickupTotals[windowKey] = (acc.pickupTotals[windowKey] || 0) + value;
        });
        if (Array.isArray(day.alerts)) {
          day.alerts.forEach(alert => {
            if (!alert || !alert.type) return;
            acc.alertTotals[alert.type] = (acc.alertTotals[alert.type] || 0) + 1;
          });
        }
        return acc;
      },
      { revenueCents: 0, nightsSold: 0, nightsAvailable: 0, pickupTotals: {}, alertTotals: {} }
    );

    summary.adrCents = summary.nightsSold > 0 ? Math.round(summary.revenueCents / summary.nightsSold) : 0;
    summary.revparCents = summary.nightsAvailable > 0 ? Math.round(summary.revenueCents / summary.nightsAvailable) : 0;
    summary.occupancyRate = summary.nightsAvailable > 0 ? summary.nightsSold / summary.nightsAvailable : 0;

    return {
      range: {
        start: start.format('YYYY-MM-DD'),
        end: end.format('YYYY-MM-DD'),
        dayCount: calendarDays.length
      },
      pickupWindows: windows,
      summary,
      days: calendarDays
    };
  }

  function getCalendar({ startDate, endDate, pickupWindows } = {}) {
    const today = dayjs().startOf('day');
    const defaultStart = startDate ? parseDateStrict(startDate, dayjs) : today;
    const defaultEnd = endDate
      ? parseDateStrict(endDate, dayjs)
      : defaultStart.add(29, 'day');
    return computeCalendar({
      startDate: defaultStart.format('YYYY-MM-DD'),
      endDate: defaultEnd.format('YYYY-MM-DD'),
      pickupWindows
    });
  }

  return {
    getCalendar
  };
}

module.exports = {
  createRevenueReportingService
};
