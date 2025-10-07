(function () {
  if (typeof window === "undefined") return;
  document.addEventListener("DOMContentLoaded", function () {
    var tabs = Array.from(document.querySelectorAll("[data-bo-target]"));
    var panes = Array.from(document.querySelectorAll("[data-bo-pane]"));
    if (!tabs.length || !panes.length) return;

    function activate(id) {
      panes.forEach(function (pane) {
        if (pane.dataset.boPane === id) {
          pane.classList.add("is-active");
        } else {
          pane.classList.remove("is-active");
        }
      });
      tabs.forEach(function (tab) {
        if (tab.dataset.boTarget === id) {
          tab.classList.add("is-active");
        } else {
          tab.classList.remove("is-active");
        }
      });
      if (id) {
        window.history.replaceState(null, "", "#" + id);
      }
    }

    var defaultPane = __DEFAULT_PANE__;
    var initialHash = window.location.hash ? window.location.hash.replace("#", "") : "";
    if (initialHash && panes.some(function (pane) { return pane.dataset.boPane === initialHash; })) {
      activate(initialHash);
    } else {
      activate(defaultPane);
    }

    tabs.forEach(function (tab) {
      if (tab.hasAttribute("disabled")) return;
      tab.addEventListener("click", function () {
        activate(tab.dataset.boTarget || "");
      });
    });

    if (typeof window.__initFeatureBuilders === "function") {
      window.__initFeatureBuilders();
    }
  });
})();
