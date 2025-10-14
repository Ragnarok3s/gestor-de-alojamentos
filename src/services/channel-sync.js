function createChannelSync({ logger = console } = {}) {
  const queue = [];
  let draining = false;

  function flush() {
    const batch = queue.splice(0, queue.length);
    draining = false;
    if (!batch.length) return;
    if (logger && typeof logger.info === 'function') {
      batch.forEach(item => {
        logger.info('[channel-sync] lock preparado', item);
      });
    }
  }

  function schedule() {
    if (draining) return;
    draining = true;
    setImmediate(flush);
  }

  function queueLock(payload) {
    if (!payload || typeof payload !== 'object') return;
    const normalized = {
      unitId: payload.unitId,
      from: payload.from,
      to: payload.to,
      bookingId: payload.bookingId,
      source: payload.source,
      updated: !!payload.updated,
      enqueuedAt: new Date().toISOString()
    };
    queue.push(normalized);
    schedule();
  }

  return {
    queueLock
  };
}

module.exports = {
  createChannelSync
};
