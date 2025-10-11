const { ValidationError } = require('./errors');

function normalizeUnitIds(rawIds) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new ValidationError('Seleciona pelo menos uma unidade.');
  }
  const unitIds = Array.from(new Set(rawIds.map(Number).filter(id => Number.isInteger(id) && id > 0)));
  if (unitIds.length === 0) {
    throw new ValidationError('IDs de unidade inválidos.');
  }
  return unitIds;
}

function parsePrice(price) {
  if (price == null || price === '') {
    throw new ValidationError('Indica um preço válido.');
  }
  const numeric = Number(price);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ValidationError('Indica um preço positivo.');
  }
  return Math.round(numeric * 100);
}

function normalizeDateRange(dateRange, dayjs) {
  if (!dateRange || typeof dateRange !== 'object') {
    throw new ValidationError('Intervalo de datas obrigatório.');
  }
  const { start, end } = dateRange;
  const startDate = dayjs(start, 'YYYY-MM-DD', true);
  const endDate = dayjs(end, 'YYYY-MM-DD', true);
  if (!startDate.isValid() || !endDate.isValid()) {
    throw new ValidationError('Datas inválidas.');
  }
  if (endDate.isBefore(startDate)) {
    throw new ValidationError('A data final deve ser posterior à inicial.');
  }
  const endExclusive = endDate.add(1, 'day');
  const nights = endExclusive.diff(startDate, 'day');
  if (nights <= 0) {
    throw new ValidationError('Intervalo tem de incluir pelo menos uma noite.');
  }
  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDateExclusive: endExclusive.format('YYYY-MM-DD'),
    nights
  };
}

function createRateManagementService({ db, dayjs }) {
  const insertSingle = db.prepare(
    `INSERT INTO rates (unit_id, start_date, end_date, weekday_price_cents, weekend_price_cents)
     VALUES (?, ?, ?, ?, ?)`
  );

  const applyBulkUpdate = db.transaction(({ unitIds, startDate, endDateExclusive, priceCents }) => {
    const rateIds = [];
    for (const unitId of unitIds) {
      const info = insertSingle.run(unitId, startDate, endDateExclusive, priceCents, priceCents);
      rateIds.push(info.lastInsertRowid);
    }
    return rateIds;
  });

  function undoBulkUpdate(rateIds) {
    if (!Array.isArray(rateIds) || rateIds.length === 0) {
      return 0;
    }
    let removed = 0;
    for (let i = 0; i < rateIds.length; i += 500) {
      const slice = rateIds.slice(i, i + 500);
      const params = {};
      const placeholders = slice.map((id, idx) => {
        const key = `id${idx}`;
        params[key] = Number(id);
        return `@${key}`;
      });
      const stmt = db.prepare(`DELETE FROM rates WHERE id IN (${placeholders.join(',')})`);
      const { changes } = stmt.run(params);
      removed += changes;
    }
    return removed;
  }

  function normalizeBulkPayload(payload) {
    const unitIds = normalizeUnitIds(payload.unitIds).sort((a, b) => a - b);
    const priceCents = parsePrice(payload.price);
    const { startDate, endDateExclusive, nights } = normalizeDateRange(payload.dateRange, dayjs);
    return { unitIds, priceCents, startDate, endDateExclusive, nights };
  }

  return {
    normalizeBulkPayload,
    applyBulkUpdate,
    undoBulkUpdate
  };
}

module.exports = {
  createRateManagementService
};
