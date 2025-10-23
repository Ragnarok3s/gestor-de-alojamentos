const logger = require('../logger');

function resolveStatus(err) {
  if (!err) return 500;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (typeof err.code === 'number') return err.code;
  return 500;
}

function wantsJson(req) {
  if (!req) return false;
  if (req.xhr) return true;
  if (req.headers && req.headers.accept && req.headers.accept.includes('application/json')) {
    return true;
  }
  if (typeof req.accepts === 'function') {
    const accepted = req.accepts(['json', 'html']);
    if (accepted === 'json') return true;
  }
  const url = req.originalUrl || req.url || '';
  return url.startsWith('/api/');
}

function createErrorHandler({ layout, logger: providedLogger } = {}) {
  const log = providedLogger || logger;

  return function errorHandler(err, req, res, next) {
    const status = resolveStatus(err);
    const safeStatus = Number.isInteger(status) && status >= 400 ? status : 500;
    const requestId = (res && res.locals && res.locals.requestId) || req.requestId;
    const errorMessage = err && err.message ? err.message : 'Erro inesperado';

    log.error(errorMessage, {
      requestId,
      status: safeStatus,
      method: req.method,
      path: req.originalUrl,
      error: err
    });

    if (res.headersSent) {
      return next(err);
    }

    const shouldRespondJson = wantsJson(req);
    const payload = {
      error: safeStatus >= 500 ? 'internal_error' : 'request_error',
      message: safeStatus >= 500 ? 'Ocorreu um erro ao processar o pedido.' : errorMessage,
      requestId
    };

    if (shouldRespondJson) {
      return res.status(safeStatus).json(payload);
    }

    const requestIdHtml = requestId
      ? `<p class="text-sm text-slate-500">Código de referência: <code>${requestId}</code></p>`
      : '';
    const fallbackBody = `
      <h1 class="text-xl font-semibold">Erro ${safeStatus}</h1>
      <p>Ocorreu um problema ao processar o seu pedido.</p>
      ${requestIdHtml}
    `;

    if (typeof layout === 'function') {
      return res.status(safeStatus).send(
        layout({
          title: `Erro ${safeStatus}`,
          body: fallbackBody,
          requestId
        })
      );
    }

    return res
      .status(safeStatus)
      .type('text/html')
      .send(`<!doctype html><html><body>${fallbackBody}</body></html>`);
  };
}

module.exports = { createErrorHandler };
