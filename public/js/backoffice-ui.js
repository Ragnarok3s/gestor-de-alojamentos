(function () {
  var THEME_KEY = 'ga.theme';
  var SEARCH_ENDPOINT = '/admin/search';
  var NOTIFICATIONS_ENDPOINT = '/admin/notifications';
  var NOTIFICATIONS_READ_ENDPOINT = '/admin/notifications/read';
  var NOTIFICATIONS_POLL_MS = 60000;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function applyTheme(theme, persist) {
    var doc = document.documentElement;
    var body = document.body;
    if (!doc) return;
    var target = theme === 'theme-dark' ? 'theme-dark' : 'theme-light';
    ['theme-light', 'theme-dark'].forEach(function (cls) {
      doc.classList.remove(cls);
      if (body) body.classList.remove(cls);
    });
    doc.classList.add(target);
    doc.setAttribute('data-theme', target);
    if (body) {
      body.classList.add(target);
      body.classList.add('theme-transition');
    }
    if (persist && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(THEME_KEY, target);
      } catch (err) {
        // ignore storage errors
      }
    }
  }

  function resolveStoredTheme() {
    try {
      var stored = window.localStorage ? window.localStorage.getItem(THEME_KEY) : '';
      if (stored === 'theme-dark' || stored === 'theme-light') {
        return stored;
      }
    } catch (err) {
      // ignore
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'theme-dark';
    }
    return 'theme-light';
  }

  function initThemeToggle() {
    var toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle) return;
    var label = toggle.querySelector('[data-theme-toggle-label]');
    var icon = toggle.querySelector('[data-theme-toggle-icon]');
    var current = (document.documentElement.getAttribute('data-theme') || '').toLowerCase();
    if (current !== 'theme-dark' && current !== 'theme-light') {
      current = resolveStoredTheme();
      applyTheme(current, false);
    }
    updateToggle(current);

    toggle.addEventListener('click', function () {
      current = current === 'theme-dark' ? 'theme-light' : 'theme-dark';
      applyTheme(current, true);
      updateToggle(current);
    });

    function updateToggle(theme) {
      var isDark = theme === 'theme-dark';
      toggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      if (label) {
        label.textContent = isDark ? 'Modo claro' : 'Modo escuro';
      }
      if (icon) {
        renderIcon(icon, isDark ? 'sun' : 'moon', isDark ? '☀' : '☾');
      }
    }
  }

  function initThemeSettings() {
    var manager = window.ThemeManager;
    if (!manager) return;
    var root = document.querySelector('[data-theme-settings]');
    if (!root) return;
    var form = root.querySelector('[data-theme-settings-form]');
    if (!form) return;
    var inputs = form.querySelectorAll('[data-theme-input]');
    var preview = root.querySelector('[data-theme-preview]');
    var applyButton = root.querySelector('[data-theme-apply]');
    var resetButton = root.querySelector('[data-theme-reset]');
    var pendingOverrides = Object.assign({}, manager.getOverrides());

    function normalizeHex(value) {
      if (typeof value !== 'string') return null;
      var match = value.trim().match(/^#?([0-9a-f]{6})$/i);
      return match ? ('#' + match[1].toLowerCase()) : null;
    }

    function hexToRgba(hex, alpha) {
      var normalized = normalizeHex(hex);
      if (!normalized) {
        return 'rgba(0, 0, 0, ' + (Number(alpha) || 0) + ')';
      }
      var value = normalized.slice(1);
      var r = parseInt(value.slice(0, 2), 16);
      var g = parseInt(value.slice(2, 4), 16);
      var b = parseInt(value.slice(4, 6), 16);
      var a = Math.max(0, Math.min(1, Number(alpha) || 0));
      return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
    }

    function updatePreview(theme) {
      if (!preview || !theme) return;
      preview.style.setProperty('--preview-primary', theme.primary || '#FF8C42');
      preview.style.setProperty('--preview-primary-contrast', theme.textOnPrimary || '#ffffff');
      preview.style.setProperty('--preview-surface', theme.surface || '#FFDBA0');
      preview.style.setProperty('--preview-surface-border', hexToRgba(theme.primary || '#FF8C42', 0.2));
      preview.style.setProperty('--preview-text', theme.textPrimary || '#2B2B2B');
    }

    function updateInputs(theme) {
      if (!theme) return;
      inputs.forEach(function (input) {
        var key = input.getAttribute('data-theme-input');
        if (!key) return;
        var value = theme[key];
        if (typeof value === 'string' && value) {
          input.value = value;
        }
      });
    }

    var initialTheme = manager.getTheme();
    updateInputs(initialTheme);
    updatePreview(initialTheme);

    var unsubscribe = manager.subscribe(function (theme) {
      updatePreview(theme);
    });

    function schedulePreview() {
      manager.replace(pendingOverrides, { persist: false });
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', function () {
        var key = input.getAttribute('data-theme-input');
        if (!key) return;
        var value = normalizeHex(input.value) || input.value;
        pendingOverrides[key] = value;
        schedulePreview();
      });
    });

    if (applyButton) {
      applyButton.addEventListener('click', function () {
        manager.replace(pendingOverrides || {}, { persist: true });
        pendingOverrides = Object.assign({}, manager.getOverrides());
        updateInputs(manager.getTheme());
      });
    }

    if (resetButton) {
      resetButton.addEventListener('click', function () {
        manager.reset();
        pendingOverrides = {};
        var theme = manager.getTheme();
        updateInputs(theme);
        updatePreview(theme);
      });
    }

    root.addEventListener('submit', function (event) {
      event.preventDefault();
    });

    root.addEventListener('theme:dispose', function () {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  function initGlobalSearch() {
    var root = document.querySelector('[data-global-search]');
    if (!root) return;
    var input = root.querySelector('[data-global-search-input]');
    var results = root.querySelector('[data-global-search-results]');
    var clearButton = root.querySelector('[data-global-search-clear]');
    var spinner = root.querySelector('[data-global-search-spinner]');
    var controller = null;
    var lastQuery = '';
    var activeIndex = -1;
    var items = [];

    function setLoading(state) {
      if (state) {
        root.setAttribute('data-loading-state', 'loading');
        if (spinner) spinner.hidden = false;
      } else {
        root.setAttribute('data-loading-state', 'idle');
        if (spinner) spinner.hidden = true;
      }
    }

    function hideResults() {
      if (results) {
        results.hidden = true;
        results.innerHTML = '';
        results.removeAttribute('aria-expanded');
      }
      activeIndex = -1;
      items = [];
    }

    function renderEmpty(message) {
      if (!results) return;
      results.innerHTML = '<p class="nav-search__empty">' + (message || 'Sem resultados') + '</p>';
      results.hidden = false;
      results.setAttribute('aria-expanded', 'true');
      items = [];
      activeIndex = -1;
      syncIcons(results);
    }

    function renderResults(payload) {
      if (!results) return;
      if (!payload || !Array.isArray(payload.groups) || !payload.groups.length) {
        renderEmpty(payload && payload.query ? 'Sem resultados para "' + escapeHtml(payload.query) + '"' : 'Sem resultados');
        return;
      }
      var html = payload.groups
        .map(function (group, groupIndex) {
          if (!group || !Array.isArray(group.items) || !group.items.length) return '';
          var title = group.label || group.type || 'Resultados';
          var itemsHtml = group.items
            .map(function (item, itemIndex) {
              var key = groupIndex + '-' + itemIndex;
              var icon = item.icon ? '<span class="nav-search__icon" aria-hidden="true"><i data-lucide="' + item.icon + '"></i></span>' : '';
              var subtitle = item.subtitle ? '<span class="nav-search__item-subtitle">' + escapeHtml(item.subtitle) + '</span>' : '';
              var meta = item.meta ? '<span class="nav-search__item-subtitle">' + escapeHtml(item.meta) + '</span>' : '';
              var badge = item.badge ? '<span class="nav-search__item-subtitle">' + escapeHtml(item.badge) + '</span>' : '';
              var href = item.href || '#';
              var content = '<span class="nav-search__item-title">' + escapeHtml(item.title || href) + '</span>' + subtitle + meta + badge;
              return '<li class="nav-search__item" role="presentation">' +
                '<a class="nav-search__item-link" data-search-result role="option" data-result-index="' + key + '" tabindex="-1" href="' + escapeAttr(href) + '">' +
                icon + content +
                '</a>' +
                '</li>';
            })
            .join('');
          return '<div class="nav-search__group" role="group" aria-label="' + escapeAttr(title) + '">' +
            '<span class="nav-search__group-title">' + escapeHtml(title) + '</span>' +
            '<ul class="nav-search__items">' + itemsHtml + '</ul>' +
            '</div>';
        })
        .filter(Boolean)
        .join('');
      if (!html) {
        renderEmpty('Sem resultados');
        return;
      }
      results.innerHTML = html;
      results.hidden = false;
      results.setAttribute('aria-expanded', 'true');
      items = Array.prototype.slice.call(results.querySelectorAll('[data-search-result]'));
      activeIndex = -1;
      syncIcons(results);
    }

    function fetchResults(query) {
      if (!query || query.length < 2) {
        hideResults();
        setLoading(false);
        return;
      }
      if (controller) {
        controller.abort();
      }
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      setLoading(true);
      var url = SEARCH_ENDPOINT + '?q=' + encodeURIComponent(query);
      var options = { headers: { Accept: 'application/json' } };
      if (controller) {
        options.signal = controller.signal;
      }
      fetch(url, options)
        .then(function (response) {
          if (!response.ok) {
            throw new Error('search_failed');
          }
          return response.json();
        })
        .then(function (payload) {
          renderResults(payload || {});
        })
        .catch(function (error) {
          if (error.name === 'AbortError') return;
          renderEmpty('Não foi possível carregar resultados.');
        })
        .finally(function () {
          setLoading(false);
        });
    }

    function onInput(event) {
      var value = event.target.value.trim();
      lastQuery = value;
      if (clearButton) {
        clearButton.hidden = value.length === 0;
      }
      fetchResults(value);
    }

    function onFocus() {
      if (items.length && results) {
        results.hidden = false;
        results.setAttribute('aria-expanded', 'true');
      }
    }

    function onBlur(event) {
      var related = event.relatedTarget;
      if (related && results && results.contains(related)) return;
      hideResults();
    }

    function onClear(event) {
      event.preventDefault();
      if (!input) return;
      input.value = '';
      input.focus();
      clearButton.hidden = true;
      hideResults();
    }

    function moveSelection(offset) {
      if (!items.length) return;
      activeIndex += offset;
      if (activeIndex < 0) activeIndex = items.length - 1;
      if (activeIndex >= items.length) activeIndex = 0;
      var target = items[activeIndex];
      items.forEach(function (el) {
        el.setAttribute('aria-selected', 'false');
      });
      if (target) {
        target.setAttribute('aria-selected', 'true');
        target.focus();
        if (typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    if (input) {
      input.addEventListener('input', debounce(onInput, 250));
      input.addEventListener('focus', onFocus);
      input.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (!items.length) {
            fetchResults(input.value.trim());
          }
          moveSelection(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (!items.length) {
            fetchResults(input.value.trim());
          }
          moveSelection(-1);
        } else if (event.key === 'Escape') {
          hideResults();
          input.blur();
        } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
          items[activeIndex].click();
        }
      });
      input.addEventListener('blur', onBlur);
    }
    if (clearButton) {
      clearButton.addEventListener('click', onClear);
    }
    if (results) {
      results.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          hideResults();
          if (input) input.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
        }
      });
      results.addEventListener('click', function (event) {
        var link = event.target.closest('[data-search-result]');
        if (!link) return;
        hideResults();
      });
    }

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) {
        hideResults();
      }
    });

    if (input && input.value) {
      clearButton.hidden = false;
      fetchResults(input.value.trim());
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function renderIcon(target, iconName, fallbackSymbol) {
    if (!target) return;
    var symbol = typeof fallbackSymbol === 'string' ? fallbackSymbol : '';
    target.innerHTML = '';
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      target.innerHTML = '<i data-lucide="' + iconName + '" aria-hidden="true"></i>';
      try {
        window.lucide.createIcons({ root: target });
      } catch (err) {
        // ignore lucide errors
      }
      return;
    }
    var span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.className = 'icon-fallback';
    span.textContent = symbol || (iconName ? iconName.charAt(0).toUpperCase() : '•');
    target.appendChild(span);
  }

  function syncIcons(scope) {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({ root: scope || document });
      } catch (err) {
        // ignore icon errors
      }
      return;
    }
    var root = scope || document;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('i[data-lucide]').forEach(function (node) {
      if (node.getAttribute('data-icon-processed') === 'true') return;
      node.setAttribute('data-icon-processed', 'true');
      var name = node.getAttribute('data-lucide') || '';
      node.textContent = name ? name.charAt(0).toUpperCase() : '•';
      node.setAttribute('aria-hidden', 'true');
    });
  }

  function initNotifications() {
    var root = document.querySelector('[data-notifications]');
    if (!root) return;
    var toggle = root.querySelector('[data-notifications-toggle]');
    var panel = root.querySelector('[data-notifications-panel]');
    var badge = root.querySelector('[data-notifications-badge]');
    var counter = root.querySelector('[data-notifications-counter]');
    var markReadBtn = root.querySelector('[data-notifications-mark-read]');
    var refreshBtn = root.querySelector('[data-notifications-refresh]');
    var list = panel ? panel.querySelector('.nav-notifications__list') : null;
    var unread = Number(root.getAttribute('data-unread') || '0');
    var pollingTimer = null;
    var inFlight = null;
    var readKeys = new Set();

    if (list) {
      list.querySelectorAll('[data-notification-key]').forEach(function (item) {
        if (item.getAttribute('data-notification-read') === 'true') {
          readKeys.add(item.getAttribute('data-notification-key'));
        }
      });
    }

    function setPanelVisibility(open) {
      if (!panel || !toggle) return;
      if (open) {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        panel.focus({ preventScroll: true });
      } else {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    }

    function togglePanel() {
      if (!panel) return;
      var isOpen = panel.hidden === false;
      setPanelVisibility(!isOpen);
      if (!isOpen) {
        fetchNotifications(true);
      }
    }

    function updateBadge() {
      if (!badge) return;
      if (unread > 0) {
        badge.hidden = false;
        badge.textContent = unread;
      } else {
        badge.hidden = true;
      }
      if (counter) {
        counter.textContent = unread;
      }
      if (markReadBtn) {
        if (unread > 0) {
          markReadBtn.disabled = false;
        } else {
          markReadBtn.disabled = true;
        }
      }
      root.setAttribute('data-unread', String(unread));
    }

    function buildNotificationItem(item) {
      if (!item) return '';
      var severity = item.severity ? ' nav-notifications__item--' + item.severity : '';
      var title = escapeHtml(item.title || 'Atualização');
      var message = item.message ? '<div class="nav-notifications__message">' + escapeHtml(item.message) + '</div>' : '';
      var meta = item.meta ? '<div class="nav-notifications__meta">' + escapeHtml(item.meta) + '</div>' : '';
      var keyAttr = item.key ? ' data-notification-key="' + escapeAttr(item.key) + '"' : '';
      var readAttr = item.read ? ' data-notification-read="true"' : '';
      if (item.href) {
        return '<li class="nav-notifications__item' + severity + '"' + keyAttr + readAttr + '>' +
          '<a class="nav-notifications__link" href="' + escapeAttr(item.href) + '">' +
          '<span class="nav-notifications__title">' + title + '</span>' +
          message + meta +
          '</a>' +
          '</li>';
      }
      return '<li class="nav-notifications__item' + severity + '"' + keyAttr + readAttr + '>' +
        '<span class="nav-notifications__title">' + title + '</span>' +
        message + meta +
        '</li>';
    }

    function renderNotifications(payload) {
      if (!panel) return;
      var items = Array.isArray(payload.notifications) ? payload.notifications : [];
      if (!items.length) {
        if (list) {
          list.innerHTML = '';
        }
        if (list) {
          list.innerHTML = '';
        }
        var existingEmpty = panel.querySelector('.nav-notifications__empty');
        if (existingEmpty && existingEmpty.parentNode) {
          existingEmpty.parentNode.removeChild(existingEmpty);
        }
        var empty = document.createElement('p');
        empty.className = 'nav-notifications__empty';
        empty.textContent = 'Sem notificações no momento.';
        var footer = panel.querySelector('.nav-notifications__footer');
        if (footer) {
          panel.insertBefore(empty, footer);
        } else {
          panel.appendChild(empty);
        }
      } else {
        if (!list) {
          list = document.createElement('ul');
          list.className = 'nav-notifications__list';
          panel.insertBefore(list, panel.querySelector('.nav-notifications__footer'));
        }
        list.innerHTML = items.map(buildNotificationItem).join('');
        var emptyMessage = panel.querySelector('.nav-notifications__empty');
        if (emptyMessage && emptyMessage.parentNode) {
          emptyMessage.parentNode.removeChild(emptyMessage);
        }
      }
      readKeys.clear();
      if (list) {
        list.querySelectorAll('[data-notification-key]').forEach(function (item) {
          if (item.getAttribute('data-notification-read') === 'true') {
            readKeys.add(item.getAttribute('data-notification-key'));
          }
        });
      }
      unread = Number(payload.unreadCount || 0);
      updateBadge();
      syncIcons(panel);
    }

    function fetchNotifications(skipIfOpen) {
      if (panel && panel.hidden === false && skipIfOpen) return;
      if (inFlight) {
        inFlight.abort();
      }
      inFlight = typeof AbortController === 'function' ? new AbortController() : null;
      var options = { headers: { Accept: 'application/json' } };
      if (inFlight) options.signal = inFlight.signal;
      fetch(NOTIFICATIONS_ENDPOINT, options)
        .then(function (response) {
          if (!response.ok) throw new Error('notifications_failed');
          return response.json();
        })
        .then(function (payload) {
          renderNotifications(payload || {});
        })
        .catch(function (err) {
          if (err.name === 'AbortError') return;
          // silently ignore errors to avoid noisy UI
        })
        .finally(function () {
          inFlight = null;
        });
    }

    function markAsRead(keys) {
      if (!Array.isArray(keys) || !keys.length) return;
      fetch(NOTIFICATIONS_READ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ keys: keys })
      })
        .then(function (response) {
          if (!response.ok) throw new Error('notifications_mark_failed');
          return response.json();
        })
        .then(function (payload) {
          unread = Number(payload && payload.unread != null ? payload.unread : Math.max(0, unread - keys.length));
          keys.forEach(function (key) {
            readKeys.add(key);
            var el = list ? list.querySelector('[data-notification-key="' + cssEscape(key) + '"]') : null;
            if (el) {
              el.setAttribute('data-notification-read', 'true');
            }
          });
          updateBadge();
        })
        .catch(function () {
          // ignore errors silently
        });
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        togglePanel();
      });
    }

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) {
        setPanelVisibility(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setPanelVisibility(false);
      }
    });

    if (markReadBtn) {
      markReadBtn.addEventListener('click', function () {
        var unreadKeys = [];
        if (list) {
          list.querySelectorAll('[data-notification-key]').forEach(function (item) {
            var key = item.getAttribute('data-notification-key');
            if (key && item.getAttribute('data-notification-read') !== 'true') {
              unreadKeys.push(key);
            }
          });
        }
        if (unreadKeys.length) {
          markAsRead(unreadKeys);
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        fetchNotifications(false);
      });
    }

    pollingTimer = setInterval(function () {
      fetchNotifications(true);
    }, NOTIFICATIONS_POLL_MS);

    updateBadge();
  }

  function initLoadingObserver() {
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (!mutation.target) return;
        if (mutation.attributeName === 'aria-busy') {
          var value = mutation.target.getAttribute('aria-busy');
          mutation.target.setAttribute('data-loading-state', value === 'true' ? 'loading' : 'idle');
        }
      });
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-busy'] });
  }

  ready(function () {
    initThemeToggle();
    initThemeSettings();
    initGlobalSearch();
    initNotifications();
    initLoadingObserver();
    syncIcons(document.body);
  });
})();
