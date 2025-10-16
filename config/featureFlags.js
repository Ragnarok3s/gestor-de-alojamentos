const DEFAULT_FLAGS = {
  FEATURE_CALENDAR_UNIT_CARD_MODAL: true,
  FEATURE_NAV_EXPORT_SHORTCUTS: true,
  FEATURE_NAV_SECURITY_LINK: true,
  FEATURE_NAV_AUDIT_LINKS: true,
  FEATURE_ALIAS_ACCOUNT_SECURITY_REDIRECT: true,
  FEATURE_META_NOINDEX_BACKOFFICE: true,
  FEATURE_BREADCRUMBS: true,
  FEATURE_SIGNED_EXPORT_DOWNLOAD: true,
  FEATURE_EXPORT_RATE_LIMIT: true,
  FEATURE_BACKOFF_2FA: true
};

function parseFlag(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return !!defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'on', 'yes'].includes(normalized)) {
    return true;
  }
  return !!defaultValue;
}

const featureFlags = Object.fromEntries(
  Object.entries(DEFAULT_FLAGS).map(([key, defaultValue]) => [
    key,
    parseFlag(process.env[key], defaultValue)
  ])
);

function isFeatureEnabled(flagName) {
  if (Object.prototype.hasOwnProperty.call(featureFlags, flagName)) {
    return !!featureFlags[flagName];
  }
  return false;
}

module.exports = {
  featureFlags,
  isFeatureEnabled
};
