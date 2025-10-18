import { BoRoutes } from "./backoffice-router.js";
import { wirePanelNavigation } from "./panel-intercept.js";

const PANEL_PREFIX = "bo-panel-";
const FETCH_OPTS = {
  credentials: "same-origin",
  headers: {
    "X-Requested-With": "fetch",
    Accept: "text/html"
  }
};

export async function loadPanel(target, { pushState = true } = {}) {
  if (!target) {
    throw new Error("Target obrigatório");
  }

  const route = BoRoutes[target];
  if (!route) {
    throw new Error(`Sem rota para target: ${target}`);
  }

  const panel = document.getElementById(`${PANEL_PREFIX}${target}`);
  if (!panel) {
    throw new Error(`Painel inexistente: ${PANEL_PREFIX}${target}`);
  }

  showLoading(panel);

  try {
    const res = await fetch(route.url, FETCH_OPTS);
    const finalResponse = res.redirected ? await fetch(res.url, FETCH_OPTS) : res;
    if (!finalResponse.ok) {
      throw new Error(`HTTP ${finalResponse.status}`);
    }

    const html = await finalResponse.text();
    mount(panel, html, route.selector);

    if (pushState) {
      const url = new URL(location.href);
      url.searchParams.set("tab", target);
      history.pushState({ tab: target }, "", url);
    }
  } catch (err) {
    showError(panel, err);
    throw err;
  }
}

function mount(panel, html, selector) {
  const fragment = parseHTML(html, selector);
  window.BO?.destroy?.(panel);

  panel.innerHTML = "";
  panel.appendChild(fragment);

  panel.querySelectorAll('button:not([type])').forEach(btn => btn.setAttribute("type", "button"));
  panel.querySelectorAll('[onclick*="window.location"], [href^="javascript:"]').forEach(el => {
    el.removeAttribute("onclick");
    if (el.matches('[href^="javascript:"]')) {
      el.removeAttribute("href");
    }
  });

  window.BO?.init?.(panel);
  wirePanelNavigation(panel);
  panel.dataset.boPanelLoaded = "true";
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
}

function parseHTML(html, selector) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  if (!selector) {
    return tpl.content;
  }

  const selectors = String(selector)
    .split(",")
    .map(sel => sel.trim())
    .filter(Boolean);

  let root = null;
  for (const sel of selectors) {
    root = tpl.content.querySelector(sel);
    if (root) break;
  }

  const fragment = document.createDocumentFragment();
  const source = root || tpl.content;
  Array.from(source.childNodes).forEach(node => fragment.appendChild(node));
  return fragment;
}

function showLoading(panel) {
  panel.innerHTML = '<div class="bo-panel__loading" aria-busy="true">A carregar…</div>';
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
}

function showError(panel, err) {
  const message = err && err.message ? err.message : String(err || "Erro desconhecido");
  panel.innerHTML = `<div class="bo-panel__error">
    <p>Não foi possível carregar a secção.</p>
    <code>${escapeHtml(message)}</code>
    <button class="bo-retry" type="button">Tentar novamente</button>
  </div>`;
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

if (typeof window !== "undefined") {
  window.BackofficePanelLoader = Object.assign(window.BackofficePanelLoader || {}, {
    loadPanel
  });
}
