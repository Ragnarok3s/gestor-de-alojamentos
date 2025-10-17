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

const TEST_USER_AGENT = 'jest-export-agent';

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

function signExportLink({ ym, months, ts, secret = process.env.EXPORT_SIGNING_KEY }) {
  const payload = `ym=${ym}&months=${months}&ts=${ts}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('GET /admin/export/download', () => {
  test('rejects requests without signature', async () => {
    const { cookie } = createAuthenticatedSession();
    const ts = Date.now();

    const response = await request(app)
      .get('/admin/export/download')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ ym: '2024-01', months: 1, ts });

    expect(response.status).toBe(400);
    expect(response.text).toContain('Assinatura');
  });

  test('rejects requests with expired signatures', async () => {
    const { cookie } = createAuthenticatedSession();
    const ym = '2024-01';
    const months = 1;
    const ts = Date.now() - 61_000;
    const sig = signExportLink({ ym, months, ts });

    const response = await request(app)
      .get('/admin/export/download')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ ym, months, ts, sig });

    expect(response.status).toBe(403);
    expect(response.text).toContain('expirada');
  });

  test('rejects requests with months outside the 1-12 window', async () => {
    const { cookie } = createAuthenticatedSession();
    const ym = '2024-01';
    const months = 13;
    const ts = Date.now();
    const sig = signExportLink({ ym, months, ts });

    const response = await request(app)
      .get('/admin/export/download')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ ym, months, ts, sig });

    expect(response.status).toBe(400);
    expect(response.text).toContain('Número de meses inválido');
  });

  test('rejects requests with invalid ym parameter', async () => {
    const { cookie } = createAuthenticatedSession();
    const ym = '202401';
    const months = 1;
    const ts = Date.now();

    const response = await request(app)
      .get('/admin/export/download')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ ym, months, ts, sig: signExportLink({ ym, months, ts }) });

    expect(response.status).toBe(400);
    expect(response.text).toContain('Parâmetros inválidos');
  });

  test('allows downloading when parameters are valid and signature matches', async () => {
    const { cookie } = createAuthenticatedSession();
    const ym = '2024-02';
    const months = 2;
    const ts = Date.now();
    const sig = signExportLink({ ym, months, ts });

    const response = await request(app)
      .get('/admin/export/download')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .query({ ym, months, ts, sig });

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/\.xlsx/i);
  });
});
