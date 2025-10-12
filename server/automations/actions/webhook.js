const { randomUUID } = require('node:crypto');

function getByPath(source, path) {
  if (!source || typeof path !== 'string') return undefined;
  return path
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      if (typeof acc !== 'object') return undefined;
      if (Object.prototype.hasOwnProperty.call(acc, key)) {
        return acc[key];
      }
      return undefined;
    }, source);
}

module.exports = async function webhookAction(action = {}, payload = {}, context = {}) {
  const enqueue = context.enqueueWebhookDelivery;
  if (typeof enqueue !== 'function') {
    throw new Error('Fila de webhooks indisponível.');
  }

  const url = typeof action.url === 'string' ? action.url.trim() : '';
  if (!url) {
    throw new Error('Webhook sem URL configurado.');
  }

  const method = typeof action.method === 'string' && action.method.trim()
    ? action.method.trim().toUpperCase()
    : 'POST';

  const headers = {};
  if (action.headers && typeof action.headers === 'object') {
    Object.entries(action.headers).forEach(([key, value]) => {
      if (!key) return;
      headers[key] = value;
    });
  }

  let body;
  if (action.body !== undefined) {
    if (typeof action.body === 'string' && action.body_path) {
      body = getByPath(payload, action.body_path) ?? action.body;
    } else {
      body = action.body;
    }
  } else if (typeof action.body_path === 'string') {
    body = getByPath(payload, action.body_path);
  } else if (action.include_payload === false) {
    body = {};
  } else {
    body = payload;
  }

  const timeoutMsRaw = action.timeout_ms ?? action.timeoutMs;
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : Number(timeoutMsRaw);
  const jobOptions = {};
  if (action.attempts && Number.isFinite(Number(action.attempts))) {
    jobOptions.attempts = Number(action.attempts);
  }

  const deliveryId = typeof action.delivery_id === 'string' && action.delivery_id.trim()
    ? action.delivery_id.trim()
    : undefined;

  const enqueueResult = await enqueue(
    {
      deliveryId: deliveryId || randomUUID(),
      url,
      method,
      headers,
      body,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
      context: {
        automationId: payload.automationId || context.automation?.id || null,
        trigger: payload.trigger || context.trigger || action.trigger || null,
        actionId: action.id || null,
        actionLabel: action.name || action.label || action.type || null,
        source: context.source || null,
      },
      source: action.source || 'automation',
    },
    jobOptions
  );

  return {
    url,
    method,
    deliveryId: enqueueResult.deliveryId,
    jobId: enqueueResult.jobId,
  };
};
