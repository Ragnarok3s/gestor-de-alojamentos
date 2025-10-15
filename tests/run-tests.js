const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');

const { createDatabase } = require('../src/infra/database');
const { createSessionService } = require('../src/services/session');
const { createCsrfProtection } = require('../src/security/csrf');
const { suggestPrice } = require('../server/services/pricing');
const { createRateManagementService } = require('../src/services/rate-management');
const { createUnitBlockService } = require('../src/services/unit-blocks');
const { createReviewService } = require('../src/services/review-center');
const { createReportingService } = require('../src/services/reporting');
const { ConflictError } = require('../src/services/errors');
const { createOverbookingGuard } = require('../src/services/overbooking-guard');
const { createChannelIntegrationService } = require('../src/services/channel-integrations');
const { createOtaDispatcher } = require('../src/services/ota-sync/dispatcher');

const simpleSlugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

function stableStringify(value) {
  const seen = new WeakSet();
  const sorter = (key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (seen.has(val)) return val;
      seen.add(val);
      const ordered = {};
      Object.keys(val)
        .sort()
        .forEach(name => {
          ordered[name] = val[name];
        });
      return ordered;
    }
    return val;
  };
  return JSON.stringify(value, sorter);
}

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

async function testOverbookingGuardService() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  const channelQueue = [];
  const guard = createOverbookingGuard({
    db,
    dayjs,
    logChange: () => {},
    channelSync: {
      queueLock: (payload) => channelQueue.push(payload)
    },
    logger: { warn: () => {} }
  });

  const insertBooking = db.prepare(
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status) VALUES (?,?,?,?,?,?,?)'
  );

  const bookingId = insertBooking.run(unitId, 'Maria', 'maria@example.com', '2025-06-01', '2025-06-04', 36000, 'PENDING')
    .lastInsertRowid;
  const hold = guard.reserveSlot({ unitId, from: '2025-06-01', to: '2025-06-04', bookingId });
  assert.equal(hold.created, true, 'primeiro bloqueio deve ser criado');
  assert.ok(channelQueue.length >= 1, 'bloqueio deve ser enfileirado para canais');

  const repeat = guard.reserveSlot({ unitId, from: '2025-06-01', to: '2025-06-04', bookingId });
  assert.equal(repeat.created, false, 'chamada idempotente não deve recriar bloqueio');
  assert.ok(channelQueue.length >= 1, 'idempotência não deve duplicar fila');

  const concurrentFrom = '2025-07-01';
  const concurrentTo = '2025-07-04';
  const firstConcurrentId = insertBooking.run(unitId, 'João', 'joao@example.com', concurrentFrom, concurrentTo, 45000, 'PENDING')
    .lastInsertRowid;
  const secondConcurrentId = insertBooking.run(unitId, 'Carla', 'carla@example.com', concurrentFrom, concurrentTo, 45000, 'PENDING')
    .lastInsertRowid;

  function runReserve(booking) {
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          const result = guard.reserveSlot({ unitId, from: concurrentFrom, to: concurrentTo, bookingId: booking });
          resolve({ ok: true, result });
        } catch (err) {
          resolve({ ok: false, err });
        }
      });
    });
  }

  const [attemptA, attemptB] = await Promise.all([runReserve(firstConcurrentId), runReserve(secondConcurrentId)]);
  const failure = [attemptA, attemptB].find(item => !item.ok);
  const success = [attemptA, attemptB].find(item => item.ok);
  assert.ok(success && success.ok, 'uma tentativa deve obter bloqueio');
  assert.ok(failure && failure.err instanceof ConflictError, 'segunda tentativa deve falhar com conflito');
  assert.ok(channelQueue.length >= 2, 'segundo bloqueio válido deve ser enfileirado');
}

async function testOtaWebhookIngestion() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  const channelIntegrations = createChannelIntegrationService({
    db,
    dayjs,
    slugify: simpleSlugify,
    ExcelJS,
    ensureDir: () => Promise.resolve(),
    uploadsDir: 'uploads-test'
  });
  const dispatcher = createOtaDispatcher({
    db,
    dayjs,
    channelIntegrations,
    overbookingGuard: createOverbookingGuard({
      db,
      dayjs,
      logChange: () => {},
      channelSync: { queueLock: () => {} },
      logger: { warn: () => {} }
    }),
    logger: { warn: () => {}, info: () => {} }
  });

  db.prepare(
    `UPDATE channel_integrations SET settings_json = ?, credentials_json = ? WHERE channel_key = 'airbnb'`
  ).run(
    JSON.stringify({ webhookSecret: 'topsecret', autoEnabled: true }),
    JSON.stringify({ apiSecret: 'air-secret' })
  );

  const payload = {
    event: 'booking.created',
    reservation: {
      propertyName: 'Casas de Pousadouro',
      unitName: 'Douro Suite',
      guestName: 'Helena Martins',
      guestEmail: 'helena@example.com',
      checkin: '2025-08-10',
      checkout: '2025-08-12',
      total: { amount: 420, currency: 'EUR' },
      externalReference: 'OTA-123'
    }
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex');

  await dispatcher.ingest({
    channelKey: 'airbnb',
    payload,
    headers: { 'x-ota-signature': signature },
    rawBody
  });

  const booking = db.prepare('SELECT * FROM bookings WHERE external_ref = ?').get('OTA-123');
  assert.ok(booking, 'webhook deve criar reserva via dispatcher');
  assert.equal(booking.unit_id, unitId, 'reserva importada deve ligar à unidade correta');
  const lock = db.prepare('SELECT * FROM unit_blocks WHERE lock_owner_booking_id = ?').get(booking.id);
  assert.ok(lock, 'reserva OTA deve bloquear datas automaticamente');
}

async function testOtaDispatcherQueue() {
  const db = createDatabase(':memory:');
  const { unitId } = seedPropertyAndUnit(db);
  const channelIntegrations = createChannelIntegrationService({
    db,
    dayjs,
    slugify: simpleSlugify,
    ExcelJS,
    ensureDir: () => Promise.resolve(),
    uploadsDir: 'uploads-test'
  });
  const dispatcher = createOtaDispatcher({
    db,
    dayjs,
    channelIntegrations,
    overbookingGuard: createOverbookingGuard({
      db,
      dayjs,
      logChange: () => {},
      channelSync: { queueLock: () => {} },
      logger: { warn: () => {} }
    }),
    logger: { warn: () => {}, info: () => {} }
  });

  const secrets = {
    airbnb: 'air-secret',
    booking: 'booking-secret',
    expedia: 'exp-secret'
  };
  for (const [channel, secret] of Object.entries(secrets)) {
    db.prepare(
      'UPDATE channel_integrations SET settings_json = ?, credentials_json = ? WHERE channel_key = ?'
    ).run(JSON.stringify({ autoEnabled: true }), JSON.stringify({ apiSecret: secret }), channel);
  }

  dispatcher.pushUpdate({
    unitId,
    type: 'rate.change',
    payload: { startDate: '2025-09-01', endDateExclusive: '2025-09-05', priceCents: 15500 }
  });
  dispatcher.pushUpdate({
    unitId,
    type: 'availability.change',
    payload: { startDate: '2025-09-01', endDateExclusive: '2025-09-05' }
  });

  dispatcher.flushPendingDebounce();

  const pending = db.prepare('SELECT id, type, payload FROM channel_sync_queue').all();
  assert.equal(pending.length, 1, 'deve agregar um único item na fila');
  const queuedPayload = JSON.parse(pending[0].payload);
  assert.equal(queuedPayload.updates.length, 2, 'fila deve manter ambas as alterações');

  const result = await dispatcher.flushQueue();
  assert.equal(result.processed.length, 1, 'flush deve processar o item agregado');

  const stored = db.prepare('SELECT status, payload FROM channel_sync_queue WHERE id = ?').get(pending[0].id);
  assert.equal(stored.status, 'processed', 'item deve ficar marcado como processado');

  const outbound = dispatcher.getOutboundLog();
  assert.equal(outbound.length, 3, 'três canais devem receber notificações');
  const channels = outbound.map(entry => entry.channel).sort();
  assert.deepEqual(channels, ['airbnb', 'booking', 'expedia'], 'todos os canais configurados recebem atualizações');

  outbound.forEach(entry => {
    const secret = secrets[entry.channel];
    const { signature, ...message } = entry.update;
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(stableStringify(message)).digest('hex');
      assert.equal(signature, expected, 'assinatura deve corresponder ao HMAC esperado');
    }
  });
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

async function main() {
  testServerBootstrap();
  testSessionService();
  testCsrfProtection();
  testPricingService();
  testRateManagementService();
  testUnitBlockService();
  await testOverbookingGuardService();
  await testOtaWebhookIngestion();
  await testOtaDispatcherQueue();
  testReviewService();
  testReportingService();
  console.log('Todos os testes passaram.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

