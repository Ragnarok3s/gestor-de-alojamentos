const assert = require('node:assert/strict');
const dayjs = require('dayjs');

const { createDatabase } = require('../src/infra/database');
const { createSessionService } = require('../src/services/session');
const { createCsrfProtection } = require('../src/security/csrf');
const { suggestPrice } = require('../server/services/pricing');
const { createRateManagementService } = require('../src/services/rate-management');
const { createUnitBlockService } = require('../src/services/unit-blocks');
const { createReviewService } = require('../src/services/review-center');
const { createReportingService } = require('../src/services/reporting');
const { ConflictError } = require('../src/services/errors');

function testServerBootstrap() {
  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const previousFlag = global.__SERVER_STARTED__;
  const previousDbPath = process.env.DATABASE_PATH;
  process.env.SKIP_SERVER_START = '1';
  process.env.DATABASE_PATH = ':memory:';
  const app = require(serverPath);
  assert.equal(typeof app, 'function', 'server deve exportar instância Express');
  assert.equal(global.__SERVER_STARTED__, previousFlag, 'servidor não deve arrancar em modo de teste');
  delete process.env.SKIP_SERVER_START;
  if (previousDbPath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDbPath;
  }
  delete require.cache[serverPath];
  if (previousFlag === undefined) {
    delete global.__SERVER_STARTED__;
  } else {
    global.__SERVER_STARTED__ = previousFlag;
  }
}

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

function seedPropertyAndUnit(db) {
  const propertyId = db.prepare('INSERT INTO properties(name) VALUES (?)').run('Casas de Pousadouro').lastInsertRowid;
  const unitId = db.prepare(
    'INSERT INTO units(property_id, name, capacity, base_price_cents) VALUES (?,?,?,?)'
  ).run(propertyId, 'Douro Suite', 2, 12000).lastInsertRowid;
  return { propertyId, unitId };
}

function testRateManagementService() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  const service = createRateManagementService({ db, dayjs });
  const payload = service.normalizeBulkPayload({
    unitIds: [unitId],
    dateRange: { start: '2025-03-14', end: '2025-03-16' },
    price: 155.5
  });
  assert.equal(payload.nights, 3, 'deve calcular número de noites no intervalo');
  assert.equal(payload.priceCents, 15550, 'deve converter preço para cêntimos');
  const rateIds = service.applyBulkUpdate(payload);
  assert.equal(rateIds.length, 1, 'deve criar registo de tarifa por unidade');
  const stored = db.prepare('SELECT weekday_price_cents, end_date FROM rates WHERE id = ?').get(rateIds[0]);
  assert.equal(stored.weekday_price_cents, 15550, 'preço deve ser persistido em cêntimos');
  assert.equal(stored.end_date, '2025-03-17', 'data final exclusiva deve ser respeitada');
  const removed = service.undoBulkUpdate(rateIds);
  assert.equal(removed, 1, 'undo deve remover tarifas aplicadas');
}

function testUnitBlockService() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  const service = createUnitBlockService({ db, dayjs });
  const payload = service.normalizeBlockPayload({
    start: '2025-04-01',
    end: '2025-04-03',
    reason: 'Manutenção preventiva'
  });
  assert.equal(payload.nights, 3, 'bloqueio deve contar noites incluídas');
  const block = service.createBlock({
    unitId,
    startDate: payload.startDate,
    endDateExclusive: payload.endDateExclusive,
    reason: payload.reason,
    userId: null
  });
  assert.ok(block.id, 'bloqueio deve devolver id');
  assert.equal(block.reason, 'Manutenção preventiva');

  db.prepare(
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status) VALUES (?,?,?,?,?,?,?)'
  ).run(unitId, 'Ana', 'ana@example.com', '2025-04-05', '2025-04-08', 48000, 'CONFIRMED');

  assert.throws(() => {
    service.createBlock({
      unitId,
      startDate: '2025-04-06',
      endDateExclusive: '2025-04-09',
      reason: 'Fechado',
      userId: null
    });
  }, ConflictError, 'não deve permitir bloquear intervalo com reservas');
}

function testReviewService() {
  const db = createDatabase(':memory:');
  const { propertyId, unitId } = seedPropertyAndUnit(db);
  const service = createReviewService({ db, dayjs });
  const reviewId = db
    .prepare(
      'INSERT INTO reviews(property_id, unit_id, guest_name, rating, body, title, source) VALUES (?,?,?,?,?,?,?)'
    )
    .run(propertyId, unitId, 'Miguel', 2, 'A vista era bonita mas havia ruído.', 'Experiência mista', 'direct')
    .lastInsertRowid;

  const list = service.listReviews({ onlyNegative: true });
  assert.equal(list.length, 1, 'lista negativa deve conter avaliação criada');
  const updated = service.respondToReview(reviewId, 'Obrigado pelo feedback, já corrigimos o ruído.', null);
  assert.ok(updated.responded_at, 'resposta deve registar timestamp');
  assert.equal(updated.response_text.startsWith('Obrigado'), true, 'texto de resposta deve ser guardado');
}

function testReportingService() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  db.prepare(
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status) VALUES (?,?,?,?,?,?,?)'
  ).run(unitId, 'João', 'joao@example.com', '2025-05-10', '2025-05-13', 30000, 'CONFIRMED');

  const service = createReportingService({ db, dayjs });
  const snapshot = service.computeWeeklySnapshot({ from: '2025-05-10', to: '2025-05-12' });
  assert.equal(snapshot.kpis.occupancy, 1, 'ocupação deve ser 100% com noites preenchidas');
  assert.equal(snapshot.kpis.adr, 100, 'ADR deve refletir receita média');
  assert.equal(snapshot.kpis.revpar, 100, 'RevPAR deve coincidir com ADR numa unidade única ocupada');
  const csv = service.toCsv(snapshot);
  assert.ok(csv.includes('Ocupação (%)'), 'CSV deve conter cabeçalhos');
  const pdf = service.toPdf(snapshot);
  assert.equal(pdf.slice(0, 4).toString(), '%PDF', 'PDF gerado deve começar com assinatura PDF');
}

function main() {
  testServerBootstrap();
  testSessionService();
  testCsrfProtection();
  testPricingService();
  testRateManagementService();
  testUnitBlockService();
  testReviewService();
  testReportingService();
  console.log('Todos os testes passaram.');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}

