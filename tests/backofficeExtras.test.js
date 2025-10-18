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

const TEST_USER_AGENT = 'jest-backoffice-extras';

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_START = '1';
process.env.DATABASE_PATH = ':memory:';

const serverPath = require.resolve('../server');
delete require.cache[serverPath];
delete require.cache[require.resolve('../config/featureFlags.js')];
const app = require(serverPath);

function createAuthenticatedSession(role = 'gestao') {
  const username = `user_${Math.random().toString(16).slice(2)}`;
  const insertUser = app.db.prepare('INSERT INTO users(username, email, password_hash, role) VALUES (?,?,?,?)');
  const userId = insertUser.run(username, `${username}@example.com`, 'hash', role).lastInsertRowid;
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

describe('Backoffice extras management', () => {
  test('renders extras page with property selector', async () => {
    const propertyId = app.db.prepare('INSERT INTO properties(name) VALUES (?)').run('Casa Atlântica').lastInsertRowid;
    const { cookie } = createAuthenticatedSession();

    const response = await request(app)
      .get('/admin/extras')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ propertyId });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Extras &amp; serviços');
    expect(response.text).toContain('Casa Atlântica');
  });

  test('persists extras for selected property', async () => {
    const propertyId = app.db.prepare('INSERT INTO properties(name) VALUES (?)').run('Monte da Serra').lastInsertRowid;
    const { cookie } = createAuthenticatedSession();

    const extrasPayload = {
      extras: [
        {
          name: 'Transfer aeroporto',
          code: 'transfer',
          priceEuros: '30',
          pricingRule: 'standard',
          availabilityFrom: '08:00',
          availabilityTo: '22:00'
        },
        {
          name: 'Welcome pack',
          code: 'welcome-pack',
          priceEuros: '0',
          pricingRule: 'long_stay',
          minNights: '7',
          discountPercent: '10'
        }
      ]
    };

    const formData = new URLSearchParams();
    formData.set('property_id', String(propertyId));
    formData.set('extras_json', JSON.stringify(extrasPayload));

    const response = await request(app)
      .post('/admin/extras')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(formData.toString());

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain(`/admin/extras?propertyId=${propertyId}`);

    const stored = app.db
      .prepare('SELECT extras FROM property_policies WHERE property_id = ?')
      .get(propertyId);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored.extras);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: 'transfer',
      code: 'transfer',
      name: 'Transfer aeroporto',
      price_cents: 3000,
      pricing_rule: 'standard',
      availability: { from: '08:00', to: '22:00' }
    });
    expect(parsed[1]).toMatchObject({
      id: 'welcome-pack',
      code: 'welcome-pack',
      name: 'Welcome pack',
      price_cents: 0,
      pricing_rule: 'long_stay',
      pricing_config: { min_nights: 7, discount_percent: 10 }
    });
  });
});
