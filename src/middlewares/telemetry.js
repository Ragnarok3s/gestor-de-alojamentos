const { isFeatureEnabled } = require('../../config/featureFlags');

function serverRender(tag) {
  if (!isFeatureEnabled('FEATURE_TELEMETRY_LINKS')) return;
  if (typeof tag !== 'string' || !tag.trim()) return;
  console.info('[telemetry:render]', tag.trim());
}

module.exports = {
  serverRender
};
