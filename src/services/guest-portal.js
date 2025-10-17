const DEFAULT_TOKEN_LENGTH = 10;

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializePayload(payload) {
  if (!payload) return null;
  try {
    return JSON.stringify(payload);
  } catch (err) {
    return null;
  }
}

function createGuestPortalService({ db, crypto, dayjs } = {}) {
  if (!db) {
    throw new Error('createGuestPortalService requires a database instance');
  }
  if (!crypto) {
    throw new Error('createGuestPortalService requires crypto utilities');
  }

  function generateToken({ length = DEFAULT_TOKEN_LENGTH } = {}) {
    let token = '';
    const targetLength = Math.max(6, Number(length) || DEFAULT_TOKEN_LENGTH);
    while (token.length < targetLength) {
      const chunk = crypto.randomBytes(6).toString('base64');
      token += chunk.replace(/[^a-z0-9]/gi, '');
    }
    return token.slice(0, targetLength);
  }

  function ensureBookingToken(bookingId, { length } = {}) {
    const row = db.prepare('SELECT confirmation_token FROM bookings WHERE id = ?').get(bookingId);
    if (!row) return null;
    const existing = safeTrim(row.confirmation_token);
    if (existing) {
      return existing;
    }
    const token = generateToken({ length });
    db.prepare("UPDATE bookings SET confirmation_token = ?, updated_at = datetime('now') WHERE id = ?").run(token, bookingId);
    return token;
  }

  function recordEvent({
    bookingId,
    token,
    eventType,
    payload,
    request,
    createdAt
  } = {}) {
    if (!bookingId || !eventType) return false;
    const normalizedToken = safeTrim(token);
    const ip = request && request.ip ? String(request.ip) : null;
    const userAgent = request && typeof request.get === 'function' ? request.get('user-agent') : null;
    const payloadJson = serializePayload(payload);
    const timestamp = createdAt || (dayjs ? dayjs().toISOString() : null);

    try {
      db.prepare(
        `INSERT INTO guest_portal_events(booking_id, token, event_type, payload_json, ip, user_agent, created_at)
         VALUES (?,?,?,?,?,?,COALESCE(?, datetime('now')))`
      ).run(bookingId, normalizedToken || null, eventType, payloadJson, ip, userAgent, timestamp);
      return true;
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('guest_portal_events insert failed:', err.message);
      }
      return false;
    }
  }

  function fetchBookingWithToken(bookingId, token) {
    const normalizedToken = safeTrim(token);
    if (!bookingId || !normalizedToken) {
      return null;
    }
    const row = db.prepare('SELECT confirmation_token FROM bookings WHERE id = ?').get(bookingId);
    if (!row) return null;
    const storedToken = safeTrim(row.confirmation_token);
    if (!storedToken || storedToken !== normalizedToken) {
      return null;
    }
    return row;
  }

  return {
    generateToken,
    ensureBookingToken,
    recordEvent,
    fetchBookingWithToken
  };
}

module.exports = { createGuestPortalService };
