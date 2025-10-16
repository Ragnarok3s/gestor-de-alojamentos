const { isFeatureEnabled } = require('../../../config/featureFlags');

function createGuardList(requireLogin) {
  if (typeof requireLogin === 'function') {
    return [requireLogin];
  }
  return [];
}

module.exports = function registerInternalTelemetry(app, context) {
  const { requireLogin } = context || {};
  const guards = createGuardList(requireLogin);

  const handlers = [
    ...guards,
    (req, res) => {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      if (!isFeatureEnabled('FEATURE_TELEMETRY_LINKS')) {
        return res.status(204).end();
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const route = typeof body.route === 'string' ? body.route : '';
      const referrer = typeof body.referrer === 'string' ? body.referrer : '';

      try {
        console.info('[telemetry:click]', {
          route,
          referrer,
          ts: Date.now()
        });
      } catch (err) {
        console.warn('telemetry logging failed', err);
      }

      return res.status(204).end();
    }
  ];

  app.post('/internal/telemetry/click', ...handlers);
};
