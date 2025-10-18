(function () {
  if (typeof window === "undefined") return;

  var tabs = [];
  var panes = [];
  var featureBuildersInitialized = false;
  var paneRequestTokens = Object.create(null);
  var paneRequestSequence = 0;

  function refreshCollections() {
    tabs = Array.from(document.querySelectorAll("[data-bo-target]"));
    panes = Array.from(document.querySelectorAll("[data-bo-pane]"));
  }

  function beginPaneRequest(id, pane) {
    paneRequestSequence += 1;
    var token = String(paneRequestSequence);
    paneRequestTokens[id] = token;
    if (pane) {
      pane.dataset.loading = "true";
      pane.setAttribute("aria-busy", "true");
    }
    return token;
  }

  function isLatestPaneRequest(id, token) {
    return paneRequestTokens[id] === token;
  }

  function finishPaneRequest(id, token, pane) {
    if (!isLatestPaneRequest(id, token)) return;
    delete paneRequestTokens[id];
    if (pane) {
      delete pane.dataset.loading;
      pane.removeAttribute("aria-busy");
    }
  }

  function cleanupIframeObservers(pane) {
    if (!pane) return;
    if (pane._boIframePaneObserver) {
      try {
        pane._boIframePaneObserver.disconnect();
      } catch (err) {
        // ignore
      }
      pane._boIframePaneObserver = null;
    }
    if (pane._boIframeContentObserver) {
      try {
        pane._boIframeContentObserver.disconnect();
      } catch (err) {
        // ignore
      }
      pane._boIframeContentObserver = null;
    }
  }

  function findPane(id) {
    return panes.find(function (pane) {
      return pane.dataset.boPane === id;
    }) || null;
  }

  function schedulePaneFocus(pane) {
    if (!pane) return;
    if (typeof window.requestAnimationFrame !== "function") {
      focusPaneTarget(pane);
      return;
    }
    window.requestAnimationFrame(function () {
      focusPaneTarget(pane);
    });
  }

  function focusPaneTarget(pane) {
    if (!pane || pane.getAttribute("aria-hidden") === "true") return;
    var focusTarget = pane.querySelector("[autofocus]");
    if (!focusTarget) {
      focusTarget = pane.querySelector("h1, h2, h3, h4, h5, h6");
    }
    if (!focusTarget) {
      focusTarget = pane.querySelector("[tabindex]:not([tabindex='-1'])");
    }
    if (!focusTarget) {
      focusTarget = pane.querySelector(
        "a[href], button, input, select, textarea, [role='button']"
      );
    }
    if (!focusTarget || typeof focusTarget.focus !== "function") return;
    try {
      focusTarget.focus({ preventScroll: false });
    } catch (err) {
      focusTarget.focus();
    }
  }

  function schedulePaneFocusById(id) {
    if (!id) return;
    schedulePaneFocus(findPane(id));
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
      schedulePaneFocusById(initialPane);
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
        schedulePaneFocusById(targetId);
      });
    });
  });

  document.addEventListener("click", function (ev) {
    if (!window.FEATURE_NAV_LINKS_AS_TABS) return;
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    var anchor = ev.target && ev.target.closest("a.bo-tab--link[data-bo-target]");
    if (!anchor) return;
    if (isTabDisabled(anchor)) return;

    refreshCollections();
    if (!tabs.length || !panes.length) return;

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

    activatePane(targetId);
    updateHash(targetId);

    var mode = (anchor.dataset.boLoad || "fragment").toLowerCase();
    try {
      console.info("nav:tab_opened", { id: targetId, mode: mode });
    } catch (err) {
      // ignore telemetry errors
    }

    var forceReload = pane.dataset.forceReload === "true";
    if (pane.dataset.loaded === "true" && !forceReload) {
      runPaneInitializers(targetId);
      schedulePaneFocus(pane);
      return;
    }

    if (forceReload) {
      delete pane.dataset.forceReload;
      delete pane.dataset.loaded;
    }

    var requestToken = beginPaneRequest(targetId, pane);

    if (mode === "iframe") {
      cleanupIframeObservers(pane);
      pane.innerHTML = "";
      var iframe = document.createElement("iframe");
      iframe.title = anchor.textContent ? anchor.textContent.trim() || "Conteúdo" : "Conteúdo";
      iframe.setAttribute("loading", "lazy");
      iframe.setAttribute("referrerpolicy", "same-origin");
      iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms");
      iframe.style.width = "100%";
      iframe.style.border = "0";
      if (typeof ResizeObserver !== "undefined") {
        var paneObserver = new ResizeObserver(function (entries) {
          entries.forEach(function (entry) {
            iframe.style.height = entry.contentRect.height + "px";
          });
        });
        paneObserver.observe(pane);
        pane._boIframePaneObserver = paneObserver;
      } else {
        iframe.style.height = "100%";
      }

      iframe.addEventListener("load", function () {
        if (!isLatestPaneRequest(targetId, requestToken)) return;
        pane.dataset.loaded = "true";
        delete pane.dataset.forceReload;
        try {
          if (typeof ResizeObserver !== "undefined") {
            var doc = iframe.contentDocument;
            if (doc && doc.body) {
              if (pane._boIframeContentObserver) {
                pane._boIframeContentObserver.disconnect();
              }
              var contentObserver = new ResizeObserver(function () {
                iframe.style.height = doc.body.scrollHeight + "px";
              });
              contentObserver.observe(doc.body);
              pane._boIframeContentObserver = contentObserver;
              iframe.style.height = doc.body.scrollHeight + "px";
            }
          } else if (iframe.contentDocument && iframe.contentDocument.body) {
            iframe.style.height = iframe.contentDocument.body.scrollHeight + "px";
          }
        } catch (err) {
          // ignore cross-origin sizing issues
        }
        runPaneInitializers(targetId);
        schedulePaneFocus(pane);
        finishPaneRequest(targetId, requestToken, pane);
      });

      iframe.addEventListener("error", function () {
        if (!isLatestPaneRequest(targetId, requestToken)) return;
        cleanupIframeObservers(pane);
        finishPaneRequest(targetId, requestToken, pane);
        try {
          console.error("nav:fragment_error", { id: targetId, href: anchor.href, status: null });
        } catch (err) {
          // ignore telemetry errors
        }
        window.location.href = anchor.href;
      });

      pane.appendChild(iframe);
      iframe.src = anchor.href;
      return;
    }

    var fetchPromise;

    if (mode === "fetch-json") {
      fetchPromise = fetch(anchor.href, {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      })
        .then(function (res) {
          if (!res.ok) {
            var error = new Error("HTTP " + res.status);
            error.status = res.status;
            throw error;
          }
          return res.json();
        })
        .then(function (data) {
          if (!isLatestPaneRequest(targetId, requestToken)) return;
          var rendered = renderFromJson(data);
          pane.innerHTML = typeof rendered === "string" ? rendered : "";
          pane.dataset.loaded = "true";
          delete pane.dataset.forceReload;
          runPaneInitializers(targetId);
          schedulePaneFocus(pane);
          finishPaneRequest(targetId, requestToken, pane);
        });
    } else {
      var fragmentUrl = addFragmentParam(anchor.href);
      fetchPromise = fetch(fragmentUrl, { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) {
            var error = new Error("HTTP " + res.status);
            error.status = res.status;
            throw error;
          }
          return res.text();
        })
        .then(function (html) {
          if (!isLatestPaneRequest(targetId, requestToken)) return;
          pane.innerHTML = html;
          pane.dataset.loaded = "true";
          delete pane.dataset.forceReload;
          runPaneInitializers(targetId);
          schedulePaneFocus(pane);
          finishPaneRequest(targetId, requestToken, pane);
        });
    }

    fetchPromise.catch(function (err) {
      if (!isLatestPaneRequest(targetId, requestToken)) return;
      finishPaneRequest(targetId, requestToken, pane);
      var status = err && typeof err.status === "number" ? err.status : null;
      try {
        console.error("nav:fragment_error", { id: targetId, href: anchor.href, status: status });
      } catch (logErr) {
        // ignore telemetry errors
      }
      window.location.href = anchor.href;
    });
  });
})();
