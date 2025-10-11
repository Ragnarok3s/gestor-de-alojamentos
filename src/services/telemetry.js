'use strict';

function createTelemetry({ logger = console, now = () => Date.now() } = {}) {
  const log = typeof logger?.info === 'function'
    ? logger.info.bind(logger)
    : typeof logger?.log === 'function'
      ? logger.log.bind(logger)
      : console.log.bind(console);

  function emit(eventName, payload = {}) {
    if (!eventName) {
      return;
    }
    const timestamp = payload.timestamp || new Date(now()).toISOString();
    const normalized = {
      event: eventName,
      userId: payload.userId ?? null,
      propertyId: payload.propertyId ?? null,
      timestamp,
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
      success: payload.success !== undefined ? Boolean(payload.success) : true,
      meta: payload.meta ?? {}
    };

    try {
      const serialized = JSON.stringify(normalized);
      log(`[telemetry] ${serialized}`);
    } catch (err) {
      try {
        log(`[telemetry] ${eventName} ${timestamp}`);
      } catch (_) {
        // ignore secondary logging errors
      }
    }
  }

  return { emit };
}

module.exports = { createTelemetry };
