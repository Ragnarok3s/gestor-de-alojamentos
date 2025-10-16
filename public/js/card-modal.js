(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  function buildUrl(baseUrl, ym) {
    if (!baseUrl) return null;
    if (!ym) return baseUrl;
    var separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
    return baseUrl + separator + 'ym=' + encodeURIComponent(ym);
  }

  ready(function () {
    var modalRoot = document.querySelector('[data-unit-card-modal]');
    if (!modalRoot) return;
    var backdrop = modalRoot.querySelector('[data-modal-backdrop]');
    var dialog = modalRoot.querySelector('[data-modal-dialog]');
    if (!dialog) dialog = modalRoot.querySelector('.bo-modal__dialog');
    var titleEl = modalRoot.querySelector('[data-modal-title]');
    var bodyEl = modalRoot.querySelector('[data-modal-body]');
    var footerEl = modalRoot.querySelector('[data-modal-footer]');
    var closeBtn = modalRoot.querySelector('[data-modal-close]');
    var activeRequest = null;

    function setBodyContent(html, options) {
      if (!bodyEl) return;
      bodyEl.innerHTML = html;
      if (options && options.showFooter && footerEl) {
        footerEl.hidden = false;
        footerEl.innerHTML = options.footerHtml || '';
      } else if (footerEl) {
        footerEl.hidden = true;
        footerEl.innerHTML = '';
      }
      if (typeof window.refreshIcons === 'function') {
        try { window.refreshIcons(); } catch (err) { /* ignore */ }
      }
    }

    function setLoading(message) {
      var loadingHtml = '<div class="bo-modal__placeholder" role="status">' +
        (message || 'A carregar cartão da unidade...') + '</div>';
      setBodyContent(loadingHtml, { showFooter: false });
    }

    function setError(message) {
      var errorHtml = '<div class="bo-modal__placeholder" role="alert">' +
        (message || 'Não foi possível carregar o cartão da unidade.') + '</div>';
      setBodyContent(errorHtml, { showFooter: false });
    }

    function openModal() {
      if (!dialog || !backdrop) return;
      backdrop.hidden = false;
      dialog.hidden = false;
      document.body.classList.add('is-modal-open');
      dialog.focus();
    }

    function closeModal() {
      if (activeRequest && typeof activeRequest.abort === 'function') {
        activeRequest.abort();
      }
      if (dialog) dialog.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.classList.remove('is-modal-open');
    }

    function handleTriggerClick(event) {
      var trigger = event.currentTarget;
      if (trigger.disabled) return;
      event.preventDefault();
      var unitId = trigger.getAttribute('data-unit-id');
      var unitName = trigger.getAttribute('data-unit-card-name') || trigger.getAttribute('data-unit-name') || '';
      var customTitle = trigger.getAttribute('data-unit-card-title');
      if (titleEl) {
        var composedTitle = (customTitle || 'Cartão da unidade') + (unitName ? ' · ' + unitName : '');
        titleEl.textContent = composedTitle;
      }
      var baseUrl = trigger.getAttribute('data-unit-card-fetch');
      if (!baseUrl && unitId) {
        baseUrl = '/calendar/unit/' + encodeURIComponent(unitId) + '/card';
      }
      var ym = trigger.getAttribute('data-unit-card-ym');
      var url = buildUrl(baseUrl, ym);
      if (!url) {
        setError('Selecione uma unidade para consultar o cartão.');
        openModal();
        return;
      }
      if (window.__telemetry && typeof window.__telemetry.track === 'function') {
        try {
          window.__telemetry.track({
            route: url,
            referrer: window.location.pathname + window.location.search
          });
        } catch (err) {
          // ignore telemetry errors
        }
      }
      setLoading(trigger.getAttribute('data-unit-card-loading') || 'A preparar o cartão da unidade...');
      openModal();
      var controller = window.AbortController ? new AbortController() : null;
      if (controller) {
        activeRequest = controller;
      } else {
        activeRequest = { abort: function () {} };
      }
      fetch(url, { signal: controller ? controller.signal : undefined })
        .then(function (res) {
          if (!res.ok) {
            throw new Error('Estado ' + res.status);
          }
          return res.text();
        })
        .then(function (html) {
          setBodyContent(html || '<div class="bo-modal__placeholder">Sem dados disponíveis.</div>', {
            showFooter: false
          });
        })
        .catch(function () {
          setError('Não foi possível carregar o cartão da unidade.');
        })
        .finally(function () {
          activeRequest = null;
        });
    }

    function initTriggers() {
      var triggers = document.querySelectorAll('[data-unit-card-trigger]');
      triggers.forEach(function (trigger) {
        trigger.addEventListener('click', handleTriggerClick);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function (event) {
        event.preventDefault();
        closeModal();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', closeModal);
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeModal();
      }
    });

    initTriggers();
  });
})();
