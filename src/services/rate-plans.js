const { ValidationError, ConflictError } = require('./errors');

function parsePlanId(input, fieldName = 'Plano tarifário') {
  if (input == null || input === '') return null;
  const numeric = Number(input);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new ValidationError(`${fieldName} inválido.`);
  }
  return numeric;
}

function sanitizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function toBoolean(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return false;
    return ['1', 'true', 'yes', 'sim', 'on'].includes(trimmed);
  }
  return !!value;
}

function normalizeDate(value, dayjs, fieldLabel) {
  const parsed = dayjs(value, 'YYYY-MM-DD', true);
  if (!parsed.isValid()) {
    throw new ValidationError(`${fieldLabel} inválida.`);
  }
  return parsed.format('YYYY-MM-DD');
}

function createRatePlanService({ db, dayjs }) {
  if (!db) throw new Error('createRatePlanService: db obrigatório');
  if (!dayjs) throw new Error('createRatePlanService: dayjs obrigatório');

  const selectPlanStmt = db.prepare(
    `SELECT id, property_id, name, description, is_default, active, min_price, max_price, rules,
            created_at, updated_at
       FROM rate_plans
      WHERE id = ?`
  );
  const listPlansStmt = db.prepare(
    `SELECT id, property_id, name, description, is_default, active, min_price, max_price, rules,
            created_at, updated_at
       FROM rate_plans
      WHERE (? IS NULL OR property_id = ? OR property_id IS NULL)
      ORDER BY name`
  );
  const insertPlanStmt = db.prepare(
    `INSERT INTO rate_plans(property_id, name, description, is_default, active, min_price, max_price, rules, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))`
  );
  const updatePlanStmt = db.prepare(
    `UPDATE rate_plans
        SET property_id = ?,
            name = ?,
            description = ?,
            is_default = ?,
            active = ?,
            min_price = ?,
            max_price = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );
  const deletePlanStmt = db.prepare('DELETE FROM rate_plans WHERE id = ?');

  const listRestrictionsStmt = db.prepare(
    `SELECT id, rate_plan_id, start_date, end_date, closed_to_arrival, closed_to_departure, reason,
            created_at, updated_at
       FROM rate_restrictions
      WHERE rate_plan_id = ?
      ORDER BY start_date`
  );
  const selectRestrictionStmt = db.prepare(
    `SELECT id, rate_plan_id, start_date, end_date, closed_to_arrival, closed_to_departure, reason,
            created_at, updated_at
       FROM rate_restrictions
      WHERE id = ?`
  );
  const insertRestrictionStmt = db.prepare(
    `INSERT INTO rate_restrictions(rate_plan_id, start_date, end_date, closed_to_arrival, closed_to_departure, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  );
  const updateRestrictionStmt = db.prepare(
    `UPDATE rate_restrictions
        SET start_date = ?,
            end_date = ?,
            closed_to_arrival = ?,
            closed_to_departure = ?,
            reason = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );
  const deleteRestrictionStmt = db.prepare('DELETE FROM rate_restrictions WHERE id = ?');

  function listPlans({ propertyId = null, includeInactive = false } = {}) {
    const propertyFilter = propertyId != null ? Number(propertyId) : null;
    const rows = listPlansStmt.all(propertyFilter, propertyFilter);
    return rows.filter(row => includeInactive || row.active !== 0);
  }

  function getPlan(id) {
    const numericId = parsePlanId(id);
    if (numericId == null) return null;
    return selectPlanStmt.get(numericId) || null;
  }

  function normalizePlanPayload(payload = {}) {
    const name = sanitizeText(payload.name);
    if (!name) throw new ValidationError('Nome do plano obrigatório.');
    const propertyId = payload.propertyId != null ? parsePlanId(payload.propertyId, 'Propriedade') : null;
    const description = sanitizeText(payload.description);
    const isDefault = toBoolean(payload.isDefault) ? 1 : 0;
    const active = payload.active === undefined ? 1 : toBoolean(payload.active) ? 1 : 0;
    let minPrice = null;
    let maxPrice = null;
    if (payload.minPrice != null && payload.minPrice !== '') {
      const numeric = Number(payload.minPrice);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new ValidationError('Preço mínimo inválido.');
      }
      minPrice = numeric;
    }
    if (payload.maxPrice != null && payload.maxPrice !== '') {
      const numeric = Number(payload.maxPrice);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new ValidationError('Preço máximo inválido.');
      }
      maxPrice = numeric;
    }
    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      throw new ValidationError('Preço mínimo não pode exceder máximo.');
    }
    return { propertyId, name, description, isDefault, active, minPrice, maxPrice };
  }

  function createPlan(payload) {
    const normalized = normalizePlanPayload(payload);
    const info = insertPlanStmt.run(
      normalized.propertyId,
      normalized.name,
      normalized.description,
      normalized.isDefault,
      normalized.active,
      normalized.minPrice,
      normalized.maxPrice
    );
    return getPlan(info.lastInsertRowid);
  }

  function updatePlan(id, payload) {
    const existing = getPlan(id);
    if (!existing) throw new ValidationError('Plano tarifário não encontrado.');
    const normalized = normalizePlanPayload({ ...existing, ...payload });
    updatePlanStmt.run(
      normalized.propertyId,
      normalized.name,
      normalized.description,
      normalized.isDefault,
      normalized.active,
      normalized.minPrice,
      normalized.maxPrice,
      existing.id
    );
    return getPlan(existing.id);
  }

  function deletePlan(id) {
    const numericId = parsePlanId(id);
    if (numericId == null) throw new ValidationError('Plano tarifário inválido.');
    const ref = selectPlanStmt.get(numericId);
    if (!ref) return false;
    const inUse = db.prepare('SELECT 1 FROM bookings WHERE rate_plan_id = ? LIMIT 1').get(numericId);
    if (inUse) {
      throw new ConflictError('Não é possível remover plano associado a reservas.');
    }
    const { changes } = deletePlanStmt.run(numericId);
    return changes > 0;
  }

  function listRestrictions(ratePlanId) {
    const plan = getPlan(ratePlanId);
    if (!plan) throw new ValidationError('Plano tarifário não encontrado.');
    return listRestrictionsStmt.all(plan.id).map(row => ({
      ...row,
      closed_to_arrival: row.closed_to_arrival ? 1 : 0,
      closed_to_departure: row.closed_to_departure ? 1 : 0
    }));
  }

  function getRestriction(id) {
    const numericId = parsePlanId(id, 'Restrição');
    if (numericId == null) return null;
    const row = selectRestrictionStmt.get(numericId);
    if (!row) return null;
    return {
      ...row,
      closed_to_arrival: row.closed_to_arrival ? 1 : 0,
      closed_to_departure: row.closed_to_departure ? 1 : 0
    };
  }

  function normalizeRestrictionPayload(payload = {}) {
    const ratePlanId = parsePlanId(payload.ratePlanId || payload.rate_plan_id, 'Plano tarifário');
    if (!ratePlanId) throw new ValidationError('Plano tarifário obrigatório.');
    const startDate = normalizeDate(payload.startDate || payload.start_date, dayjs, 'Data inicial');
    const endDateRaw = normalizeDate(payload.endDate || payload.end_date, dayjs, 'Data final');
    const start = dayjs(startDate);
    const end = dayjs(endDateRaw);
    if (!end.isAfter(start)) {
      throw new ValidationError('A data final deve ser posterior à inicial.');
    }
    const closedToArrival = toBoolean(payload.closedToArrival || payload.closed_to_arrival) ? 1 : 0;
    const closedToDeparture = toBoolean(payload.closedToDeparture || payload.closed_to_departure) ? 1 : 0;
    if (!closedToArrival && !closedToDeparture) {
      throw new ValidationError('Seleciona pelo menos uma restrição (CTA ou CTD).');
    }
    const reason = sanitizeText(payload.reason);
    return {
      ratePlanId,
      startDate,
      endDate: end.format('YYYY-MM-DD'),
      closedToArrival,
      closedToDeparture,
      reason
    };
  }

  function createRestriction(payload) {
    const normalized = normalizeRestrictionPayload(payload);
    if (!getPlan(normalized.ratePlanId)) {
      throw new ValidationError('Plano tarifário não encontrado.');
    }
    const info = insertRestrictionStmt.run(
      normalized.ratePlanId,
      normalized.startDate,
      normalized.endDate,
      normalized.closedToArrival,
      normalized.closedToDeparture,
      normalized.reason
    );
    return getRestriction(info.lastInsertRowid);
  }

  function updateRestriction(id, payload) {
    const existing = getRestriction(id);
    if (!existing) throw new ValidationError('Restrição não encontrada.');
    const normalized = normalizeRestrictionPayload({ ...existing, ...payload, ratePlanId: existing.rate_plan_id });
    updateRestrictionStmt.run(
      normalized.startDate,
      normalized.endDate,
      normalized.closedToArrival,
      normalized.closedToDeparture,
      normalized.reason,
      existing.id
    );
    return getRestriction(existing.id);
  }

  function deleteRestriction(id) {
    const numericId = parsePlanId(id, 'Restrição');
    if (numericId == null) throw new ValidationError('Restrição inválida.');
    const { changes } = deleteRestrictionStmt.run(numericId);
    return changes > 0;
  }

  function isWithinRange(target, start, end) {
    const cursor = dayjs(target, 'YYYY-MM-DD', true);
    const startDate = dayjs(start, 'YYYY-MM-DD', true);
    const endDate = dayjs(end, 'YYYY-MM-DD', true);
    if (!cursor.isValid() || !startDate.isValid() || !endDate.isValid()) return false;
    return !cursor.isBefore(startDate) && cursor.isBefore(endDate);
  }

  function assertBookingAllowed({ ratePlanId, checkin, checkout }) {
    const numericPlanId = parsePlanId(ratePlanId);
    if (!numericPlanId) {
      return { ok: true, plan: null };
    }
    const plan = getPlan(numericPlanId);
    if (!plan || plan.active === 0) {
      throw new ValidationError('Plano tarifário inválido.');
    }
    const checkinDate = normalizeDate(checkin, dayjs, 'Check-in');
    const checkoutDate = normalizeDate(checkout, dayjs, 'Check-out');
    const overlapping = db
      .prepare(
        `SELECT id, start_date, end_date, closed_to_arrival, closed_to_departure, reason
           FROM rate_restrictions
          WHERE rate_plan_id = ?
            AND NOT (end_date <= ? OR start_date >= ?)`
      )
      .all(plan.id, checkinDate, checkoutDate);

    for (const restriction of overlapping) {
      if (restriction.closed_to_arrival && isWithinRange(checkinDate, restriction.start_date, restriction.end_date)) {
        const reason = restriction.reason ? ` ${restriction.reason}` : '';
        throw new ConflictError(
          `Check-in indisponível para ${dayjs(checkinDate).format('DD/MM/YYYY')}.${reason ? ' ' + reason : ''}`.trim(),
          { type: 'CTA', restrictionId: restriction.id, ratePlanId: plan.id }
        );
      }
      if (
        restriction.closed_to_departure &&
        isWithinRange(checkoutDate, restriction.start_date, restriction.end_date)
      ) {
        const reason = restriction.reason ? ` ${restriction.reason}` : '';
        throw new ConflictError(
          `Check-out indisponível para ${dayjs(checkoutDate).format('DD/MM/YYYY')}.${reason ? ' ' + reason : ''}`.trim(),
          { type: 'CTD', restrictionId: restriction.id, ratePlanId: plan.id }
        );
      }
    }

    return { ok: true, plan };
  }

  return {
    listPlans,
    getPlan,
    createPlan,
    updatePlan,
    deletePlan,
    listRestrictions,
    getRestriction,
    createRestriction,
    updateRestriction,
    deleteRestriction,
    assertBookingAllowed
  };
}

module.exports = {
  createRatePlanService
};
