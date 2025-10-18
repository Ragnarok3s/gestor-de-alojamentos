(function () {
  if (typeof window === "undefined") return;
  if (window.__boTabsInitialized) return;
  window.__boTabsInitialized = true;

  var SECTION_SELECTOR = ".bo-nav__section-items";
  var BUTTON_SELECTOR = ".bo-tab";
  var PANELS_CONTAINER_SELECTOR = "[data-bo-panels]";
  var PANEL_PREFIX = "bo-panel-";
  var ACTIVE_CLASS = "is-active";
  var LOADED_ATTR = "data-bo-panel-loaded";
  var SOURCE_ATTR = "data-bo-panel-src";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value)
      .replace(/[^a-zA-Z0-9\-_.]/g, function (ch) {
        return "\\" + ch.charCodeAt(0).toString(16) + " ";
      });
  }

  function getPanelsContainer() {
    return document.querySelector(PANELS_CONTAINER_SELECTOR) || document.querySelector("[data-bo-main]") || document.body;
  }

  function upgradePanels(root) {
    if (!root) return;
    var panes = root.querySelectorAll("[data-bo-pane]");
    panes.forEach(function (pane) {
      var target = pane.dataset.boPane;
      if (!target) return;
      var panelId = PANEL_PREFIX + target;
      pane.id = panelId;
      pane.classList.add("bo-panel");
      pane.setAttribute("role", "tabpanel");
      if (!pane.hasAttribute(LOADED_ATTR) && (pane.childElementCount > 0 || (pane.textContent || "").trim())) {
        pane.setAttribute(LOADED_ATTR, "true");
      }
      var isActive = pane.classList.contains(ACTIVE_CLASS) || pane.hasAttribute(ACTIVE_CLASS);
      if (isActive) {
        pane.removeAttribute("hidden");
        pane.classList.add(ACTIVE_CLASS);
      } else {
        pane.setAttribute("hidden", "true");
        pane.classList.remove(ACTIVE_CLASS);
      }
      var controller = document.querySelector('.bo-tab[data-bo-target="' + cssEscape(target) + '"]');
      if (controller && controller.id) {
        pane.setAttribute("aria-labelledby", controller.id);
      }
    });
  }

  function executeScripts(container) {
    var scripts = Array.from(container.querySelectorAll("script"));
    scripts.forEach(function (script) {
      var type = script.getAttribute("type");
      if (type && type !== "" && type !== "text/javascript" && type !== "application/javascript" && type !== "module") {
        var clone = script.cloneNode(true);
        script.replaceWith(clone);
        return;
      }
      var newScript = document.createElement("script");
      Array.from(script.attributes).forEach(function (attr) {
        if (attr && attr.name) newScript.setAttribute(attr.name, attr.value);
      });
      if (script.src) {
        newScript.src = script.src;
      } else {
        newScript.textContent = script.textContent;
      }
      script.replaceWith(newScript);
    });
  }

  function createPanel(target) {
    var container = getPanelsContainer();
    var panel = document.createElement("section");
    panel.id = PANEL_PREFIX + target;
    panel.className = "bo-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("hidden", "true");
    container.appendChild(panel);
    return panel;
  }

  function setPanelVisibility(activeId) {
    var panels = document.querySelectorAll('[id^="' + PANEL_PREFIX + '"]');
    panels.forEach(function (panel) {
      var isActive = panel.id === activeId;
      if (isActive) {
        panel.removeAttribute("hidden");
        panel.classList.add(ACTIVE_CLASS);
        var controller = document.querySelector('[aria-controls="' + panel.id + '"]');
        if (controller && controller.id) {
          panel.setAttribute("aria-labelledby", controller.id);
        }
      } else {
        panel.setAttribute("hidden", "true");
        panel.classList.remove(ACTIVE_CLASS);
      }
    });
  }

  function updateHistory(target, _source, replace) {
    try {
      var current = new URL(window.location.href);
      current.searchParams.set("tab", target);
      var method = replace ? "replaceState" : "pushState";
      window.history[method]({ boTab: target }, "", current);
    } catch (err) {
      // ignore history errors
    }
  }

  function fetchPanel(url, target) {
    return fetch(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Falha ao carregar a página");
        return response.text();
      })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var panelId = PANEL_PREFIX + target;
        var panel = doc.getElementById(panelId);
        if (!panel) {
          panel = doc.querySelector('[data-bo-pane="' + target + '"]');
          if (panel) {
            panel.id = panelId;
            panel.classList.add("bo-panel");
          }
        }
        return panel;
      });
  }

  function ensurePanelContent(panel, button) {
    if (!panel) return Promise.resolve();
    var target = button.dataset.boTarget;
    if (!target) return Promise.resolve();

    var source = panel.getAttribute(SOURCE_ATTR) || button.dataset.boSource;
    if (!source) {
      panel.setAttribute(LOADED_ATTR, "true");
      upgradePanels(panel);
      return Promise.resolve();
    }

    if (panel.getAttribute(LOADED_ATTR) === "true") {
      upgradePanels(panel);
      return Promise.resolve();
    }

    if (panel.__boLoadingPromise) {
      return panel.__boLoadingPromise;
    }

    panel.classList.add("is-loading");
    var fullUrl = new URL(source, window.location.origin).toString();
    var request = fetchPanel(fullUrl, target)
      .then(function (remotePanel) {
        if (!remotePanel) throw new Error("Conteúdo indisponível");
        panel.innerHTML = "";
        while (remotePanel.firstChild) {
          panel.appendChild(remotePanel.firstChild);
        }
        Array.from(remotePanel.attributes).forEach(function (attr) {
          if (!attr || !attr.name) return;
          if (attr.name === "id") return;
          if (attr.name === "class") {
            attr.value.split(/\s+/).forEach(function (cls) {
              if (cls) panel.classList.add(cls);
            });
            return;
          }
          panel.setAttribute(attr.name, attr.value);
        });
        panel.setAttribute(LOADED_ATTR, "true");
        panel.classList.remove("is-loading");
        upgradePanels(panel);
        executeScripts(panel);
      })
      .catch(function (err) {
        panel.classList.remove("is-loading");
        panel.setAttribute("data-bo-panel-error", "true");
        panel.innerHTML = '<div class="bo-panel__error">Não foi possível carregar esta secção.</div>';
        throw err;
      })
      .finally(function () {
        panel.__boLoadingPromise = null;
      });

    panel.__boLoadingPromise = request;
    return request;
  }

  function focusPanel(panel) {
    if (!panel) return;
    if (typeof panel.focus === "function") {
      panel.setAttribute("tabindex", "-1");
      panel.focus({ preventScroll: true });
      panel.removeAttribute("tabindex");
    }
  }

  function activate(button, options) {
    options = options || {};
    if (!button || button.disabled) return Promise.resolve();
    var target = button.dataset.boTarget;
    if (!target) return Promise.resolve();

    var section = button.closest(SECTION_SELECTOR);
    if (section) {
      Array.from(section.querySelectorAll(BUTTON_SELECTOR)).forEach(function (tab) {
        tab.classList.remove(ACTIVE_CLASS);
        tab.setAttribute("aria-selected", "false");
      });
    }

    button.classList.add(ACTIVE_CLASS);
    button.setAttribute("aria-selected", "true");

    var panelId = PANEL_PREFIX + target;
    var panel = document.getElementById(panelId) || createPanel(target);
    panel.setAttribute(SOURCE_ATTR, panel.getAttribute(SOURCE_ATTR) || button.dataset.boSource || "");

    return ensurePanelContent(panel, button)
      .then(function () {
        setPanelVisibility(panelId);
        if (options.pushState) {
          updateHistory(target, button.dataset.boSource, options.replaceHistory);
        }
        focusPanel(panel);
      })
      .catch(function () {
        setPanelVisibility(panelId);
        if (options.pushState) {
          updateHistory(target, button.dataset.boSource, options.replaceHistory);
        }
      });
  }

  function activateByTarget(target, options) {
    if (!target) return Promise.resolve();
    var button = document.querySelector('.bo-tab[data-bo-target="' + cssEscape(target) + '"]');
    if (!button) return Promise.resolve();
    return activate(button, options);
  }

  function getTargetFromQuery() {
    try {
      var url = new URL(window.location.href);
      var tab = url.searchParams.get("tab");
      if (tab) return tab.trim();
      var hash = url.hash ? url.hash.replace(/^#/, "").trim() : "";
      return hash;
    } catch (err) {
      return "";
    }
  }

  function handleSectionClick(event) {
    var button = event.target.closest(BUTTON_SELECTOR);
    if (!button) return;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    activate(button, { pushState: true });
  }

  function handleSectionKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var button = event.target.closest(BUTTON_SELECTOR);
    if (!button) return;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    activate(button, { pushState: true });
  }

  ready(function () {
    upgradePanels(document);

    var sections = Array.from(document.querySelectorAll(SECTION_SELECTOR));
    if (!sections.length) return;

    sections.forEach(function (section) {
      section.setAttribute("role", "tablist");
      section.addEventListener("click", handleSectionClick);
      section.addEventListener("keydown", handleSectionKeydown);
      Array.from(section.querySelectorAll(BUTTON_SELECTOR)).forEach(function (button, index) {
        var target = button.dataset.boTarget || "";
        var buttonId = button.id && button.id.trim() ? button.id : "bo-tab-" + (target || index);
        button.id = buttonId;
        button.setAttribute("role", "tab");
        button.setAttribute("tabindex", button.disabled ? "-1" : "0");
        button.setAttribute("aria-selected", button.classList.contains(ACTIVE_CLASS) ? "true" : "false");
        if (target) {
          button.setAttribute("aria-controls", PANEL_PREFIX + target);
        }
      });
    });

    var container = getPanelsContainer();
    var defaultTarget = container ? container.getAttribute("data-default-target") : "";
    var activeTarget = container ? container.getAttribute("data-active-target") : "";
    var queryTarget = getTargetFromQuery();
    var initialTarget = queryTarget || activeTarget || defaultTarget;

    var initialActivation = initialTarget
      ? activateByTarget(initialTarget, { pushState: true, replaceHistory: true })
      : Promise.resolve();

    initialActivation.finally(function () {
      if (typeof window.__initFeatureBuilders === "function") {
        try {
          window.__initFeatureBuilders();
        } catch (err) {
          console.error(err);
        }
      }
    });

    window.addEventListener("popstate", function (event) {
      var stateTarget = event.state && event.state.boTab ? event.state.boTab : getTargetFromQuery();
      if (!stateTarget) return;
      activateByTarget(stateTarget, { pushState: false });
    });
  });
})();
