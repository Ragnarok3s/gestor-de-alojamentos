const { ValidationError, ConflictError } = require('./errors');

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function createOverbookingGuard({ db, dayjs, logChange, channelSync, logger = console } = {}) {
  if (!db || typeof db.transaction !== 'function') {
    throw new Error('createOverbookingGuard requer instancia de base de dados com transações.');
  }

  const findLockByBookingStmt = db.prepare(
    'SELECT id, unit_id, start_date, end_date, lock_type, lock_source, lock_owner_booking_id FROM unit_blocks WHERE lock_owner_booking_id = ? LIMIT 1'
  );

  const bookingOverlapStmt = db.prepare(
    `SELECT id FROM bookings
       WHERE unit_id = ?
         AND id <> ?
         AND status IN ('CONFIRMED','PENDING')
         AND NOT (checkout <= ? OR checkin >= ?)
       LIMIT 1`
  );

  const blockOverlapStmt = db.prepare(
    `SELECT id FROM unit_blocks
       WHERE unit_id = ?
         AND id <> ?
         AND end_date > ?
         AND start_date < ?
       LIMIT 1`
  );

  const legacyBlockOverlapStmt = db.prepare(
    `SELECT id FROM blocks
       WHERE unit_id = ?
         AND end_date > ?
         AND start_date < ?
       LIMIT 1`
  );

  const insertLockStmt = db.prepare(
    `INSERT INTO unit_blocks(
        unit_id,
        start_date,
        end_date,
        reason,
        created_by,
        lock_type,
        lock_source,
        lock_owner_booking_id
      )
      VALUES (?,?,?,?,?,?,?,?)`
  );

  const updateLockStmt = db.prepare(
    `UPDATE unit_blocks
        SET unit_id = ?,
            start_date = ?,
            end_date = ?,
            reason = ?,
            lock_type = ?,
            lock_source = ?,
            lock_owner_booking_id = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );

  const tx = db.transaction(({ unitId, fromDate, toDate, bookingId, actorId, source }) => {
    const existing = findLockByBookingStmt.get(bookingId);
    const ignoreId = existing ? existing.id : -1;

    const conflictingBooking = bookingOverlapStmt.get(unitId, bookingId, toDate, fromDate);
    if (conflictingBooking) {
      throw new ConflictError('Datas indisponíveis para reserva.');
    }

    const conflictingBlock = blockOverlapStmt.get(unitId, ignoreId, fromDate, toDate);
    if (conflictingBlock) {
      throw new ConflictError('Intervalo já bloqueado.');
    }

    const conflictingLegacyBlock = legacyBlockOverlapStmt.get(unitId, fromDate, toDate);
    if (conflictingLegacyBlock) {
      throw new ConflictError('Intervalo indisponível (bloqueio existente).');
    }

    if (existing) {
      if (existing.unit_id === unitId && existing.start_date === fromDate && existing.end_date === toDate) {
        return { id: existing.id, wasCreated: false, wasUpdated: false, before: existing };
      }

      updateLockStmt.run(
        unitId,
        fromDate,
        toDate,
        'HARD_LOCK',
        'HARD_LOCK',
        source,
        bookingId,
        existing.id
      );

      return {
        id: existing.id,
        wasCreated: false,
        wasUpdated: true,
        before: existing
      };
    }

    const info = insertLockStmt.run(
      unitId,
      fromDate,
      toDate,
      'HARD_LOCK',
      actorId || null,
      'HARD_LOCK',
      source,
      bookingId
    );

    return {
      id: info.lastInsertRowid,
      wasCreated: true,
      wasUpdated: false,
      before: null
    };
  });

  function reserveSlot({ unitId, from, to, bookingId, actorId = null, source = 'SYSTEM' } = {}) {
    if (!Number.isInteger(unitId) || unitId <= 0) {
      throw new ValidationError('unitId inválido para bloqueio.');
    }
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      throw new ValidationError('bookingId inválido para bloqueio.');
    }
    if (!isIsoDate(from) || !isIsoDate(to)) {
      throw new ValidationError('Datas inválidas para bloqueio.');
    }
    if (!dayjs(to).isAfter(dayjs(from))) {
      throw new ValidationError('Data final deve ser posterior à inicial.');
    }
    const normalizedSource = source === 'OTA' ? 'OTA' : 'SYSTEM';

    const result = tx({ unitId, fromDate: from, toDate: to, bookingId, actorId, source: normalizedSource });

    if (logChange && (result.wasCreated || result.wasUpdated)) {
      const before = result.before
        ? {
            unit_id: result.before.unit_id,
            start_date: result.before.start_date,
            end_date: result.before.end_date,
            booking_id: result.before.lock_owner_booking_id || null
          }
        : null;
      const after = {
        unit_id: unitId,
        start_date: from,
        end_date: to,
        booking_id: bookingId,
        source: normalizedSource
      };
      try {
        logChange(actorId || null, 'unit_lock', result.id, result.wasCreated ? 'create' : 'update', before, after);
      } catch (err) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('Falha ao registar auditoria do bloqueio:', err.message);
        }
      }
    }

    if (channelSync && typeof channelSync.queueLock === 'function' && (result.wasCreated || result.wasUpdated)) {
      try {
        channelSync.queueLock({
          unitId,
          from,
          to,
          bookingId,
          source: normalizedSource,
          updated: result.wasUpdated
        });
      } catch (err) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('Falha ao enfileirar lock OTA:', err.message);
        }
      }
    }

    return {
      lockId: result.id,
      created: result.wasCreated,
      updated: result.wasUpdated
    };
  }

  return {
    reserveSlot
  };
}

module.exports = {
  createOverbookingGuard
};
