(function (global) {
  if (typeof window === 'undefined') return;

  var PANEL_PREFIX = 'bo-panel-';

  function normalizeInput(input) {
    if (!input) return null;
    if (typeof input === 'string') {
      try {
        return new URL(input, window.location.origin);
      } catch (err) {
        return null;
      }
    }
    if (input instanceof URL) {
      return input;
    }
    return null;
  }

  function routeFromUrl(input) {
    var urlObj = normalizeInput(input);
    if (!urlObj) return null;

    var routes = global.BoRoutes || {};
    var keys = Object.keys(routes);

    for (var i = 0; i < keys.length; i++) {
      var descriptor = routes[keys[i]];
      if (!descriptor || !descriptor.url) continue;
      try {
        var routeUrl = new URL(descriptor.url, window.location.origin);
        if (routeUrl.pathname !== urlObj.pathname) continue;

        var match = true;
        routeUrl.searchParams.forEach(function (value, key) {
          if (urlObj.searchParams.get(key) !== value) {
            match = false;
          }
        });
        if (!match) continue;

        return keys[i];
      } catch (err) {
        // ignore malformed routes
      }
    }

    return null;
  }

  function currentTab() {
    var active = document.querySelector('.bo-tab.is-active');
    return active ? active.getAttribute('data-bo-target') : null;
  }

  function showSubmitting(form) {
    var submit = form.querySelector('button[type="submit"], [type="submit"]');
    if (submit && !submit.hasAttribute('data-bo-submitting')) {
      submit.setAttribute('data-bo-submitting', 'true');
      submit.disabled = true;
      submit.dataset.boSubmitOriginalLabel = submit.innerHTML;
      submit.innerHTML = 'A guardar…';
    }
  }

  function handleLinkClick(event) {
    var anchor = event.target.closest('a');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    var href = anchor.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;

    var url = normalizeInput(anchor.href);
    if (!url) return;
    if (url.origin !== window.location.origin) return;

    var panel = event.target.closest('[id^="' + PANEL_PREFIX + '"]');
    if (!panel) return;

    var target = routeFromUrl(url);
    if (!target) return;

    event.preventDefault();

    var tabsApi = global.BackofficeTabs;
    if (tabsApi && typeof tabsApi.activate === 'function') {
      tabsApi.activate(target, { pushState: true }).catch(function (err) {
        console.error(err);
      });
    } else {
      var loader = global.BackofficePanelLoader;
      if (loader && typeof loader.loadPanel === 'function') {
        loader.loadPanel(target, { pushState: true });
      }
    }
  }

  function followRedirectResponse(response) {
    if (!response || !response.redirected) return Promise.resolve(null);
    return fetch(response.url, {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        Accept: 'text/html'
      }
    }).then(function (res) {
      return res.text();
    });
  }

  function submitForm(event) {
    var form = event.target.closest('form');
    if (!form) return;

    var panel = event.target.closest('[id^="' + PANEL_PREFIX + '"]');
    if (!panel) return;

    event.preventDefault();

    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var actionAttr = form.getAttribute('action');
    var actionUrl = actionAttr ? new URL(actionAttr, window.location.origin) : new URL(window.location.href);
    var target = routeFromUrl(actionUrl) || currentTab();

    showSubmitting(form);

    var fetchOptions = {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        Accept: 'text/html'
      }
    };

    var requestPromise;

    if (method === 'GET') {
      var params = new URLSearchParams(new FormData(form));
      actionUrl.search = params.toString();
      requestPromise = fetch(actionUrl.toString(), fetchOptions);
    } else {
      fetchOptions.method = method;
      fetchOptions.body = new FormData(form);
      requestPromise = fetch(actionUrl.toString(), fetchOptions);
    }

    requestPromise
      .then(function (res) {
        if (!res.ok && !res.redirected) {
          var error = new Error('HTTP ' + res.status);
          error.response = res;
          throw error;
        }
        if (res.redirected) {
          return followRedirectResponse(res).then(function (html) {
            return { html: html, response: res };
          });
        }
        return res.text().then(function (html) {
          return { html: html, response: res };
        });
      })
      .then(function (payload) {
        if (!payload) return;
        var loader = global.BackofficePanelLoader;
        if (!loader || typeof loader.mountFragment !== 'function') return;

        var routes = global.BoRoutes || {};
        var descriptor = (target && routes[target]) || null;
        loader.mountFragment(panel, payload.html, descriptor ? descriptor.selector : null, target);
        if (target) {
          var tabsApi = global.BackofficeTabs;
          if (tabsApi && typeof tabsApi.rememberPanelLoaded === 'function') {
            tabsApi.rememberPanelLoaded(target);
          }
        }
      })
      .catch(function (err) {
        panel.innerHTML =
          '<div class="bo-panel__error"><p>Erro ao submeter.</p><code>' + (err && err.message ? err.message : String(err)) + '</code></div>';
      });
  }

  function wirePanelNavigation(container) {
    if (!container || container.__boInterceptWired) return;
    container.__boInterceptWired = true;

    container.addEventListener('click', handleLinkClick, true);
    container.addEventListener('submit', submitForm, true);
  }

  if (!global.BackofficePanelIntercept) {
    global.BackofficePanelIntercept = {};
  }

  global.BackofficePanelIntercept.routeFromUrl = routeFromUrl;
  global.BackofficePanelIntercept.wirePanelNavigation = wirePanelNavigation;
})(typeof window !== 'undefined' ? window : globalThis);
