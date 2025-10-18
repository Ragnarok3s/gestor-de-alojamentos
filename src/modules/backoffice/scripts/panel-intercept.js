import { loadPanel } from "./panel-loader.js";
import { BoRoutes } from "./backoffice-router.js";

const PANEL_PREFIX = "bo-panel-";

export function wirePanelNavigation(container) {
  if (!container || container.__boInterceptWired) return;
  container.__boInterceptWired = true;

  container.addEventListener(
    "click",
    async (event) => {
      const anchor = event.target.closest("a");
      const linkLike = event.target.closest("[data-href], [role='link']");
      let url = null;

      if (anchor) {
        if (anchor.target && anchor.target !== "_self") return;
        if (anchor.hasAttribute("download")) return;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        url = safeUrl(anchor.href);
      } else if (linkLike) {
        const hinted = linkLike.getAttribute("data-href") || linkLike.getAttribute("href");
        if (!hinted || hinted.startsWith("#")) return;
        url = safeUrl(hinted);
      }

      if (!url) return;
      if (url.origin !== location.origin) return;

      const panel = event.target.closest(`[id^="${PANEL_PREFIX}"]`);
      if (!panel) return;

      const target = routeFromUrl(url.pathname);
      if (!target) return;

      event.preventDefault();
      try {
        await navigateTo(target);
      } catch (err) {
        console.error(err);
      }
    },
    true
  );

  container.addEventListener(
    "submit",
    async (event) => {
      const form = event.target.closest("form");
      if (!form) return;

      const panel = event.target.closest(`[id^="${PANEL_PREFIX}"]`);
      if (!panel) return;

      event.preventDefault();

      const method = (form.method || "GET").toUpperCase();
      const action = safeUrl(form.action || location.href);
      if (!action) return;

      const target = routeFromUrl(action.pathname) || currentTab();
      showSubmitting(form);

      try {
        const response = await submitForm(action, method, new FormData(form));
        const html = await response.text();
        const { selector } = BoRoutes[target] || {};

        const fragment = (() => {
          const tpl = document.createElement("template");
          tpl.innerHTML = html;
          if (!selector) return tpl.content.cloneNode(true);
          const selectors = String(selector)
            .split(",")
            .map((sel) => sel.trim())
            .filter(Boolean);
          for (const sel of selectors) {
            const root = tpl.content.querySelector(sel);
            if (root) {
              const frag = document.createDocumentFragment();
              Array.from(root.childNodes).forEach((node) => frag.appendChild(node));
              return frag;
            }
          }
          return tpl.content.cloneNode(true);
        })();

        window.BO?.destroy?.(panel);
        panel.innerHTML = "";
        panel.appendChild(fragment);
        panel.querySelectorAll('button:not([type])').forEach((btn) => btn.setAttribute("type", "button"));
        panel.querySelectorAll('[onclick*="window.location"], [href^="javascript:"]').forEach((el) => {
          el.removeAttribute("onclick");
          if (el.matches('[href^="javascript:"]')) {
            el.removeAttribute("href");
          }
        });
        window.BO?.init?.(panel);
        wirePanelNavigation(panel);
        panel.dataset.boPanelLoaded = "true";
      } catch (err) {
        panel.innerHTML = `<div class="bo-panel__error"><p>Erro ao submeter.</p><code>${escapeHtml(
          err && err.message ? err.message : String(err)
        )}</code></div>`;
      } finally {
        resetSubmitting(form);
      }
    },
    true
  );
}

function routeFromUrl(pathname) {
  const clean = pathname.replace(/\/+$/, "");
  const keys = Object.keys(BoRoutes);
  for (const key of keys) {
    const candidate = BoRoutes[key];
    if (!candidate) continue;
    const candidateUrl = (candidate.url || "").replace(/\/+$/, "");
    if (candidateUrl === clean) {
      return key;
    }
  }
  return null;
}

function currentTab() {
  const active = document.querySelector(".bo-tab.is-active");
  return active ? active.dataset.boTarget || null : null;
}

async function navigateTo(target) {
  document.querySelectorAll(".bo-tab.is-active").forEach((btn) => {
    btn.classList.remove("is-active");
    btn.setAttribute("aria-selected", "false");
  });

  const button = document.querySelector(`.bo-tab[data-bo-target="${cssEscape(target)}"]`);
  if (button) {
    button.classList.add("is-active");
    button.setAttribute("aria-selected", "true");
  }

  const panelId = `${PANEL_PREFIX}${target}`;
  document.querySelectorAll(`[id^="${PANEL_PREFIX}"]`).forEach((panel) => {
    const isActive = panel.id === panelId;
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    if (!isActive) {
      panel.classList.remove("is-active");
    } else {
      panel.classList.add("is-active");
      if (button?.id) {
        panel.setAttribute("aria-labelledby", button.id);
      }
    }
  });

  await loadPanel(target, { pushState: true });
}

function showSubmitting(form) {
  const submit = form.querySelector('[type="submit"]');
  if (!submit) return;
  submit.disabled = true;
  if (!submit.dataset.boSubmitOriginalLabel) {
    submit.dataset.boSubmitOriginalLabel = submit.innerHTML;
  }
  submit.innerHTML = "A guardar…";
}

function resetSubmitting(form) {
  const submit = form.querySelector('[type="submit"]');
  if (!submit) return;
  submit.disabled = false;
  if (submit.dataset.boSubmitOriginalLabel) {
    submit.innerHTML = submit.dataset.boSubmitOriginalLabel;
    delete submit.dataset.boSubmitOriginalLabel;
  }
}

async function submitForm(action, method, body) {
  const opts = {
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "fetch",
      Accept: "text/html"
    }
  };

  if (method === "GET") {
    const params = new URLSearchParams(body);
    action.search = params.toString();
    return fetch(action, opts).then(handleResponse);
  }

  return fetch(action, {
    ...opts,
    method,
    body
  }).then(handleResponse);
}

async function handleResponse(response) {
  if (response.redirected) {
    return followRedirect(response);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function followRedirect(response) {
  const redirected = await fetch(response.url, {
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "fetch",
      Accept: "text/html"
    }
  });
  if (!redirected.ok) {
    throw new Error(`HTTP ${redirected.status}`);
  }
  return redirected;
}

function safeUrl(input) {
  try {
    return new URL(input, location.origin);
  } catch (err) {
    return null;
  }
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9\-_.]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
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
  window.BackofficePanelIntercept = Object.assign(window.BackofficePanelIntercept || {}, {
    wirePanelNavigation
  });
}
