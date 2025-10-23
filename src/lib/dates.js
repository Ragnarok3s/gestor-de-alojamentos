const dayjs = require('../../server/dayjs');

const DEFAULT_TIMEZONE = process.env.APP_DEFAULT_TIMEZONE || 'Europe/Lisbon';

function ensureDayjs(value) {
  if (value == null) {
    return null;
  }
  const instance = dayjs(value);
  return instance.isValid() ? instance : null;
}

function ensureZonedDayjs(value, timezone = DEFAULT_TIMEZONE) {
  const instance = ensureDayjs(value);
  if (!instance) return null;
  if (!timezone) {
    return instance;
  }
  if (typeof dayjs.tz === 'function') {
    const isDateOnlyString = typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}/.test(value);
    if (isDateOnlyString) {
      try {
        return dayjs.tz(value, timezone);
      } catch (err) {
        // Continua para fallback.
      }
    }
  }
  if (typeof instance.tz === 'function') {
    try {
      return instance.tz(timezone);
    } catch (err) {
      return instance;
    }
  }
  return instance;
}

function startOfDay(value, { timezone = DEFAULT_TIMEZONE } = {}) {
  const zoned = ensureZonedDayjs(value, timezone);
  return zoned ? zoned.startOf('day') : null;
}

function calculateNights(checkin, checkout, { timezone = DEFAULT_TIMEZONE } = {}) {
  const start = ensureZonedDayjs(checkin, timezone);
  const end = ensureZonedDayjs(checkout, timezone);
  if (!start || !end) return 0;
  if (!end.isAfter(start)) return 0;
  const startDate = dayjs(start.format('YYYY-MM-DD'));
  const endDate = dayjs(end.format('YYYY-MM-DD'));
  if (!endDate.isAfter(startDate)) return 0;
  return endDate.diff(startDate, 'day');
}

function formatDate(value, format = 'DD/MM/YYYY') {
  const instance = ensureDayjs(value);
  return instance ? instance.format(format) : '';
}

function formatDateTime(value, format = 'DD/MM/YYYY HH:mm') {
  const instance = ensureDayjs(value);
  return instance ? instance.format(format) : '';
}

function toIsoString(value) {
  const instance = ensureDayjs(value);
  return instance ? instance.toISOString() : null;
}

function diffInDays(start, end, options = { floating: false }) {
  const startValue = ensureDayjs(start);
  const endValue = ensureDayjs(end);
  if (!startValue || !endValue) return null;
  return endValue.diff(startValue, 'day', !!options.floating);
}

function isBefore(first, second) {
  const firstValue = ensureDayjs(first);
  const secondValue = ensureDayjs(second);
  if (!firstValue || !secondValue) return false;
  return firstValue.isBefore(secondValue);
}

function isAfter(first, second) {
  const firstValue = ensureDayjs(first);
  const secondValue = ensureDayjs(second);
  if (!firstValue || !secondValue) return false;
  return firstValue.isAfter(secondValue);
}

const api = {
  dayjs,
  ensureDayjs,
  ensureZonedDayjs,
  startOfDay,
  calculateNights,
  formatDate,
  formatDateTime,
  toIsoString,
  diffInDays,
  isBefore,
  isAfter,
  DEFAULT_TIMEZONE
};

module.exports = api;
module.exports.default = dayjs;
