const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');

const { createDatabase } = require('../src/infra/database');
const { createSessionService } = require('../src/services/session');
const { createCsrfProtection } = require('../src/security/csrf');
const { suggestPrice } = require('../server/services/pricing');
const { applyRateRules, normalizeRuleRow } = require('../server/services/pricing/rules');
const { createRateManagementService } = require('../src/services/rate-management');
const { createRatePlanService } = require('../src/services/rate-plans');
const { createUnitBlockService } = require('../src/services/unit-blocks');
const { createReviewService } = require('../src/services/review-center');
const { createReportingService } = require('../src/services/reporting');
const { ConflictError } = require('../src/services/errors');
const { createOverbookingGuard } = require('../src/services/overbooking-guard');
const { createChannelIntegrationService } = require('../src/services/channel-integrations');
const { createOtaDispatcher } = require('../src/services/ota-sync/dispatcher');
const { createI18nService } = require('../src/services/i18n');
const { createMessageTemplateService } = require('../src/services/templates');
const { createTenantService } = require('../src/services/tenants');

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
  const userId = db
    .prepare('INSERT INTO users(username,email,password_hash,role) VALUES (?,?,?,?)')
    .run('test', 'test@example.com', 'hash', 'gestao')
    .lastInsertRowid;

  const sessionService = createSessionService({ db, dayjs });
  const req = createMockRequest({ ip: '192.168.0.1', userAgent: 'UnitTester/1.0' });
  const tenantId = 1;

  const { token } = sessionService.issueSession(userId, req, { tenantId });
  assert.ok(token, 'deve emitir token');

  const stored = db.prepare('SELECT token, token_hash, user_id, ip, user_agent FROM sessions').get();
  assert.ok(stored, 'sessão deve ser persistida');
  const hashed = sessionService.hashToken(token);
  assert.equal(stored.token, hashed, 'token deve ser guardado de forma cifrada');
  assert.equal(stored.token_hash, hashed, 'token_hash deve corresponder');
  assert.equal(stored.ip, req.ip);
  assert.equal(stored.user_agent, req.get('user-agent'));

  const session = sessionService.getSession(token, req, { tenantId });
  assert.ok(session, 'getSession deve recuperar sessão válida');
  assert.equal(session.user_id, userId);

  const mismatched = createMockRequest({ ip: '10.0.0.5', userAgent: 'Other/1.0' });
  assert.equal(
    sessionService.getSession(token, mismatched, { tenantId }),
    null,
    'sessão deve ser rejeitada com IP/UA diferentes'
  );

  sessionService.destroySession(token, { tenantId });
  const count = db.prepare('SELECT COUNT(*) as total FROM sessions').get();
  assert.equal(count.total, 0, 'destroySession deve eliminar sessão');

  sessionService.revokeUserSessions(userId, { tenantId });
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

function testRequireScopeMiddleware() {
  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const previousSkip = process.env.SKIP_SERVER_START;
  const previousDbPath = process.env.DATABASE_PATH;
  process.env.SKIP_SERVER_START = '1';
  process.env.DATABASE_PATH = ':memory:';
  const server = require(serverPath);
  const { db, requireScope, buildUserContext } = server;

  const propertyId = db.prepare('INSERT INTO properties(name) VALUES (?)').run('Quinta das Escopos').lastInsertRowid;
  db
    .prepare('INSERT INTO units(property_id, name, capacity, base_price_cents) VALUES (?,?,?,?)')
    .run(propertyId, 'Casa Pátio', 4, 18000);
  const userId = db
    .prepare('INSERT INTO users(username,email,password_hash,role) VALUES (?,?,?,?)')
    .run('maria', 'maria@example.com', 'hash', 'rececao')
    .lastInsertRowid;

  const req = {
    params: { id: String(propertyId) },
    originalUrl: `/admin/properties/${propertyId}`,
    cookies: {},
    headers: {},
  };
  req.user = buildUserContext({ user_id: userId, username: 'maria', role: 'rececao' });

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    sent: null,
    send(payload) {
      this.sent = payload;
      return this;
    },
    json(payload) {
      this.sent = payload;
      return this;
    }
  };

  let nextCalled = false;
  requireScope('properties', 'manage', r => r.params.id)(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false, 'middleware deve bloquear acesso sem escopo específico');
  assert.equal(res.statusCode, 403, 'sem escopo deve responder com 403');

  const roleRow = db.prepare('SELECT id FROM roles WHERE key = ?').get('gestao');
  db.prepare('INSERT OR IGNORE INTO user_roles(user_id, role_id, property_id) VALUES (?,?,?)').run(userId, roleRow.id, propertyId);

  req.user = buildUserContext({ user_id: userId, username: 'maria', role: 'rececao' });
  const resAllowed = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    sent: null,
    send(payload) {
      this.sent = payload;
      return this;
    },
    json(payload) {
      this.sent = payload;
      return this;
    }
  };
  let nextAllowed = false;
  requireScope('properties', 'manage', r => r.params.id)(req, resAllowed, () => {
    nextAllowed = true;
  });
  assert.equal(nextAllowed, true, 'middleware deve permitir acesso quando escopo é atribuído');
  assert.equal(resAllowed.statusCode, 200, 'resposta não deve alterar status quando autorizado');

  if (server && server.db && typeof server.db.close === 'function') {
    server.db.close();
  }
  delete require.cache[serverPath];
  if (previousSkip === undefined) {
    delete process.env.SKIP_SERVER_START;
  } else {
    process.env.SKIP_SERVER_START = previousSkip;
  }
  if (previousDbPath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDbPath;
  }
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

  const weekdayRuleRow = {
    id: 101,
    type: 'weekday',
    name: 'Ajuste dia específico',
    adjustment_percent: 50,
    min_price_cents: 10000,
    max_price_cents: 20000,
    config: JSON.stringify({ weekdays: [dayjs(targetDate).day()] }),
    active: 1,
  };
  const leadRuleRow = {
    id: 102,
    type: 'lead_time',
    name: 'Promo last-minute',
    adjustment_percent: -20,
    max_price_cents: 15000,
    config: JSON.stringify({ maxLead: 3 }),
    active: 1,
  };
  const rateRules = [
    normalizeRuleRow(weekdayRuleRow, { currency: 'eur' }),
    normalizeRuleRow(leadRuleRow, { currency: 'eur' }),
  ];
  const { price: ruledPrice, breakdown: ruledBreakdown } = suggestPrice({
    unit,
    targetDate,
    history,
    ratePlan,
    rateRules,
  });
  assert.ok(Array.isArray(ruledBreakdown.rulesApplied) && ruledBreakdown.rulesApplied.length === 2, 'regras devem ser aplicadas');
  assert.ok(Math.abs(ruledBreakdown.ruleMultiplier - 1.2) < 0.0001, 'multiplicador combinado deve refletir regras');
  assert.ok(ruledPrice >= 100 && ruledPrice <= 150, 'limites das regras devem ser respeitados');
}

function testRateRuleEngine() {
  const targetDate = dayjs().add(5, 'day');
  const weekdayRule = normalizeRuleRow(
    {
      id: 201,
      type: 'weekday',
      name: 'Boost fim-de-semana',
      adjustment_percent: 10,
      min_price_cents: 9000,
      config: JSON.stringify({ weekdays: [targetDate.day()] }),
      active: 1,
    },
    { currency: 'eur' }
  );
  const occupancyRule = normalizeRuleRow(
    {
      id: 202,
      type: 'occupancy',
      name: 'Alta procura',
      adjustment_percent: 15,
      max_price_cents: 20000,
      config: JSON.stringify({ minOccupancy: 0.7 }),
      active: 1,
    },
    { currency: 'eur' }
  );
  const outcome = applyRateRules({
    rules: [weekdayRule, occupancyRule],
    context: {
      date: targetDate,
      weekday: targetDate.day(),
      occupancy: 0.75,
    },
  });
  assert.ok(Math.abs(outcome.multiplier - 1.265) < 0.0001, 'multiplicador deve combinar ajustes');
  assert.equal(outcome.minPrice, 90, 'mínimo em euros deve ser respeitado');
  assert.equal(outcome.maxPrice, 200, 'máximo em euros deve ser respeitado');
  assert.equal(outcome.applied.length, 2, 'ambas as regras devem ser consideradas');
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
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status, rate_plan_id) VALUES (?,?,?,?,?,?,?,?)'
  ).run(unitId, 'Ana', 'ana@example.com', '2025-04-05', '2025-04-08', 48000, 'CONFIRMED', null);

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
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status, rate_plan_id) VALUES (?,?,?,?,?,?,?,?)'
  );

  const bookingId = insertBooking.run(unitId, 'Maria', 'maria@example.com', '2025-06-01', '2025-06-04', 36000, 'PENDING', null)
    .lastInsertRowid;
  const hold = guard.reserveSlot({ unitId, from: '2025-06-01', to: '2025-06-04', bookingId });
  assert.equal(hold.created, true, 'primeiro bloqueio deve ser criado');
  assert.ok(channelQueue.length >= 1, 'bloqueio deve ser enfileirado para canais');

  const repeat = guard.reserveSlot({ unitId, from: '2025-06-01', to: '2025-06-04', bookingId });
  assert.equal(repeat.created, false, 'chamada idempotente não deve recriar bloqueio');
  assert.ok(channelQueue.length >= 1, 'idempotência não deve duplicar fila');

  const concurrentFrom = '2025-07-01';
  const concurrentTo = '2025-07-04';
  const firstConcurrentId = insertBooking.run(unitId, 'João', 'joao@example.com', concurrentFrom, concurrentTo, 45000, 'PENDING', null)
    .lastInsertRowid;
  const secondConcurrentId = insertBooking.run(unitId, 'Carla', 'carla@example.com', concurrentFrom, concurrentTo, 45000, 'PENDING', null)
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

function testI18nService() {
  const i18n = createI18nService();
  assert.equal(i18n.normalizeLanguage('PT-pt'), 'pt', 'normalização deve reconhecer variantes de português');
  assert.equal(i18n.normalizeLanguage('english'), 'en', 'normalização deve reconhecer inglês');
  assert.equal(i18n.normalizeLanguage(''), null, 'valor vazio não deve ser aceite');

  const detectedPt = i18n.detectLanguage('Olá, obrigado pela reserva!');
  assert.ok(detectedPt && detectedPt.language === 'pt', 'deve detetar português em mensagens com contexto');
  const detectedEn = i18n.detectLanguage('Hello, thank you for your help.');
  assert.ok(detectedEn && detectedEn.language === 'en', 'deve detetar inglês em mensagens com contexto');
  const neutral = i18n.detectLanguage('🙂🙂🙂');
  assert.equal(neutral, null, 'mensagem neutra não deve indicar idioma');
}

function testMessageTemplateService() {
  const db = createDatabase(':memory:');
  const userId = db
    .prepare('INSERT INTO users(username,email,password_hash,role) VALUES (?,?,?,?)')
    .run('editor', 'editor@example.com', 'hash', 'gestao').lastInsertRowid;

  const i18n = createI18nService();
  const service = createMessageTemplateService({ db, dayjs, i18n });

  const templates = service.listTemplates();
  assert.ok(Array.isArray(templates) && templates.length >= 1, 'deve listar templates de mensagens');

  const previewEn = service.renderTemplate('booking_confirmation', {
    sampleText: 'Hello, can we check in earlier?',
    variables: {
      guest_first_name: 'Alice',
      property_name: 'Casa Azul',
      unit_name: 'Suite Rio',
      checkin: '10/08/2025',
      checkout: '12/08/2025',
      nights: 2,
      door_code: '1357',
      support_phone: '+44 20 0000 0000',
      brand_name: 'Blue Stay'
    }
  });
  assert.equal(previewEn.language, 'en', 'idioma deve ser inglês quando a mensagem é inglesa');
  assert.ok(previewEn.body.includes('Hi Alice'), 'mensagem inglesa deve conter o primeiro nome');

  const previewPt = service.renderTemplate('booking_confirmation', {
    sampleText: 'Olá, podemos chegar às 14h?',
    variables: {
      guest_first_name: 'Beatriz',
      property_name: 'Casa Azul',
      unit_name: 'Suite Rio',
      checkin: '10/08/2025',
      checkout: '12/08/2025',
      nights: 2,
      door_code: '1357',
      support_phone: '+351 910 000 000',
      brand_name: 'Blue Stay'
    }
  });
  assert.equal(previewPt.language, 'pt', 'idioma deve ser português quando a mensagem é portuguesa');
  assert.ok(previewPt.body.includes('Olá Beatriz'), 'mensagem portuguesa deve conter o primeiro nome');

  const fallbackPreview = service.renderTemplate('pre_checkin_reminder', {
    sampleText: '🙂🙂',
    variables: {
      guest_first_name: 'Alex',
      checkin_time: '16:00',
      checkin: '20/08/2025',
      support_phone: '+351 910 000 000',
      unit_name: 'Suite Vista Rio',
      welcome_link: 'https://example.com/info',
      brand_name: 'Casas de Pousadouro'
    }
  });
  assert.equal(fallbackPreview.language, 'en', 'quando não há idioma detetado deve usar fallback inglês');

  const sanitized = service.renderTemplate('booking_confirmation', {
    sampleText: 'Hello!',
    variables: {
      guest_first_name: '<script>alert(1)</script>Ana',
      property_name: 'Casa <Test>',
      unit_name: 'Suite',
      checkin: '01/09/2025',
      checkout: '05/09/2025',
      nights: 4,
      door_code: '<b>1234</b>',
      support_phone: '+351 900 000 000',
      brand_name: 'Test Brand'
    }
  });
  assert.equal(sanitized.language, 'en');
  assert.ok(!sanitized.body.includes('<script'), 'placeholders devem ser sanitizados');
  assert.ok(!sanitized.body.includes('<b>'), 'tags HTML devem ser removidas');
  assert.ok(sanitized.body.includes('Ana'), 'texto útil deve permanecer após sanitização');

  const updated = service.updateTemplate('pre_checkin_reminder', 'pt', { body: 'Olá {{guest_first_name}}!' }, userId);
  assert.equal(updated.body, 'Olá {{guest_first_name}}!');
  const persisted = db
    .prepare('SELECT body, updated_by FROM message_templates WHERE template_key = ? AND language = ?')
    .get('pre_checkin_reminder', 'pt');
  assert.equal(persisted.body, 'Olá {{guest_first_name}}!');
  assert.equal(persisted.updated_by, userId);

  const overridePreview = service.renderTemplate('pre_checkin_reminder', {
    language: 'pt',
    bodyOverride: 'Teste {{guest_first_name}}',
    variables: { guest_first_name: 'Marta' }
  });
  assert.equal(overridePreview.body, 'Teste Marta');
  const stored = service.getTemplate('pre_checkin_reminder', 'pt');
  assert.equal(stored.body, 'Olá {{guest_first_name}}!');
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
    'INSERT INTO bookings(unit_id, guest_name, guest_email, checkin, checkout, total_cents, status, rate_plan_id) VALUES (?,?,?,?,?,?,?,?)'
  ).run(unitId, 'João', 'joao@example.com', '2025-05-10', '2025-05-13', 30000, 'CONFIRMED', null);

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

function testRatePlanRestrictions() {
  const db = createDatabase(':memory:');
  const { propertyId } = seedPropertyAndUnit(db);
  const service = createRatePlanService({ db, dayjs });
  const plan = service.createPlan({ name: 'Plano Festival', propertyId });

  service.createRestriction({
    ratePlanId: plan.id,
    startDate: '2025-08-10',
    endDate: '2025-08-15',
    closedToArrival: true,
    reason: 'Festival local'
  });

  let arrivalError = null;
  try {
    service.assertBookingAllowed({ ratePlanId: plan.id, checkin: '2025-08-11', checkout: '2025-08-13' });
  } catch (err) {
    arrivalError = err;
  }
  assert.ok(arrivalError instanceof ConflictError, 'restrição de chegada deve gerar conflito');
  assert.equal(arrivalError.status, 409, 'conflito deve sinalizar estado 409');
  assert.ok(arrivalError.message.includes('Check-in indisponível'), 'mensagem deve indicar bloqueio de check-in');
  assert.ok(arrivalError.message.includes('Festival local'), 'mensagem deve incluir motivo configurado');

  const allowed = service.assertBookingAllowed({ ratePlanId: plan.id, checkin: '2025-08-16', checkout: '2025-08-18' });
  assert.ok(allowed.ok, 'fora do intervalo restrito a reserva deve ser permitida');

  service.createRestriction({
    ratePlanId: plan.id,
    startDate: '2025-09-20',
    endDate: '2025-09-22',
    closedToDeparture: true,
    reason: 'Saídas bloqueadas para limpeza'
  });

  let departureError = null;
  try {
    service.assertBookingAllowed({ ratePlanId: plan.id, checkin: '2025-09-18', checkout: '2025-09-21' });
  } catch (err) {
    departureError = err;
  }
  assert.ok(departureError instanceof ConflictError, 'restrição de saída deve gerar conflito');
  assert.equal(departureError.status, 409, 'conflito de saída deve sinalizar 409');
  assert.ok(departureError.message.includes('Check-out indisponível'), 'mensagem deve indicar bloqueio de check-out');
  assert.ok(departureError.message.includes('Saídas bloqueadas'), 'motivo de saída deve aparecer na mensagem');
}

function testTenantService() {
  const db = createDatabase(':memory:');
  const tenantService = createTenantService({ db });

  const defaultTenant = tenantService.getDefaultTenant();
  assert.ok(defaultTenant && defaultTenant.id, 'tenant padrão deve existir');

  const tenantA = tenantService.createTenant({
    name: 'Tenant Alpha',
    domain: 'tenant-a.test',
    branding: { brandName: 'Alpha Stays', primaryColor: '#336699' }
  });
  const tenantB = tenantService.createTenant({ name: 'Tenant Beta', domain: 'tenant-b.test' });

  const resolvedA = tenantService.resolveTenant('tenant-a.test');
  assert.equal(resolvedA.id, tenantA.id, 'resolver por domínio deve devolver tenant correto');

  const resolvedUnknown = tenantService.resolveTenant('inexistente.test');
  assert.equal(resolvedUnknown.id, defaultTenant.id, 'domínios desconhecidos regressam ao tenant padrão');

  const updatedA = tenantService.updateTenant(tenantA.id, {
    branding: { brandName: 'Alpha Updated', highlightColor: '#ff6600' }
  });
  assert.equal(updatedA.branding.brandName, 'Alpha Updated', 'branding deve poder ser atualizado');

  const userId = db
    .prepare('INSERT INTO users(username,email,password_hash,role,tenant_id) VALUES (?,?,?,?,?)')
    .run('alpha-user', 'alpha@example.com', 'hash', 'gestao', tenantA.id).lastInsertRowid;

  const sessionService = createSessionService({ db, dayjs });
  const req = createMockRequest({ ip: '127.0.0.5', userAgent: 'TenantTest/1.0' });
  const { token } = sessionService.issueSession(userId, req, { tenantId: tenantA.id });

  const validSession = sessionService.getSession(token, req, { tenantId: tenantA.id });
  assert.ok(validSession, 'sessão deve ser recuperada para tenant correto');
  assert.equal(validSession.tenant_id, tenantA.id, 'sessão deve manter tenant associado');

  const crossSession = sessionService.getSession(token, req, { tenantId: tenantB.id });
  assert.equal(crossSession, null, 'acesso cruzado a sessões deve ser bloqueado');

  const tenants = tenantService.listTenants();
  assert.ok(tenants.some(t => t.id === tenantA.id) && tenants.some(t => t.id === tenantB.id), 'listagem deve incluir novos tenants');

  const fetched = tenantService.getTenantById(tenantA.id);
  assert.equal(fetched.branding.brandName, 'Alpha Updated', 'tenant deve refletir branding actualizado');

  assert.throws(() => tenantService.deleteTenant(defaultTenant.id), /tenant padrão/i, 'não deve remover tenant padrão');
}

async function main() {
  console.log('> testServerBootstrap');
  testServerBootstrap();
  console.log('✓ testServerBootstrap');
  console.log('> testSessionService');
  testSessionService();
  console.log('✓ testSessionService');
  console.log('> testTenantService');
  testTenantService();
  console.log('✓ testTenantService');
  console.log('> testCsrfProtection');
  testCsrfProtection();
  console.log('✓ testCsrfProtection');
  console.log('> testRequireScopeMiddleware');
  testRequireScopeMiddleware();
  console.log('✓ testRequireScopeMiddleware');
  console.log('> testPricingService');
  testPricingService();
  console.log('✓ testPricingService');
  console.log('> testRateRuleEngine');
  testRateRuleEngine();
  console.log('✓ testRateRuleEngine');
  console.log('> testRateManagementService');
  testRateManagementService();
  console.log('✓ testRateManagementService');
  console.log('> testUnitBlockService');
  testUnitBlockService();
  console.log('✓ testUnitBlockService');
  console.log('> testRatePlanRestrictions');
  testRatePlanRestrictions();
  console.log('✓ testRatePlanRestrictions');
  console.log('> testOverbookingGuardService');
  await testOverbookingGuardService();
  console.log('✓ testOverbookingGuardService');
  console.log('> testOtaWebhookIngestion');
  await testOtaWebhookIngestion();
  console.log('✓ testOtaWebhookIngestion');
  console.log('> testOtaDispatcherQueue');
  await testOtaDispatcherQueue();
  console.log('✓ testOtaDispatcherQueue');
  console.log('> testI18nService');
  testI18nService();
  console.log('✓ testI18nService');
  console.log('> testMessageTemplateService');
  testMessageTemplateService();
  console.log('✓ testMessageTemplateService');
  console.log('> testReviewService');
  testReviewService();
  console.log('✓ testReviewService');
  console.log('> testReportingService');
  testReportingService();
  const handles = process._getActiveHandles();
  console.log('Active handles after tests:', handles.map(h => h.constructor.name));
  console.log('Todos os testes passaram.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

