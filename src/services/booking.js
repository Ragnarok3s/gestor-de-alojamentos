const dayjs = require('../config/dayjs');

function dateRangeNights(checkin, checkout) {
  const start = dayjs(checkin);
  const end = dayjs(checkout);
  const nights = [];
  for (let d = start; d.isBefore(end); d = d.add(1, 'day')) {
    nights.push(d.format('YYYY-MM-DD'));
  }
  return nights;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const aS = dayjs(aStart);
  const aE = dayjs(aEnd);
  const bS = dayjs(bStart);
  const bE = dayjs(bEnd);
  return aS.isBefore(bE) && aE.isAfter(bS);
}

function isWeekendDate(dateLike) {
  const dow = dayjs(dateLike).day();
  return dow === 0 || dow === 6;
}

function unitAvailable(db, unitId, checkin, checkout) {
  const conflicts = db
    .prepare(
      `SELECT checkin AS s, checkout AS e FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
       UNION ALL
       SELECT start_date AS s, end_date AS e FROM blocks WHERE unit_id = ?`
    )
    .all(unitId, unitId);
  return !conflicts.some((c) => overlaps(checkin, checkout, c.s, c.e));
}

function rateQuote(db, unitId, checkin, checkout, basePriceCents) {
  const nights = dateRangeNights(checkin, checkout);
  const rows = db.prepare('SELECT * FROM rates WHERE unit_id = ?').all(unitId);
  let total = 0;
  let minStayReq = 1;
  nights.forEach((night) => {
    const rate = rows.find(
      (entry) => !dayjs(night).isBefore(entry.start_date) && dayjs(night).isBefore(entry.end_date)
    );
    if (rate) {
      minStayReq = Math.max(minStayReq, rate.min_stay || 1);
      const price = isWeekendDate(night)
        ? rate.weekend_price_cents ?? rate.weekday_price_cents ?? basePriceCents
        : rate.weekday_price_cents ?? rate.weekend_price_cents ?? basePriceCents;
      total += price;
    } else {
      total += basePriceCents;
    }
  });
  return { total_cents: total, nights: nights.length, minStayReq };
}

module.exports = {
  dateRangeNights,
  overlaps,
  unitAvailable,
  rateQuote,
  isWeekendDate,
};
