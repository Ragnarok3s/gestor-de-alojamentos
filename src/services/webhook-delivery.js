'use strict';

const http = require('http');
const https = require('https');
const { randomUUID } = require('node:crypto');

function safeJsonParse(value, fallback = null) {
  if (!value && value !== 0) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function safeJsonStringify(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return null;
  }
}

function normalizeHeaders(input = {}) {
  const headers = {};
  if (!input || typeof input !== 'object') {
    return headers;
  }
  Object.entries(input).forEach(([key, value]) => {
    if (!key) return;
    headers[key] = value != null ? String(value) : '';
  });
  return headers;
}

function ensureHeader(headers, target, value) {
  const existing = Object.keys(headers).find(header => header.toLowerCase() === target.toLowerCase());
  if (!existing) {
    headers[target] = value;
  }
}

function sendWebhookRequest({ url, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(new Error(`URL inválido para webhook: ${url}`));
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const options = {
      method,
      headers,
    };

    const req = transport.request(parsed, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        const statusCode = res.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode, body: responseBody, headers: res.headers });
        } else {
          const error = new Error(`Webhook respondeu com status ${statusCode}`);
          error.statusCode = statusCode;
          error.responseBody = responseBody;
          reject(error);
        }
      });
    });

    req.on('error', reject);
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Webhook expirou após ${timeoutMs}ms`));
      });
    }

    if (body && body.length) {
      req.write(body);
    }
    req.end();
  });
}

function createWebhookDeliveryService(options = {}) {
  const {
    db,
    queueFactory,
    workerFactory,
    queueName = 'ota:webhooks',
    logger = console,
    telemetry = null,
    dayjs = null,
  } = options;

  if (!db) {
    throw new Error('createWebhookDeliveryService requer uma ligação à base de dados.');
  }
  if (typeof queueFactory !== 'function') {
    throw new Error('createWebhookDeliveryService requer queueFactory.');
  }
  if (typeof workerFactory !== 'function') {
    throw new Error('createWebhookDeliveryService requer workerFactory.');
  }

  const log = logger && typeof logger.error === 'function' ? logger : console;
  const queue = queueFactory(queueName, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 60 * 60, count: 500 },
      removeOnFail: false,
    },
  });

  const upsertDeadLetterStmt = db.prepare(`
    INSERT INTO webhook_dead_letters (
      delivery_id,
      job_id,
      queue_name,
      url,
      method,
      headers_json,
      body_json,
      context_json,
      source,
      attempts_made,
      max_attempts,
      error_message,
      first_failed_at,
      last_failed_at,
      status
    ) VALUES (
      @delivery_id,
      @job_id,
      @queue_name,
      @url,
      @method,
      @headers_json,
      @body_json,
      @context_json,
      @source,
      @attempts_made,
      @max_attempts,
      @error_message,
      @timestamp,
      @timestamp,
      'PENDING'
    )
    ON CONFLICT(delivery_id) DO UPDATE SET
      job_id = excluded.job_id,
      queue_name = excluded.queue_name,
      url = excluded.url,
      method = excluded.method,
      headers_json = excluded.headers_json,
      body_json = excluded.body_json,
      context_json = excluded.context_json,
      source = excluded.source,
      attempts_made = excluded.attempts_made,
      max_attempts = excluded.max_attempts,
      error_message = excluded.error_message,
      last_failed_at = excluded.last_failed_at,
      status = 'PENDING'
  `);

  const markReplayedStmt = db.prepare(`
    UPDATE webhook_dead_letters
    SET replay_count = replay_count + 1,
        last_replayed_at = @last_replayed_at,
        last_replayed_job_id = @last_replayed_job_id,
        status = 'REPLAYED'
    WHERE delivery_id = @delivery_id
  `);

  const getDeadLetterStmt = db.prepare(`
    SELECT delivery_id,
           job_id,
           queue_name,
           url,
           method,
           headers_json,
           body_json,
           context_json,
           source,
           attempts_made,
           max_attempts,
           error_message,
           first_failed_at,
           last_failed_at,
           replay_count,
           last_replayed_at,
           last_replayed_job_id,
           status
    FROM webhook_dead_letters
    WHERE delivery_id = ?
  `);

  const listDeadLettersStmt = db.prepare(`
    SELECT delivery_id,
           job_id,
           url,
           method,
           error_message,
           attempts_made,
           max_attempts,
           first_failed_at,
           last_failed_at,
           replay_count,
           last_replayed_at,
           status
    FROM webhook_dead_letters
    ORDER BY (status = 'PENDING') DESC, last_failed_at DESC
  `);

  const nowIso = () => (dayjs ? dayjs().toISOString() : new Date().toISOString());

  async function deliverJob(job) {
    const data = job?.data || {};
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (!url) throw new Error('Webhook sem URL definido.');
    const method = typeof data.method === 'string' && data.method.trim()
      ? data.method.trim().toUpperCase()
      : 'POST';
    const headers = normalizeHeaders(data.headers);
    let bodyPayload = data.body;
    if (bodyPayload === undefined) {
      bodyPayload = data.payload ?? {};
    }

    let serializedBody = '';
    if (Buffer.isBuffer(bodyPayload)) {
      serializedBody = bodyPayload;
    } else if (typeof bodyPayload === 'string') {
      serializedBody = bodyPayload;
    } else if (bodyPayload == null) {
      serializedBody = '';
    } else {
      serializedBody = JSON.stringify(bodyPayload);
      ensureHeader(headers, 'Content-Type', 'application/json');
    }

    if (!Buffer.isBuffer(serializedBody) && serializedBody) {
      ensureHeader(headers, 'Content-Length', Buffer.byteLength(serializedBody).toString());
    }

    const timeoutMs = Number.isFinite(data.timeoutMs) && data.timeoutMs > 0 ? data.timeoutMs : 8000;
    const response = await sendWebhookRequest({
      url,
      method,
      headers,
      body: serializedBody,
      timeoutMs,
    });

    telemetry?.emit('webhook.delivered', {
      meta: {
        url,
        method,
        statusCode: response.statusCode,
        deliveryId: data.deliveryId || job.id,
      },
    });

    return {
      statusCode: response.statusCode,
      body: response.body,
    };
  }

  const worker = workerFactory(queueName, deliverJob, { concurrency: 3 });

  if (worker && typeof worker.on === 'function') {
    worker.on('error', err => {
      if (log && typeof log.error === 'function') {
        log.error('Worker de webhooks encontrou um erro', err);
      } else {
        console.error('Worker de webhooks encontrou um erro', err);
      }
    });

    worker.on('failed', (job, err) => {
      if (!job) return;
      const maxAttempts = job.opts && Number.isFinite(job.opts.attempts) ? job.opts.attempts : 1;
      if (job.attemptsMade < maxAttempts) {
        return;
      }
      const timestamp = nowIso();
      const record = {
        delivery_id: job.data?.deliveryId || job.id,
        job_id: job.id,
        queue_name: queueName,
        url: job.data?.url || '',
        method: job.data?.method || 'POST',
        headers_json: safeJsonStringify(job.data?.headers || {}),
        body_json: safeJsonStringify(job.data?.body ?? job.data?.payload ?? null),
        context_json: safeJsonStringify(job.data?.context ?? {}),
        source: job.data?.source ?? null,
        attempts_made: job.attemptsMade || 0,
        max_attempts: maxAttempts,
        error_message: err && err.message ? err.message : String(err),
        timestamp,
      };
      try {
        upsertDeadLetterStmt.run(record);
      } catch (dbErr) {
        console.error('Falha ao guardar dead-letter de webhook:', dbErr.message);
      }
      telemetry?.emit('webhook.dead_letter', {
        success: false,
        meta: {
          url: record.url,
          method: record.method,
          error: record.error_message,
          deliveryId: record.delivery_id,
          attempts: record.attempts_made,
        },
      });
    });
  }

  async function enqueue(payload = {}, jobOptions = {}) {
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) {
      throw new Error('Webhook sem URL.');
    }
    const deliveryId = payload.deliveryId || randomUUID();
    const method = typeof payload.method === 'string' && payload.method.trim()
      ? payload.method.trim().toUpperCase()
      : 'POST';
    const headers = normalizeHeaders(payload.headers);
    const body = payload.body !== undefined ? payload.body : payload.payload ?? null;
    const timeoutMs = Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0 ? payload.timeoutMs : 8000;
    const context = payload.context && typeof payload.context === 'object' ? payload.context : {};

    const defaultOptions = {
      removeOnComplete: { age: 60 * 60, count: 500 },
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    };

    const job = await queue.add(payload.name || 'deliver-webhook', {
      deliveryId,
      url,
      method,
      headers,
      body,
      timeoutMs,
      context,
      source: payload.source || null,
      queuedAt: nowIso(),
    }, {
      ...defaultOptions,
      ...jobOptions,
    });

    return { jobId: job.id, deliveryId };
  }

  function listDeadLetters() {
    return listDeadLettersStmt.all().map(row => ({
      deliveryId: row.delivery_id,
      jobId: row.job_id,
      url: row.url,
      method: row.method,
      error: row.error_message,
      attemptsMade: row.attempts_made,
      maxAttempts: row.max_attempts,
      firstFailedAt: row.first_failed_at,
      lastFailedAt: row.last_failed_at,
      replayCount: row.replay_count,
      lastReplayedAt: row.last_replayed_at,
      status: row.status,
    }));
  }

  function getDeadLetter(deliveryId) {
    if (!deliveryId) return null;
    const record = getDeadLetterStmt.get(deliveryId);
    return record || null;
  }

  async function replayDeadLetter(deliveryId, jobOptions = {}) {
    const record = getDeadLetter(deliveryId);
    if (!record) {
      throw new Error('Dead-letter de webhook não encontrado.');
    }
    const headers = safeJsonParse(record.headers_json, {});
    const body = safeJsonParse(record.body_json, null);
    const context = safeJsonParse(record.context_json, {});
    const enqueueResult = await enqueue({
      deliveryId: record.delivery_id,
      url: record.url,
      method: record.method,
      headers,
      body,
      timeoutMs: undefined,
      context,
      source: record.source,
    }, {
      attempts: record.max_attempts || 5,
      ...jobOptions,
    });

    markReplayedStmt.run({
      delivery_id: record.delivery_id,
      last_replayed_at: nowIso(),
      last_replayed_job_id: enqueueResult.jobId,
    });

    return enqueueResult;
  }

  async function close() {
    if (worker && typeof worker.close === 'function') {
      await worker.close();
    }
    if (queue && typeof queue.close === 'function') {
      await queue.close();
    }
  }

  return {
    queue,
    worker,
    enqueue,
    listDeadLetters,
    getDeadLetter,
    replayDeadLetter,
    close,
  };
}

module.exports = { createWebhookDeliveryService };
