(function() {
  const dataEl = document.getElementById('extras-data');
  if (!dataEl) return;

  let initialState = {};
  try {
    initialState = JSON.parse(dataEl.textContent || '{}');
  } catch (err) {
    initialState = {};
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
      article.dataset.extraIndex = String(index);
      article.innerHTML = `
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-slate-800" data-extra-title>${extra.name || `Extra ${index + 1}`}</h3>
            <p class="text-xs text-slate-500">Defina os detalhes visíveis para o hóspede e regras de preço.</p>
          </div>
          <button type="button" class="bo-button bo-button--ghost" data-remove-extra>
            <i data-lucide="trash-2" aria-hidden="true"></i>
            <span>Remover</span>
          </button>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="grid gap-1 text-sm">
            <span>Nome</span>
            <input type="text" class="input" data-field="name" maxlength="120" placeholder="Ex.: Transfer aeroporto" />
          </label>
          <label class="grid gap-1 text-sm">
            <span>Código interno</span>
            <input type="text" class="input font-mono text-sm" data-field="code" maxlength="80" placeholder="Ex.: transfer" />
            <span class="text-xs text-slate-500">Sem espaços; usado para identificar o extra nas reservas.</span>
          </label>
        </div>
        <label class="grid gap-1 text-sm">
          <span>Descrição (opcional)</span>
          <textarea class="input" rows="2" data-field="description" placeholder="Notas ou limites do serviço"></textarea>
        </label>
        <div class="grid gap-4 md:grid-cols-3">
          <label class="grid gap-1 text-sm">
            <span>Preço (€)</span>
            <input type="number" class="input" data-field="priceEuros" min="0" step="0.01" placeholder="Ex.: 30" />
            <span class="text-xs text-slate-500">Use 0 para incluir sem custo adicional.</span>
          </label>
          <label class="grid gap-1 text-sm">
            <span>Regra de preço</span>
            <select class="input" data-field="pricingRule">
              <option value="standard">Preço fixo por reserva</option>
              <option value="long_stay">Desconto estadias longas</option>
            </select>
          </label>
          <div class="grid gap-2" data-long-stay>
            <label class="grid gap-1 text-sm">
              <span>Noites mínimas</span>
              <input type="number" class="input" data-field="minNights" min="1" step="1" placeholder="Ex.: 7" />
            </label>
            <label class="grid gap-1 text-sm">
              <span>Desconto (%)</span>
              <input type="number" class="input" data-field="discountPercent" min="0" max="100" step="1" placeholder="Ex.: 15" />
            </label>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="grid gap-1 text-sm">
            <span>Disponível a partir das (opcional)</span>
            <input type="time" class="input" data-field="availabilityFrom" />
          </label>
          <label class="grid gap-1 text-sm">
            <span>Disponível até às (opcional)</span>
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
