(function () {
  var featureEnabled = typeof window !== 'undefined' && window.__FEATURE_TELEMETRY_LINKS__ !== false;
  if (!featureEnabled) {
    return;
  }

  var endpoint = '/internal/telemetry/click';
  var referrerCache = null;

  function currentReferrer() {
    if (referrerCache) return referrerCache;
    var path = window.location.pathname || '/';
    var search = window.location.search || '';
    referrerCache = path + search;
    return referrerCache;
  }

  function sanitizeRoute(value) {
    if (typeof value !== 'string') return '';
    try {
      var url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) {
        return '';
      }
      return url.pathname + url.search;
    } catch (_) {
      if (value.startsWith('/')) {
        return value;
      }
      return '';
    }
  }

  function postTelemetry(route, referrer) {
    var payload = {
      route: sanitizeRoute(route),
      referrer: typeof referrer === 'string' && referrer ? referrer : currentReferrer()
    };

    if (!payload.route) {
      return;
    }

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () {
        /* ignore network errors */
      });
    } catch (err) {
      /* ignore errors */
    }
  }

  function handleAnchorClick(event) {
    var anchor = event.target.closest('a');
    if (!anchor) return;
    var href = anchor.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(href) && !href.startsWith(window.location.origin)) {
      return;
    }
    postTelemetry(href, currentReferrer());
  }

  if (document && document.addEventListener) {
    document.addEventListener('click', handleAnchorClick, true);
  }

  window.__telemetry = window.__telemetry || {};
  window.__telemetry.track = function (options) {
    if (!options || !options.route) return;
    postTelemetry(options.route, options.referrer);
  };
})();
