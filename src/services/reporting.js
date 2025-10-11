const iconv = require('iconv-lite');
const { ValidationError } = require('./errors');

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
    const lines = [
      'Relatório Semanal',
      `Período: ${snapshot.range.from} a ${snapshot.range.to}`,
      `Unidades disponíveis: ${snapshot.units}`,
      '',
      `Ocupação: ${snapshot.kpis.occupancy != null ? (snapshot.kpis.occupancy * 100).toFixed(2) + '%' : '—'}`,
      `ADR: ${snapshot.kpis.adr != null ? `€${snapshot.kpis.adr.toFixed(2)}` : '—'}`,
      `RevPAR: ${snapshot.kpis.revpar != null ? `€${snapshot.kpis.revpar.toFixed(2)}` : '—'}`,
      `Receita: ${snapshot.kpis.revenue != null ? `€${snapshot.kpis.revenue.toFixed(2)}` : '—'}`,
      `Reservas confirmadas: ${snapshot.kpis.reservations}`,
      `Noites ocupadas: ${snapshot.nights.occupied}`,
      `Noites disponíveis: ${snapshot.nights.available}`
    ];

    const escapePdfText = (text) => String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const textBuffers = lines.map((line, index) => {
      const y = 780 - index * 24;
      const prefix = Buffer.from(`BT /F1 12 Tf 50 ${y} Td (`, 'ascii');
      const encoded = iconv.encode(escapePdfText(line), 'win1252');
      const suffix = Buffer.from(') Tj ET\n', 'ascii');
      return Buffer.concat([prefix, encoded, suffix]);
    });
    const textOps = Buffer.concat(textBuffers);

    const header = Buffer.from('%PDF-1.4\n', 'utf8');
    const objects = [];
    const offsets = [0];
    let currentOffset = header.length;

    const addObject = (index, content) => {
      let buffer;
      if (Buffer.isBuffer(content)) {
        buffer = Buffer.concat([
          Buffer.from(`${index} 0 obj\n`, 'ascii'),
          content,
          Buffer.from('\nendobj\n', 'ascii')
        ]);
      } else {
        const obj = `${index} 0 obj\n${content}\nendobj\n`;
        buffer = Buffer.from(obj, 'utf8');
      }
      offsets[index] = currentOffset;
      objects.push(buffer);
      currentOffset += buffer.length;
    };

    addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
    const streamLength = textOps.length;
    const streamContent = Buffer.concat([
      Buffer.from(`<< /Length ${streamLength} >>\nstream\n`, 'ascii'),
      textOps,
      Buffer.from('endstream\n', 'ascii')
    ]);
    addObject(4, streamContent);
    addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

    const bodyBuffer = Buffer.concat(objects);
    const xrefStart = header.length + bodyBuffer.length;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i += 1) {
      const pos = offsets[i] ?? header.length;
      xref += `${String(pos).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    return Buffer.concat([
      header,
      bodyBuffer,
      Buffer.from(xref, 'utf8'),
      Buffer.from(trailer, 'utf8')
    ]);
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
