const assert = require('node:assert/strict');
const dayjs = require('dayjs');

const { createDatabase } = require('../src/infra/database');
const { createSessionService } = require('../src/services/session');
const { createCsrfProtection } = require('../src/security/csrf');
const { suggestPrice } = require('../server/services/pricing');
const { parseMessage } = require('../server/chatbot/parser');

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

function testPricingService() {
  const unit = { id: 'u1', name: 'Studio Teste', base_price_cents: 12000 };
  const history = {
    occupancy: { '30': 0.25, '60': 0.3, '90': 0.35 },
    pace: { last7: 1, last14: 2, typical7: 2, typical14: 4 },
    leadTimeBuckets: { short: 0.9, medium: 0.95, long: 1.05 },
    seasonality: {
      [dayjs().add(1, 'day').format('MM')]: {
        [String(dayjs().add(1, 'day').day())]: 0.95,
      },
    },
  };
  const ratePlan = { min_price: 80, max_price: 200, rules: '{}' };
  const targetDate = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const { price, breakdown } = suggestPrice({ unit, targetDate, history, ratePlan });
  assert.ok(price < 120, 'preço deve descer com ocupação baixa');
  assert.ok(price >= 80, 'clamp mínimo deve aplicar-se');
  assert.ok(breakdown.lastMinute < 0, 'ajuste last-minute deve existir');

  const clampRatePlan = { min_price: 150, max_price: 160, rules: '{}' };
  const { price: clamped } = suggestPrice({ unit, targetDate, history, ratePlan: clampRatePlan });
  assert.ok(clamped <= 160, 'clamp máximo deve aplicar-se');
  assert.ok(clamped >= 150, 'clamp mínimo deve aplicar-se com valores altos');
}

function testChatbotParser() {
  const availabilityQuery = parseMessage(dayjs, '2 adultos 10 a 13 novembro');
  assert.equal(availabilityQuery.intent, 'availability', 'intenção deve mudar para disponibilidade quando dados existem');
  assert.equal(availabilityQuery.guests, 2, 'deve extrair número de hóspedes');
  assert.ok(availabilityQuery.checkin, 'deve extrair data inicial sem preposição "de"');
  assert.ok(availabilityQuery.checkout, 'deve extrair data final sem preposição "de"');
  assert.ok(
    availabilityQuery.checkout.isAfter(availabilityQuery.checkin),
    'checkout deve ser posterior ao check-in'
  );
  assert.equal(availabilityQuery.checkin.month(), 10, 'mês de novembro deve ser reconhecido');

  const withPreposition = parseMessage(dayjs, 'preciso para 3 pessoas 5 a 8 de dezembro');
  assert.equal(withPreposition.intent, 'availability', 'mensagem com datas explícitas deve indicar disponibilidade');
  assert.equal(withPreposition.guests, 3, 'deve extrair hóspedes em outra frase');
  assert.ok(withPreposition.checkin, 'data com "de" deve ser interpretada');
  assert.ok(withPreposition.checkout, 'data final com "de" deve ser interpretada');
  assert.equal(withPreposition.checkin.month(), 11, 'mês de dezembro deve ser reconhecido');
}

function main() {
  testSessionService();
  testCsrfProtection();
  testPricingService();
  testChatbotParser();
  console.log('Todos os testes passaram.');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}

