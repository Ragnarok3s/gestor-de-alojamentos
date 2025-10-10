const { randomUUID } = require('node:crypto');

module.exports = async function priceOverrideAction(action = {}, payload = {}, context = {}) {
  const { db } = context;
  if (!db) throw new Error('Base de dados indisponível para overrides de preço.');

  const unitId = action.unit_id || payload.unit_id || (payload.unit && payload.unit.id);
  const date = action.date || payload.date;
  const price = Number(action.price != null ? action.price : payload.price);
  if (!unitId || !date || !Number.isFinite(price)) {
    throw new Error('Override de preço requer unidade, data e preço válidos.');
  }

  const upsertStmt = db.prepare(
    `INSERT INTO calendar_price_overrides (id, unit_id, date, price, created_by, created_at)
     VALUES (@id, @unit_id, @date, @price, @created_by, datetime('now'))
     ON CONFLICT(unit_id, date)
     DO UPDATE SET price = excluded.price, created_by = excluded.created_by, created_at = datetime('now')`
  );

  const id = randomUUID();
  upsertStmt.run({
    id,
    unit_id: unitId,
    date,
    price,
    created_by: context.userId || null,
  });

  const historyStmt = db.prepare(
    `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, meta_json)
     VALUES (@user_id, 'price.override', 'unit', @entity_id, @meta_json)`
  );
  historyStmt.run({
    user_id: context.userId || null,
    entity_id: unitId,
    meta_json: JSON.stringify({ date, price, source: payload.trigger || 'automation' }),
  });

  return { unit_id: unitId, date, price };
};
