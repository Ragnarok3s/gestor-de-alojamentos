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

const TEST_USER_AGENT = 'jest-2fa-agent';

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

describe('POST /account/seguranca/2fa/confirmar', () => {
  const initialTime = new Date('2024-01-01T00:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(initialTime);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function advanceTime(milliseconds) {
    const next = new Date(Date.now() + milliseconds);
    jest.setSystemTime(next);
  }

  test('locks after five invalid attempts and unlocks after the cooldown', async () => {
    const { cookie } = createAuthenticatedSession();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(app)
        .post('/account/seguranca/2fa/confirmar')
        .set('Cookie', cookie)
        .set('User-Agent', TEST_USER_AGENT)
        .type('form')
        .send({ token: '000000' });

      expect(response.status).toBe(200);
      expect(response.text).toContain('Código inválido');
      expect(response.text).not.toContain('Demasiadas tentativas falhadas');
    }

    const lockedResponse = await request(app)
      .post('/account/seguranca/2fa/confirmar')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .type('form')
      .send({ token: '000000' });

    expect(lockedResponse.status).toBe(200);
    expect(lockedResponse.text).toContain('Demasiadas tentativas falhadas');

    advanceTime(5 * 60 * 1000 + 1_000);

    const postLockResponse = await request(app)
      .post('/account/seguranca/2fa/confirmar')
      .set('Cookie', cookie)
      .set('User-Agent', TEST_USER_AGENT)
      .type('form')
      .send({ token: '000000' });

    expect(postLockResponse.status).toBe(200);
    expect(postLockResponse.text).toContain('Código inválido');
    expect(postLockResponse.text).not.toContain('Demasiadas tentativas falhadas');
  });
});
