import { loadPanel } from "./panel-loader.js";

const SEC_SELECTOR = ".bo-nav__section-items";
const TAB_SELECTOR = ".bo-tab";
const PANEL_PREFIX = "bo-panel-";
const ACTIVE_CLASS = "is-active";

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9\-_.]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

function panelId(target) {
  return `${PANEL_PREFIX}${target}`;
}

function setActiveButton(section, button) {
  section.querySelectorAll(TAB_SELECTOR).forEach((tab) => {
    if (tab === button) return;
    tab.classList.remove(ACTIVE_CLASS);
    tab.setAttribute("aria-selected", "false");
  });

  button.classList.add(ACTIVE_CLASS);
  button.setAttribute("aria-selected", "true");
}

function showPanel(target) {
  const id = panelId(target);
  document.querySelectorAll(`[id^="${PANEL_PREFIX}"]`).forEach((panel) => {
    const isActive = panel.id === id;
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    if (!isActive) {
      panel.classList.remove(ACTIVE_CLASS);
    } else {
      panel.classList.add(ACTIVE_CLASS);
    }
  });
}

async function activateButton(button, { pushState = true } = {}) {
  if (!button) return;
  const section = button.closest(SEC_SELECTOR);
  if (!section) return;

  const target = button.dataset.boTarget;
  if (!target) return;

  setActiveButton(section, button);
  showPanel(target);

  const panel = document.getElementById(panelId(target));
  if (panel && button.id) {
    panel.setAttribute("aria-labelledby", button.id);
  }

  try {
    await loadPanel(target, { pushState });
  } catch (err) {
    console.error(err);
  }
}

export function activateTab(target, options = {}) {
  const button = document.querySelector(`.bo-tab[data-bo-target="${cssEscape(target)}"]`);
  if (button) {
    return activateButton(button, options);
  }
  return Promise.resolve();
}

document.querySelectorAll(SEC_SELECTOR).forEach((section) => {
  section.setAttribute("role", "tablist");

  section.addEventListener("click", (event) => {
    const button = event.target.closest(TAB_SELECTOR);
    if (!button || !section.contains(button)) return;
    event.preventDefault();
    activateButton(button, { pushState: true });
  });

  section.querySelectorAll(TAB_SELECTOR).forEach((button, index) => {
    button.type = "button";
    button.setAttribute("role", "tab");
    const target = button.dataset.boTarget || `panel-${index}`;
    if (!button.id) {
      button.id = `bo-tab-${target}`;
    }
    button.setAttribute("aria-selected", button.classList.contains(ACTIVE_CLASS) ? "true" : "false");
    if (target) {
      button.setAttribute("aria-controls", panelId(target));
    }
  });
});

document.addEventListener("click", (event) => {
  const retry = event.target.closest(".bo-retry");
  if (!retry) return;
  const panel = retry.closest(`[id^="${PANEL_PREFIX}"]`);
  if (!panel) return;
  const target = panel.id.replace(PANEL_PREFIX, "");
  loadPanel(target, { pushState: false }).catch((err) => console.error(err));
});

window.addEventListener("popstate", () => {
  try {
    const url = new URL(location.href);
    const target = url.searchParams.get("tab");
    if (!target) return;
    activateTab(target, { pushState: false });
  } catch (err) {
    console.error(err);
  }
});

(function boot() {
  let initialTarget = null;
  try {
    const url = new URL(location.href);
    initialTarget = url.searchParams.get("tab");
  } catch (err) {
    initialTarget = null;
  }

  let button = null;
  if (initialTarget) {
    button = document.querySelector(`.bo-tab[data-bo-target="${cssEscape(initialTarget)}"]`);
  }

  if (!button) {
    button = document.querySelector(`.bo-tab.${ACTIVE_CLASS}`) || document.querySelector(TAB_SELECTOR);
  }

  if (button) {
    activateButton(button, { pushState: false });
  }
})();

if (typeof window !== "undefined") {
  window.BackofficeTabs = Object.assign(window.BackofficeTabs || {}, {
    activate: activateTab
  });
}
