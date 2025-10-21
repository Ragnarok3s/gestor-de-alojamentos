(function() {
  const dataEl = document.getElementById('extras-data');
  if (!dataEl) return;

  let initialState = {};
  try {
    initialState = JSON.parse(dataEl.textContent || '{}');
  } catch (err) {
    initialState = {};
  }

  const translations = initialState && typeof initialState.translations === 'object' ? initialState.translations : {};

  function resolveTranslation(path) {
    if (!path) return undefined;
    return String(path)
      .split('.')
      .reduce((acc, segment) => {
        if (acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, segment)) {
          return acc[segment];
        }
        return undefined;
      }, translations);
  }

  function formatTemplate(template, values) {
    if (typeof template !== 'string' || !values) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        const value = values[key];
        return value == null ? '' : String(value);
      }
      return match;
    });
  }

  function translate(key, fallback, values) {
    const template = resolveTranslation(key);
    const base = template === undefined ? fallback : template;
    if (typeof base === 'string') {
      return formatTemplate(base, values);
    }
    return base !== undefined ? base : fallback;
  }

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const listEl = document.querySelector('[data-extras-list]');
  const emptyEl = document.querySelector('[data-extras-empty]');
  const addBtn = document.querySelector('[data-add-extra]');
  const formEl = document.querySelector('[data-extras-form]');
  const outputEl = document.querySelector('[data-extras-json]');

  if (!listEl || !formEl || !outputEl) {
    return;
  }

  const state = {
    extras: Array.isArray(initialState.extras) ? initialState.extras.map(normalizeExtra) : []
  };

  function normalizeExtra(extra) {
    const safe = typeof extra === 'object' && extra ? { ...extra } : {};
    return {
      name: typeof safe.name === 'string' ? safe.name : '',
      code: typeof safe.code === 'string' ? safe.code : '',
      description: typeof safe.description === 'string' ? safe.description : '',
      priceEuros: typeof safe.priceEuros === 'string' || typeof safe.priceEuros === 'number' ? String(safe.priceEuros) : '',
      pricingRule: safe.pricingRule === 'long_stay' ? 'long_stay' : 'standard',
      minNights: typeof safe.minNights === 'number' || typeof safe.minNights === 'string' ? String(safe.minNights || '') : '',
      discountPercent:
        typeof safe.discountPercent === 'number' || typeof safe.discountPercent === 'string'
          ? String(safe.discountPercent || '')
          : '',
      availabilityFrom:
        typeof safe.availabilityFrom === 'string'
          ? safe.availabilityFrom
          : typeof safe.availability === 'object' && safe.availability
            ? safe.availability.from || ''
            : '',
      availabilityTo:
        typeof safe.availabilityTo === 'string'
          ? safe.availabilityTo
          : typeof safe.availability === 'object' && safe.availability
            ? safe.availability.to || ''
            : ''
    };
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function setState(updater, options = {}) {
    const next = typeof updater === 'function' ? updater(state.extras.slice()) : updater;
    state.extras = Array.isArray(next) ? next.map(normalizeExtra) : [];
    if (!options.skipRender) {
      render();
    }
  }

  function updateExtra(index, patch, options = {}) {
    let updated;
    setState(
      current => {
        if (index < 0 || index >= current.length) return current;
        const next = current.slice();
        updated = normalizeExtra({ ...next[index], ...patch });
        next[index] = updated;
        return next;
      },
      options
    );
    return updated;
  }

  function removeExtra(index) {
    setState(current => current.filter((_, i) => i !== index));
  }

  function render() {
    listEl.innerHTML = '';
    if (!state.extras.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    state.extras.forEach((extra, index) => {
      const article = document.createElement('article');
      article.className = 'card p-4 space-y-4';
      const anchorId = slugify(extra.code || extra.name || 'extra-' + (index + 1));
      if (anchorId) {
        article.id = 'extra-' + anchorId;
      }
      article.dataset.extraIndex = String(index);
      const fallbackTitle = translate('form.itemFallback', 'Extra {number}', { number: index + 1 });
      const titleText = extra.name || fallbackTitle;
      const detailsHint = translate(
        'form.detailsHint',
        'Set the information visible to guests and choose pricing rules.'
      );
      const removeLabel = translate('actions.remove', 'Remove');
      const nameLabel = translate('fields.name.label', 'Name');
      const namePlaceholder = translate('fields.name.placeholder', 'Ex.: Airport transfer');
      const codeLabel = translate('fields.code.label', 'Internal code');
      const codePlaceholder = translate('fields.code.placeholder', 'Ex.: transfer');
      const codeHelp = translate(
        'fields.code.help',
        'No spaces; used to identify the extra in bookings.'
      );
      const descriptionLabel = translate('fields.description.label', 'Description (optional)');
      const descriptionPlaceholder = translate(
        'fields.description.placeholder',
        'Notes or limits for the service'
      );
      const priceLabel = translate('fields.price.label', 'Price (€)');
      const pricePlaceholder = translate('fields.price.placeholder', 'Ex.: 30');
      const priceHelp = translate('fields.price.help', 'Use 0 to include it without additional cost.');
      const ruleLabel = translate('fields.rule.label', 'Pricing rule');
      const ruleStandardLabel = translate('fields.rule.options.standard', 'Fixed price per booking');
      const ruleLongStayLabel = translate('fields.rule.options.long_stay', 'Long-stay discount');
      const minNightsLabel = translate('fields.minNights.label', 'Minimum nights');
      const minNightsPlaceholder = translate('fields.minNights.placeholder', 'Ex.: 7');
      const discountLabel = translate('fields.discountPercent.label', 'Discount (%)');
      const discountPlaceholder = translate('fields.discountPercent.placeholder', 'Ex.: 15');
      const availabilityFromLabel = translate('fields.availabilityFrom.label', 'Available from (optional)');
      const availabilityToLabel = translate('fields.availabilityTo.label', 'Available until (optional)');

      article.innerHTML = `
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-slate-800" data-extra-title>${escapeHtml(titleText)}</h3>
            <p class="text-xs text-slate-500">${escapeHtml(detailsHint)}</p>
          </div>
          <button type="button" class="bo-button bo-button--ghost" data-remove-extra>
            <i data-lucide="trash-2" class="app-icon" aria-hidden="true"></i>
            <span>${escapeHtml(removeLabel)}</span>
          </button>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(nameLabel)}</span>
            <input type="text" class="input" data-field="name" maxlength="120" placeholder="${escapeHtml(
              namePlaceholder
            )}" />
          </label>
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(codeLabel)}</span>
            <input type="text" class="input font-mono text-sm" data-field="code" maxlength="80" placeholder="${escapeHtml(
              codePlaceholder
            )}" />
            <span class="text-xs text-slate-500">${escapeHtml(codeHelp)}</span>
          </label>
        </div>
        <label class="grid gap-1 text-sm">
          <span>${escapeHtml(descriptionLabel)}</span>
          <textarea class="input" rows="2" data-field="description" placeholder="${escapeHtml(
            descriptionPlaceholder
          )}"></textarea>
        </label>
        <div class="grid gap-4 md:grid-cols-3">
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(priceLabel)}</span>
            <input type="number" class="input" data-field="priceEuros" min="0" step="0.01" placeholder="${escapeHtml(
              pricePlaceholder
            )}" />
            <span class="text-xs text-slate-500">${escapeHtml(priceHelp)}</span>
          </label>
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(ruleLabel)}</span>
            <select class="input" data-field="pricingRule">
              <option value="standard">${escapeHtml(ruleStandardLabel)}</option>
              <option value="long_stay">${escapeHtml(ruleLongStayLabel)}</option>
            </select>
          </label>
          <div class="grid gap-2" data-long-stay>
            <label class="grid gap-1 text-sm">
              <span>${escapeHtml(minNightsLabel)}</span>
              <input type="number" class="input" data-field="minNights" min="1" step="1" placeholder="${escapeHtml(
                minNightsPlaceholder
              )}" />
            </label>
            <label class="grid gap-1 text-sm">
              <span>${escapeHtml(discountLabel)}</span>
              <input type="number" class="input" data-field="discountPercent" min="0" max="100" step="1" placeholder="${escapeHtml(
                discountPlaceholder
              )}" />
            </label>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(availabilityFromLabel)}</span>
            <input type="time" class="input" data-field="availabilityFrom" />
          </label>
          <label class="grid gap-1 text-sm">
            <span>${escapeHtml(availabilityToLabel)}</span>
            <input type="time" class="input" data-field="availabilityTo" />
          </label>
        </div>
      `;

      const removeBtn = article.querySelector('[data-remove-extra]');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          removeExtra(index);
        });
      }

      const titleEl = article.querySelector('[data-extra-title]');

      article.querySelectorAll('[data-field]').forEach(input => {
        const field = input.getAttribute('data-field');
        if (!field) return;
        if (field === 'description') {
          input.value = extra.description || '';
        } else {
          input.value = extra[field] || '';
        }

        const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, event => {
          const value = event.target.value;
          const updated = updateExtra(index, { [field]: value }, { skipRender: true });
          if (updated && field in updated && updated[field] !== value && field !== 'description') {
            input.value = updated[field];
          }
        });
      });

      const ruleSelect = article.querySelector('[data-field="pricingRule"]');
      const longStayContainer = article.querySelector('[data-long-stay]');

      function updateLongStayVisibility() {
        if (!longStayContainer) return;
        longStayContainer.hidden = ruleSelect && ruleSelect.value !== 'long_stay';
      }

      if (ruleSelect) {
        ruleSelect.value = extra.pricingRule;
        ruleSelect.addEventListener('change', () => {
          updateExtra(index, { pricingRule: ruleSelect.value }, { skipRender: true });
        });
      }

      if (longStayContainer) {
        updateLongStayVisibility();
        ruleSelect && ruleSelect.addEventListener('change', updateLongStayVisibility);
      }

      const nameInput = article.querySelector('[data-field="name"]');
      const codeInput = article.querySelector('[data-field="code"]');

      if (nameInput) {
        nameInput.addEventListener('blur', () => {
          if (!codeInput) return;
          const currentCode = codeInput.value.trim();
          if (!currentCode && nameInput.value.trim()) {
            const generated = slugify(nameInput.value.trim());
            if (generated) {
              const updated = updateExtra(index, { code: generated }, { skipRender: true });
              if (updated && updated.code !== codeInput.value) {
                codeInput.value = updated.code;
              }
            }
          }
        });
      }

      if (titleEl && nameInput) {
        nameInput.addEventListener('input', () => {
          titleEl.textContent = nameInput.value.trim() || `Extra ${index + 1}`;
        });
      }

      listEl.appendChild(article);
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      setState(current => {
        return current.concat([
          {
            name: '',
            code: '',
            description: '',
            priceEuros: '',
            pricingRule: 'standard',
            minNights: '',
            discountPercent: '',
            availabilityFrom: '',
            availabilityTo: ''
          }
        ]);
      });
    });
  }

  formEl.addEventListener('submit', () => {
    if (!outputEl) return;
    const payload = state.extras.map(extra => ({
      name: extra.name || '',
      code: extra.code || '',
      description: extra.description || '',
      priceEuros: extra.priceEuros || '',
      pricingRule: extra.pricingRule || 'standard',
      minNights: extra.minNights || '',
      discountPercent: extra.discountPercent || '',
      availabilityFrom: extra.availabilityFrom || '',
      availabilityTo: extra.availabilityTo || ''
    }));
    outputEl.value = JSON.stringify({ extras: payload });
  });

  render();
})();
