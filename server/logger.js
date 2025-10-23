const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function serializeMeta(meta = {}) {
  const payload = { ...meta };
  if (payload.error instanceof Error) {
    payload.error = payload.error.message;
  }
  return Object.keys(payload).length ? JSON.stringify(payload) : '';
}

function formatLine(level, message, meta = {}) {
  const ctx = storage.getStore() || {};
  const requestId = meta.requestId || ctx.requestId;
  const safeMessage = typeof message === 'string' ? message : JSON.stringify(message);
  const parts = [new Date().toISOString(), level.toUpperCase()];
  if (requestId) {
    parts.push(`request:${requestId}`);
  }
  const metaString = serializeMeta({ ...meta, requestId: undefined });
  const suffix = metaString ? ` ${metaString}` : '';
  return `[${parts.join('] [')}] ${safeMessage}${suffix}`;
}

function write(stream, line) {
  stream.write(line + '\n');
}

function log(level, message, meta = {}) {
  const stream = level === 'error' ? process.stderr : process.stdout;
  write(stream, formatLine(level, message, meta));
  if (meta && meta.error instanceof Error) {
    write(process.stderr, meta.error.stack || meta.error.message || String(meta.error));
  }
}

function info(message, meta) {
  log('info', message, meta);
}

function warn(message, meta) {
  log('warn', message, meta);
}

function error(message, meta) {
  log('error', message, meta);
}

function runWithContext(context, callback) {
  return storage.run(context || {}, callback);
}

function getContext() {
  return storage.getStore() || {};
}

function bindConsole() {
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  console.log = (...args) => info(args.join(' '));
  console.warn = (...args) => warn(args.join(' '));
  console.error = (...args) => {
    if (args.length === 1 && args[0] instanceof Error) {
      error(args[0].message, { error: args[0] });
    } else {
      error(args.join(' '));
    }
  };

  return original;
}

module.exports = {
  info,
  warn,
  error,
  log,
  bindConsole,
  runWithContext,
  getContext
};
