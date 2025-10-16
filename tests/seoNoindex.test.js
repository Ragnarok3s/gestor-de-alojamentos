const request = require('supertest');
const crypto = require('crypto');

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

const TEST_USER_AGENT = 'jest-noindex-agent';

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_START = '1';
process.env.DATABASE_PATH = ':memory:';
process.env.EXPORT_SIGNING_KEY = 'test-export-secret';

const serverPath = require.resolve('../server');
delete require.cache[serverPath];
delete require.cache[require.resolve('../config/featureFlags.js')];
const app = require(serverPath);

function createAuthenticatedSession(role = 'direcao') {
  const username = `user_${Math.random().toString(16).slice(2)}`;
  const insertUser = app.db.prepare('INSERT INTO users(username, password_hash, role) VALUES (?,?,?)');
  const userId = insertUser.run(username, 'hash', role).lastInsertRowid;
  const token = crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  app.db
    .prepare(
      "INSERT INTO sessions(token, token_hash, user_id, expires_at, ip, user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))"
    )
    .run(tokenHash, tokenHash, userId, expiresAt, '::ffff:127.0.0.1', TEST_USER_AGENT);
  return { userId, cookie: `adm=${token}` };
}

function seedBooking() {
  const propertyId = app.db
    .prepare('INSERT INTO properties(name, locality, district) VALUES (?,?,?)')
    .run('Propriedade Teste', 'Lisboa', 'Lisboa').lastInsertRowid;
  const unitId = app.db
    .prepare('INSERT INTO units(property_id, name, capacity, base_price_cents) VALUES (?,?,?,?)')
    .run(propertyId, 'Suite Teste', 2, 10000).lastInsertRowid;
  const confirmationToken = `tok_${Math.random().toString(16).slice(2)}`;
  const bookingId = app.db
    .prepare(
      "INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status, confirmation_token) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      unitId,
      'Convidado Teste',
      'guest@example.com',
      '2024-02-10',
      '2024-02-12',
      18000,
      'CONFIRMED',
      confirmationToken
    ).lastInsertRowid;
  return { propertyId, unitId, bookingId, confirmationToken };
}

const bookingFixture = seedBooking();

describe('X-Robots-Tag headers', () => {
  test('backoffice dashboard sets noindex header', async () => {
    const { cookie } = createAuthenticatedSession();
    const response = await request(app)
      .get('/admin')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT);

    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('login page is marked as noindex', async () => {
    const response = await request(app).get('/login');

    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('account security view sends noindex header', async () => {
    const { cookie } = createAuthenticatedSession();
    const response = await request(app)
      .get('/account/seguranca')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT);

    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('booking confirmation page is excluded from indexing', async () => {
    const response = await request(app)
      .get(`/booking/${bookingFixture.bookingId}?token=${bookingFixture.confirmationToken}`)
      .set('User-Agent', TEST_USER_AGENT);

    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
