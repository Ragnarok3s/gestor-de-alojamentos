(function (global) {
  if (typeof window === 'undefined') return;

  var PANEL_PREFIX = 'bo-panel-';
  var FETCH_OPTS = {
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'fetch',
      Accept: 'text/html'
    }
  };

  var pendingLoads = new Map();
  var hasBoundRetry = false;

  function ensureHooks() {
    if (!global.BO) {
      global.BO = {};
    }
    if (typeof global.BO.init !== 'function') {
      global.BO.init = function () {};
    }
    if (typeof global.BO.destroy !== 'function') {
      global.BO.destroy = function () {};
    }
  }

  function getRoute(target) {
    var routes = global.BoRoutes || {};
    return routes[target] || null;
  }

  function panelIdFor(target) {
    return PANEL_PREFIX + target;
  }

  function parseHTML(html, selector, target) {
    var template = document.createElement('template');
    template.innerHTML = html || '';
    var root;
    if (selector) {
      root = template.content.querySelector(selector);
    }
    if (!root && target) {
      root = template.content.querySelector('#' + panelIdFor(target));
    }
    if (!root) {
      root = template.content;
    }
    var fragment = document.createDocumentFragment();
    var child = root.firstChild;
    while (child) {
      fragment.appendChild(child.cloneNode(true));
      child = child.nextSibling;
    }
    return fragment;
  }

  function runScripts(container) {
    var scripts = Array.from(container.querySelectorAll('script'));
    scripts.forEach(function (script) {
      var newScript = document.createElement('script');
      Array.from(script.attributes).forEach(function (attr) {
        newScript.setAttribute(attr.name, attr.value);
      });
      if (script.src) {
        newScript.src = script.src;
      } else {
        newScript.textContent = script.textContent;
      }
      script.parentNode.replaceChild(newScript, script);
    });
  }

  function ensureButtonTypes(container) {
    if (!container) return;
    container.querySelectorAll('button:not([type])').forEach(function (btn) {
      btn.setAttribute('type', 'button');
    });
  }

  function wireRetry() {
    if (hasBoundRetry) return;
    hasBoundRetry = true;
    document.addEventListener('click', function (event) {
      var retry = event.target.closest('.bo-retry');
      if (!retry) return;
      var panel = retry.closest('[id^="' + PANEL_PREFIX + '"]');
      if (!panel) return;
      var target = panel.id.replace(PANEL_PREFIX, '');
      loadPanel(target, { pushState: false, replaceState: false });
    });
  }

  function showLoading(panel) {
    panel.hidden = false;
    panel.setAttribute('aria-busy', 'true');
    panel.classList.add('is-loading');
    panel.innerHTML = '<div class="bo-panel__loading" aria-live="polite">A carregar…</div>';
  }

  function showError(panel, error) {
    panel.hidden = false;
    panel.classList.remove('is-loading');
    panel.removeAttribute('aria-busy');
    var message = error && error.message ? error.message : String(error || 'Erro desconhecido');
    panel.innerHTML =
      '<div class="bo-panel__error"><p>Não foi possível carregar a secção.</p><code>' +
      message.replace(/[<>]/g, function (char) {
        return { '<': '&lt;', '>': '&gt;' }[char] || char;
      }) +
      '</code><button class="bo-retry" type="button">Tentar novamente</button></div>';
  }

  function mountFragment(panel, html, selector, target) {
    ensureHooks();
    var fragment = parseHTML(html, selector, target);
    global.BO.destroy(panel);
    panel.innerHTML = '';
    panel.appendChild(fragment);
    panel.hidden = false;
    ensureButtonTypes(panel);
    runScripts(panel);
    global.BO.init(panel);
    var intercept = global.BackofficePanelIntercept;
    if (intercept && typeof intercept.wirePanelNavigation === 'function') {
      intercept.wirePanelNavigation(panel);
    }
    panel.classList.remove('is-loading');
    panel.removeAttribute('aria-busy');
    panel.dataset.boPanelLoaded = 'true';
    wireRetry();
  }

  function fetchHtml(url) {
    return fetch(url, FETCH_OPTS).then(function (res) {
      if (res.redirected) {
        return fetch(res.url, FETCH_OPTS).then(function (follow) {
          if (!follow.ok) throw new Error('HTTP ' + follow.status);
          return follow.text();
        });
      }
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      return res.text();
    });
  }

  function updateHistory(target, pushState, replaceState) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('tab', target);
      var state = { tab: target };
      if (replaceState) {
        window.history.replaceState(state, '', url);
      } else if (pushState) {
        window.history.pushState(state, '', url);
      }
    } catch (err) {
      // ignore history errors
    }
  }

  function loadPanel(target, options) {
    options = options || {};
    var pushState = options.pushState !== false;
    var replaceState = !!options.replaceState;
    var forceReload = !!options.forceReload;

    if (!target) {
      return Promise.resolve();
    }

    var route = getRoute(target);
    if (!route || !route.url) {
      updateHistory(target, pushState, replaceState);
      return Promise.resolve();
    }

    var panelId = panelIdFor(target);
    var panel = document.getElementById(panelId);
    if (!panel) {
      throw new Error('Painel inexistente: ' + panelId);
    }

    if (!forceReload && panel.dataset.boPanelLoaded === 'true') {
      updateHistory(target, pushState, replaceState);
      panel.hidden = false;
      panel.classList.add('is-active');
      return Promise.resolve();
    }

    if (pendingLoads.has(target)) {
      return pendingLoads.get(target);
    }

    showLoading(panel);

    var request = fetchHtml(route.url)
      .then(function (html) {
        mountFragment(panel, html, route.selector, target);
        updateHistory(target, pushState, replaceState);
        return panel;
      })
      .catch(function (err) {
        showError(panel, err);
        if (pushState || replaceState) {
          updateHistory(target, false, false);
        }
        throw err;
      })
      .finally(function () {
        pendingLoads.delete(target);
      });

    pendingLoads.set(target, request);
    return request;
  }

  if (!global.BackofficePanelLoader) {
    global.BackofficePanelLoader = {};
  }

  global.BackofficePanelLoader.loadPanel = loadPanel;
  global.BackofficePanelLoader.mountFragment = mountFragment;
})(typeof window !== 'undefined' ? window : globalThis);
