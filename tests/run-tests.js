const assert = require('node:assert/strict');
const dayjs = require('dayjs');

const { createDatabase } = require('../src/infra/database');
const { createSessionService } = require('../src/services/session');
const { createCsrfProtection } = require('../src/security/csrf');

function createMockRequest({ ip = '127.0.0.1', userAgent = 'jest/agent', body = {}, headers = {} } = {}) {
  return {
    ip,
    body,
    headers,
    get(name) {
      const key = String(name || '').toLowerCase();
      return this.headers[key] || null;
    },
  };
}

function createMockResponse(targetCookies) {
  return {
    cookie(name, value) {
      targetCookies[name] = value;
    },
    locals: {},
  };
}

function testSessionService() {
  const db = createDatabase(':memory:');
  const userId = db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('test', 'hash', 'gestao')
    .lastInsertRowid;

  const sessionService = createSessionService({ db, dayjs });
  const req = createMockRequest({ ip: '192.168.0.1', userAgent: 'UnitTester/1.0' });

  const { token } = sessionService.issueSession(userId, req);
  assert.ok(token, 'deve emitir token');

  const stored = db.prepare('SELECT token, token_hash, user_id, ip, user_agent FROM sessions').get();
  assert.ok(stored, 'sessão deve ser persistida');
  const hashed = sessionService.hashToken(token);
  assert.equal(stored.token, hashed, 'token deve ser guardado de forma cifrada');
  assert.equal(stored.token_hash, hashed, 'token_hash deve corresponder');
  assert.equal(stored.ip, req.ip);
  assert.equal(stored.user_agent, req.get('user-agent'));

  const session = sessionService.getSession(token, req);
  assert.ok(session, 'getSession deve recuperar sessão válida');
  assert.equal(session.user_id, userId);

  const mismatched = createMockRequest({ ip: '10.0.0.5', userAgent: 'Other/1.0' });
  assert.equal(sessionService.getSession(token, mismatched), null, 'sessão deve ser rejeitada com IP/UA diferentes');

  sessionService.destroySession(token);
  const count = db.prepare('SELECT COUNT(*) as total FROM sessions').get();
  assert.equal(count.total, 0, 'destroySession deve eliminar sessão');

  sessionService.revokeUserSessions(userId);
}

function testCsrfProtection() {
  const csrf = createCsrfProtection({ secureCookies: false });
  const cookies = {};
  const req = createMockRequest({ body: {}, headers: {}, ip: '1.1.1.1' });
  req.cookies = cookies;
  const res = createMockResponse(cookies);

  const token = csrf.ensureToken(req, res);
  assert.ok(token, 'csrf token deve ser criado');
  assert.equal(cookies[csrf.options.cookieName], token, 'token deve ser escrito no cookie');

  const validReq = createMockRequest({ body: { [csrf.options.formField]: token } });
  validReq.cookies = cookies;
  assert.equal(csrf.validateRequest(validReq), true, 'token válido deve ser aceite');

  const invalidReq = createMockRequest({ body: { [csrf.options.formField]: 'invalido' } });
  invalidReq.cookies = cookies;
  assert.equal(csrf.validateRequest(invalidReq), false, 'token inválido deve ser rejeitado');

  const rotated = csrf.rotateToken(req, res);
  assert.notEqual(rotated, token, 'token deve rodar');
}

function main() {
  testSessionService();
  testCsrfProtection();
  console.log('Todos os testes passaram.');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}

