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
    DELETE FROM booking_extras;
    DELETE FROM payments;
    DELETE FROM refunds;
    DELETE FROM bookings;
    DELETE FROM units;
    DELETE FROM properties;
    DELETE FROM property_policies;
  `);
}

function seedBooking({
  withPayment = true,
  extras,
  bookedExtras = [],
  checkin = '2024-06-01',
  checkout = '2024-06-05',
  totalCents
} = {}) {
  const propertyId = app.db
    .prepare('INSERT INTO properties(name, address, locality, district) VALUES (?,?,?,?)')
    .run('Casa Azul', 'Rua das Flores, 10', 'Lisboa', 'Lisboa')
    .lastInsertRowid;

  const unitId = app.db
    .prepare('INSERT INTO units(property_id, name, capacity, base_price_cents) VALUES (?,?,?,?)')
    .run(propertyId, 'Suite 1', 4, 12000)
    .lastInsertRowid;

  const extrasPayload = extras || [
    {
      id: 'transfer',
      code: 'transfer',
      name: 'Transfer aeroporto',
      description: 'Até 4 pessoas',
      price_cents: 3000,
      pricing_rule: 'standard'
    }
  ];

  app.db
    .prepare(
      'INSERT OR REPLACE INTO property_policies(property_id, checkin_from, checkout_until, parking_info, payment_methods, extras) VALUES (?,?,?,?,?,?)'
    )
    .run(
      String(propertyId),
      '15:00',
      '11:00',
      'Estacionamento gratuito na rua.',
      'Pagamento no check-in.',
      JSON.stringify(extrasPayload)
    );

  const token = 'tok123';
  const bookingTotalCents = totalCents != null ? totalCents : 48000;
  const bookingId = app.db
    .prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_phone, checkin, checkout, total_cents, status, confirmation_token)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(unitId, 'Ana Silva', 'ana@example.com', '+351900000000', checkin, checkout, bookingTotalCents, 'CONFIRMED', token)
    .lastInsertRowid;

  if (withPayment) {
    app.db
      .prepare(
        `INSERT INTO payments(id, booking_id, provider, provider_payment_id, intent_type, status, amount_cents, currency)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run('pay_test', bookingId, 'manual', null, 'charge', 'succeeded', 20000, 'EUR');
  }

  if (Array.isArray(bookedExtras) && bookedExtras.length) {
    const insertExtra = app.db.prepare(
      `INSERT INTO booking_extras(booking_id, extra_id, extra_name, pricing_rule, pricing_payload_json, quantity, unit_price_cents, total_cents, refunded_cents, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    bookedExtras.forEach(extra => {
      insertExtra.run(
        bookingId,
        extra.extraId || extra.id || extra.code || 'extra',
        extra.extraName || extra.name || 'Extra',
        extra.pricingRule || 'standard',
        extra.pricingPayload ? JSON.stringify(extra.pricingPayload) : null,
        extra.quantity || 1,
        extra.unitPriceCents != null ? extra.unitPriceCents : 0,
        extra.totalCents != null
          ? extra.totalCents
          : (extra.unitPriceCents != null ? extra.unitPriceCents : 0) * (extra.quantity || 1),
        extra.refundedCents != null ? extra.refundedCents : 0,
        extra.status || 'confirmed'
      );
    });
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
    expect(response.body.extras.purchases).toHaveLength(0);
    expect(response.body.extras.summary).toMatchObject({ totalCents: 0, outstandingCents: 0 });
    expect(Array.isArray(response.body.payments.summaryLines)).toBe(true);
    expect(response.body.payments.summaryLines.length).toBeGreaterThan(0);
    expect(response.body.payments.outstandingCents).toBe(28000);
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

  test('POST /api/guest/extras/checkout stores extras and updates payment summary', async () => {
    const { bookingId, token } = seedBooking();

    const response = await request(app)
      .post('/api/guest/extras/checkout')
      .set('Accept', 'application/json')
      .send({ bookingId, token, items: [{ id: 'transfer', quantity: 2 }] });

    expect(response.status).toBe(200);
    expect(response.body.extras.purchases).toHaveLength(1);
    expect(response.body.extras.purchases[0]).toMatchObject({ extraId: 'transfer', quantity: 2, totalCents: 6000 });
    expect(response.body.payments.outstandingCents).toBe(34000);
    expect(response.body.extras.summary).toMatchObject({ totalCents: 6000, outstandingCents: 6000 });

    const storedExtra = app.db
      .prepare('SELECT extra_id, quantity, total_cents FROM booking_extras WHERE booking_id = ?')
      .get(bookingId);
    expect(storedExtra).toMatchObject({ extra_id: 'transfer', quantity: 2, total_cents: 6000 });

    const eventRow = app.db
      .prepare("SELECT event_type FROM guest_portal_events WHERE booking_id = ? AND event_type = 'extras_checkout'")
      .get(bookingId);
    expect(eventRow).toBeTruthy();
  });

  test('POST /api/guest/extras/checkout applies long-stay pricing rule', async () => {
    const extras = [
      {
        id: 'late-checkout',
        code: 'late-checkout',
        name: 'Late checkout',
        price_cents: 5000,
        pricing_rule: 'long_stay',
        pricing_config: { min_nights: 7, discount_percent: 50 }
      }
    ];
    const { bookingId, token } = seedBooking({
      extras,
      checkin: '2024-06-01',
      checkout: '2024-06-10',
      totalCents: 72000
    });

    const response = await request(app)
      .post('/api/guest/extras/checkout')
      .set('Accept', 'application/json')
      .send({ bookingId, token, items: [{ id: 'late-checkout', quantity: 1 }] });

    expect(response.status).toBe(200);
    expect(response.body.extras.purchases[0]).toMatchObject({ extraId: 'late-checkout', quantity: 1, totalCents: 2500 });
    expect(response.body.payments.outstandingCents).toBe(54500);

    const storedExtra = app.db
      .prepare('SELECT pricing_rule, total_cents, pricing_payload_json FROM booking_extras WHERE booking_id = ?')
      .get(bookingId);
    expect(storedExtra).toMatchObject({ pricing_rule: 'long_stay', total_cents: 2500 });
    const pricingPayload = JSON.parse(storedExtra.pricing_payload_json);
    expect(pricingPayload).toMatchObject({ discountApplied: true, minNights: 7, discountPercent: 50 });
  });

  test('GET /api/guest/booking reflects refunded extras in summary', async () => {
    const { bookingId, token } = seedBooking({
      bookedExtras: [
        {
          extraId: 'transfer',
          extraName: 'Transfer aeroporto',
          quantity: 1,
          unitPriceCents: 3000,
          totalCents: 3000,
          refundedCents: 3000,
          status: 'refunded'
        }
      ]
    });

    const response = await request(app)
      .get('/api/guest/booking')
      .query({ bookingId, token })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.extras.purchases).toHaveLength(1);
    expect(response.body.extras.purchases[0]).toMatchObject({ status: 'refunded', refundedCents: 3000 });
    expect(response.body.extras.summary).toMatchObject({ totalCents: 3000, refundedCents: 3000, outstandingCents: 0 });
    expect(response.body.payments.outstandingCents).toBe(28000);
  });
});
