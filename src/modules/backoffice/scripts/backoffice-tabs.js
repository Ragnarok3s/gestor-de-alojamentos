(function (global) {
  if (typeof window === 'undefined') return;
  if (global.__backofficeTabsInitialized) return;
  global.__backofficeTabsInitialized = true;

  var SECTION_SELECTOR = '.bo-nav__section-items';
  var BUTTON_SELECTOR = '.bo-tab';
  var PANEL_SELECTOR = '[id^="bo-panel-"]';
  var PANEL_PREFIX = 'bo-panel-';
  var ACTIVE_CLASS = 'is-active';

  var loader = global.BackofficePanelLoader || {};

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9\-_.]/g, function (ch) {
      return '\\' + ch.charCodeAt(0).toString(16) + ' ';
    });
  }

  function ensureButton(button, index) {
    if (!button) return;
    button.type = 'button';
    var target = button.getAttribute('data-bo-target') || '';
    var id = button.id && button.id.trim() ? button.id : 'bo-tab-' + (target || index);
    button.id = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', button.classList.contains(ACTIVE_CLASS) ? 'true' : 'false');
    if (target) {
      button.setAttribute('aria-controls', PANEL_PREFIX + target);
    }
  }

  function upgradePanels() {
    var panes = document.querySelectorAll('[data-bo-pane]');
    panes.forEach(function (pane) {
      var target = pane.getAttribute('data-bo-pane');
      if (!target) return;
      var id = PANEL_PREFIX + target;
      pane.id = id;
      pane.classList.add('bo-panel');
      pane.setAttribute('role', 'tabpanel');
      var controller = document.querySelector('.bo-tab[data-bo-target="' + cssEscape(target) + '"]');
      if (controller) {
        pane.setAttribute('aria-labelledby', controller.id || 'bo-tab-' + target);
      }
      if (pane.classList.contains(ACTIVE_CLASS) || pane.getAttribute('data-active') === 'true') {
        pane.hidden = false;
        pane.classList.add(ACTIVE_CLASS);
        pane.dataset.boPanelLoaded = pane.dataset.boPanelLoaded || 'true';
      } else {
        pane.hidden = true;
        pane.classList.remove(ACTIVE_CLASS);
      }
    });
  }

  function getButton(target) {
    if (!target) return null;
    return document.querySelector('.bo-tab[data-bo-target="' + cssEscape(target) + '"]');
  }

  function getPanel(target) {
    if (!target) return null;
    return document.getElementById(PANEL_PREFIX + target);
  }

  function setActiveButton(button) {
    var buttons = document.querySelectorAll(BUTTON_SELECTOR);
    buttons.forEach(function (btn) {
      if (btn === button) return;
      btn.classList.remove(ACTIVE_CLASS);
      btn.setAttribute('aria-selected', 'false');
    });
    if (button) {
      button.classList.add(ACTIVE_CLASS);
      button.setAttribute('aria-selected', 'true');
    }
  }

  function setActivePanel(target) {
    var panelId = PANEL_PREFIX + target;
    var panels = document.querySelectorAll(PANEL_SELECTOR);
    panels.forEach(function (panel) {
      var isActive = panel.id === panelId;
      if (isActive) {
        panel.hidden = false;
        panel.classList.add(ACTIVE_CLASS);
        panel.setAttribute('aria-hidden', 'false');
      } else {
        panel.hidden = true;
        panel.classList.remove(ACTIVE_CLASS);
        panel.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function currentTarget() {
    var active = document.querySelector('.bo-tab.' + ACTIVE_CLASS);
    return active ? active.getAttribute('data-bo-target') : null;
  }

  function activate(target, options) {
    options = options || {};
    var button = getButton(target);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return Promise.resolve();
    }

    setActiveButton(button);
    setActivePanel(target);

    var panel = getPanel(target);
    if (panel) {
      panel.dataset.boPanelLoaded = panel.dataset.boPanelLoaded || (panel.childElementCount > 0 ? 'true' : '');
      panel.setAttribute('aria-labelledby', button.id);
      var intercept = global.BackofficePanelIntercept;
      if (intercept && typeof intercept.wirePanelNavigation === 'function') {
        intercept.wirePanelNavigation(panel);
      }
    }

    var pushState = options.pushState !== false;
    var replaceState = !!options.replaceState;
    var forceReload = !!options.forceReload;

    if (!loader || typeof loader.loadPanel !== 'function') {
      return Promise.resolve();
    }

    return loader.loadPanel(target, {
      pushState: pushState,
      replaceState: replaceState,
      forceReload: forceReload
    });
  }

  function handleSectionClick(event) {
    var button = event.target.closest(BUTTON_SELECTOR);
    if (!button) return;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    var target = button.getAttribute('data-bo-target');
    if (!target) return;
    activate(target, { pushState: true }).catch(function (err) {
      console.error(err);
    });
  }

  function handleSectionKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var button = event.target.closest(BUTTON_SELECTOR);
    if (!button) return;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    var target = button.getAttribute('data-bo-target');
    if (!target) return;
    activate(target, { pushState: true }).catch(function (err) {
      console.error(err);
    });
  }

  function initializeSections() {
    var sections = document.querySelectorAll(SECTION_SELECTOR);
    sections.forEach(function (section) {
      section.setAttribute('role', 'tablist');
      section.addEventListener('click', handleSectionClick);
      section.addEventListener('keydown', handleSectionKeydown);
      var buttons = section.querySelectorAll(BUTTON_SELECTOR);
      buttons.forEach(function (button, index) {
        ensureButton(button, index);
      });
    });
  }

  function restoreFromQuery() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get('tab');
    } catch (err) {
      return null;
    }
  }

  function boot() {
    upgradePanels();
    initializeSections();

    var initialTarget = restoreFromQuery();
    if (!initialTarget) {
      var active = currentTarget();
      if (active) {
        initialTarget = active;
      } else {
        var firstButton = document.querySelector(BUTTON_SELECTOR);
        initialTarget = firstButton ? firstButton.getAttribute('data-bo-target') : null;
        if (firstButton) {
          firstButton.classList.add(ACTIVE_CLASS);
          firstButton.setAttribute('aria-selected', 'true');
        }
      }
    }

    var activationPromise = initialTarget
      ? activate(initialTarget, { pushState: false, replaceState: true })
      : Promise.resolve();

    activationPromise.finally(function () {
      if (typeof window.__initFeatureBuilders === 'function') {
        try {
          window.__initFeatureBuilders();
        } catch (err) {
          console.error(err);
        }
      }
    });
  }

  ready(boot);

  window.addEventListener('popstate', function () {
    var qsTarget = restoreFromQuery();
    if (!qsTarget) return;
    activate(qsTarget, { pushState: false }).catch(function (err) {
      console.error(err);
    });
  });

  global.BackofficeTabs = {
    activate: activate,
    current: currentTarget,
    rememberPanelLoaded: function (target) {
      var panel = getPanel(target);
      if (panel) {
        panel.dataset.boPanelLoaded = 'true';
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
