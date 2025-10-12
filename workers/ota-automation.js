#!/usr/bin/env node

// Evita que o servidor arranque o listener HTTP quando apenas queremos o worker.
process.env.OTA_WORKER_ONLY = '1';
global.__SERVER_STARTED__ = true;

const server = require('../server');

console.log('[OTA Worker] BullMQ pronto. A aguardar eventos...');

function gracefulExit(signal) {
  console.log(`[OTA Worker] Sinal ${signal} recebido, a encerrar...`);
  const closeQueue = async () => {
    try {
      if (server.otaWorker && typeof server.otaWorker.close === 'function') {
        await server.otaWorker.close();
      }
    } catch (err) {
      console.warn('[OTA Worker] Erro ao fechar worker', err.message);
    }
    try {
      if (server.otaQueue && typeof server.otaQueue.close === 'function') {
        await server.otaQueue.close();
      }
    } catch (err) {
      console.warn('[OTA Worker] Erro ao fechar fila', err.message);
    }
    process.exit(0);
  };

  closeQueue().catch(err => {
    console.error('[OTA Worker] Encerramento forçado devido a erro', err);
    process.exit(1);
  });
}

process.once('SIGINT', () => gracefulExit('SIGINT'));
process.once('SIGTERM', () => gracefulExit('SIGTERM'));
