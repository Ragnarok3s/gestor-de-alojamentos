'use strict';

function createCalendarRepository({
  db,
  rescheduleBookingUpdateStmt,
  rescheduleBlockUpdateStmt,
  insertBlockStmt,
  deleteLockByBookingStmt
}) {
  if (!db) throw new Error('createCalendarRepository: db é obrigatório');

  function listProperties() {
    return db.prepare('SELECT id, name FROM properties ORDER BY name').all();
  }

  function listUnitsByProperty(propertyId) {
    return db
      .prepare('SELECT id, name FROM units WHERE property_id = ? ORDER BY name')
      .all(propertyId);
  }

  function listBookings({ propertyId, start, end, unitId, searchTerm }) {
    if (!propertyId) return [];
    const params = {
      propertyId,
      start,
      end
    };
    let where =
      "u.property_id = @propertyId AND NOT (b.checkout <= @start OR b.checkin >= @end) AND b.status IN ('CONFIRMED','PENDING')";

    if (unitId) {
      params.unitId = unitId;
      where += ' AND b.unit_id = @unitId';
    }

    if (searchTerm) {
      params.search = `%${searchTerm}%`;
      where +=
        " AND (LOWER(b.guest_name) LIKE @search OR LOWER(IFNULL(b.guest_email, '')) LIKE @search OR LOWER(IFNULL(b.agency, '')) LIKE @search)";
    }

    const rows = db
      .prepare(
        `SELECT b.*, u.name AS unit_name, p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE ${where}
          ORDER BY b.checkin, b.checkout, b.id`
      )
      .all(params);

    return rows;
  }

  function findUnitWithProperty(unitId) {
    return db
      .prepare(
        `SELECT u.*, p.name as property_name
           FROM units u JOIN properties p ON p.id = u.property_id
          WHERE u.id = ?`
      )
      .get(unitId);
  }

  function findUnitById(unitId) {
    return db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
  }

  function getBookingWithPricing(id) {
    return db
      .prepare(
        `SELECT b.*, u.base_price_cents
           FROM bookings b JOIN units u ON u.id = b.unit_id
          WHERE b.id = ?`
      )
      .get(id);
  }

  function findBookingConflict({ unitId, bookingId, checkin, checkout }) {
    return db
      .prepare(
        `SELECT 1 FROM bookings
          WHERE unit_id = ?
            AND id <> ?
            AND status IN ('CONFIRMED','PENDING')
            AND NOT (checkout <= ? OR checkin >= ?)
          LIMIT 1`
      )
      .get(unitId, bookingId, checkin, checkout);
  }

  function findBlockConflictForBooking({ unitId, checkin, checkout }) {
    return db
      .prepare(
        `SELECT 1 FROM blocks
          WHERE unit_id = ?
            AND NOT (end_date <= ? OR start_date >= ?)
          LIMIT 1`
      )
      .get(unitId, checkin, checkout);
  }

  function updateBookingDates({ bookingId, checkin, checkout, totalCents }) {
    if (rescheduleBookingUpdateStmt) {
      rescheduleBookingUpdateStmt.run(checkin, checkout, totalCents, bookingId);
      return;
    }
    db.prepare('UPDATE bookings SET checkin = ?, checkout = ?, total_cents = ? WHERE id = ?').run(
      checkin,
      checkout,
      totalCents,
      bookingId
    );
  }

  function deleteBookingById(bookingId) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
  }

  function deleteLockForBooking(bookingId) {
    if (deleteLockByBookingStmt) {
      deleteLockByBookingStmt.run(bookingId);
    }
  }

  function findBookingById(bookingId) {
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  }

  function findBlockById(blockId) {
    return db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  }

  function findBookingConflictForBlock({ unitId, start, end }) {
    return db
      .prepare(
        `SELECT 1 FROM bookings
          WHERE unit_id = ?
            AND status IN ('CONFIRMED','PENDING')
            AND NOT (checkout <= ? OR checkin >= ?)
          LIMIT 1`
      )
      .get(unitId, start, end);
  }

  function findBlockConflict({ unitId, blockId, start, end }) {
    const params = [unitId];
    let query =
      `SELECT 1 FROM blocks
         WHERE unit_id = ?
           AND NOT (end_date <= ? OR start_date >= ?)`;

    if (blockId != null) {
      query += ' AND id <> ?';
      params.push(start, end, blockId);
    } else {
      params.push(start, end);
    }

    query += ' LIMIT 1';

    return db.prepare(query).get(...params);
  }

  function updateBlockDates({ blockId, start, end }) {
    if (rescheduleBlockUpdateStmt) {
      rescheduleBlockUpdateStmt.run(start, end, blockId);
      return;
    }
    db.prepare('UPDATE blocks SET start_date = ?, end_date = ? WHERE id = ?').run(start, end, blockId);
  }

  function insertBlock({ unitId, start, end }) {
    if (insertBlockStmt) {
      return insertBlockStmt.run(unitId, start, end);
    }
    return db.prepare('INSERT INTO blocks (unit_id, start_date, end_date) VALUES (?, ?, ?)').run(unitId, start, end);
  }

  function deleteBlockById(blockId) {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
  }

  function listBookingsForUnit(unitId) {
    return db
      .prepare(
        `SELECT id, checkin as s, checkout as e, guest_name, guest_email, guest_phone, status, adults, children, total_cents, agency
           FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')`
      )
      .all(unitId);
  }

  function listUnitBlocks(unitId) {
    return db
      .prepare(
        `SELECT id, start_date, end_date, reason
           FROM unit_blocks
          WHERE unit_id = ?`
      )
      .all(unitId);
  }

  function listLegacyBlocks(unitId) {
    return db
      .prepare(
        `SELECT id, start_date, end_date
           FROM blocks
          WHERE unit_id = ?`
      )
      .all(unitId);
  }

  function getBookingNotesMeta(bookingIds) {
    const result = {
      counts: new Map(),
      latest: new Map()
    };

    if (!bookingIds.length) return result;

    const placeholders = bookingIds.map(() => '?').join(',');
    const countsStmt = db.prepare(
      `SELECT booking_id, COUNT(*) AS c FROM booking_notes WHERE booking_id IN (${placeholders}) GROUP BY booking_id`
    );
    countsStmt.all(...bookingIds).forEach(row => result.counts.set(row.booking_id, row.c));

    const latestStmt = db.prepare(
      `SELECT bn.booking_id, bn.note, bn.created_at, u.username
         FROM booking_notes bn
         JOIN users u ON u.id = bn.user_id
        WHERE bn.booking_id IN (${placeholders})
        ORDER BY bn.booking_id, bn.created_at DESC`
    );

    latestStmt.all(...bookingIds).forEach(row => {
      if (!result.latest.has(row.booking_id)) {
        result.latest.set(row.booking_id, {
          note: row.note,
          username: row.username,
          created_at: row.created_at
        });
      }
    });

    return result;
  }

  return {
    listProperties,
    listUnitsByProperty,
    listBookings,
    findUnitWithProperty,
    findUnitById,
    getBookingWithPricing,
    findBookingConflict,
    findBlockConflictForBooking,
    updateBookingDates,
    deleteBookingById,
    deleteLockForBooking,
    findBookingById,
    findBlockById,
    findBookingConflictForBlock,
    findBlockConflict,
    updateBlockDates,
    insertBlock,
    deleteBlockById,
    listBookingsForUnit,
    listUnitBlocks,
    listLegacyBlocks,
    getBookingNotesMeta
  };
}

module.exports = { createCalendarRepository };
