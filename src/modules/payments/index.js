const express = require('express');
const { isKnownError, ValidationError } = require('../../services/errors');

function requirePaymentService(context) {
  if (!context || !context.paymentService) {
    throw new Error('Serviço de pagamentos não configurado.');
  }
  return context.paymentService;
}

module.exports = function registerPaymentsModule(app, context) {
  let paymentService;
  try {
    paymentService = requirePaymentService(context);
  } catch (err) {
    console.warn('[payments] módulo desativado:', err.message);
    return;
  }

  const router = express.Router();

  router.post('/collect', async (req, res) => {
    try {
      const payload = req.body || {};
      const result = await paymentService.collect(payload);
      return res.json({
        ok: true,
        payment: result.payment,
        requiresAction: result.requiresAction,
        nextAction: result.nextAction,
        clientSecret: result.clientSecret,
        status: result.status
      });
    } catch (err) {
      if (isKnownError(err)) {
        const details = err.details || null;
        return res.status(err.status).json({ ok: false, error: err.message, details });
      }
      console.error('[payments] erro inesperado ao coletar pagamento', err);
      return res.status(500).json({ ok: false, error: 'Falha inesperada ao processar o pagamento.' });
    }
  });

  router.post('/webhook', async (req, res) => {
    try {
      const provider =
        (req.query && req.query.provider) ||
        req.get('x-payments-provider') ||
        (req.body && (req.body.provider || req.body.adapter || req.body.method));
      if (!provider) {
        throw new ValidationError('Fornecedor do webhook obrigatório.');
      }
      const result = await paymentService.handleWebhook(provider, req.body || {}, { headers: req.headers || {} });
      return res.json({ ok: true, result });
    } catch (err) {
      if (isKnownError(err)) {
        const details = err.details || null;
        return res.status(err.status).json({ ok: false, error: err.message, details });
      }
      console.error('[payments] erro inesperado ao processar webhook', err);
      return res.status(500).json({ ok: false, error: 'Falha inesperada ao processar webhook de pagamento.' });
    }
  });

  app.use('/api/payments', router);
};
