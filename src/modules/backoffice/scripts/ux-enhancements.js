(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function ensureStyles() {
    if (document.getElementById('ux-enhancements-styles')) return;
    var style = document.createElement('style');
    style.id = 'ux-enhancements-styles';
    style.textContent = "\n      .bo-toast-stack { position: fixed; top: 1.5rem; right: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; z-index: 60; max-width: 22rem; }\n      @media (max-width: 768px) { .bo-toast-stack { left: 50%; right: auto; transform: translateX(-50%); width: calc(100% - 2rem); } }\n      .bo-toast { background: #0f172a; color: #f8fafc; padding: 0.9rem 1rem; border-radius: 0.75rem; box-shadow: 0 15px 30px rgba(15, 23, 42, 0.25); display: flex; align-items: center; gap: 0.75rem; font-size: 0.9rem; outline: none; }\n      .bo-toast--success { background: #047857; }\n      .bo-toast--error { background: #b91c1c; }\n      .bo-toast__message { flex: 1 1 auto; }\n      .bo-toast__action { background: rgba(248, 250, 252, 0.18); color: inherit; border: none; border-radius: 999px; padding: 0.25rem 0.75rem; font-weight: 600; cursor: pointer; }\n      .bo-modal { position: fixed; inset: 0; z-index: 55; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }\n      .bo-modal.hidden { display: none; }\n      .bo-modal__backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45); }\n      .bo-modal__content { position: relative; z-index: 1; background: #fff; border-radius: 1rem; padding: 1.5rem; width: min(36rem, 100%); max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 45px rgba(15, 23, 42, 0.35); }\n      .bo-modal__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }\n      .bo-modal__close { border: none; background: rgba(15, 23, 42, 0.08); border-radius: 999px; width: 2rem; height: 2rem; font-size: 1.15rem; line-height: 1; cursor: pointer; color: #0f172a; }\n      .bo-status-badge { display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 999px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.1rem 0.55rem; margin-left: 0.4rem; vertical-align: middle; }\n      .bo-status-badge--warning { background: rgba(250, 204, 21, 0.18); color: #92400e; border: 1px solid rgba(217, 119, 6, 0.35); }\n      .animate-pulse { animation: ux-pulse 1.4s ease-in-out infinite; }\n      @keyframes ux-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }\n    ";
    document.head.appendChild(style);
  }

  function parseConfig() {
    var el = document.getElementById('ux-dashboard-config');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (err) {
      console.error('[ux] configuração inválida', err);
      return null;
    }
  }

  function createToastManager() {
    var container = document.querySelector('[data-toast-container]');
    if (!container) {
      container = document.createElement('div');
      container.dataset.toastContainer = 'true';
      container.className = 'bo-toast-stack';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }

    function showToast(options) {
      if (!options) options = {};
      var type = options.type || 'info';
      var toast = document.createElement('div');
      toast.className = 'bo-toast bo-toast--' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
      toast.setAttribute('role', 'status');
      toast.setAttribute('tabindex', '-1');
      var message = document.createElement('div');
      message.className = 'bo-toast__message';
      message.textContent = options.message || '';
      toast.appendChild(message);
      if (options.action && typeof options.action.onClick === 'function') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bo-toast__action';
        btn.textContent = options.action.label || 'Anular';
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          options.action.onClick();
          dismiss();
        });
        toast.appendChild(btn);
      }
      container.appendChild(toast);
      setTimeout(function () {
        try { toast.focus(); } catch (err) {}
      }, 50);

      var timeout = setTimeout(dismiss, options.duration || 5000);

      function dismiss() {
        clearTimeout(timeout);
        if (!toast.parentElement) return;
        toast.classList.add('is-dismissed');
        setTimeout(function () {
          if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 200);
      }

      return { dismiss: dismiss, element: toast };
    }

    return { show: showToast };
  }

  function formatCurrencyFromCents(cents) {
    var formatter = formatCurrencyFromCents._cache;
    if (!formatter) {
      formatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
      formatCurrencyFromCents._cache = formatter;
    }
    return formatter.format((cents || 0) / 100);
  }

  function formatPercent(value) {
    var formatter = formatPercent._cache;
    if (!formatter) {
      formatter = new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 1 });
      formatPercent._cache = formatter;
    }
    return formatter.format(value || 0);
  }

  function setFieldError(field, message) {
    if (!field) return;
    var error = field.querySelector('[data-error]');
    var input = field.querySelector('input, textarea, select');
    if (error) {
      error.textContent = message || '';
      error.hidden = !message;
    }
    if (input) {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  function clearFieldErrors(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-field]').forEach(function (field) {
      setFieldError(field, '');
    });
  }

  function buildNights(start, end, weekendsOnly) {
    var nights = [];
    if (!start || !end) return nights;
    var cursor = new Date(start + 'T00:00:00');
    var limit = new Date(end + 'T00:00:00');
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(limit.getTime())) return nights;
    while (cursor <= limit) {
      var day = cursor.getDay();
      if (!weekendsOnly || day === 5 || day === 6 || day === 0) {
        nights.push({
          date: cursor.toISOString().slice(0, 10),
          label: cursor.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' })
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return nights;
  }

  function setupRatesModule(config, toast) {
    var card = document.querySelector('[data-rates-bulk]');
    if (!card) return;
    var form = card.querySelector('[data-rates-form]');
    var startInput = card.querySelector('[data-rate-start]');
    var endInput = card.querySelector('[data-rate-end]');
    var priceInput = card.querySelector('[data-rate-price]');
    var unitSelect = card.querySelector('[data-rate-unit]');
    var typeSelect = card.querySelector('[data-rate-type]');
    var weekendCheckbox = card.querySelector('[data-rate-weekends]');
    var previewWrapper = card.querySelector('[data-rate-preview-wrapper]');
    var previewBody = card.querySelector('[data-rate-preview]');
    var summaryEl = card.querySelector('[data-rate-summary]');
    var loadingEl = card.querySelector('[data-rate-loading]');
    var feedbackEl = card.querySelector('[data-rate-feedback]');
    if (!form || !startInput || !endInput || !priceInput || !unitSelect || !typeSelect) return;

    var units = Array.isArray(config && config.units) ? config.units.slice() : [];
    units.sort(function (a, b) {
      var prop = (a.propertyName || '').localeCompare(b.propertyName || '', 'pt');
      if (prop !== 0) return prop;
      return (a.name || '').localeCompare(b.name || '', 'pt');
    });
    var unitOptions = document.createDocumentFragment();
    units.forEach(function (unit) {
      var option = document.createElement('option');
      option.value = String(unit.id);
      option.textContent = (unit.propertyName ? unit.propertyName + ' · ' : '') + unit.name;
      unitOptions.appendChild(option);
    });
    unitSelect.appendChild(unitOptions);

    var types = Array.isArray(config && config.unitTypes) ? config.unitTypes : [];
    types.forEach(function (type) {
      var option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      typeSelect.appendChild(option);
    });

    function describePreview(selectedUnits, nights) {
      return (
        selectedUnits.length + ' unidade' + (selectedUnits.length === 1 ? '' : 's') +
        ' · ' + nights.length + ' noite' + (nights.length === 1 ? '' : 's')
      );
    }

    function populatePreview(selectedUnits, nights, priceValue) {
      if (!previewBody) return;
      if (!selectedUnits.length || !nights.length) {
        previewBody.innerHTML = '<tr><td colspan="3" class="text-sm text-center text-slate-500">Seleciona um intervalo para visualizar o impacto.</td></tr>';
        if (previewWrapper) previewWrapper.hidden = true;
        if (summaryEl) summaryEl.textContent = '';
        return;
      }
      var nightBadges = nights
        .map(function (night) {
          return '<span class="inline-flex items-center bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs">' + night.label + '</span>';
        })
        .join(' ');
      previewBody.innerHTML = selectedUnits
        .map(function (unit) {
          return (
            '<tr>' +
            '<td data-label="Unidade"><span class="table-cell-value">' +
            ((unit.propertyName ? unit.propertyName + ' · ' : '') + unit.name) +
            '</span></td>' +
            '<td data-label="Noites" class="space-x-1">' + nightBadges + '</td>' +
            '<td data-label="Preço aplicado">' +
            (priceValue > 0
              ? '€ ' + priceValue.toFixed(2).replace('.', ',')
              : '<span class="text-slate-400">—</span>') +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
      if (previewWrapper) previewWrapper.hidden = false;
      if (summaryEl) summaryEl.textContent = describePreview(selectedUnits, nights);
    }

    function getSelectedUnits() {
      var targetId = unitSelect.value;
      var typeFilter = typeSelect.value;
      return units.filter(function (unit) {
        if (targetId && String(unit.id) !== targetId) return false;
        if (typeFilter && unit.unitType !== typeFilter) return false;
        return true;
      });
    }

    function setBusy(flag) {
      card.setAttribute('aria-busy', flag ? 'true' : 'false');
      if (loadingEl) loadingEl.hidden = !flag;
    }

    function refreshPreview() {
      var start = startInput.value;
      var end = endInput.value;
      var priceValue = Number(priceInput.value);
      var weekendsOnly = !!(weekendCheckbox && weekendCheckbox.checked);
      var selectedUnits = getSelectedUnits();
      var nights = buildNights(start, end, weekendsOnly);
      populatePreview(selectedUnits, nights, Number.isFinite(priceValue) ? priceValue : 0);
    }

    function applyBulkUpdate() {
      clearFieldErrors(form);
      if (feedbackEl) feedbackEl.textContent = '';
      var start = startInput.value;
      var end = endInput.value;
      var priceValue = Number(priceInput.value);
      var weekendsOnly = !!(weekendCheckbox && weekendCheckbox.checked);
      var selectedUnits = getSelectedUnits();
      var nights = buildNights(start, end, weekendsOnly);

      var valid = true;
      if (!start) {
        setFieldError(startInput.closest('[data-field]'), 'Seleciona a data inicial.');
        valid = false;
      }
      if (!end) {
        setFieldError(endInput.closest('[data-field]'), 'Seleciona a data final.');
        valid = false;
      }
      if (start && end && new Date(start) > new Date(end)) {
        setFieldError(endInput.closest('[data-field]'), 'Data final deve ser posterior à inicial.');
        valid = false;
      }
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        setFieldError(priceInput.closest('[data-field]'), 'Indica um preço positivo.');
        valid = false;
      }
      if (!selectedUnits.length) {
        setFieldError(unitSelect.closest('[data-field]'), 'Seleciona pelo menos uma unidade.');
        valid = false;
      }
      if (!nights.length) {
        setFieldError(endInput.closest('[data-field]'), 'Intervalo sem noites para aplicar.');
        valid = false;
      }
      populatePreview(selectedUnits, nights, Number.isFinite(priceValue) ? priceValue : 0);
      if (!valid) return;

      setBusy(true);
      fetch('/admin/api/rates/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          unitIds: selectedUnits.map(function (unit) { return unit.id; }),
          dateRange: { start: start, end: end },
          price: priceValue
        })
      })
        .then(function (resp) {
          if (!resp.ok) return resp.json().then(function (payload) { throw payload; });
          return resp.json();
        })
        .then(function (payload) {
          if (!payload || !payload.ok) throw payload;
          var nightsCount = nights.length * selectedUnits.length;
          var toastInstance = toast.show({
            type: 'success',
            message: 'Preços atualizados para ' + nights.length + ' noite' + (nights.length === 1 ? '' : 's') + ' em ' + selectedUnits.length + ' unidade' + (selectedUnits.length === 1 ? '' : 's') + '.',
            action: payload.rateIds && payload.rateIds.length ? {
              label: 'Anular',
              onClick: function () {
                undoBulk(payload.rateIds);
              }
            } : null,
            duration: 5000
          });
          if (feedbackEl) feedbackEl.textContent = describePreview(selectedUnits, nights) + ' · ' + nightsCount + ' noites impactadas.';
          form.reset();
          if (previewWrapper) previewWrapper.hidden = true;
          refreshPreview();
          if (toastInstance && toastInstance.element) toastInstance.element.focus();
        })
        .catch(function (err) {
          var message = (err && (err.error || err.message)) || 'Não foi possível atualizar os preços. Tenta novamente.';
          toast.show({ type: 'error', message: message });
          if (feedbackEl) feedbackEl.textContent = message;
        })
        .finally(function () {
          setBusy(false);
        });
    }

    function undoBulk(rateIds) {
      if (!Array.isArray(rateIds) || !rateIds.length) return;
      fetch('/admin/api/rates/bulk/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ rateIds: rateIds })
      })
        .then(function (resp) {
          if (!resp.ok) return resp.json().then(function (payload) { throw payload; });
          return resp.json();
        })
        .then(function () {
          toast.show({ type: 'success', message: 'Alteração anulada.' });
        })
        .catch(function (err) {
          toast.show({ type: 'error', message: (err && err.error) || 'Não foi possível anular.' });
        });
    }

    function attachClearHandler(input) {
      if (!input) return;
      var field = input.closest('[data-field]');
      var eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
      input.addEventListener(eventName, function () {
        setFieldError(field, '');
        refreshPreview();
      });
    }

    card.querySelectorAll('[data-field] input, [data-field] select, [data-field] textarea').forEach(function (input) {
      attachClearHandler(input);
    });

    card.querySelector('[data-rate-apply]')?.addEventListener('click', function (event) {
      event.preventDefault();
      applyBulkUpdate();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      applyBulkUpdate();
    });
  }

  function formatDateRangeLabel(start, endExclusive) {
    var startDate = new Date(start + 'T00:00:00');
    var endDate = new Date(endExclusive + 'T00:00:00');
    if (!Number.isFinite(startDate.getTime())) return start;
    if (!Number.isFinite(endDate.getTime())) return startDate.toLocaleDateString('pt-PT');
    endDate.setDate(endDate.getDate() - 1);
    return (
      startDate.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) +
      '–' +
      endDate.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
    );
  }

  function setupBlockModal(config, toast) {
    var modal = document.querySelector('[data-block-modal]');
    if (!modal) return;
    var titleEl = modal.querySelector('[data-block-title]');
    var form = modal.querySelector('[data-block-form]');
    var startInput = modal.querySelector('[data-block-start]');
    var endInput = modal.querySelector('[data-block-end]');
    var reasonInput = modal.querySelector('[data-block-reason]');
    var conflictEl = modal.querySelector('[data-block-conflict]');
    var countEl = modal.querySelector('[data-block-count]');
    var loadingEl = modal.querySelector('[data-block-loading]');
    var submitButton = modal.querySelector('[data-block-submit]');
    if (!form || !startInput || !endInput || !reasonInput) return;

    function updateCount() {
      if (!countEl) return;
      var value = reasonInput.value || '';
      countEl.textContent = value.length + ' / 240';
    }

    reasonInput.addEventListener('input', updateCount);
    updateCount();

    function closeModal() {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function openModal(button) {
      clearFieldErrors(form);
      if (conflictEl) {
        conflictEl.hidden = true;
        conflictEl.removeAttribute('tabindex');
      }
      form.reset();
      updateCount();
      modal.dataset.unitId = button.dataset.blockUnit;
      modal.dataset.unitName = button.dataset.unitName || '';
      if (titleEl) {
        var base = 'Bloquear unidade';
        if (modal.dataset.unitName) base += ' – ' + modal.dataset.unitName;
        titleEl.textContent = base;
      }
      var today = new Date();
      var startDefault = today.toISOString().slice(0, 10);
      var endDefault = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      startInput.value = startDefault;
      endInput.value = endDefault;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        try { startInput.focus(); } catch (err) {}
      }, 80);
    }

    function setBusy(flag) {
      form.setAttribute('aria-busy', flag ? 'true' : 'false');
      if (submitButton) submitButton.disabled = !!flag;
      if (loadingEl) loadingEl.hidden = !flag;
    }

    function updateBadges(unitId, start, endExclusive, reason) {
      var badges = document.querySelectorAll('[data-block-badge="' + unitId + '"]');
      if (!badges.length) return;
      var rangeLabel = formatDateRangeLabel(start, endExclusive);
      badges.forEach(function (badge) {
        badge.hidden = false;
        badge.classList.remove('hidden');
        badge.textContent = 'Bloqueado';
        badge.setAttribute('aria-label', 'Bloqueado ' + rangeLabel + (reason ? ' · ' + reason : ''));
        badge.title = 'Bloqueado ' + rangeLabel + (reason ? ' · ' + reason : '');
      });
    }

    function submitBlock(event) {
      event.preventDefault();
      clearFieldErrors(form);
      if (conflictEl) conflictEl.hidden = true;
      var start = startInput.value;
      var end = endInput.value;
      var reason = reasonInput.value.trim();
      var unitId = modal.dataset.unitId;
      if (!unitId) return;
      var valid = true;
      if (!start) {
        setFieldError(startInput.closest('[data-field]'), 'Seleciona a data inicial.');
        valid = false;
      }
      if (!end) {
        setFieldError(endInput.closest('[data-field]'), 'Seleciona a data final.');
        valid = false;
      }
      if (start && end && new Date(start) > new Date(end)) {
        setFieldError(endInput.closest('[data-field]'), 'Data final deve ser posterior à inicial.');
        valid = false;
      }
      if (!reason) {
        setFieldError(reasonInput.closest('[data-field]'), 'Indica o motivo do bloqueio.');
        valid = false;
      }
      if (!valid) return;

      var unitLabel = modal.dataset.unitName || 'unidade';
      var confirmEndExclusive = end;
      var endForConfirm = new Date(end + 'T00:00:00');
      if (Number.isFinite(endForConfirm.getTime())) {
        endForConfirm.setDate(endForConfirm.getDate() + 1);
        confirmEndExclusive = endForConfirm.toISOString().slice(0, 10);
      }
      var confirmRange = formatDateRangeLabel(start, confirmEndExclusive);
      var confirmationMessage = 'Confirmas o bloqueio de ' + unitLabel + ' entre ' + confirmRange + '?';
      var confirmResult = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(confirmationMessage) : true;
      if (!confirmResult) return;

      setBusy(true);
      fetch('/admin/api/units/' + unitId + '/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ start: start, end: end, reason: reason })
      })
        .then(function (resp) {
          if (!resp.ok) return resp.json().then(function (payload) { throw payload; });
          return resp.json();
        })
        .then(function (payload) {
          if (!payload || !payload.ok) throw payload;
          var block = payload.block || {};
          var blockStart = block.start_date || start;
          var blockEnd = block.end_date || null;
          if (!blockEnd) {
            var fallbackEnd = new Date(end + 'T00:00:00');
            if (Number.isFinite(fallbackEnd.getTime())) {
              fallbackEnd.setDate(fallbackEnd.getDate() + 1);
              blockEnd = fallbackEnd.toISOString().slice(0, 10);
            } else {
              blockEnd = end;
            }
          }
          var blockReason = typeof block.reason === 'string' ? block.reason : reason;
          var nightsCount = payload.summary && payload.summary.nights ? payload.summary.nights : null;
          var successMessage = 'Bloqueio criado para ' + unitLabel + '.';
          if (Number.isFinite(nightsCount)) {
            successMessage =
              'Bloqueio criado para ' + unitLabel + ' durante ' + nightsCount + ' noite' + (nightsCount === 1 ? '' : 's') + '.';
          }
          toast.show({ type: 'success', message: successMessage });
          updateBadges(unitId, blockStart, blockEnd, blockReason);
          closeModal();
        })
        .catch(function (err) {
          var message = (err && err.error) || 'Não foi possível bloquear a unidade.';
          if (err && err.details) message = err.details;
          if (err && err.error && err.error.includes('reservas')) {
            if (conflictEl) {
              conflictEl.textContent = err.error;
              conflictEl.hidden = false;
              conflictEl.setAttribute('tabindex', '-1');
              setTimeout(function () {
                try { conflictEl.focus(); } catch (focusErr) {}
              }, 40);
            }
          } else {
            toast.show({ type: 'error', message: message });
          }
        })
        .finally(function () {
          setBusy(false);
        });
    }

    modal.addEventListener('click', function (event) {
      if (event.target && event.target.matches('[data-block-dismiss]')) {
        event.preventDefault();
        closeModal();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });

    form.addEventListener('submit', submitBlock);

    document.querySelectorAll('[data-block-unit]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        openModal(button);
      });
    });
  }

  function setupReviews(toast) {
    var pane = document.querySelector('[data-reviews-pane]');
    if (!pane) return;
    var listEl = pane.querySelector('[data-reviews-list]');
    var counterEl = pane.querySelector('[data-reviews-counter]');
    var emptyEl = pane.querySelector('[data-reviews-empty]');
    var skeletonMarkup = listEl ? listEl.innerHTML : '';
    var composer = pane.querySelector('[data-review-composer]');
    var selectedReviewEl = pane.querySelector('[data-selected-review]');
    var responseInput = pane.querySelector('[data-review-response]');
    var responseField = responseInput ? responseInput.closest('[data-field]') : null;
    var countEl = pane.querySelector('[data-review-count]');
    var loadingEl = pane.querySelector('[data-review-loading]');
    var submitBtn = pane.querySelector('[data-review-submit]');
    var filters = pane.querySelectorAll('[data-review-filter]');
    if (!listEl || !composer || !selectedReviewEl || !responseInput) return;

    var activeFilter = 'all';
    var activeReview = null;

    function setBusy(flag) {
      listEl.setAttribute('aria-busy', flag ? 'true' : 'false');
      if (flag) {
        if (skeletonMarkup) {
          listEl.innerHTML = skeletonMarkup;
        }
        if (emptyEl) emptyEl.hidden = true;
      }
    }

    function updateCharCount() {
      if (!countEl) return;
      countEl.textContent = (responseInput.value || '').length + ' / 1000';
    }

    responseInput.addEventListener('input', function () {
      if (responseField) setFieldError(responseField, '');
      updateCharCount();
      autoGrow(responseInput);
    });
    updateCharCount();

    function autoGrow(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }

    function renderReview(review) {
      var responded = review.responded || !!review.responded_at;
      var wrapper = document.createElement('article');
      wrapper.className = 'rounded-xl border border-slate-200 bg-white/80 p-3 space-y-2';
      wrapper.dataset.reviewId = review.id;
      var header = document.createElement('div');
      header.className = 'flex items-start justify-between gap-3';
      var title = document.createElement('div');
      title.innerHTML = '<div class="font-semibold text-slate-800">' + (review.title || 'Sem título') + '</div>' +
        '<div class="text-xs text-slate-500">' +
        (review.rating ? ('Classificação: ' + review.rating + '/5 · ') : '') +
        (review.stay_date ? new Date(review.stay_date).toLocaleDateString('pt-PT') : '') +
        (review.source ? ' · ' + review.source : '') +
        '</div>';
      header.appendChild(title);
      var actions = document.createElement('div');
      actions.className = 'flex items-center gap-2';
      if (responded) {
        var badge = document.createElement('span');
        badge.className = 'bo-status-badge bo-status-badge--warning';
        badge.textContent = 'Respondida';
        actions.appendChild(badge);
      }
      if (!responded) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-light btn-compact';
        btn.textContent = 'Responder';
        btn.addEventListener('click', function () {
          openComposer(review);
        });
        actions.appendChild(btn);
      }
      header.appendChild(actions);
      wrapper.appendChild(header);

      var body = document.createElement('p');
      body.className = 'text-sm text-slate-600 whitespace-pre-line';
      body.textContent = review.body || '';
      wrapper.appendChild(body);

      if (responded && review.response_text) {
        var response = document.createElement('div');
        response.className = 'rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800';
        response.textContent = review.response_text;
        wrapper.appendChild(response);
      }

      return wrapper;
    }

    function openComposer(review) {
      activeReview = review;
      composer.hidden = false;
      if (responseField) setFieldError(responseField, '');
      selectedReviewEl.innerHTML = '<div class="text-sm font-semibold text-slate-700">' + (review.title || 'Review sem título') + '</div>' +
        '<div class="text-xs text-slate-500">' + (review.guest_name || 'Hóspede anónimo') + '</div>' +
        '<p class="text-sm text-slate-600 whitespace-pre-line">' + (review.body || '') + '</p>';
      responseInput.value = review.response_text || '';
      updateCharCount();
      setTimeout(function () {
        responseInput.focus();
        autoGrow(responseInput);
      }, 60);
    }

    function closeComposer() {
      composer.hidden = true;
      activeReview = null;
      responseInput.value = '';
      updateCharCount();
      selectedReviewEl.innerHTML = '';
      if (responseField) setFieldError(responseField, '');
    }

    pane.querySelector('[data-review-cancel]')?.addEventListener('click', function () {
      closeComposer();
    });

    submitBtn?.addEventListener('click', function () {
      if (!activeReview) return;
      var value = responseInput.value.trim();
      if (!value) {
        if (responseField) setFieldError(responseField, 'Escreve uma resposta antes de enviar.');
        return;
      }
      if (responseField) setFieldError(responseField, '');
      if (loadingEl) loadingEl.hidden = false;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-disabled', 'true');
      }
      fetch('/admin/api/reviews/' + activeReview.id + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ response: value })
      })
        .then(function (resp) {
          if (!resp.ok)
            return resp.json().then(function (payload) {
              throw { status: resp.status, payload: payload };
            });
          return resp.json();
        })
        .then(function (payload) {
          toast.show({ type: 'success', message: 'Resposta registada.' });
          closeComposer();
          refreshReviews(activeFilter);
        })
        .catch(function (err) {
          var message = (err && err.payload && err.payload.error) || (err && err.error) || 'Não foi possível enviar a resposta.';
          if (err && err.status === 400 && responseField) {
            setFieldError(responseField, message);
          }
          toast.show({ type: 'error', message: message });
        })
        .finally(function () {
          if (loadingEl) loadingEl.hidden = true;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-disabled');
          }
        });
    });

    function renderReviews(reviews) {
      if (counterEl) {
        var label = reviews.length + ' review' + (reviews.length === 1 ? '' : 's');
        if (activeFilter === 'negative') label += ' negativas';
        if (activeFilter === 'recent') label += ' recentes';
        counterEl.textContent = label;
      }
      listEl.innerHTML = '';
      if (!reviews.length) {
        emptyEl && (emptyEl.hidden = false);
        return;
      }
      emptyEl && (emptyEl.hidden = true);
      var frag = document.createDocumentFragment();
      reviews.forEach(function (review) {
        frag.appendChild(renderReview(review));
      });
      listEl.appendChild(frag);
    }

    function refreshReviews(filter) {
      activeFilter = filter;
      setBusy(true);
      var url = '/admin/api/reviews';
      if (filter === 'negative' || filter === 'recent') {
        url += '?filter=' + encodeURIComponent(filter);
      }
      fetch(url)
        .then(function (resp) {
          if (!resp.ok)
            return resp.json().then(function (payload) {
              throw payload;
            });
          return resp.json();
        })
        .then(function (payload) {
          var reviews = (payload && payload.reviews) || [];
          renderReviews(reviews);
        })
        .catch(function (err) {
          toast.show({ type: 'error', message: (err && err.error) || 'Não foi possível carregar as reviews.' });
        })
        .finally(function () {
          setBusy(false);
        });
    }

    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        filters.forEach(function (other) {
          other.classList.remove('is-active');
          other.setAttribute('aria-selected', 'false');
        });
        button.classList.add('is-active');
        button.setAttribute('aria-selected', 'true');
        refreshReviews(button.dataset.reviewFilter || 'all');
        closeComposer();
      });
    });

    refreshReviews(activeFilter);
  }

  function setupWeeklyExport(config, toast) {
    var wrapper = document.querySelector('[data-weekly-export]');
    if (!wrapper) return;
    var fromInput = wrapper.querySelector('[data-weekly-from]');
    var toInput = wrapper.querySelector('[data-weekly-to]');
    var statusEl = wrapper.querySelector('[data-weekly-status]');
    if (config && config.weeklyDefaults) {
      if (fromInput) fromInput.value = config.weeklyDefaults.from;
      if (toInput) toInput.value = config.weeklyDefaults.to;
    }

    function validateRange() {
      clearFieldErrors(wrapper);
      var valid = true;
      if (!fromInput.value) {
        setFieldError(fromInput.closest('[data-field]'), 'Seleciona a data de início.');
        valid = false;
      }
      if (!toInput.value) {
        setFieldError(toInput.closest('[data-field]'), 'Seleciona a data de fim.');
        valid = false;
      }
      if (fromInput.value && toInput.value && new Date(fromInput.value) > new Date(toInput.value)) {
        setFieldError(toInput.closest('[data-field]'), 'Data final deve ser posterior à inicial.');
        valid = false;
      }
      return valid;
    }

    function download(format) {
      if (!validateRange()) return;
      var url = '/admin/api/reports/weekly?from=' + encodeURIComponent(fromInput.value) + '&to=' + encodeURIComponent(toInput.value) + '&format=' + format;
      if (statusEl) {
        statusEl.textContent = 'A gerar ' + format.toUpperCase() + '…';
      }
      fetch(url)
        .then(function (resp) {
          if (!resp.ok) return resp.json().then(function (payload) { throw payload; });
          return resp.blob();
        })
        .then(function (blob) {
          var downloadUrl = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = downloadUrl;
          link.download = 'relatorio-semanal-' + fromInput.value + '-' + toInput.value + '.' + format;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(function () { URL.revokeObjectURL(downloadUrl); }, 1000);
          toast.show({ type: 'success', message: 'Relatório semanal exportado (' + format.toUpperCase() + ').' });
        })
        .catch(function (err) {
          toast.show({ type: 'error', message: (err && err.error) || 'Não foi possível exportar o relatório.' });
        })
        .finally(function () {
          if (statusEl) statusEl.textContent = '';
        });
    }

    wrapper.querySelectorAll('[data-weekly-export-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        download(button.dataset.weeklyExportAction);
      });
    });
  }

  function initKpiCard(config, toast) {
    var card = document.querySelector('[data-kpi-card]');
    if (!card) return;
    var occupancyEl = card.querySelector('[data-kpi-occupancy]');
    var adrEl = card.querySelector('[data-kpi-adr]');
    var revparEl = card.querySelector('[data-kpi-revpar]');
    if (config && config.kpi) {
      if (occupancyEl) occupancyEl.textContent = formatPercent(config.kpi.occupancyRate || 0);
      if (adrEl) adrEl.textContent = formatCurrencyFromCents(config.kpi.adrCents || 0);
      if (revparEl) revparEl.textContent = formatCurrencyFromCents(config.kpi.revparCents || 0);
    }
    var infoBtn = card.querySelector('[data-kpi-info]');
    if (infoBtn) {
      infoBtn.addEventListener('click', function () {
        toast.show({
          type: 'info',
          message: 'Monitoriza variações: queda de ocupação com ADR alto indica oportunidade de promoções rápidas.'
        });
      });
    }
  }

  ready(function () {
    ensureStyles();
    var config = parseConfig() || {};
    var toast = createToastManager();
    initKpiCard(config, toast);
    setupRatesModule(config, toast);
    setupBlockModal(config, toast);
    setupReviews(toast);
    setupWeeklyExport(config, toast);
  });
})();
