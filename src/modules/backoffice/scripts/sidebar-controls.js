(function () {
  if (typeof window === "undefined") return;

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var shell = document.querySelector("[data-bo-shell]");
    if (!shell) return;

    var sidebar = shell.querySelector("[data-bo-sidebar]");
    if (!sidebar) return;

    var toggle = shell.querySelector("[data-sidebar-toggle]");
    var openButtons = Array.from(shell.querySelectorAll("[data-sidebar-open]"));
    var scrim = shell.querySelector("[data-sidebar-scrim]");
    var collapseState = false;
    var mobileQuery = window.matchMedia ? window.matchMedia("(max-width: 1080px)") : null;

    function isMobile() {
      return mobileQuery ? mobileQuery.matches : window.innerWidth <= 1080;
    }

    function updateToggleLabels(isCollapsed) {
      if (!toggle) return;
      if (isMobile()) {
        toggle.setAttribute("aria-label", "Fechar menu");
        toggle.setAttribute("aria-expanded", shell.classList.contains("is-sidebar-open") ? "true" : "false");
      } else {
        toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
        toggle.setAttribute("aria-label", isCollapsed ? "Expandir menu" : "Encolher menu");
      }
      toggle.dataset.state = isCollapsed ? "collapsed" : "expanded";
    }

    function syncOpenButtons(isOpen) {
      openButtons.forEach(function (btn) {
        btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    }

    function setCollapsed(nextState) {
      collapseState = !!nextState;
      shell.classList.toggle("is-collapsed", collapseState);
      updateToggleLabels(collapseState);
    }

    function openSidebar() {
      shell.classList.add("is-sidebar-open");
      if (scrim) {
        scrim.removeAttribute("hidden");
      }
      updateToggleLabels(collapseState);
      syncOpenButtons(true);
      if (!prefersReducedMotion() && typeof sidebar.focus === "function") {
        try {
          sidebar.focus({ preventScroll: true });
        } catch (err) {
          sidebar.focus();
        }
      }
    }

    function closeSidebar() {
      shell.classList.remove("is-sidebar-open");
      if (scrim) {
        scrim.setAttribute("hidden", "");
      }
      updateToggleLabels(collapseState);
      syncOpenButtons(false);
    }

    function handleToggleClick(event) {
      event.preventDefault();
      if (isMobile()) {
        if (shell.classList.contains("is-sidebar-open")) {
          closeSidebar();
        } else {
          openSidebar();
        }
        return;
      }
      setCollapsed(!collapseState);
    }

    function handleMobileChange() {
      shell.classList.remove("is-sidebar-open");
      if (scrim) {
        scrim.setAttribute("hidden", "");
      }
      if (isMobile()) {
        shell.classList.remove("is-collapsed");
        updateToggleLabels(false);
        syncOpenButtons(false);
      } else {
        updateToggleLabels(collapseState);
        syncOpenButtons(false);
      }
    }

    if (toggle) {
      toggle.addEventListener("click", handleToggleClick);
    }

    openButtons.forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        openSidebar();
      });
    });

    if (scrim) {
      scrim.addEventListener("click", function () {
        closeSidebar();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && shell.classList.contains("is-sidebar-open")) {
        closeSidebar();
      }
    });

    if (mobileQuery && typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", handleMobileChange);
    } else if (mobileQuery && typeof mobileQuery.addListener === "function") {
      mobileQuery.addListener(handleMobileChange);
    } else {
      window.addEventListener("resize", handleMobileChange);
    }

    handleMobileChange();
    updateToggleLabels(collapseState);
    syncOpenButtons(false);
  });
})();
