(function () {
  if (typeof window === 'undefined') return;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function listen(mediaQuery, handler) {
    if (!mediaQuery || typeof handler !== 'function') return;
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handler);
    }
  }

  ready(function () {
    var shell = document.querySelector('[data-bo-shell]');
    var sidebar = document.querySelector('[data-bo-sidebar]');
    if (!shell || !sidebar) return;

    var collapseButton = sidebar.querySelector('[data-sidebar-collapse]');
    var trigger = document.querySelector('[data-sidebar-trigger]');
    var overlay = document.querySelector('[data-sidebar-overlay]');
    var navLabels = Array.prototype.slice.call(sidebar.querySelectorAll('.bo-tab__label'));
    var focusReturnTarget = null;

    var MODE_DESKTOP = 'desktop';
    var MODE_COMPACT = 'compact';
    var MODE_MOBILE = 'mobile';
    var currentMode = MODE_DESKTOP;

    var mobileMedia = window.matchMedia('(max-width: 768px)');
    var compactMedia = window.matchMedia('(max-width: 1024px)');
    var desktopMedia = window.matchMedia('(min-width: 1280px)');

    var storageKey = 'boSidebarCollapsed';
    var storedPreference = null;
    try {
      storedPreference = localStorage.getItem(storageKey);
    } catch (err) {
      storedPreference = null;
    }
    var preferredCollapsed = storedPreference === '1';

    function syncLabelVisibility() {
      var hideLabels = shell.getAttribute('data-sidebar-collapsed') === '1' || currentMode === MODE_COMPACT || currentMode === MODE_MOBILE;
      navLabels.forEach(function (label) {
        if (!label) return;
        if (hideLabels) {
          label.setAttribute('aria-hidden', 'true');
        } else {
          label.removeAttribute('aria-hidden');
        }
      });
    }

    function setCollapsed(flag, options) {
      if (!options) options = {};
      if (currentMode === MODE_MOBILE) flag = false;
      shell.setAttribute('data-sidebar-collapsed', flag ? '1' : '0');
      sidebar.setAttribute('data-collapsed', flag ? '1' : '0');
      if (collapseButton) {
        collapseButton.setAttribute('aria-expanded', flag ? 'false' : 'true');
      }
      syncLabelVisibility();
      if (currentMode === MODE_DESKTOP && !options.skipStore) {
        preferredCollapsed = flag;
        try {
          localStorage.setItem(storageKey, flag ? '1' : '0');
        } catch (err) {}
      }
    }

    function setMode(mode) {
      currentMode = mode;
      shell.setAttribute('data-sidebar-mode', mode);
      if (mode === MODE_MOBILE) {
        setCollapsed(false, { skipStore: true });
        closeSidebar({ skipFocus: true, silent: true });
        if (collapseButton) {
          collapseButton.setAttribute('aria-hidden', 'true');
          collapseButton.setAttribute('tabindex', '-1');
        }
      } else {
        if (collapseButton) {
          collapseButton.removeAttribute('aria-hidden');
          collapseButton.removeAttribute('tabindex');
        }
        closeSidebar({ skipFocus: true, silent: true });
        if (mode === MODE_COMPACT) {
          setCollapsed(true, { skipStore: true });
        } else {
          setCollapsed(preferredCollapsed, { skipStore: true });
        }
      }
      syncLabelVisibility();
    }

    function openSidebar() {
      if (currentMode !== MODE_MOBILE) return;
      shell.setAttribute('data-sidebar-open', '1');
      sidebar.setAttribute('aria-hidden', 'false');
      if (overlay) {
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
      }
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      focusReturnTarget = document.activeElement;
      document.body.style.overflow = 'hidden';
      var firstAction = sidebar.querySelector('[data-bo-target]:not([disabled])');
      if (firstAction) {
        setTimeout(function () {
          try {
            firstAction.focus();
          } catch (err) {}
        }, 120);
      }
    }

    function closeSidebar(options) {
      options = options || {};
      shell.setAttribute('data-sidebar-open', '0');
      sidebar.setAttribute('aria-hidden', currentMode === MODE_MOBILE ? 'true' : 'false');
      if (overlay) {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
      }
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (!options.skipFocus) {
        var target = trigger || focusReturnTarget;
        if (target) {
          setTimeout(function () {
            try {
              target.focus();
            } catch (err) {}
          }, 120);
        }
      }
      if (!options.silent) {
        focusReturnTarget = null;
      }
    }

    function toggleCollapsed() {
      if (currentMode === MODE_MOBILE) {
        openSidebar();
        return;
      }
      var isCollapsed = shell.getAttribute('data-sidebar-collapsed') === '1';
      setCollapsed(!isCollapsed);
    }

    function toggleMobileOverlay() {
      if (currentMode !== MODE_MOBILE) return;
      var open = shell.getAttribute('data-sidebar-open') === '1';
      if (open) {
        closeSidebar();
      } else {
        openSidebar();
      }
    }

    function handleMediaChange() {
      if (mobileMedia.matches) {
        setMode(MODE_MOBILE);
      } else if (compactMedia.matches && !desktopMedia.matches) {
        setMode(MODE_COMPACT);
      } else {
        setMode(MODE_DESKTOP);
      }
    }

    if (collapseButton) {
      collapseButton.addEventListener('click', function (event) {
        event.preventDefault();
        toggleCollapsed();
      });
    }

    if (trigger) {
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        toggleMobileOverlay();
      });
    }

    if (overlay) {
      overlay.addEventListener('click', function () {
        closeSidebar();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && currentMode === MODE_MOBILE && shell.getAttribute('data-sidebar-open') === '1') {
        event.preventDefault();
        closeSidebar();
      }
    });

    listen(mobileMedia, handleMediaChange);
    listen(compactMedia, handleMediaChange);
    listen(desktopMedia, handleMediaChange);

    handleMediaChange();
    syncLabelVisibility();
  });
})();
