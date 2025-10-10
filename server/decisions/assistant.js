const { randomUUID } = require('node:crypto');

function average(numbers = []) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function createDecisionAssistant({ db, dayjs }) {
  if (!db) {
    throw new Error('createDecisionAssistant requer acesso à base de dados.');
  }

  const listUnitsStmt = db.prepare(
    `SELECT u.id, u.name, u.capacity, u.base_price_cents, u.property_id, p.name AS property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name`
  );
  const futureBookingsStmt = db.prepare(
    `SELECT id, unit_id, checkin, checkout, status, created_at, source_channel, total_cents
       FROM bookings
      WHERE checkout > ? AND status IN ('CONFIRMED', 'PENDING')`
  );
  const directBookingsStmt = db.prepare(
    `SELECT COUNT(*) AS c
       FROM bookings
      WHERE status IN ('CONFIRMED', 'PENDING')
        AND created_at >= ?
        AND (source_channel IS NULL OR source_channel = '' OR source_channel = 'Direto')
        AND unit_id IN (SELECT id FROM units WHERE property_id = ?)`
  );
  const updateExistingStmt = db.prepare(
    `UPDATE decision_suggestions
        SET status = 'DISMISSED'
      WHERE status = 'OPEN'
        AND property_id = @property_id
        AND (unit_id = @unit_id OR unit_id IS NULL)
        AND kind = @kind`
  );
  const insertSuggestionStmt = db.prepare(
    `INSERT INTO decision_suggestions
      (id, property_id, unit_id, kind, title, details, suggested_action, status, created_at)
     VALUES (@id, @property_id, @unit_id, @kind, @title, @details, @suggested_action, 'OPEN', datetime('now'))`
  );

  function computeOccupancy(unitBookings, rangeStart, rangeEnd) {
    const totalNights = Math.max(0, rangeEnd.diff(rangeStart, 'day'));
    if (!totalNights) return 0;
    let occupied = 0;
    unitBookings.forEach(booking => {
      const checkin = dayjs(booking.checkin);
      const checkout = dayjs(booking.checkout);
      if (!checkin.isValid() || !checkout.isValid()) return;
      const start = dayjs.max(rangeStart, checkin);
      const end = dayjs.min(rangeEnd, checkout);
      const nights = Math.max(0, end.diff(start, 'day'));
      occupied += nights;
    });
    return occupied / totalNights;
  }

  function computePace(unitBookings, rangeStart, rangeEnd) {
    const sevenDaysAgo = dayjs().subtract(7, 'day');
    const fourteenDaysAgo = dayjs().subtract(14, 'day');
    const futureWindowStart = rangeStart;
    const futureWindowEnd = rangeEnd;

    const recent = unitBookings.filter(booking => {
      const createdAt = dayjs(booking.created_at);
      if (!createdAt.isValid()) return false;
      if (createdAt.isBefore(fourteenDaysAgo)) return false;
      const checkin = dayjs(booking.checkin);
      return checkin.isAfter(futureWindowStart.subtract(1, 'day')) && checkin.isBefore(futureWindowEnd.add(1, 'day'));
    });

    const last7 = recent.filter(b => dayjs(b.created_at).isAfter(sevenDaysAgo));
    const previous7 = recent.filter(b => dayjs(b.created_at).isAfter(fourteenDaysAgo) && dayjs(b.created_at).isBefore(sevenDaysAgo));

    const last7Count = last7.length;
    const previous7Count = previous7.length;
    const change = previous7Count === 0 ? (last7Count ? 1 : 0) : (last7Count - previous7Count) / previous7Count;
    return {
      last7: last7Count,
      previous7: previous7Count,
      change,
    };
  }

  function createPriceSuggestion(unit, occupancy, pace, windowStart, windowEnd, delta) {
    const nights = [];
    for (let cursor = windowStart; cursor.isBefore(windowEnd); cursor = cursor.add(1, 'day')) {
      nights.push(cursor.format('YYYY-MM-DD'));
    }

    const details = {
      occupancy,
      pace,
      window_start: windowStart.format('YYYY-MM-DD'),
      window_end: windowEnd.format('YYYY-MM-DD'),
      capacity: unit.capacity,
    };

    const suggestedAction = {
      type: 'apply_price_delta',
      unit_id: unit.id,
      delta,
      dates: nights,
    };

    const title = delta < 0
      ? `Baixar tarifa ${Math.round(Math.abs(delta) * 100)}% (${unit.name})`
      : `Aumentar tarifa ${Math.round(delta * 100)}% (${unit.name})`;

    updateExistingStmt.run({ property_id: unit.property_id, unit_id: unit.id, kind: 'PRICE_ADJUST' });
    insertSuggestionStmt.run({
      id: randomUUID(),
      property_id: unit.property_id,
      unit_id: unit.id,
      kind: 'PRICE_ADJUST',
      title,
      details: JSON.stringify(details),
      suggested_action: JSON.stringify(suggestedAction),
    });
  }

  function createPromoSuggestion(propertyId, propertyName) {
    updateExistingStmt.run({ property_id: propertyId, unit_id: null, kind: 'PROMO' });
    insertSuggestionStmt.run({
      id: randomUUID(),
      property_id: propertyId,
      unit_id: null,
      kind: 'PROMO',
      title: `Lançar campanha promocional (${propertyName})`,
      details: JSON.stringify({ reason: 'Sem reservas diretas últimos 7 dias' }),
      suggested_action: JSON.stringify({ type: 'create_promo_code', property_id: propertyId, duration_hours: 72 }),
    });
  }

  function createPolicySuggestion(unit) {
    updateExistingStmt.run({ property_id: unit.property_id, unit_id: unit.id, kind: 'POLICY' });
    insertSuggestionStmt.run({
      id: randomUUID(),
      property_id: unit.property_id,
      unit_id: unit.id,
      kind: 'POLICY',
      title: `Rever política de early check-in (${unit.name})`,
      details: JSON.stringify({ reason: 'Pedidos frequentes de early check-in' }),
      suggested_action: JSON.stringify({ type: 'review_policy', policy: 'early_checkin', unit_id: unit.id }),
    });
  }

  function run(options = {}) {
    const horizonDays = Number(options.horizonDays || 30);
    const windowStart = dayjs().startOf('day');
    const windowEnd = windowStart.add(horizonDays, 'day');
    const units = listUnitsStmt.all();
    if (!units.length) return [];

    const bookings = futureBookingsStmt.all(windowStart.format('YYYY-MM-DD'));
    const bookingsByUnit = new Map();
    units.forEach(unit => bookingsByUnit.set(unit.id, []));
    bookings.forEach(booking => {
      if (!bookingsByUnit.has(booking.unit_id)) {
        bookingsByUnit.set(booking.unit_id, []);
      }
      bookingsByUnit.get(booking.unit_id).push(booking);
    });

    const suggestions = [];

    units.forEach(unit => {
      const unitBookings = bookingsByUnit.get(unit.id) || [];
      const occupancy = computeOccupancy(unitBookings, windowStart, windowEnd);
      const pace = computePace(unitBookings, windowStart, windowEnd);
      const avgStay = average(unitBookings.map(b => dayjs(b.checkout).diff(dayjs(b.checkin), 'day')));
      const heavyEarlyCheckin = unitBookings.filter(b => (b.internal_notes || '').toLowerCase().includes('early check')).length;

      if (occupancy < 0.35 && pace.change <= 0) {
        const adjustWindowEnd = windowStart.add(14, 'day');
        createPriceSuggestion(unit, { value: occupancy, window: '0-14' }, pace, windowStart, adjustWindowEnd, -0.1);
        suggestions.push({ unit_id: unit.id, kind: 'PRICE_ADJUST' });
      } else if (occupancy > 0.85) {
        const adjustWindowEnd = windowStart.add(21, 'day');
        createPriceSuggestion(unit, { value: occupancy, window: '0-21' }, pace, windowStart, adjustWindowEnd, 0.08);
        suggestions.push({ unit_id: unit.id, kind: 'PRICE_ADJUST' });
      }

      if (heavyEarlyCheckin >= 3) {
        createPolicySuggestion(unit);
        suggestions.push({ unit_id: unit.id, kind: 'POLICY' });
      }

      if (avgStay >= 7 && occupancy < 0.5) {
        updateExistingStmt.run({ property_id: unit.property_id, unit_id: unit.id, kind: 'BLOCKING' });
        insertSuggestionStmt.run({
          id: randomUUID(),
          property_id: unit.property_id,
          unit_id: unit.id,
          kind: 'BLOCKING',
          title: `Avaliar bloqueios temporários (${unit.name})`,
          details: JSON.stringify({ reason: 'Estadias longas com baixa ocupação', avg_stay: avgStay }),
          suggested_action: JSON.stringify({ type: 'consider_block', unit_id: unit.id, nights: 3 }),
        });
        suggestions.push({ unit_id: unit.id, kind: 'BLOCKING' });
      }
    });

    const groupedByProperty = new Map();
    units.forEach(unit => {
      if (!groupedByProperty.has(unit.property_id)) {
        groupedByProperty.set(unit.property_id, { propertyId: unit.property_id, propertyName: unit.property_name });
      }
    });

    groupedByProperty.forEach(info => {
      const directBookings = directBookingsStmt.get(dayjs().subtract(7, 'day').toISOString(), info.propertyId).c;
      if (directBookings === 0) {
        createPromoSuggestion(info.propertyId, info.propertyName);
        suggestions.push({ property_id: info.propertyId, kind: 'PROMO' });
      }
    });

    return suggestions;
  }

  return { run };
}

module.exports = { createDecisionAssistant };
