const { ValidationError } = require('./errors');
const { createWeeklyPdf } = require('./reporting-pdf');

function parseDateStrict(value, dayjs) {
  const date = dayjs(value, 'YYYY-MM-DD', true);
  if (!date.isValid()) {
    throw new ValidationError('Data inválida.');
  }
  return date;
}

function formatDecimal(value, digits = 2) {
  if (value == null) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function createReportingService({ db, dayjs }) {
  const countUnitsStmt = db.prepare('SELECT COUNT(1) as total FROM units');
  const bookingsStmt = db.prepare(
    `SELECT id, unit_id, checkin, checkout, total_cents
     FROM bookings
     WHERE status NOT IN ('CANCELLED', 'CANCELED')
       AND checkin < ?
       AND checkout > ?`
  );

  function computeWeeklySnapshot({ from, to }) {
    const start = parseDateStrict(from, dayjs);
    const end = parseDateStrict(to, dayjs);
    if (end.isBefore(start)) {
      throw new ValidationError('A data final deve ser posterior à inicial.');
    }
    if (end.diff(start, 'day') + 1 > 31) {
      throw new ValidationError('Intervalo máximo de 31 dias para exportação.');
    }
    const endExclusive = end.add(1, 'day');
    const totalUnits = Number(countUnitsStmt.get().total || 0);
    const totalNights = totalUnits * endExclusive.diff(start, 'day');
    const rows = bookingsStmt.all(endExclusive.format('YYYY-MM-DD'), start.format('YYYY-MM-DD'));

    let occupiedNights = 0;
    let revenueCents = 0;
    let reservationCount = 0;

    for (const row of rows) {
      const bookingStart = dayjs(row.checkin);
      const bookingEnd = dayjs(row.checkout);
      const bookingNights = Math.max(bookingEnd.diff(bookingStart, 'day'), 1);
      const overlapStart = bookingStart.isAfter(start) ? bookingStart : start;
      const overlapEnd = bookingEnd.isBefore(endExclusive) ? bookingEnd : endExclusive;
      const overlap = overlapEnd.diff(overlapStart, 'day');
      if (overlap <= 0) continue;
      reservationCount += 1;
      occupiedNights += overlap;
      const nightly = row.total_cents / bookingNights;
      revenueCents += nightly * overlap;
    }

    const occupancy = totalNights > 0 ? occupiedNights / totalNights : null;
    const adr = occupiedNights > 0 ? (revenueCents / occupiedNights) / 100 : null;
    const revpar = totalNights > 0 ? (revenueCents / totalNights) / 100 : null;

    return {
      range: {
        from: start.format('YYYY-MM-DD'),
        to: end.format('YYYY-MM-DD')
      },
      units: totalUnits,
      reservations: reservationCount,
      nights: {
        occupied: occupiedNights,
        available: totalNights
      },
      kpis: {
        occupancy: occupancy != null ? formatDecimal(occupancy, 4) : null,
        adr: adr != null ? formatDecimal(adr, 2) : null,
        revpar: revpar != null ? formatDecimal(revpar, 2) : null,
        revenue: formatDecimal(revenueCents / 100, 2),
        reservations: reservationCount
      }
    };
  }

  function toCsv(snapshot) {
    const headers = [
      'Período',
      'Ocupação (%)',
      'ADR',
      'RevPAR',
      'Receita',
      'Reservas',
      'Noites Ocupadas',
      'Noites Disponíveis',
      'Unidades'
    ];
    const { range, kpis, nights, units } = snapshot;
    const line = [
      `${range.from} a ${range.to}`,
      kpis.occupancy != null ? (kpis.occupancy * 100).toFixed(2) : '—',
      kpis.adr != null ? kpis.adr.toFixed(2) : '—',
      kpis.revpar != null ? kpis.revpar.toFixed(2) : '—',
      kpis.revenue != null ? kpis.revenue.toFixed(2) : '—',
      kpis.reservations,
      nights.occupied,
      nights.available,
      units
    ];
    return [headers.join(','), line.join(',')].join('\n');
  }

  function toPdf(snapshot) {
    return createWeeklyPdf(snapshot);
  }

  function computeKpiSummary() {
    const today = dayjs();
    const start = today.startOf('week');
    const end = today.endOf('week');
    return computeWeeklySnapshot({ from: start.format('YYYY-MM-DD'), to: end.format('YYYY-MM-DD') });
  }

  return {
    computeWeeklySnapshot,
    toCsv,
    toPdf,
    computeKpiSummary
  };
}

module.exports = {
  createReportingService
};
