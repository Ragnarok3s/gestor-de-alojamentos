const { EventEmitter } = require('events');

const QUEUE_NAME = 'ota:automation';

let Queue;
let Worker;
let QueueEvents;
let bullmqAvailable = false;

try {
  const BullMQ = require('bullmq');
  Queue = BullMQ.Queue;
  Worker = BullMQ.Worker;
  QueueEvents = BullMQ.QueueEvents;
  bullmqAvailable = true;
} catch (err) {
  console.warn(
    'BullMQ não está instalado; a fila OTA será executada em modo de memória. Instale `bullmq` para usar Redis.'
  );

  const queueState = new Map();

  function ensureState(name) {
    if (!queueState.has(name)) {
      queueState.set(name, {
        processors: new Set(),
        jobs: [],
        processing: false,
      });
    }
    return queueState.get(name);
  }

  class InMemoryJob {
    constructor(name, data, opts = {}) {
      this.name = name;
      this.data = data;
      this.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      this.opts = opts || {};
      this.attemptsMade = 0;
    }
  }

  function getMaxAttempts(job) {
    if (!job || !job.opts) return 1;
    const attempts = Number(job.opts.attempts);
    return Number.isFinite(attempts) && attempts > 0 ? attempts : 1;
  }

  function getBackoffDelay(job) {
    if (!job || !job.opts || !job.opts.backoff) return 0;
    const { delay } = job.opts.backoff;
    const parsed = Number(delay);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async function dispatch(name) {
    const state = ensureState(name);
    if (state.processing) return;
    state.processing = true;
    try {
      while (state.jobs.length) {
        const job = state.jobs.shift();
        if (!job) continue;
        const processors = Array.from(state.processors);
        if (!processors.length) {
          // sem workers, volta a enfileirar para futura execução
          state.jobs.unshift(job);
          break;
        }
        const worker = processors[0];
        try {
          await worker._process(job);
        } catch (workerErr) {
          console.error('In-memory BullMQ: erro ao processar job', workerErr);
          if (job.attemptsMade < getMaxAttempts(job)) {
            const delay = getBackoffDelay(job);
            if (delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            state.jobs.push(job);
          }
        }
      }
    } finally {
      state.processing = false;
    }
  }

  class InMemoryQueueEvents extends EventEmitter {
    constructor(name) {
      super();
      this.name = name;
      ensureState(name);
    }

    async close() {
      this.removeAllListeners();
    }
  }

  Queue = class InMemoryQueue {
    constructor(name, _options = {}) {
      this.name = name;
      ensureState(name);
    }

    async add(jobName, data, opts = {}) {
      const state = ensureState(this.name);
      const job = new InMemoryJob(jobName, data, opts);
      state.jobs.push(job);
      dispatch(this.name).catch(err => {
        console.error('In-memory BullMQ: erro ao despachar job', err);
      });
      return job;
    }

    async close() {}
  };

  Worker = class InMemoryWorker extends EventEmitter {
    constructor(name, processor, _options = {}) {
      super();
      this.name = name;
      this.processor = processor;
      this.closed = false;
      const state = ensureState(name);
      state.processors.add(this);
      dispatch(name).catch(err => {
        console.error('In-memory BullMQ: erro ao iniciar processamento', err);
      });
    }

    async _process(job) {
      if (this.closed) return;
      job.attemptsMade = (job.attemptsMade || 0) + 1;
      try {
        await this.processor(job);
        this.emit('completed', job);
      } catch (err) {
        this.emit('failed', job, err);
        throw err;
      }
    }

    async close() {
      this.closed = true;
      ensureState(this.name).processors.delete(this);
      this.removeAllListeners();
    }
  };

  QueueEvents = InMemoryQueueEvents;
}

function resolveRedisUrl() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!process.env.REDIS_URL) {
    console.warn(
      'REDIS_URL não definido; a fila OTA irá assumir redis://127.0.0.1:6379. Configure REDIS_URL em produção.'
    );
  }
  return url;
}

function buildConnectionOptions() {
  return { connection: { url: resolveRedisUrl() } };
}

function createQueue(name, options = {}) {
  return new Queue(name, {
    ...buildConnectionOptions(),
    ...options,
  });
}

function createWorker(name, processor, options = {}) {
  if (typeof processor !== 'function') {
    throw new Error('createWorker requer uma função de processamento.');
  }
  const worker = new Worker(name, processor, {
    ...buildConnectionOptions(),
    ...options,
  });
  if (typeof worker.on === 'function') {
    worker.on('error', err => {
      console.error(`BullMQ worker (${name}): erro de processamento`, err);
    });
  }
  return worker;
}

function createQueueEvents(name, options = {}) {
  if (!QueueEvents) {
    throw new Error('QueueEvents não está disponível sem BullMQ.');
  }
  return new QueueEvents(name, {
    ...buildConnectionOptions(),
    ...options,
  });
}

function createOtaQueue(options = {}) {
  const { defaultJobOptions, ...rest } = options;
  return createQueue(QUEUE_NAME, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1500 },
      removeOnComplete: { age: 60 * 60, count: 500 },
      removeOnFail: { age: 24 * 60 * 60, count: 200 },
      ...defaultJobOptions,
    },
    ...rest,
  });
}

function createOtaWorker(processor, options = {}) {
  return createWorker(QUEUE_NAME, processor, {
    concurrency: 4,
    ...options,
  });
}

function isBullmqAvailable() {
  return bullmqAvailable;
}

module.exports = {
  createOtaQueue,
  createOtaWorker,
  createQueue,
  createWorker,
  createQueueEvents,
  isBullmqAvailable,
  buildConnectionOptions,
};
