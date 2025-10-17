const crypto = require('crypto');
const { ValidationError } = require('../errors');
const {
  normalizePaymentStatus,
  isFinalPaymentStatus,
  isCapturedStatus,
  isCancelledStatus,
  isFailureStatus,
  isActionRequiredStatus,
  isFinalRefundStatus
} = require('./status');

function randomId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

function parseJsonSafe(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeStatus(value, { fallback = null } = {}) {
  const normalized = normalizePaymentStatus(value);
  return normalized || fallback;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function nowIso(dayjs) {
  if (dayjs && typeof dayjs === 'function') {
    try {
      return dayjs().toISOString();
    } catch (_) {}
  }
  return new Date().toISOString();
}

function createPaymentService({ db, dayjs, adapters = {}, logger = console } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('db é obrigatório para criar o serviço de pagamentos.');
  }

  const adapterMap = new Map();

  const insertPaymentStmt = db.prepare(
    `INSERT INTO payments (
      id,
      booking_id,
      provider,
      intent_type,
      status,
      amount_cents,
      currency,
      customer_email,
      metadata,
      reconciliation_status
    ) VALUES (@id, @bookingId, @provider, @intentType, @status, @amountCents, @currency, @customerEmail, @metadata, @reconciliationStatus)`
  );

  const selectPaymentByIdStmt = db.prepare(
    `SELECT id, booking_id, provider, provider_payment_id, intent_type, status,
            amount_cents, currency, customer_email, metadata, client_secret,
            next_action_json, last_error, reconciliation_status, captured_at,
            cancelled_at, created_at, updated_at
       FROM payments
      WHERE id = ?`
  );

  const selectPaymentByProviderStmt = db.prepare(
    `SELECT id, booking_id, provider, provider_payment_id, intent_type, status,
            amount_cents, currency, customer_email, metadata, client_secret,
            next_action_json, last_error, reconciliation_status, captured_at,
            cancelled_at, created_at, updated_at
       FROM payments
      WHERE provider = ? AND provider_payment_id = ?`
  );

  const selectPendingPaymentsStmt = db.prepare(
    `SELECT id FROM payments WHERE reconciliation_status = 'pending' LIMIT ?`
  );

  const selectRefundByIdStmt = db.prepare(
    `SELECT id, payment_id, provider, provider_refund_id, amount_cents, currency,
            status, reason, metadata, reconciliation_status, created_at, updated_at,
            processed_at
       FROM refunds
      WHERE id = ?`
  );

  const selectRefundByProviderStmt = db.prepare(
    `SELECT id, payment_id, provider, provider_refund_id, amount_cents, currency,
            status, reason, metadata, reconciliation_status, created_at, updated_at,
            processed_at
       FROM refunds
      WHERE provider = ? AND provider_refund_id = ?`
  );

  const insertRefundStmt = db.prepare(
    `INSERT INTO refunds (
      id,
      payment_id,
      provider,
      provider_refund_id,
      amount_cents,
      currency,
      status,
      reason,
      metadata,
      reconciliation_status,
      processed_at
    ) VALUES (@id, @paymentId, @provider, @providerRefundId, @amountCents, @currency, @status, @reason, @metadata, @reconciliationStatus, @processedAt)`
  );

  function serializePaymentRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      bookingId: row.booking_id ?? null,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id ?? null,
      intentType: row.intent_type,
      status: row.status,
      amountCents: row.amount_cents,
      currency: row.currency,
      customerEmail: row.customer_email ?? null,
      metadata: parseJsonSafe(row.metadata, null),
      clientSecret: row.client_secret ?? null,
      nextAction: parseJsonSafe(row.next_action_json, null),
      lastError: parseJsonSafe(row.last_error, null),
      reconciliationStatus: row.reconciliation_status,
      capturedAt: row.captured_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function serializeRefundRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      paymentId: row.payment_id,
      provider: row.provider,
      providerRefundId: row.provider_refund_id ?? null,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      reason: row.reason ?? null,
      metadata: parseJsonSafe(row.metadata, null),
      reconciliationStatus: row.reconciliation_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      processedAt: row.processed_at ?? null
    };
  }

  function getPayment(id) {
    if (!id) return null;
    const row = selectPaymentByIdStmt.get(id);
    return serializePaymentRow(row);
  }

  function getPaymentByProvider(provider, providerPaymentId) {
    if (!provider || !providerPaymentId) return null;
    const row = selectPaymentByProviderStmt.get(provider, providerPaymentId);
    return serializePaymentRow(row);
  }

  function getRefund(id) {
    if (!id) return null;
    const row = selectRefundByIdStmt.get(id);
    return serializeRefundRow(row);
  }

  function getRefundByProvider(provider, providerRefundId) {
    if (!provider || !providerRefundId) return null;
    const row = selectRefundByProviderStmt.get(provider, providerRefundId);
    return serializeRefundRow(row);
  }

  function registerAdapter(name, adapter) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Nome do adaptador inválido.');
    }
    if (!adapter || typeof adapter !== 'object') {
      throw new ValidationError(`Adaptador "${name}" inválido.`);
    }
    const key = name.trim().toLowerCase();
    adapterMap.set(key, adapter);
    return key;
  }

  function resolveAdapter(name) {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!key) {
      throw new ValidationError('Fornecedor de pagamento obrigatório.');
    }
    const adapter = adapterMap.get(key);
    if (!adapter) {
      throw new ValidationError(`Método de pagamento "${name}" indisponível.`);
    }
    return { key, adapter };
  }

  function normalizeCollectInput(input = {}) {
    const providerRaw = input.provider || input.method || input.adapter;
    const intentRaw = input.intentType || input.intent || input.flow || 'charge';
    const amountRaw = input.amountCents ?? input.amount ?? input.value;
    const currencyRaw = input.currency || 'EUR';

    const { key: provider } = resolveAdapter(providerRaw);

    let amountCents = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amountCents)) {
      amountCents = Number(amountRaw);
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new ValidationError('Montante inválido para cobrança.');
    }

    let intentType = normalizeStatus(intentRaw, { fallback: 'charge' });
    if (intentType === 'preauthorization' || intentType === 'preauthorisation' || intentType === 'preauth') {
      intentType = 'preauth';
    }
    if (!['charge', 'preauth'].includes(intentType)) {
      throw new ValidationError('Tipo de intenção de pagamento inválido.');
    }

    const currency = String(currencyRaw || 'EUR').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError('Moeda inválida.');
    }

    let bookingId = null;
    if (input.bookingId !== undefined && input.bookingId !== null && input.bookingId !== '') {
      const parsed = Number(input.bookingId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError('Reserva associada inválida.');
      }
      bookingId = parsed;
    }

    let metadata = null;
    if (input.metadata !== undefined && input.metadata !== null) {
      if (isPlainObject(input.metadata)) {
        metadata = { ...input.metadata };
      } else if (typeof input.metadata === 'string') {
        metadata = parseJsonSafe(input.metadata, null);
      }
    }

    const customerEmail = input.customerEmail ? String(input.customerEmail).trim() : null;
    const paymentMethod = input.paymentMethod ? { ...input.paymentMethod } : null;
    const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).trim() : null;

    return {
      provider,
      intentType,
      amountCents,
      currency,
      bookingId,
      metadata,
      customerEmail,
      paymentMethod,
      idempotencyKey,
      raw: input
    };
  }

  function createPaymentRecord(payload) {
    const id = randomId('pay_');
    const metadata = payload.metadata ? JSON.stringify(payload.metadata) : null;
    insertPaymentStmt.run({
      id,
      bookingId: payload.bookingId ?? null,
      provider: payload.provider,
      intentType: payload.intentType,
      status: 'pending',
      amountCents: payload.amountCents,
      currency: payload.currency,
      customerEmail: payload.customerEmail ?? null,
      metadata,
      reconciliationStatus: 'pending'
    });
    return getPayment(id);
  }

  function mergeMetadata(current, updates, merge = true) {
    if (updates === undefined) return undefined;
    if (updates === null) return null;
    if (!isPlainObject(updates)) {
      return updates;
    }
    if (!merge || !isPlainObject(current)) {
      return { ...updates };
    }
    return { ...current, ...updates };
  }

  function applyPaymentUpdates(id, updates = {}) {
    const current = getPayment(id);
    if (!current) return null;

    const sets = [];
    const params = { id };

    const status = updates.status !== undefined ? normalizeStatus(updates.status) : undefined;
    if (status !== undefined) {
      sets.push('status = @status');
      params.status = status;
      if (updates.reconciliationStatus === undefined) {
        updates.reconciliationStatus = isFinalPaymentStatus(status)
          ? 'matched'
          : current.reconciliationStatus || 'pending';
      }
      if (isCapturedStatus(status) && updates.capturedAt === undefined && !current.capturedAt) {
        updates.capturedAt = nowIso(dayjs);
      }
      if (isCancelledStatus(status) && updates.cancelledAt === undefined && !current.cancelledAt) {
        updates.cancelledAt = nowIso(dayjs);
      }
      if (!isCapturedStatus(status) && updates.capturedAt === undefined) {
        updates.capturedAt = current.capturedAt ?? undefined;
      }
      if (!isCancelledStatus(status) && updates.cancelledAt === undefined) {
        updates.cancelledAt = current.cancelledAt ?? undefined;
      }
    }

    if (updates.providerPaymentId !== undefined) {
      sets.push('provider_payment_id = @providerPaymentId');
      params.providerPaymentId = updates.providerPaymentId || null;
    }

    if (updates.clientSecret !== undefined) {
      sets.push('client_secret = @clientSecret');
      params.clientSecret = updates.clientSecret || null;
    }

    if (updates.nextAction !== undefined) {
      sets.push('next_action_json = @nextAction');
      params.nextAction = updates.nextAction == null ? null : JSON.stringify(updates.nextAction);
    }

    if (updates.lastError !== undefined) {
      const serializedError = updates.lastError == null ? null : JSON.stringify(updates.lastError);
      sets.push('last_error = @lastError');
      params.lastError = serializedError;
    }

    if (updates.metadata !== undefined) {
      const merged = mergeMetadata(current.metadata, updates.metadata, updates.mergeMetadata !== false);
      sets.push('metadata = @metadata');
      params.metadata = merged == null ? null : JSON.stringify(merged);
    }

    if (updates.reconciliationStatus !== undefined) {
      sets.push('reconciliation_status = @reconciliationStatus');
      params.reconciliationStatus = updates.reconciliationStatus;
    }

    if (updates.capturedAt !== undefined) {
      sets.push('captured_at = @capturedAt');
      params.capturedAt = updates.capturedAt ?? null;
    }

    if (updates.cancelledAt !== undefined) {
      sets.push('cancelled_at = @cancelledAt');
      params.cancelledAt = updates.cancelledAt ?? null;
    }

    if (updates.customerEmail !== undefined) {
      sets.push('customer_email = @customerEmail');
      params.customerEmail = updates.customerEmail ?? null;
    }

    if (!sets.length) {
      return current;
    }

    sets.push("updated_at = datetime('now')");
    const sql = `UPDATE payments SET ${sets.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(params);
    return getPayment(id);
  }

  function normalizeAdapterError(err) {
    if (!err || typeof err !== 'object') {
      return { message: 'Pagamento não autorizado.', details: null, status: 'failed' };
    }
    const message = err.message || 'Pagamento não autorizado.';
    const details = err.details || (err.data ? err.data : null);
    const status = err.status ? normalizeStatus(err.status, { fallback: 'failed' }) : 'failed';
    return { message, details, status };
  }

  function normalizeAdapterResult(result = {}) {
    const normalized = isPlainObject(result) ? result : {};
    const status = normalized.status ? normalizeStatus(normalized.status, { fallback: null }) : null;
    const providerPaymentId =
      normalized.providerPaymentId ||
      normalized.paymentIntentId ||
      normalized.paymentId ||
      normalized.id ||
      null;
    const clientSecret = normalized.clientSecret || normalized.secret || null;
    const nextAction = normalized.nextAction || normalized.action || null;
    const lastError = normalized.lastError || normalized.error || null;
    const reconciliationStatus = normalized.reconciliationStatus;
    const requiresAction =
      normalized.requiresAction !== undefined
        ? !!normalized.requiresAction
        : (status ? isActionRequiredStatus(status) : false);
    const capturedAt = normalized.capturedAt || null;
    const cancelledAt = normalized.cancelledAt || normalized.canceledAt || null;
    const metadata = normalized.metadata !== undefined ? normalized.metadata : undefined;
    const errorMessage = normalized.errorMessage || null;

    return {
      status,
      providerPaymentId,
      clientSecret,
      nextAction,
      lastError,
      reconciliationStatus,
      requiresAction,
      capturedAt,
      cancelledAt,
      metadata,
      errorMessage
    };
  }

  function buildAdapterHelpers(payment) {
    return {
      payment,
      update: (updates) => applyPaymentUpdates(payment.id, updates),
      getPayment,
      logger,
      dayjs,
      now: () => nowIso(dayjs)
    };
  }

  async function invokeAdapterCollect(adapter, payload, helpers) {
    if (!adapter || typeof adapter !== 'object') {
      throw new ValidationError('Adaptador de pagamento inválido.');
    }

    if (payload.intentType === 'preauth' && typeof adapter.createPreauth === 'function') {
      return adapter.createPreauth(payload, helpers);
    }

    if (typeof adapter.collect === 'function') {
      return adapter.collect(payload, helpers);
    }

    if (typeof adapter.createPaymentIntent === 'function') {
      return adapter.createPaymentIntent(payload, helpers);
    }

    throw new ValidationError(`Adaptador "${payload.provider}" não suporta o modo ${payload.intentType}.`);
  }

  async function collect(input = {}) {
    const normalizedInput = normalizeCollectInput(input);
    const { key: provider, adapter } = resolveAdapter(normalizedInput.provider);
    const payment = createPaymentRecord({ ...normalizedInput, provider });
    const helpers = buildAdapterHelpers(payment);

    let adapterResult;
    try {
      adapterResult = await invokeAdapterCollect(adapter, { ...normalizedInput, provider, paymentId: payment.id, payment }, helpers);
    } catch (err) {
      const normalizedError = normalizeAdapterError(err);
      const updated = applyPaymentUpdates(payment.id, {
        status: normalizedError.status || 'failed',
        lastError: normalizedError.details || { message: normalizedError.message },
        reconciliationStatus: 'failed'
      });
      if (err && typeof err === 'object') {
        if (!err.details) err.details = {};
        err.details.payment = updated;
      }
      throw err;
    }

    const result = normalizeAdapterResult(adapterResult || {});
    const updatedPayment = applyPaymentUpdates(payment.id, {
      status: result.status || payment.status || 'pending',
      providerPaymentId: result.providerPaymentId || payment.providerPaymentId || null,
      clientSecret: result.clientSecret !== undefined ? result.clientSecret : payment.clientSecret,
      nextAction: result.nextAction !== undefined ? result.nextAction : payment.nextAction,
      lastError: result.lastError !== undefined ? result.lastError : payment.lastError,
      reconciliationStatus: result.reconciliationStatus,
      metadata: result.metadata,
      capturedAt: result.capturedAt || undefined,
      cancelledAt: result.cancelledAt || undefined
    });

    const requiresAction = result.requiresAction || isActionRequiredStatus(updatedPayment.status);
    const response = {
      payment: updatedPayment,
      requiresAction,
      nextAction: updatedPayment.nextAction,
      clientSecret: updatedPayment.clientSecret,
      status: updatedPayment.status
    };

    if (isFailureStatus(updatedPayment.status)) {
      const message =
        result.errorMessage ||
        (updatedPayment.lastError && updatedPayment.lastError.message) ||
        'Pagamento não autorizado.';
      throw new ValidationError(message, {
        payment: updatedPayment,
        status: updatedPayment.status,
        error: updatedPayment.lastError || null
      });
    }

    return response;
  }

  function normalizeWebhookEvents(rawResult) {
    if (!rawResult) return [];
    if (Array.isArray(rawResult)) return rawResult;
    if (Array.isArray(rawResult.events)) return rawResult.events;
    if (rawResult.event) return [rawResult.event];
    if (rawResult.type || rawResult.kind) return [rawResult];
    return [];
  }

  function locatePayment(provider, event) {
    if (!event) return null;
    if (event.paymentId) {
      const byId = getPayment(event.paymentId);
      if (byId) return byId;
    }
    if (event.providerPaymentId) {
      const byProvider = getPaymentByProvider(provider, event.providerPaymentId);
      if (byProvider) return byProvider;
    }
    const metadata = event.metadata || (event.data && event.data.metadata) || null;
    if (metadata && metadata.paymentId) {
      const byMeta = getPayment(metadata.paymentId);
      if (byMeta) return byMeta;
    }
    return null;
  }

  function applyRefundEvent(provider, event, payment) {
    const amountCents = Number.isInteger(event.amountCents) ? event.amountCents : Number(event.amountCents || 0);
    const currency = event.currency ? String(event.currency).toUpperCase() : payment.currency;
    const status = normalizeStatus(event.status, { fallback: 'pending' });
    const reason = event.reason ? String(event.reason) : null;
    const metadata = event.metadata !== undefined ? event.metadata : undefined;
    const processedAt =
      event.processedAt ||
      event.settledAt ||
      (isFinalRefundStatus(status) ? nowIso(dayjs) : null);

    let refund = null;
    let created = false;

    if (event.providerRefundId) {
      refund = getRefundByProvider(provider, event.providerRefundId);
    }
    if (!refund && event.refundId) {
      refund = getRefund(event.refundId);
    }

    if (!refund) {
      const id = event.refundId || randomId('ref_');
      insertRefundStmt.run({
        id,
        paymentId: payment.id,
        provider,
        providerRefundId: event.providerRefundId || null,
        amountCents: Number.isInteger(amountCents) ? amountCents : 0,
        currency,
        status,
        reason,
        metadata: metadata == null ? null : JSON.stringify(metadata),
        reconciliationStatus: isFinalRefundStatus(status) ? 'matched' : 'pending',
        processedAt: processedAt || null
      });
      refund = getRefund(id);
      created = true;
    } else {
      const sets = [];
      const params = { id: refund.id };
      if (event.providerRefundId && !refund.providerRefundId) {
        sets.push('provider_refund_id = @providerRefundId');
        params.providerRefundId = event.providerRefundId;
      }
      if (Number.isInteger(amountCents) && amountCents > 0) {
        sets.push('amount_cents = @amountCents');
        params.amountCents = amountCents;
      }
      if (currency) {
        sets.push('currency = @currency');
        params.currency = currency;
      }
      if (status) {
        sets.push('status = @status');
        params.status = status;
        sets.push('reconciliation_status = @reconciliationStatus');
        params.reconciliationStatus = isFinalRefundStatus(status) ? 'matched' : refund.reconciliationStatus;
      }
      if (reason !== undefined) {
        sets.push('reason = @reason');
        params.reason = reason;
      }
      if (metadata !== undefined) {
        const mergedMetadata = mergeMetadata(refund.metadata, metadata, event.mergeMetadata !== false);
        sets.push('metadata = @metadata');
        params.metadata = mergedMetadata == null ? null : JSON.stringify(mergedMetadata);
      }
      if (processedAt !== undefined && processedAt !== null) {
        sets.push('processed_at = @processedAt');
        params.processedAt = processedAt;
      }
      if (sets.length) {
        sets.push("updated_at = datetime('now')");
        db.prepare(`UPDATE refunds SET ${sets.join(', ')} WHERE id = @id`).run(params);
        refund = getRefund(refund.id);
      }
    }

    return { type: 'refund', payment: getPayment(payment.id), refund, created };
  }

  function applyPaymentEvent(provider, event) {
    const payment = locatePayment(provider, event);
    if (!payment) {
      return { type: 'unmatched', event };
    }

    const updates = {};
    if (event.status !== undefined) {
      updates.status = event.status;
    }
    if (event.providerPaymentId !== undefined && !payment.providerPaymentId) {
      updates.providerPaymentId = event.providerPaymentId;
    }
    if (event.clientSecret !== undefined) {
      updates.clientSecret = event.clientSecret;
    }
    if (event.nextAction !== undefined) {
      updates.nextAction = event.nextAction;
    }
    if (event.lastError !== undefined || event.error !== undefined) {
      updates.lastError = event.lastError !== undefined ? event.lastError : event.error;
    }
    if (event.metadata !== undefined) {
      updates.metadata = event.metadata;
      if (event.mergeMetadata !== undefined) {
        updates.mergeMetadata = event.mergeMetadata;
      }
    }
    if (event.capturedAt !== undefined) {
      updates.capturedAt = event.capturedAt;
    }
    if (event.cancelledAt !== undefined || event.canceledAt !== undefined) {
      updates.cancelledAt = event.cancelledAt !== undefined ? event.cancelledAt : event.canceledAt;
    }
    if (event.reconciliationStatus !== undefined) {
      updates.reconciliationStatus = event.reconciliationStatus;
    }
    if (event.customerEmail !== undefined) {
      updates.customerEmail = event.customerEmail;
    }

    const updatedPayment = applyPaymentUpdates(payment.id, updates);
    return { type: 'payment', payment: updatedPayment };
  }

  async function handleWebhook(providerRaw, payload, { headers = {} } = {}) {
    const { key: provider, adapter } = resolveAdapter(providerRaw || (payload && payload.provider));
    if (!adapter || (typeof adapter.handleWebhook !== 'function' && typeof adapter.parseWebhook !== 'function')) {
      throw new ValidationError(`Adaptador "${provider}" não suporta webhooks.`);
    }

    const helpers = {
      logger,
      getPayment,
      getPaymentByProvider,
      getRefund,
      getRefundByProvider,
      updatePayment: applyPaymentUpdates
    };

    let rawResult;
    if (typeof adapter.handleWebhook === 'function') {
      rawResult = await adapter.handleWebhook({ payload, headers }, helpers);
    } else {
      rawResult = await adapter.parseWebhook({ payload, headers }, helpers);
    }

    const events = normalizeWebhookEvents(rawResult);
    const applied = [];
    const summary = {
      matchedPayments: 0,
      unmatchedEvents: 0,
      refundsCreated: 0,
      refundsUpdated: 0
    };

    for (const event of events) {
      if (!event || typeof event !== 'object') {
        summary.unmatchedEvents += 1;
        applied.push({ type: 'unmatched', event });
        continue;
      }

      const type = event.type || event.kind || '';
      if (type.startsWith('refund')) {
        const payment = locatePayment(provider, event);
        if (!payment) {
          summary.unmatchedEvents += 1;
          applied.push({ type: 'unmatched', event });
          continue;
        }
        const outcome = applyRefundEvent(provider, event, payment);
        if (outcome.created) summary.refundsCreated += 1;
        else summary.refundsUpdated += 1;
        summary.matchedPayments += 1;
        applied.push(outcome);
        continue;
      }

      const outcome = applyPaymentEvent(provider, event);
      if (outcome.type === 'payment') {
        summary.matchedPayments += 1;
      } else if (outcome.type === 'refund') {
        summary.matchedPayments += 1;
        if (outcome.created) summary.refundsCreated += 1;
        else summary.refundsUpdated += 1;
      } else {
        summary.unmatchedEvents += 1;
      }
      applied.push(outcome);
    }

    return { events: applied, summary };
  }

  function listPendingReconciliation(limit = 50) {
    const rows = selectPendingPaymentsStmt.all(Math.max(limit, 1));
    return rows.map((row) => getPayment(row.id)).filter(Boolean);
  }

  const manualAdapter = {
    async collect(payload) {
      const providerPaymentId = `manual_${payload.paymentId}`;
      if (payload.intentType === 'preauth') {
        return {
          providerPaymentId,
          status: 'requires_capture',
          requiresAction: false,
          nextAction: {
            type: 'manual_capture',
            instructions: 'Registar a captura da caução manualmente no sistema.'
          }
        };
      }
      return {
        providerPaymentId,
        status: 'succeeded',
        requiresAction: false,
        capturedAt: nowIso(dayjs)
      };
    },
    async handleWebhook() {
      return { events: [] };
    }
  };

  registerAdapter('manual', manualAdapter);

  if (adapters && typeof adapters === 'object') {
    for (const [name, adapter] of Object.entries(adapters)) {
      if (!adapter) continue;
      registerAdapter(name, adapter);
    }
  }

  return {
    collect,
    handleWebhook,
    registerAdapter,
    getPayment,
    getPaymentByProvider,
    getRefund,
    getRefundByProvider,
    applyPaymentUpdates,
    listPendingReconciliation,
    listAdapters: () => Array.from(adapterMap.keys())
  };
}

module.exports = {
  createPaymentService
};
