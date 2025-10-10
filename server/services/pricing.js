const dayjs = require('dayjs');

function clamp(value, min, max) {
  let result = value;
  if (typeof min === 'number') {
    result = Math.max(result, min);
  }
  if (typeof max === 'number') {
    result = Math.min(result, max);
  }
  return result;
}

function charmPrice(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const nonNegative = Math.max(0, safeValue);
  const integerPart = Math.max(0, Math.floor(nonNegative));
  let candidate = integerPart + 0.99;
  while (candidate < nonNegative) {
    candidate += 1;
  }
  const rounded = Math.round(candidate * 100) / 100;
  return Number(rounded.toFixed(2));
}

function resolveSeasonFactor(history, monthKey, weekdayKey) {
  if (!history || !history.seasonality) return 1;
  const byMonth = history.seasonality[monthKey];
  if (!byMonth) return 1;
  const specific = byMonth[weekdayKey];
  if (typeof specific === 'number') return specific || 1;
  if (typeof byMonth.default === 'number') return byMonth.default || 1;
  return 1;
}

function resolveOccupancyFactor(history, leadDays) {
  if (!history || !history.occupancy) return 1;
  const windows = ['30', '60', '90'];
  const collected = windows
    .map(key => history.occupancy[key])
    .filter(rate => typeof rate === 'number' && rate >= 0 && rate <= 1);
  if (!collected.length) return 1;
  const avg = collected.reduce((sum, rate) => sum + rate, 0) / collected.length;
  let factor = 1;
  if (avg >= 0.9) factor = 1.15;
  else if (avg >= 0.75) factor = 1.08;
  else if (avg >= 0.6) factor = 1.02;
  else if (avg >= 0.45) factor = 0.97;
  else factor = 0.9;

  if (history.leadTimeBuckets && typeof leadDays === 'number') {
    const buckets = history.leadTimeBuckets;
    if (leadDays <= 3 && typeof buckets.short === 'number') {
      factor *= buckets.short;
    } else if (leadDays <= 7 && typeof buckets.medium === 'number') {
      factor *= buckets.medium;
    } else if (typeof buckets.long === 'number') {
      factor *= buckets.long;
    }
  }

  return Number(factor.toFixed(3));
}

function resolvePaceFactor(history) {
  if (!history || !history.pace) return 1;
  const { last7 = 0, last14 = 0, typical7 = 0, typical14 = 0 } = history.pace;
  const reference7 = typical7 || typical14 / 2 || 0;
  const reference14 = typical14 || typical7 * 2 || 0;
  let factor = 1;
  if (reference7 && last7 > reference7 * 1.3) {
    factor += 0.06;
  } else if (reference7 && last7 < reference7 * 0.7) {
    factor -= 0.06;
  }

  if (reference14 && last14 > reference14 * 1.3) {
    factor += 0.04;
  } else if (reference14 && last14 < reference14 * 0.7) {
    factor -= 0.04;
  }

  return Number(Math.max(0.8, factor).toFixed(3));
}

function resolveCompetitorFactor({ baseRate, marketRows = [], rules = {} }) {
  const overrideIndex = typeof rules.competitor_index === 'number' ? rules.competitor_index : null;
  if (overrideIndex && overrideIndex > 0) return Number(overrideIndex.toFixed(3));
  if (!marketRows.length || !baseRate) return 1;
  const avg =
    marketRows.reduce((sum, row) => {
      const price = Number(row.market_price || row.price || row.value);
      return Number.isFinite(price) ? sum + price : sum;
    }, 0) / marketRows.length;
  if (!Number.isFinite(avg) || avg <= 0) return 1;
  return Number((avg / baseRate).toFixed(3));
}

function applyTemporalAdjustments(price, leadDays, breakdown) {
  let adjusted = price;
  if (leadDays <= 3) {
    const discount = leadDays <= 1 ? 0.15 : 0.08;
    adjusted *= 1 - discount;
    breakdown.lastMinute = -(discount * 100);
  } else if (leadDays > 120) {
    adjusted *= 0.95;
    breakdown.earlyBird = -5;
  }
  return adjusted;
}

function parseRules(ratePlan) {
  if (!ratePlan) return {};
  if (ratePlan.rules && typeof ratePlan.rules === 'object') return ratePlan.rules;
  if (typeof ratePlan.rules === 'string') {
    try {
      const parsed = JSON.parse(ratePlan.rules);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
      return {};
    }
  }
  return {};
}

function suggestPrice({ unit, targetDate, history = {}, ratePlan = {}, marketRows = [] }) {
  if (!unit) {
    throw new Error('Unit is required');
  }
  const baseRate = Number.isFinite(unit.base_rate)
    ? unit.base_rate
    : Number.isFinite(unit.base_price)
    ? unit.base_price
    : Number.isFinite(unit.base_price_cents)
    ? unit.base_price_cents / 100
    : 0;
  const day = dayjs(targetDate);
  if (!day.isValid()) {
    throw new Error('targetDate inválida');
  }
  const monthKey = day.format('MM');
  const weekdayKey = String(day.day());
  const leadDays = Math.max(0, day.startOf('day').diff(dayjs().startOf('day'), 'day'));

  const rules = parseRules(ratePlan);
  const seasonFactor = resolveSeasonFactor(history, monthKey, weekdayKey);
  const occupancyFactor = resolveOccupancyFactor(history, leadDays);
  const paceFactor = resolvePaceFactor(history);
  const competitorFactor = resolveCompetitorFactor({ baseRate, marketRows, rules });

  let suggested = baseRate * seasonFactor * occupancyFactor * paceFactor * competitorFactor;
  const breakdown = {
    base: baseRate,
    seasonFactor,
    occupancyFactor,
    paceFactor,
    competitorFactor,
    leadDays,
  };

  suggested = applyTemporalAdjustments(suggested, leadDays, breakdown);

  const minPrice = Number.isFinite(ratePlan.min_price) ? ratePlan.min_price : null;
  const maxPrice = Number.isFinite(ratePlan.max_price) ? ratePlan.max_price : null;

  const clamped = clamp(suggested, minPrice, maxPrice);
  breakdown.clamped = clamped !== suggested;
  if (minPrice != null) breakdown.minPrice = minPrice;
  if (maxPrice != null) breakdown.maxPrice = maxPrice;

  const finalPrice = charmPrice(clamped);
  breakdown.finalPrice = finalPrice;

  return {
    price: finalPrice,
    breakdown,
  };
}

function bulkSuggest(unitIds, fromDate, toDate, options = {}) {
  const {
    unitsById = new Map(),
    historiesByUnit = new Map(),
    ratePlansByUnit = new Map(),
    competitorRowsByUnit = new Map(),
    generateId,
    reasonBuilder,
    now = dayjs(),
  } = options;

  const start = dayjs(fromDate).startOf('day');
  const end = dayjs(toDate).startOf('day');
  if (!start.isValid() || !end.isValid()) {
    throw new Error('Intervalo inválido');
  }
  if (end.isBefore(start)) {
    throw new Error('Data final não pode ser anterior à inicial');
  }

  const createId = typeof generateId === 'function' ? generateId : (unitId, dateStr) => `${unitId}:${dateStr}`;
  const makeReason =
    typeof reasonBuilder === 'function'
      ? reasonBuilder
      : ({ unit, date }) => `Sugestão automática (${unit.name || unit.id}) para ${date}`;

  const snapshots = [];

  for (const unitId of unitIds) {
    const unit = unitsById.get(unitId) || unitsById.get(String(unitId));
    if (!unit) continue;
    const history = historiesByUnit.get(unitId) || {};
    const ratePlan = ratePlansByUnit.get(unitId) || {};
    const marketRows = competitorRowsByUnit.get(unitId) || [];

    let cursor = start.clone();
    while (cursor.isSameOrBefore(end)) {
      const dateStr = cursor.format('YYYY-MM-DD');
      const { price, breakdown } = suggestPrice({
        unit,
        targetDate: dateStr,
        history,
        ratePlan,
        marketRows,
      });
      snapshots.push({
        id: createId(unitId, dateStr, { unit, date: dateStr, now }),
        unit_id: unitId,
        date: dateStr,
        suggested: price,
        reason: makeReason({ unit, date: dateStr, breakdown, now }),
        inputs: breakdown,
      });
      cursor = cursor.add(1, 'day');
    }
  }

  return snapshots;
}

module.exports = {
  suggestPrice,
  bulkSuggest,
};
