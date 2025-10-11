const { ValidationError, ConflictError } = require('./errors');

function normalizeBlockPayload(payload, dayjs) {
  const startDate = dayjs(payload?.start, 'YYYY-MM-DD', true);
  const endDate = dayjs(payload?.end, 'YYYY-MM-DD', true);
  if (!startDate.isValid() || !endDate.isValid()) {
    throw new ValidationError('Seleciona um intervalo válido.');
  }
  if (endDate.isBefore(startDate)) {
    throw new ValidationError('A data final deve ser posterior à inicial.');
  }
  const endExclusive = endDate.add(1, 'day');
  const nights = endExclusive.diff(startDate, 'day');
  if (nights <= 0) {
    throw new ValidationError('Intervalo deve ter pelo menos uma noite.');
  }
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    throw new ValidationError('Indica o motivo do bloqueio.');
  }
  if (reason.length > 240) {
    throw new ValidationError('Motivo demasiado longo (máx. 240 caracteres).');
  }
  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDateExclusive: endExclusive.format('YYYY-MM-DD'),
    nights,
    reason
  };
}

function createUnitBlockService({ db, dayjs }) {
  const bookingsOverlapStmt = db.prepare(
    `SELECT COUNT(1) as total
     FROM bookings
     WHERE unit_id = ?
       AND status NOT IN ('CANCELLED', 'CANCELED')
       AND checkin < ?
       AND checkout > ?`
  );

  const blocksOverlapStmt = db.prepare(
    `SELECT COUNT(1) as total
     FROM unit_blocks
     WHERE unit_id = ?
       AND end_date > ?
       AND start_date < ?`
  );

  const legacyBlocksOverlapStmt = db.prepare(
    `SELECT COUNT(1) as total
     FROM blocks
     WHERE unit_id = ?
       AND end_date > ?
       AND start_date < ?`
  );

  const insertBlockStmt = db.prepare(
    `INSERT INTO unit_blocks (unit_id, start_date, end_date, reason, created_by)
     VALUES (?, ?, ?, ?, ?)`
  );

  function createBlock({ unitId, startDate, endDateExclusive, reason, userId }) {
    const { total: bookingsConflict } = bookingsOverlapStmt.get(unitId, endDateExclusive, startDate);
    if (bookingsConflict > 0) {
      throw new ConflictError('Já existem reservas neste intervalo. Ajusta as datas.');
    }
    const { total: blockConflict } = blocksOverlapStmt.get(unitId, startDate, endDateExclusive);
    if (blockConflict > 0) {
      throw new ConflictError('Intervalo já se encontra bloqueado.');
    }
    const { total: legacyConflict } = legacyBlocksOverlapStmt.get(unitId, startDate, endDateExclusive);
    if (legacyConflict > 0) {
      throw new ConflictError('Intervalo já se encontra bloqueado.');
    }
    const info = insertBlockStmt.run(unitId, startDate, endDateExclusive, reason, userId || null);
    return {
      id: info.lastInsertRowid,
      unit_id: unitId,
      start_date: startDate,
      end_date: endDateExclusive,
      reason,
      created_by: userId || null
    };
  }

  return {
    normalizeBlockPayload: (payload) => normalizeBlockPayload(payload, dayjs),
    createBlock
  };
}

module.exports = {
  createUnitBlockService
};
