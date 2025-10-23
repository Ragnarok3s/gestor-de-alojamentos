const dayjs = require('../../dayjs');

function parseRuleConfig(rawConfig) {
  if (!rawConfig) return {};
  if (typeof rawConfig === 'object' && !Array.isArray(rawConfig)) return rawConfig;
  if (typeof rawConfig === 'string') {
    try {
      const parsed = JSON.parse(rawConfig);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      return {};
    }
  }
  return {};
}

function normalizeRuleRow(row, options = {}) {
  if (!row) return null;
  const { currency = 'eur' } = options;
  const convertPrice = value => {
    if (value == null || Number.isNaN(value)) return null;
    if (currency === 'eur') {
      return Number((Number(value) / 100).toFixed(2));
    }
    return Math.round(Number(value));
  };
  const config = parseRuleConfig(row.config || row.configuration || row.settings);
  const adjustmentPercent = Number(row.adjustment_percent ?? row.adjustmentPercent ?? 0) || 0;
  const minPrice = convertPrice(row.min_price_cents ?? row.minPriceCents ?? row.minPrice);
  const maxPrice = convertPrice(row.max_price_cents ?? row.maxPriceCents ?? row.maxPrice);
  const active = row.active == null ? true : !!Number(row.active);
  const priority = Number(row.priority ?? row.rule_priority ?? 0) || 0;
  const type = row.type || row.rule_type;
  if (!type) return null;
  const normalized = {
    id: row.id,
    name: row.name || row.label || `Regra #${row.id || ''}`.trim(),
    type,
    adjustmentPercent,
    minPrice,
    maxPrice,
    priority,
    active,
    unitId: row.unit_id ?? row.unitId ?? null,
    propertyId: row.property_id ?? row.propertyId ?? null,
    config,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    normalizedCurrency: currency,
  };
  normalized.scope = normalized.unitId ? 'unit' : normalized.propertyId ? 'property' : 'global';
  return normalized;
}

function matchesOccupancyRule(rule, context) {
  const { config } = rule;
  const { occupancy, unitOccupancy } = context;
  const sourceValue = rule.unitId ? unitOccupancy : occupancy;
  if (typeof sourceValue !== 'number') return false;
  if (typeof config.minOccupancy === 'number' && sourceValue < config.minOccupancy) return false;
  if (typeof config.maxOccupancy === 'number' && sourceValue > config.maxOccupancy) return false;
  return true;
}

function matchesLeadTimeRule(rule, context) {
  const { config } = rule;
  if (typeof context.leadDays !== 'number') return false;
  if (typeof config.minLead === 'number' && context.leadDays < config.minLead) return false;
  if (typeof config.maxLead === 'number' && context.leadDays > config.maxLead) return false;
  return true;
}

function matchesWeekdayRule(rule, context) {
  const { config } = rule;
  const weekdays = Array.isArray(config.weekdays) ? config.weekdays.map(Number).filter(n => !Number.isNaN(n)) : [];
  if (!weekdays.length) return false;
  const weekday = typeof context.weekday === 'number' ? context.weekday : dayjs(context.date).day();
  return weekdays.includes(weekday);
}

function matchesEventRule(rule, context) {
  const { config } = rule;
  const target = dayjs(context.date);
  if (!target.isValid()) return false;
  const start = config.startDate ? dayjs(config.startDate) : null;
  const end = config.endDate ? dayjs(config.endDate) : null;
  if (start && start.isValid() && target.isBefore(start, 'day')) return false;
  if (end && end.isValid() && target.isAfter(end, 'day')) return false;
  if (!start && !end && Array.isArray(config.dates)) {
    const dateStr = target.format('YYYY-MM-DD');
    return config.dates.includes(dateStr);
  }
  return true;
}

function matchesRule(rule, context) {
  if (!rule || !rule.active) return false;
  switch (rule.type) {
    case 'occupancy':
      return matchesOccupancyRule(rule, context);
    case 'lead_time':
      return matchesLeadTimeRule(rule, context);
    case 'weekday':
      return matchesWeekdayRule(rule, context);
    case 'event':
      return matchesEventRule(rule, context);
    default:
      return false;
  }
}

function applyRateRules({ rules = [], context = {} } = {}) {
  const list = Array.isArray(rules) ? rules : [];
  if (!list.length) {
    return { multiplier: 1, minPrice: null, maxPrice: null, applied: [] };
  }
  const normalizedList = list
    .map(rule => (rule && rule.normalizedCurrency ? rule : normalizeRuleRow(rule, { currency: 'eur' })))
    .filter(rule => rule && rule.active);
  if (!normalizedList.length) {
    return { multiplier: 1, minPrice: null, maxPrice: null, applied: [] };
  }
  normalizedList.sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    if (a.id && b.id) return a.id - b.id;
    return 0;
  });
  let multiplier = 1;
  let minPrice = null;
  let maxPrice = null;
  const applied = [];
  normalizedList.forEach(rule => {
    if (!matchesRule(rule, context)) return;
    const percent = Number(rule.adjustmentPercent || 0) || 0;
    if (percent !== 0) {
      const factor = 1 + percent / 100;
      multiplier *= factor;
    }
    if (rule.minPrice != null) {
      minPrice = minPrice == null ? rule.minPrice : Math.max(minPrice, rule.minPrice);
    }
    if (rule.maxPrice != null) {
      maxPrice = maxPrice == null ? rule.maxPrice : Math.min(maxPrice, rule.maxPrice);
    }
    applied.push({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      adjustmentPercent: percent,
      minPrice: rule.minPrice,
      maxPrice: rule.maxPrice,
    });
  });
  if (multiplier < 0) multiplier = 0;
  return {
    multiplier: Number(multiplier.toFixed(6)),
    minPrice,
    maxPrice,
    applied,
  };
}

module.exports = {
  applyRateRules,
  normalizeRuleRow,
  parseRuleConfig,
};
