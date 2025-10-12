const QUEUE_NAME = 'ota:automation';

let Queue;
let Worker;

try {
  const BullMQ = require('bullmq');
  Queue = BullMQ.Queue;
  Worker = BullMQ.Worker;
} catch (err) {
  console.warn(
    'BullMQ não está instalado; a fila OTA será executada em modo de memória. Instale `bullmq` para usar Redis.'
  );

  const queueState = new Map();

  function ensureState(name) {
    if (!queueState.has(name)) {
      queueState.set(name, { processors: new Set(), jobs: [], processing: false });
    }
    return queueState.get(name);
  }

  class InMemoryJob {
    constructor(name, data) {
      this.name = name;
      this.data = data;
      this.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  async function dispatch(name) {
    const state = ensureState(name);
    if (state.processing) return;
    state.processing = true;
    try {
      while (state.jobs.length) {
        const job = state.jobs.shift();
        const processors = Array.from(state.processors);
        for (const worker of processors) {
          try {
            await worker._process(job);
          } catch (workerErr) {
            console.error('In-memory BullMQ: erro ao processar job', workerErr);
          }
        }
      }
    } finally {
      state.processing = false;
    }
  }

  Queue = class InMemoryQueue {
    constructor(name, _options = {}) {
      this.name = name;
      ensureState(name);
    }

    async add(jobName, data) {
      const state = ensureState(this.name);
      const job = new InMemoryJob(jobName, data);
      state.jobs.push(job);
      dispatch(this.name).catch(err => {
        console.error('In-memory BullMQ: erro ao despachar job', err);
      });
      return job;
    }

    async close() {}
  };

  Worker = class InMemoryWorker {
    constructor(name, processor, _options = {}) {
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
      await this.processor(job);
    }

    on() {}

    async close() {
      this.closed = true;
      ensureState(this.name).processors.delete(this);
    }
  };
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

function createOtaQueue(options = {}) {
  const { defaultJobOptions, ...rest } = options;
  return new Queue(QUEUE_NAME, {
    ...buildConnectionOptions(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1500 },
      removeOnComplete: { age: 60 * 60, count: 500 },
      removeOnFail: { age: 24 * 60 * 60, count: 200 },
      ...defaultJobOptions
    },
    ...rest
  });
}

function createOtaWorker(processor, options = {}) {
  if (typeof processor !== 'function') {
    throw new Error('createOtaWorker requer uma função de processamento.');
  }
  const worker = new Worker(QUEUE_NAME, processor, {
    concurrency: 4,
    ...buildConnectionOptions(),
    ...options
  });
  worker.on('error', err => {
    console.error('BullMQ OTA worker: erro de processamento', err);
  });
  return worker;
}

module.exports = {
  createOtaQueue,
  createOtaWorker,
};
