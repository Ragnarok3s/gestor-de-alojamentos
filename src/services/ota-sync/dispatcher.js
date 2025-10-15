const crypto = require('node:crypto');

function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function normalizePlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildSignaturePayload(data) {
  const seen = new WeakSet();
  const sorter = (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (seen.has(value)) return value;
      seen.add(value);
      const entries = Object.keys(value)
        .sort()
        .map(name => [name, value[name]]);
      const ordered = {};
      for (const [name, nested] of entries) {
        ordered[name] = nested;
      }
      return ordered;
    }
    return value;
  };
  return JSON.stringify(data, sorter);
}

function computeSignature(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeEqual(a, b) {
  try {
    const expected = Buffer.from(String(a));
    const provided = Buffer.from(String(b));
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch (err) {
    return false;
  }
}

function extractSecret(integration) {
  if (!integration) return null;
  const candidates = [
    integration.settings?.webhookSecret,
    integration.settings?.webhookToken,
    integration.settings?.secret,
    integration.settings?.syncSecret,
    integration.credentials?.webhookSecret,
    integration.credentials?.webhookToken,
    integration.credentials?.secret,
    integration.credentials?.apiSecret,
    integration.credentials?.signingSecret
  ];
  const entry = candidates.find(value => typeof value === 'string' && value.trim());
  return entry ? String(entry).trim() : null;
}

function createAdapter(channelKey) {
  const upperKey = channelKey.toUpperCase();

  return {
    key: channelKey,
    async ingest({ channelIntegrations, overbookingGuard, payload, logger }) {
      const result = await channelIntegrations.importFromWebhook({
        channelKey,
        payload,
        uploadedBy: null,
        sourceLabel: 'webhook:ota-sync'
      });

      if (result && Array.isArray(result.inserted) && overbookingGuard) {
        for (const item of result.inserted) {
          const unitId = item?.unit?.id || item?.record?.unitId || null;
          if (!unitId) continue;
          const checkin = item?.record?.checkin;
          const checkout = item?.record?.checkout;
          const bookingId = item?.booking_id;
          if (!checkin || !checkout || !bookingId) continue;
          try {
            overbookingGuard.reserveSlot({
              unitId,
              from: checkin,
              to: checkout,
              bookingId,
              source: upperKey
            });
          } catch (err) {
            if (logger && typeof logger.warn === 'function') {
              logger.warn(`[ota-sync] falha ao bloquear unidade para reserva ${bookingId}: ${err.message}`);
            }
          }
        }
      }

      return result;
    },
    async pushUpdate({ update, recordOutbound }) {
      recordOutbound({
        channel: channelKey,
        update
      });
      return { ok: true };
    },
    async testConnection({ integration }) {
      if (!integration) {
        throw new Error('Integração desconhecida');
      }
      const hasUrl = !!integration.settings?.autoUrl;
      const hasCredentials = integration.credentials && Object.keys(integration.credentials).length > 0;
      return {
        ok: hasUrl || hasCredentials,
        details: {
          hasUrl,
          hasCredentials
        }
      };
    }
  };
}

const DEFAULT_CHANNELS = ['airbnb', 'booking', 'expedia'];
const DEFAULT_DEBOUNCE_MS = 1000;

function createOtaDispatcher({
  db,
  dayjs,
  channelIntegrations,
  overbookingGuard,
  logger = console,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  channels = DEFAULT_CHANNELS
} = {}) {
  if (!db || !channelIntegrations) {
    throw new Error('createOtaDispatcher requer acesso à base de dados e integrações de canais.');
  }

  const adapters = new Map();
  channels.forEach(channelKey => {
    adapters.set(channelKey, createAdapter(channelKey));
  });

  const timers = new Map();
  const pending = new Map();
  const outboundLog = [];

  const insertQueueStmt = db.prepare(
    `INSERT INTO channel_sync_queue (unit_id, type, payload, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))`
  );
  const selectPendingStmt = db.prepare(
    `SELECT * FROM channel_sync_queue WHERE status = 'pending' ORDER BY id LIMIT ?`
  );
  const updateStatusStmt = db.prepare(
    `UPDATE channel_sync_queue
        SET status = ?,
            payload = ?,
            last_error = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );

  function recordOutboundDispatch(entry) {
    outboundLog.push({ ...entry, at: new Date().toISOString() });
  }

  function serializePayload(payload) {
    return JSON.stringify(payload || {});
  }

  function finalizeUnit(unitId) {
    timers.delete(unitId);
    const bundle = pending.get(unitId);
    if (!bundle) return;
    pending.delete(unitId);
    const payload = {
      unitId,
      updates: bundle.updates,
      enqueuedAt: new Date().toISOString()
    };
    insertQueueStmt.run(unitId, bundle.type, serializePayload(payload));
  }

  function scheduleUnit(unitId) {
    if (timers.has(unitId)) return;
    const timer = setTimeout(() => finalizeUnit(unitId), debounceMs);
    timers.set(unitId, timer);
  }

  function pushUpdate(update) {
    if (!update || typeof update !== 'object') return;
    const unitId = Number(update.unitId);
    if (!Number.isInteger(unitId) || unitId <= 0) return;
    const type = update.type ? String(update.type) : 'generic';
    const payload = normalizePlainObject(update.payload);

    const entry = pending.get(unitId);
    if (entry) {
      entry.updates.push({ type, payload, receivedAt: new Date().toISOString() });
      entry.type = entry.updates.length > 1 ? 'batch' : type;
    } else {
      pending.set(unitId, {
        type,
        updates: [{ type, payload, receivedAt: new Date().toISOString() }]
      });
    }
    scheduleUnit(unitId);
  }

  function flushPendingDebounce() {
    for (const [unitId, timer] of timers.entries()) {
      clearTimeout(timer);
      finalizeUnit(unitId);
    }
  }

  async function processQueueItem(row) {
    const basePayload = safeJsonParse(row.payload, {});
    const integrations = channelIntegrations.listIntegrations();
    const dispatches = [];

    for (const integration of integrations) {
      if (!integration || !integration.key) continue;
      const adapter = adapters.get(integration.key);
      if (!adapter) continue;
      if (integration.supportsAuto === false) continue;
      const autoEnabled = integration.settings?.autoEnabled;
      if (autoEnabled === false) continue;

      const secret = extractSecret(integration);
      const message = {
        channel: integration.key,
        unitId: row.unit_id,
        type: row.type,
        payload: basePayload,
        dispatchedAt: new Date().toISOString()
      };
      const serialized = buildSignaturePayload(message);
      const signature = secret ? computeSignature(secret, serialized) : null;
      const update = { ...message, signature };
      await adapter.pushUpdate({
        update,
        recordOutbound: recordOutboundDispatch
      });
      dispatches.push({
        channel: integration.key,
        signature,
        dispatchedAt: message.dispatchedAt
      });
    }

    const nextPayload = {
      ...basePayload,
      lastDispatchAt: new Date().toISOString(),
      dispatches
    };

    updateStatusStmt.run('processed', serializePayload(nextPayload), null, row.id);
    return { id: row.id, dispatches };
  }

  async function flushQueue({ limit = 20 } = {}) {
    const capped = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const rows = selectPendingStmt.all(capped);
    const processed = [];

    for (const row of rows) {
      try {
        updateStatusStmt.run('processing', row.payload, null, row.id);
        const result = await processQueueItem(row);
        processed.push(result);
      } catch (err) {
        updateStatusStmt.run('failed', row.payload, err.message, row.id);
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[ota-sync] falha ao enviar update ${row.id}: ${err.message}`);
        }
      }
    }

    return { processed, remaining: selectPendingStmt.all(capped).length };
  }

  async function ingest({ channelKey, payload, headers = {}, rawBody }) {
    const key = String(channelKey || '').trim();
    if (!key) {
      throw new Error('Canal obrigatório');
    }
    const adapter = adapters.get(key);
    if (!adapter) {
      throw new Error('Canal não suportado');
    }
    const integration = channelIntegrations.getIntegration(key);
    if (!integration) {
      throw new Error('Canal desconhecido');
    }
    const secret = extractSecret(integration);
    if (secret) {
      const headerNames = ['x-ota-signature', 'x-channel-signature', 'x-webhook-signature'];
      let provided = null;
      for (const name of headerNames) {
        if (headers && headers[name]) {
          provided = headers[name];
          break;
        }
        const lower = name.toLowerCase();
        if (headers && headers[lower]) {
          provided = headers[lower];
          break;
        }
      }
      if (!provided && payload && typeof payload.signature === 'string') {
        provided = payload.signature;
      }
      if (!provided) {
        throw new Error('Assinatura obrigatória');
      }
      const normalized = typeof rawBody === 'string' && rawBody.trim() ? rawBody : JSON.stringify(payload || {});
      const expected = computeSignature(secret, normalized);
      if (!timingSafeEqual(expected, provided)) {
        throw new Error('Assinatura inválida');
      }
    }

    const result = await adapter.ingest({
      channelIntegrations,
      overbookingGuard,
      payload,
      logger
    });

    return result;
  }

  async function testConnection(channelKey) {
    const key = String(channelKey || '').trim();
    if (!key) {
      throw new Error('Canal obrigatório');
    }
    const adapter = adapters.get(key);
    if (!adapter) {
      throw new Error('Canal não suportado');
    }
    const integration = channelIntegrations.getIntegration(key);
    const result = await adapter.testConnection({ integration });
    return result;
  }

  return {
    ingest,
    pushUpdate,
    flushQueue,
    flushPendingDebounce,
    testConnection,
    getOutboundLog: () => outboundLog.slice()
  };
}

module.exports = {
  createOtaDispatcher
};
