const { normalizeRuleRow } = require('../../server/services/pricing/rules');

function createRateRuleService({ db, dayjs }) {
  if (!db) {
    throw new Error('createRateRuleService requer acesso à base de dados.');
  }
  const nowIso = () => (dayjs ? dayjs().format('YYYY-MM-DD HH:mm:ss') : new Date().toISOString());

  const selectUnitStmt = db.prepare('SELECT id, property_id FROM units WHERE id = ?');
  const selectPropertyStmt = db.prepare('SELECT id, name FROM properties WHERE id = ?');

  function resolveScope(unitId, propertyId) {
    let resolvedUnitId = null;
    let resolvedPropertyId = null;
    if (unitId != null) {
      const unitRow = selectUnitStmt.get(unitId);
      if (!unitRow) {
        throw new Error('Unidade selecionada não existe.');
      }
      resolvedUnitId = unitRow.id;
      resolvedPropertyId = unitRow.property_id;
    }
    if (propertyId != null) {
      const propertyRow = selectPropertyStmt.get(propertyId);
      if (!propertyRow) {
        throw new Error('Propriedade selecionada não existe.');
      }
      if (resolvedPropertyId != null && resolvedPropertyId !== propertyRow.id) {
        throw new Error('A unidade e a propriedade selecionadas não correspondem.');
      }
      resolvedPropertyId = propertyRow.id;
    }
    return { unitId: resolvedUnitId, propertyId: resolvedPropertyId };
  }

  function normalizeForCurrency(row, currency = 'eur') {
    const normalized = normalizeRuleRow(row, { currency });
    if (!normalized) return null;
    normalized.unitName = row.unit_name || row.unitName || null;
    normalized.propertyName = row.property_name || row.propertyName || null;
    return normalized;
  }

  function listRules(options = {}) {
    const currency = options.currency || 'eur';
    const rows = db
      .prepare(
        `SELECT rr.*, u.name AS unit_name, p.name AS property_name
           FROM rate_rules rr
           LEFT JOIN units u ON u.id = rr.unit_id
           LEFT JOIN properties p ON p.id = rr.property_id
          ORDER BY rr.priority DESC, rr.id DESC`
      )
      .all();
    return rows.map(row => normalizeForCurrency(row, currency)).filter(Boolean);
  }

  function getRule(id, options = {}) {
    const currency = options.currency || 'eur';
    const row = db
      .prepare(
        `SELECT rr.*, u.name AS unit_name, p.name AS property_name
           FROM rate_rules rr
           LEFT JOIN units u ON u.id = rr.unit_id
           LEFT JOIN properties p ON p.id = rr.property_id
          WHERE rr.id = ?`
      )
      .get(id);
    if (!row) return null;
    return normalizeForCurrency(row, currency);
  }

  function persistRule(insert, payload) {
    const {
      unitId,
      propertyId,
      name,
      type,
      config,
      adjustmentPercent,
      minPriceCents,
      maxPriceCents,
      priority,
      active,
    } = payload;
    const configJson = JSON.stringify(config || {});
    const params = {
      unit_id: unitId ?? null,
      property_id: propertyId ?? null,
      name,
      type,
      config: configJson,
      adjustment_percent: adjustmentPercent,
      min_price_cents: minPriceCents ?? null,
      max_price_cents: maxPriceCents ?? null,
      priority: priority ?? 0,
      active: active ? 1 : 0,
      updated_at: nowIso(),
    };
    if (insert) {
      params.created_at = params.updated_at;
      const stmt = db.prepare(
        `INSERT INTO rate_rules
          (unit_id, property_id, type, name, config, adjustment_percent, min_price_cents, max_price_cents, priority, active, created_at, updated_at)
         VALUES
          (@unit_id, @property_id, @type, @name, @config, @adjustment_percent, @min_price_cents, @max_price_cents, @priority, @active, @created_at, @updated_at)`
      );
      const result = stmt.run(params);
      return result.lastInsertRowid;
    }
    const stmt = db.prepare(
      `UPDATE rate_rules
          SET unit_id = @unit_id,
              property_id = @property_id,
              type = @type,
              name = @name,
              config = @config,
              adjustment_percent = @adjustment_percent,
              min_price_cents = @min_price_cents,
              max_price_cents = @max_price_cents,
              priority = @priority,
              active = @active,
              updated_at = @updated_at
        WHERE id = @id`
    );
    stmt.run({ ...params, id: payload.id });
    return payload.id;
  }

  function createRule(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload inválido ao criar regra.');
    }
    const scope = resolveScope(payload.unitId, payload.propertyId);
    const id = persistRule(true, { ...payload, ...scope });
    return getRule(id);
  }

  function updateRule(id, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload inválido ao atualizar regra.');
    }
    const existing = getRule(id, { currency: 'eur' });
    if (!existing) {
      throw new Error('Regra não encontrada.');
    }
    const scope = resolveScope(payload.unitId ?? existing.unitId, payload.propertyId ?? existing.propertyId);
    persistRule(false, { ...payload, ...scope, id });
    return getRule(id);
  }

  function deleteRule(id) {
    const stmt = db.prepare('DELETE FROM rate_rules WHERE id = ?');
    const result = stmt.run(id);
    return result.changes || 0;
  }

  function loadRulesForUnit(unitId, options = {}) {
    const currency = options.currency || 'eur';
    const unitRow = selectUnitStmt.get(unitId);
    if (!unitRow) return [];
    const params = { unitId: unitRow.id, propertyId: unitRow.property_id };
    const rows = db
      .prepare(
        `SELECT *
           FROM rate_rules
          WHERE active = 1
            AND (unit_id = @unitId OR (unit_id IS NULL AND (property_id IS NULL OR property_id = @propertyId)))
          ORDER BY priority DESC, id`
      )
      .all(params);
    return rows.map(row => normalizeRuleRow(row, { currency })).filter(Boolean);
  }

  return {
    listRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
    loadRulesForUnit,
  };
}

module.exports = { createRateRuleService };
