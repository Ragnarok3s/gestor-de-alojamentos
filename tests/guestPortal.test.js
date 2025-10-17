const request = require('supertest');

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

jest.mock('../src/security/csrf', () => {
  const token = 'test-csrf-token';
  return {
    createCsrfProtection: () => ({
      middleware: (req, res, next) => {
        req.cookies = req.cookies || {};
        req.cookies.csrf_token = token;
        res.locals = res.locals || {};
        res.locals.csrfToken = token;
        if (typeof res.cookie === 'function') {
          res.cookie('csrf_token', token);
        }
        req.csrfToken = () => token;
        next();
      },
      validateRequest: () => true,
      rotateToken: () => token,
      ensureToken: () => token,
      options: { cookieName: 'csrf_token', formField: '_csrf', headerName: 'x-csrf-token' }
    })
  };
});

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_START = '1';
process.env.DATABASE_PATH = ':memory:';

const serverPath = require.resolve('../server');
delete require.cache[serverPath];
const app = require(serverPath);

function resetDatabase() {
  app.db.exec(`
    DELETE FROM guest_portal_events;
    DELETE FROM payments;
    DELETE FROM refunds;
    DELETE FROM bookings;
    DELETE FROM units;
    DELETE FROM properties;
    DELETE FROM property_policies;
  `);
}

function seedBooking({ withPayment = true, extras } = {}) {
  const propertyId = app.db
    .prepare('INSERT INTO properties(name, address, locality, district) VALUES (?,?,?,?)')
    .run('Casa Azul', 'Rua das Flores, 10', 'Lisboa', 'Lisboa')
    .lastInsertRowid;

  const unitId = app.db
    .prepare('INSERT INTO units(property_id, name, capacity, base_price_cents) VALUES (?,?,?,?)')
    .run(propertyId, 'Suite 1', 4, 12000)
    .lastInsertRowid;

  const extrasPayload = extras || [
    { code: 'transfer', name: 'Transfer aeroporto', description: 'Até 4 pessoas', price_cents: 3000 }
  ];

  app.db
    .prepare(
      'INSERT OR REPLACE INTO property_policies(property_id, checkin_from, checkout_until, parking_info, payment_methods, extras) VALUES (?,?,?,?,?,?)'
    )
    .run(String(propertyId), '15:00', '11:00', 'Estacionamento gratuito na rua.', 'Pagamento no check-in.', JSON.stringify(extrasPayload));

  const token = 'tok123';
  const bookingId = app.db
    .prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_phone, checkin, checkout, total_cents, status, confirmation_token)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(unitId, 'Ana Silva', 'ana@example.com', '+351900000000', '2024-06-01', '2024-06-05', 48000, 'CONFIRMED', token)
    .lastInsertRowid;

  if (withPayment) {
    app.db
      .prepare(
        `INSERT INTO payments(id, booking_id, provider, provider_payment_id, intent_type, status, amount_cents, currency)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run('pay_test', bookingId, 'manual', null, 'charge', 'succeeded', 20000, 'EUR');
  }

  return { bookingId, token };
}

beforeEach(() => {
  resetDatabase();
});

describe('Guest portal API', () => {
  test('GET /api/guest/booking returns data for valid token', async () => {
    const { bookingId, token } = seedBooking();

    const response = await request(app)
      .get('/api/guest/booking')
      .query({ bookingId, token })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('booking');
    expect(response.body.booking).toMatchObject({ id: bookingId, status: 'CONFIRMED' });
    expect(response.body.extras.available).toHaveLength(1);
    expect(Array.isArray(response.body.payments.summaryLines)).toBe(true);
    expect(response.body.payments.summaryLines.length).toBeGreaterThan(0);
  });

  test('GET /api/guest/booking rejects mismatched token', async () => {
    const { bookingId } = seedBooking();

    const response = await request(app)
      .get('/api/guest/booking')
      .query({ bookingId, token: 'invalid' })
      .set('Accept', 'application/json');

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error');
  });

  test('POST /api/guest/extra records request and returns updated payload', async () => {
    const { bookingId, token } = seedBooking();

    const response = await request(app)
      .post('/api/guest/extra')
      .set('Accept', 'application/json')
      .send({ bookingId, token, extraCode: 'transfer', quantity: 2 });

    expect(response.status).toBe(200);
    expect(response.body.extras.requests).toHaveLength(1);
    expect(response.body.extras.requests[0]).toMatchObject({ code: 'transfer', quantity: 2 });

    const eventRow = app.db
      .prepare("SELECT event_type, payload_json FROM guest_portal_events WHERE booking_id = ? AND event_type = 'extra_requested'")
      .get(bookingId);
    expect(eventRow).toBeTruthy();
    const payload = JSON.parse(eventRow.payload_json);
    expect(payload).toMatchObject({ code: 'transfer', quantity: 2 });
  });
});
