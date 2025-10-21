(() => {
  'use strict';

  function onReady(callback) {
    if (document.readyState !== 'loading') {
      callback();
    } else {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    }
  }

  function getCookie(name) {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const parts = document.cookie.split(';');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i].trim();
      if (!part) continue;
      if (part.startsWith(`${name}=`)) {
        try {
          return decodeURIComponent(part.slice(name.length + 1));
        } catch (err) {
          return part.slice(name.length + 1);
        }
      }
    }
    return '';
  }

  function initShellLoader() {
    const shell = document.querySelector('[data-app-shell]');
    if (!shell) return;
    let completed = false;

    const markComplete = () => {
      if (completed) return;
      completed = true;
      shell.setAttribute('data-loading', 'false');
      const loader = shell.querySelector('.app-shell__loader');
      if (loader) {
        loader.setAttribute('aria-hidden', 'true');
      }
      window.setTimeout(() => {
        shell.removeAttribute('data-loading');
      }, 250);
    };

    if (document.readyState === 'complete') {
      markComplete();
    } else {
      window.addEventListener('load', markComplete, { once: true });
      window.setTimeout(markComplete, 120);
    }
  }
  function initThemeToggle() {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    const labelNode = button.querySelector('[data-theme-toggle-label]');
    const labelLight = button.getAttribute('data-theme-label-light') || 'Light mode';
    const labelDark = button.getAttribute('data-theme-label-dark') || 'Dark mode';
    const storageKey = 'bo.theme';
    const body = document.body;
    let storedPreference = null;

    try {
      storedPreference = window.localStorage ? localStorage.getItem(storageKey) : null;
    } catch (err) {
      storedPreference = null;
    }

    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    const applyTheme = (theme, persist = true) => {
      const nextTheme = theme === 'dark' ? 'dark' : 'light';
      body.classList.remove('theme-light', 'theme-dark');
      body.classList.add(`theme-${nextTheme}`);
      body.setAttribute('data-theme', nextTheme);
      if (labelNode) {
        labelNode.textContent = nextTheme === 'dark' ? labelDark : labelLight;
      }
      button.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
      button.setAttribute('aria-label', nextTheme === 'dark' ? labelLight : labelDark);
      if (persist) {
        try {
          if (window.localStorage) {
            localStorage.setItem(storageKey, nextTheme);
            storedPreference = nextTheme;
          }
        } catch (err) {
          // ignore storage failures
        }
      }
    };

    const initialTheme =
      storedPreference === 'dark' || storedPreference === 'light'
        ? storedPreference
        : mediaQuery && mediaQuery.matches
        ? 'dark'
        : body.classList.contains('theme-dark')
        ? 'dark'
        : 'light';

    applyTheme(initialTheme, false);

    button.addEventListener('click', () => {
      const currentTheme = body.classList.contains('theme-dark') ? 'dark' : 'light';
      const next = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(next, true);
    });

    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', event => {
        if (storedPreference === 'dark' || storedPreference === 'light') return;
        applyTheme(event.matches ? 'dark' : 'light', false);
      });
    }
  }

  function getCurrentLanguage() {
    const html = document.documentElement;
    if (html && html.getAttribute) {
      const lang = html.getAttribute('lang');
      if (lang) {
        return lang.toLowerCase();
      }
    }
    return '';
  }

  function setLanguageCookie(code) {
    if (typeof document === 'undefined') return;
    const encoded = encodeURIComponent(code);
    document.cookie = `lang=${encoded}; path=/; max-age=31536000; SameSite=Lax`;
  }

  function initLanguageSwitcher() {
    const switcher = document.querySelector('[data-language-switcher]');
    if (!switcher) return;

    if (switcher.dataset.languageBound === 'true') return;
    switcher.dataset.languageBound = 'true';

    const resolveCurrentLanguage = () => {
      const fromDataset = switcher.getAttribute('data-current-language');
      if (fromDataset) return fromDataset.toLowerCase();
      return getCurrentLanguage();
    };

    switcher.addEventListener('change', event => {
      const selected = (event.target && event.target.value ? event.target.value : '').trim();
      const current = resolveCurrentLanguage();
      if (!selected || selected.toLowerCase() === current) return;

      setLanguageCookie(selected);

      const localeUrl = `/locales/${encodeURIComponent(selected)}.json`;
      fetch(localeUrl, { cache: 'no-cache', credentials: 'same-origin' })
        .catch(() => {})
        .finally(() => {
          window.location.reload();
        });
    });
  }

  function initGlobalSearch() {
    const root = document.querySelector('[data-global-search]');
    if (!root) return;

    const input = root.querySelector('[data-global-search-input]');
    const results = root.querySelector('[data-global-search-results]');
    const emptyState = root.querySelector('[data-global-search-empty]');
    const minCharacters = 2;
    if (!input || !results) return;

    let debounceHandle = null;
    let abortController = null;
    let lastQuery = '';

    const setLoading = isLoading => {
      if (isLoading) {
        root.setAttribute('data-loading', 'true');
      } else {
        root.removeAttribute('data-loading');
      }
    };

    const closeResults = () => {
      if (abortController && typeof abortController.abort === 'function') {
        abortController.abort();
      }
      abortController = null;
      results.innerHTML = '';
      results.hidden = true;
      if (emptyState) emptyState.hidden = true;
      root.removeAttribute('data-open');
      root.removeAttribute('data-empty');
      input.setAttribute('aria-expanded', 'false');
    };

    const renderGroups = groups => {
      results.innerHTML = '';
      if (!Array.isArray(groups) || groups.length === 0) {
        results.hidden = true;
        if (emptyState) emptyState.hidden = false;
        root.setAttribute('data-empty', 'true');
        root.setAttribute('data-open', 'true');
        input.setAttribute('aria-expanded', 'true');
        return;
      }

      if (emptyState) emptyState.hidden = true;
      root.setAttribute('data-empty', 'false');
      root.setAttribute('data-open', 'true');
      input.setAttribute('aria-expanded', 'true');

      groups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'global-search__group';

        const header = document.createElement('div');
        header.className = 'global-search__group-header';
        if (group && group.icon) {
          const icon = document.createElement('i');
          icon.setAttribute('data-lucide', group.icon);
          icon.className = 'app-icon w-4 h-4';
          icon.setAttribute('aria-hidden', 'true');
          header.appendChild(icon);
        }
        const headerText = document.createElement('span');
        headerText.textContent = (group && group.label) || '';
        header.appendChild(headerText);
        wrapper.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'global-search__list';

        const items = group && Array.isArray(group.results) ? group.results : [];
        items.forEach(item => {
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.className = 'global-search__result';
          link.href = item && item.href ? item.href : '#';
          link.setAttribute('role', 'option');
          link.setAttribute('tabindex', '0');
          if (item && item.id) {
            link.dataset.resultId = String(item.id);
          }
          if (group && group.key) {
            link.dataset.group = String(group.key);
          }

          const title = document.createElement('span');
          title.className = 'global-search__result-title';
          title.textContent = (item && item.title) || '';
          link.appendChild(title);

          if (item && item.description) {
            const description = document.createElement('span');
            description.className = 'global-search__result-meta';
            description.textContent = item.description;
            link.appendChild(description);
          }

          if (item && item.meta) {
            const meta = document.createElement('span');
            meta.className = 'global-search__result-meta';
            meta.textContent = item.meta;
            link.appendChild(meta);
          }

          li.appendChild(link);
          list.appendChild(li);
        });

        wrapper.appendChild(list);
        results.appendChild(wrapper);
      });

      results.hidden = false;
      if (typeof window.refreshIcons === 'function') {
        window.refreshIcons();
      }
    };

    const performSearch = query => {
      if (!query) return;
      if (abortController && typeof abortController.abort === 'function') {
        abortController.abort();
      }
      abortController = typeof AbortController === 'function' ? new AbortController() : null;
      setLoading(true);
      const requestInit = {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      };
      if (abortController) {
        requestInit.signal = abortController.signal;
      }
      fetch(`/admin/search?q=${encodeURIComponent(query)}`, requestInit)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then(payload => {
          if (abortController && abortController.signal && abortController.signal.aborted) return;
          lastQuery = query;
          const groups = payload && Array.isArray(payload.groups) ? payload.groups : [];
          renderGroups(groups);
        })
        .catch(err => {
          if (err && err.name === 'AbortError') return;
          console.warn('Pesquisa global indisponível:', err);
          lastQuery = '';
          renderGroups([]);
        })
        .finally(() => {
          setLoading(false);
          abortController = null;
        });
    };

    input.addEventListener('input', () => {
      const value = input.value || '';
      if (debounceHandle) {
        window.clearTimeout(debounceHandle);
      }
      debounceHandle = window.setTimeout(() => {
        const trimmed = value.trim();
        if (trimmed.length < minCharacters) {
          lastQuery = '';
          closeResults();
          return;
        }
        if (trimmed === lastQuery) {
          return;
        }
        performSearch(trimmed);
      }, 220);
    });

    input.addEventListener('focus', () => {
      if (!results.hidden || root.dataset.empty === 'true') {
        root.setAttribute('data-open', 'true');
        input.setAttribute('aria-expanded', results.hidden ? 'false' : 'true');
      }
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeResults();
        input.blur();
      }
      if (event.key === 'ArrowDown') {
        const first = results.querySelector('.global-search__result');
        if (first && !results.hidden) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    results.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeResults();
        input.focus();
      }
      if (event.key === 'ArrowUp') {
        const items = Array.from(results.querySelectorAll('.global-search__result'));
        if (items.length && event.target === items[0]) {
          event.preventDefault();
          input.focus();
        }
      }
    });

    document.addEventListener('click', event => {
      if (!root.contains(event.target)) {
        closeResults();
      }
    });
  }

  function initNotificationsPanel() {
    const root = document.querySelector('[data-notifications]');
    if (!root || typeof fetch !== 'function') return;

    const list = root.querySelector('[data-notifications-list]');
    const badge = root.querySelector('[data-notifications-count]');
    const counter = root.querySelector('[data-notifications-counter]');
    const emptyState = root.querySelector('[data-notifications-empty]');
    const markAllButton = root.querySelector('[data-notifications-mark-read]');
    const refreshInterval = 60000;
    let pollingHandle = null;
    let isFetching = false;

    const setLoading = isLoading => {
      if (isLoading) {
        root.setAttribute('data-loading', 'true');
      } else {
        root.removeAttribute('data-loading');
      }
    };

    const renderNotifications = payload => {
      const notifications = payload && Array.isArray(payload.notifications) ? payload.notifications : [];
      const unreadCount = Number(payload && payload.unreadCount ? payload.unreadCount : 0);

      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = String(unreadCount);
          badge.removeAttribute('hidden');
        } else {
          badge.textContent = '';
          badge.setAttribute('hidden', '');
        }
      }

      if (counter) {
        counter.textContent = String(unreadCount);
      }

      if (markAllButton) {
        if (unreadCount > 0) {
          markAllButton.removeAttribute('disabled');
        } else {
          markAllButton.setAttribute('disabled', '');
        }
      }

      if (list) {
        list.innerHTML = '';
        notifications.forEach(item => {
          if (!item) return;
          const li = document.createElement('li');
          li.className = 'nav-notifications__item';
          if (item.severity) {
            li.classList.add(`nav-notifications__item--${item.severity}`);
          }
          if (item.read) {
            li.classList.add('is-read');
          }
          if (item.id) {
            li.dataset.notificationId = String(item.id);
          }
          li.dataset.notificationRead = item.read ? 'true' : 'false';

          const title = document.createElement('span');
          title.className = 'nav-notifications__title';
          title.textContent = item.title || '';

          const message = item.message ? document.createElement('div') : null;
          if (message) {
            message.className = 'nav-notifications__message';
            message.textContent = item.message;
          }

          const meta = item.meta ? document.createElement('div') : null;
          if (meta) {
            meta.className = 'nav-notifications__meta';
            meta.textContent = item.meta;
          }

          if (item.href) {
            const link = document.createElement('a');
            link.className = 'nav-notifications__link';
            link.href = item.href;
            link.setAttribute('data-notification-link', '');
            link.appendChild(title);
            if (message) link.appendChild(message);
            if (meta) link.appendChild(meta);
            li.appendChild(link);
          } else {
            li.appendChild(title);
            if (message) li.appendChild(message);
            if (meta) li.appendChild(meta);
          }

          list.appendChild(li);
        });

        list.hidden = notifications.length === 0;
      }

      if (emptyState) {
        emptyState.hidden = notifications.length !== 0;
      }
    };

    const fetchNotifications = () => {
      if (isFetching) return;
      isFetching = true;
      setLoading(true);
      fetch('/admin/notifications', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          renderNotifications(data || {});
        })
        .catch(err => {
          console.warn('Falha ao actualizar notificações:', err);
        })
        .finally(() => {
          isFetching = false;
          setLoading(false);
        });
    };

    const markNotificationsRead = ids => {
      const token = getCookie('csrf_token');
      if (!token) return Promise.resolve();
      setLoading(true);
      const body = ids && ids.length ? { ids } : {};
      return fetch('/admin/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
        .then(() => fetchNotifications())
        .catch(err => {
          console.warn('Não foi possível marcar notificações como lidas:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    };

    const schedulePolling = () => {
      if (pollingHandle) window.clearInterval(pollingHandle);
      pollingHandle = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchNotifications();
        }
      }, refreshInterval);
    };

    fetchNotifications();
    schedulePolling();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    });

    if (markAllButton) {
      markAllButton.addEventListener('click', event => {
        event.preventDefault();
        markNotificationsRead();
      });
    }

    if (list) {
      list.addEventListener('click', event => {
        const link = event.target.closest('[data-notification-link]');
        if (!link) return;
        const item = link.closest('[data-notification-id]');
        const notificationId = item ? item.getAttribute('data-notification-id') : null;
        if (!notificationId) return;
        item.classList.add('is-read');
        item.dataset.notificationRead = 'true';
        window.setTimeout(() => {
          markNotificationsRead([notificationId]);
        }, 0);
      });
    }
  }

  onReady(() => {
    initShellLoader();
    initThemeToggle();
    initLanguageSwitcher();
    initGlobalSearch();
    initNotificationsPanel();
  });

  document.addEventListener('htmx:afterSwap', () => {
    initLanguageSwitcher();
  });
})();

