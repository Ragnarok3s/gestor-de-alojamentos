(function () {
  if (typeof window === "undefined") return;

  var tabs = [];
  var panes = [];
  var featureBuildersInitialized = false;

  function refreshCollections() {
    tabs = Array.from(document.querySelectorAll("[data-bo-target]"));
    panes = Array.from(document.querySelectorAll("[data-bo-pane]"));
  }

  function findPane(id) {
    return panes.find(function (pane) {
      return pane.dataset.boPane === id;
    }) || null;
  }

  function isTabDisabled(tab) {
    if (!tab) return true;
    if (tab.dataset.disabled === "true") return true;
    if (tab.getAttribute("aria-disabled") === "true") return true;
    if (tab.hasAttribute("disabled")) return true;
    return false;
  }

  function setPaneVisibility(pane, isActive) {
    if (!pane) return;
    pane.classList.toggle("is-active", isActive);
    pane.setAttribute("aria-hidden", isActive ? "false" : "true");
  }

  function setTabState(tab, isActive) {
    if (!tab) return;
    tab.classList.toggle("is-active", isActive);
    if (tab.getAttribute("role") === "tab") {
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        tab.removeAttribute("tabindex");
      } else {
        tab.setAttribute("tabindex", "-1");
      }
    }
  }

  function activatePane(id) {
    if (!id) return;
    panes.forEach(function (pane) {
      setPaneVisibility(pane, pane.dataset.boPane === id);
    });
    tabs.forEach(function (tab) {
      setTabState(tab, tab.dataset.boTarget === id);
    });
  }

  function updateHash(id) {
    if (!id) return;
    try {
      window.history.replaceState(null, "", "#" + id);
    } catch (err) {
      // noop
    }
  }

  function runPaneInitializers(id) {
    if (typeof window.runPaneInitializers === "function") {
      try {
        window.runPaneInitializers(id);
      } catch (err) {
        // ignore initializer errors to avoid breaking navigation
      }
    }
    if (!featureBuildersInitialized && typeof window.__initFeatureBuilders === "function") {
      try {
        window.__initFeatureBuilders();
      } catch (err) {
        // ignore
      }
      featureBuildersInitialized = true;
    }
  }

  function addFragmentParam(url) {
    try {
      var parsed = new URL(url, window.location.href);
      parsed.searchParams.set("fragment", "1");
      parsed.hash = "";
      return parsed.toString();
    } catch (err) {
      if (url.indexOf("?") === -1) {
        return url + "?fragment=1";
      }
      return url + "&fragment=1";
    }
  }

  function renderFromJson(data) {
    if (typeof window.renderBackofficePaneFromJson === "function") {
      return window.renderBackofficePaneFromJson(data);
    }
    if (typeof window.renderFromJson === "function") {
      return window.renderFromJson(data);
    }
    return "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    refreshCollections();
    if (!tabs.length || !panes.length) return;

    var defaultPane = __DEFAULT_PANE__;
    var initialHash = window.location.hash ? window.location.hash.replace("#", "") : "";
    var initialPane = initialHash && findPane(initialHash) ? initialHash : defaultPane;
    if (initialPane) {
      activatePane(initialPane);
      updateHash(initialPane);
      runPaneInitializers(initialPane);
    }

    tabs.forEach(function (tab) {
      if (isTabDisabled(tab)) return;
      if (tab.tagName === "A") return;
      tab.addEventListener("click", function (ev) {
        ev.preventDefault();
        var targetId = tab.dataset.boTarget || "";
        if (!targetId) return;
        activatePane(targetId);
        updateHash(targetId);
        runPaneInitializers(targetId);
      });
    });
  });

  document.addEventListener("click", function (ev) {
    if (!window.FEATURE_NAV_LINKS_AS_TABS) return;
    if (!tabs.length || !panes.length) return;
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    var anchor = ev.target && ev.target.closest("a.bo-tab--link[data-bo-target]");
    if (!anchor) return;
    if (isTabDisabled(anchor)) return;

    ev.preventDefault();
    var targetId = anchor.getAttribute("data-bo-target") || "";
    if (!targetId) {
      window.location.href = anchor.href;
      return;
    }

    var pane = findPane(targetId);
    if (!pane) {
      window.location.href = anchor.href;
      return;
    }

    if (pane.dataset.loading === "true") return;

    activatePane(targetId);
    updateHash(targetId);

    if (pane.dataset.loaded === "true") {
      runPaneInitializers(targetId);
      return;
    }

    var mode = (anchor.dataset.boLoad || "fragment").toLowerCase();

    if (mode === "iframe") {
      pane.innerHTML = "";
      var iframe = document.createElement("iframe");
      iframe.src = anchor.href;
      iframe.title = anchor.textContent ? anchor.textContent.trim() || "Conteúdo" : "Conteúdo";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "same-origin";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      pane.appendChild(iframe);
      pane.dataset.loaded = "true";
      return;
    }

    pane.dataset.loading = "true";
    pane.setAttribute("aria-busy", "true");

    var requestPromise;

    if (mode === "fetch-json") {
      requestPromise = fetch(anchor.href, {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json().then(function (data) {
          var rendered = renderFromJson(data);
          pane.innerHTML = typeof rendered === "string" ? rendered : "";
          pane.dataset.loaded = "true";
          runPaneInitializers(targetId);
        });
      });
    } else {
      var fragmentUrl = addFragmentParam(anchor.href);
      requestPromise = fetch(fragmentUrl, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text().then(function (html) {
          pane.innerHTML = html;
          pane.dataset.loaded = "true";
          runPaneInitializers(targetId);
        });
      });
    }

    requestPromise.catch(function () {
      window.location.href = anchor.href;
    }).finally(function () {
      delete pane.dataset.loading;
      pane.removeAttribute("aria-busy");
    });
  });
})();
