// Gere as rotas e helpers das regras automáticas de tarifação no backoffice.
function registerRateRules(app, context) {
  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    eur,
    inlineScript,
    renderBreadcrumbs,
    requireLogin,
    requirePermission,
    rateRuleService,
    logActivity,
    wantsJson,
  } = context;

  const RATE_RULE_TYPES = [
    { key: 'occupancy', label: 'Ocupação' },
    { key: 'lead_time', label: 'Antecedência (lead time)' },
    { key: 'weekday', label: 'Dia da semana' },
    { key: 'event', label: 'Evento/Data especial' },
  ];

  const WEEKDAY_LABELS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  function getRuleTypeLabel(type) {
    const match = RATE_RULE_TYPES.find(entry => entry.key === type);
    return match ? match.label : type;
  }

  function describeRuleConditions(rule) {
    const cfg = (rule && rule.config) || {};
    switch (rule.type) {
      case 'occupancy': {
        const parts = [];
        if (typeof cfg.minOccupancy === 'number') {
          parts.push(`Ocupação ≥ ${Math.round(cfg.minOccupancy * 100)}%`);
        }
        if (typeof cfg.maxOccupancy === 'number') {
          parts.push(`Ocupação ≤ ${Math.round(cfg.maxOccupancy * 100)}%`);
        }
        if (cfg.windowDays) {
          parts.push(`Janela ${cfg.windowDays} dia${cfg.windowDays === 1 ? '' : 's'}`);
        }
        return parts.length ? parts.join(' · ') : 'Sem limites de ocupação definidos';
      }
      case 'lead_time': {
        const parts = [];
        if (typeof cfg.minLead === 'number') parts.push(`Antecedência ≥ ${cfg.minLead} dia(s)`);
        if (typeof cfg.maxLead === 'number') parts.push(`Antecedência ≤ ${cfg.maxLead} dia(s)`);
        return parts.length ? parts.join(' · ') : 'Aplica-se a qualquer antecedência';
      }
      case 'weekday': {
        const weekdays = Array.isArray(cfg.weekdays) ? cfg.weekdays : [];
        if (!weekdays.length) return 'Sem dias definidos';
        const labels = weekdays
          .map(index => WEEKDAY_LABELS[index] || `Dia ${index}`)
          .join(', ');
        return `Dias: ${labels}`;
      }
      case 'event': {
        const start = cfg.startDate ? dayjs(cfg.startDate) : null;
        const end = cfg.endDate ? dayjs(cfg.endDate) : null;
        if (start && start.isValid() && end && end.isValid()) {
          return `De ${start.format('DD/MM/YYYY')} até ${end.format('DD/MM/YYYY')}`;
        }
        if (start && start.isValid()) {
          return `A partir de ${start.format('DD/MM/YYYY')}`;
        }
        if (end && end.isValid()) {
          return `Até ${end.format('DD/MM/YYYY')}`;
        }
        if (Array.isArray(cfg.dates) && cfg.dates.length) {
          return `Datas: ${cfg.dates.join(', ')}`;
        }
        return 'Intervalo não definido';
      }
      default:
        return '';
    }
  }

  function parseRateRuleFormInput(form) {
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name) throw new Error('Indique o nome da regra.');

    const type = typeof form.type === 'string' ? form.type.trim() : '';
    if (!RATE_RULE_TYPES.some(entry => entry.key === type)) {
      throw new Error('Tipo de regra inválido.');
    }

    const adjustmentRaw = typeof form.adjustment_percent === 'string' ? form.adjustment_percent.replace(',', '.').trim() : '0';
    const adjustmentPercent = Number.parseFloat(adjustmentRaw);
    if (!Number.isFinite(adjustmentPercent)) {
      throw new Error('Ajuste percentual inválido.');
    }

    const priorityRaw = typeof form.priority === 'string' ? form.priority.trim() : '';
    const priority = priorityRaw ? Number.parseInt(priorityRaw, 10) : 0;

    const minPriceStr = typeof form.min_price === 'string' ? form.min_price.replace(',', '.').trim() : '';
    const maxPriceStr = typeof form.max_price === 'string' ? form.max_price.replace(',', '.').trim() : '';
    const minPriceValue = minPriceStr ? Number.parseFloat(minPriceStr) : null;
    const maxPriceValue = maxPriceStr ? Number.parseFloat(maxPriceStr) : null;
    const minPriceCents = Number.isFinite(minPriceValue) ? Math.round(minPriceValue * 100) : null;
    const maxPriceCents = Number.isFinite(maxPriceValue) ? Math.round(maxPriceValue * 100) : null;
    if (minPriceCents != null && maxPriceCents != null && minPriceCents > maxPriceCents) {
      throw new Error('Preço mínimo não pode ser superior ao preço máximo.');
    }

    const unitIdRaw = typeof form.unit_id === 'string' ? form.unit_id.trim() : '';
    const propertyIdRaw = typeof form.property_id === 'string' ? form.property_id.trim() : '';
    const unitId = unitIdRaw ? Number.parseInt(unitIdRaw, 10) : null;
    const propertyId = propertyIdRaw ? Number.parseInt(propertyIdRaw, 10) : null;

    const active = form.active ? true : false;

    const config = {};
    if (type === 'occupancy') {
      if (unitId == null && propertyId == null) {
        throw new Error('Selecione uma propriedade ou unidade para regras de ocupação.');
      }
      const minOccStr = typeof form.min_occupancy === 'string' ? form.min_occupancy.replace(',', '.').trim() : '';
      const maxOccStr = typeof form.max_occupancy === 'string' ? form.max_occupancy.replace(',', '.').trim() : '';
      const minOcc = minOccStr ? Number.parseFloat(minOccStr) : null;
      const maxOcc = maxOccStr ? Number.parseFloat(maxOccStr) : null;
      if (minOcc != null && (minOcc < 0 || minOcc > 100)) {
        throw new Error('Ocupação mínima deve estar entre 0% e 100%.');
      }
      if (maxOcc != null && (maxOcc < 0 || maxOcc > 100)) {
        throw new Error('Ocupação máxima deve estar entre 0% e 100%.');
      }
      if (minOcc != null && maxOcc != null && minOcc > maxOcc) {
        throw new Error('Ocupação mínima não pode ser superior à máxima.');
      }
      if (minOcc != null) config.minOccupancy = minOcc / 100;
      if (maxOcc != null) config.maxOccupancy = maxOcc / 100;
      const windowRaw = typeof form.occupancy_window === 'string' ? form.occupancy_window.trim() : '';
      const windowDays = windowRaw ? Number.parseInt(windowRaw, 10) : null;
      if (Number.isInteger(windowDays) && windowDays > 0) {
        config.windowDays = windowDays;
      }
    } else if (type === 'lead_time') {
      const minLeadRaw = typeof form.min_lead === 'string' ? form.min_lead.trim() : '';
      const maxLeadRaw = typeof form.max_lead === 'string' ? form.max_lead.trim() : '';
      const minLead = minLeadRaw ? Number.parseInt(minLeadRaw, 10) : null;
      const maxLead = maxLeadRaw ? Number.parseInt(maxLeadRaw, 10) : null;
      if (minLead != null && minLead < 0) throw new Error('Antecedência mínima inválida.');
      if (maxLead != null && maxLead < 0) throw new Error('Antecedência máxima inválida.');
      if (minLead != null && maxLead != null && minLead > maxLead) {
        throw new Error('Antecedência mínima não pode ser superior à máxima.');
      }
      if (minLead != null) config.minLead = minLead;
      if (maxLead != null) config.maxLead = maxLead;
    } else if (type === 'weekday') {
      const incoming = form.weekdays;
      const values = Array.isArray(incoming)
        ? incoming
        : typeof incoming === 'string' && incoming
        ? [incoming]
        : [];
      const weekdays = values
        .map(value => Number.parseInt(String(value), 10))
        .filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
      if (!weekdays.length) throw new Error('Selecione pelo menos um dia da semana.');
      config.weekdays = Array.from(new Set(weekdays)).sort();
    } else if (type === 'event') {
      const start = typeof form.event_start === 'string' ? form.event_start.trim() : '';
      const end = typeof form.event_end === 'string' ? form.event_end.trim() : '';
      const startDate = start ? dayjs(start, 'YYYY-MM-DD', true) : null;
      const endDate = end ? dayjs(end, 'YYYY-MM-DD', true) : null;
      if (!startDate || !startDate.isValid()) throw new Error('Data inicial do evento inválida.');
      if (!endDate || !endDate.isValid()) throw new Error('Data final do evento inválida.');
      if (endDate.isBefore(startDate)) throw new Error('Data final deve ser posterior à inicial.');
      config.startDate = startDate.format('YYYY-MM-DD');
      config.endDate = endDate.format('YYYY-MM-DD');
    }

    Object.keys(config).forEach(key => {
      const value = config[key];
      if (value == null || (Array.isArray(value) && !value.length)) {
        delete config[key];
      }
    });

    return {
      name,
      type,
      adjustmentPercent,
      priority: Number.isFinite(priority) ? priority : 0,
      minPriceCents,
      maxPriceCents,
      unitId: Number.isInteger(unitId) ? unitId : null,
      propertyId: Number.isInteger(propertyId) ? propertyId : null,
      active,
      config,
    };
  }

  app.get('/admin/rates/rules', requireLogin, requirePermission('rates.manage'), (req, res) => {
    const rules = rateRuleService.listRules({ currency: 'eur' });
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const units = db
      .prepare(
        `SELECT u.id, u.name, u.property_id, p.name AS property_name
         FROM units u
         JOIN properties p ON p.id = u.property_id
        ORDER BY p.name, u.name`
      )
      .all();

    const editId = req.query.edit ? Number.parseInt(req.query.edit, 10) : null;
    let editingRule = null;
    if (Number.isInteger(editId) && editId > 0) {
      editingRule = rateRuleService.getRule(editId, { currency: 'eur' });
      if (!editingRule) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Regra não encontrada.' });
        return res.status(404).send('Regra não encontrada');
      }
    }

    const errorMessage = req.query.error ? String(req.query.error) : null;
    const successMessage = req.query.saved
      ? 'Regra guardada com sucesso.'
      : req.query.deleted
      ? 'Regra removida com sucesso.'
      : null;

    const formType = editingRule ? editingRule.type : 'occupancy';
    const formName = editingRule ? editingRule.name : '';
    const formAdjustment = editingRule ? editingRule.adjustmentPercent : 0;
    const formPriority = editingRule ? editingRule.priority : 0;
    const formMinPrice = editingRule && editingRule.minPrice != null ? editingRule.minPrice.toFixed(2) : '';
    const formMaxPrice = editingRule && editingRule.maxPrice != null ? editingRule.maxPrice.toFixed(2) : '';
    const formActive = editingRule ? editingRule.active : true;
    const formPropertyId = editingRule ? editingRule.propertyId : '';
    const formUnitId = editingRule ? editingRule.unitId : '';
    const cfg = editingRule && editingRule.config ? editingRule.config : {};
    const occupancyMin = typeof cfg.minOccupancy === 'number' ? Math.round(cfg.minOccupancy * 100) : '';
    const occupancyMax = typeof cfg.maxOccupancy === 'number' ? Math.round(cfg.maxOccupancy * 100) : '';
    const occupancyWindow = cfg.windowDays || '';
    const leadMin = cfg.minLead != null ? cfg.minLead : '';
    const leadMax = cfg.maxLead != null ? cfg.maxLead : '';
    const weekdaySet = new Set(
      Array.isArray(cfg.weekdays)
        ? cfg.weekdays.map(value => Number.parseInt(value, 10)).filter(value => Number.isInteger(value))
        : []
    );
    const eventStart = cfg.startDate || '';
    const eventEnd = cfg.endDate || '';

    const ruleItems = rules.length
      ? rules
          .map(rule => {
            const scopeLabel = rule.unitName
              ? `${rule.propertyName ? `${rule.propertyName} · ` : ''}${rule.unitName}`
              : rule.propertyName
              ? `Propriedade: ${rule.propertyName}`
              : 'Global';
            const adjustmentLabel = `${rule.adjustmentPercent > 0 ? '+' : ''}${rule.adjustmentPercent}%`;
            const adjustmentClass = rule.adjustmentPercent >= 0 ? 'text-emerald-600' : 'text-rose-600';
            const minLabel = rule.minPrice != null ? `€ ${eur(Math.round(rule.minPrice * 100))}` : '—';
            const maxLabel = rule.maxPrice != null ? `€ ${eur(Math.round(rule.maxPrice * 100))}` : '—';
            const statusBadge = rule.active
              ? '<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Ativa</span>'
              : '<span class="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">Inativa</span>';
            return `
            <li class="border border-slate-200 rounded-xl p-4 space-y-2 bg-white shadow-sm">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-semibold text-slate-800">${esc(rule.name)}</div>
                  <div class="text-xs text-slate-500">${esc(getRuleTypeLabel(rule.type))} · ${esc(scopeLabel)}</div>
                </div>
                <div class="text-sm font-semibold ${adjustmentClass}">${esc(adjustmentLabel)}</div>
              </div>
              <div class="text-sm text-slate-600">${esc(describeRuleConditions(rule))}</div>
              <div class="text-xs text-slate-500">Mín: ${esc(minLabel)} · Máx: ${esc(maxLabel)} · Prioridade: ${rule.priority || 0}</div>
              <div class="flex items-center gap-2">${statusBadge}</div>
              <div class="flex flex-wrap gap-2 pt-2">
                <a class="btn btn-light" href="/admin/rates/rules?edit=${rule.id}">Editar</a>
                <form method="post" action="/admin/rates/rules/${rule.id}/delete" onsubmit="return confirm('Remover esta regra?');">
                  <button type="submit" class="btn btn-danger">Remover</button>
                </form>
              </div>
            </li>
          `;
          })
          .join('')
      : '<p class="text-sm text-slate-500">Ainda não existem regras configuradas.</p>';

    const typeOptions = RATE_RULE_TYPES.map(entry => `
    <option value="${entry.key}" ${entry.key === formType ? 'selected' : ''}>${esc(entry.label)}</option>
  `).join('');

    const propertyOptions = ['<option value="">Todas as propriedades</option>']
      .concat(properties.map(p => `<option value="${p.id}" ${p.id === formPropertyId ? 'selected' : ''}>${esc(p.name)}</option>`))
      .join('');

    const unitOptions = ['<option value="">Todas as unidades</option>']
      .concat(
        units.map(u => {
          const label = `${u.property_name ? `${u.property_name} · ` : ''}${u.name}`;
          return `<option value="${u.id}" ${u.id === formUnitId ? 'selected' : ''}>${esc(label)}</option>`;
        })
      )
      .join('');

    const weekdayInputs = WEEKDAY_LABELS.map((label, index) => {
      const checked = weekdaySet.has(index) ? 'checked' : '';
      return `
      <label class="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="weekdays" value="${index}" ${checked} />
        <span>${esc(label)}</span>
      </label>
    `;
    }).join('');

    const ruleFormScript = inlineScript(`
    (function(){
      const typeSelect = document.querySelector('[data-rule-type]');
      const fieldsets = document.querySelectorAll('[data-rule-fields]');
      function updateFields(){
        const value = typeSelect ? typeSelect.value : '';
        fieldsets.forEach(section => {
          section.hidden = section.getAttribute('data-rule-type') !== value;
        });
      }
      if (typeSelect){
        typeSelect.addEventListener('change', updateFields);
        updateFields();
      }
    })();
  `);

    res.send(
      layout({
        title: 'Regras automáticas de tarifas',
        language: req.language,
        t: req.t,
        user: req.user,
        activeNav: 'backoffice',
        pageClass: 'page-backoffice page-rates',
        body: html`
        <div class="bo-page bo-page--wide">
          ${renderBreadcrumbs([
            { label: 'Backoffice', href: '/admin' },
            { label: 'Regras de tarifas' }
          ])}
          <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
          <h1 class="text-2xl font-semibold mb-4">Regras automáticas de tarifas</h1>
          <p class="text-sm text-slate-600 mb-6">Configure ajustes dinâmicos que combinam ocupação, antecedência, dias da semana e eventos especiais.</p>
          ${successMessage
            ? `<div class="inline-feedback" data-variant="success" role="status">${esc(successMessage)}</div>`
            : ''}
          ${errorMessage
            ? `<div class="inline-feedback" data-variant="danger" role="alert">${esc(errorMessage)}</div>`
            : ''}
          <div class="grid gap-6 lg:grid-cols-2">
          <section class="card p-6 space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-800">${editingRule ? 'Editar regra' : 'Nova regra'}</h2>
              <p class="text-sm text-slate-500">Defina o nome, tipo de condição e o ajuste aplicado ao preço base.</p>
            </div>
            <form method="post" action="/admin/rates/rules/save" class="grid gap-4">
              <input type="hidden" name="rule_id" value="${editingRule ? editingRule.id : ''}" />
              <label class="grid gap-1 text-sm">
                <span>Nome da regra</span>
                <input type="text" name="name" class="input" required maxlength="80" value="${esc(formName)}" />
              </label>
              <label class="grid gap-1 text-sm">
                <span>Tipo</span>
                <select name="type" class="input" data-rule-type required>
                  ${typeOptions}
                </select>
              </label>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="grid gap-1 text-sm">
                  <span>Ajuste (%)</span>
                  <input type="number" step="0.1" name="adjustment_percent" class="input" value="${esc(formAdjustment)}" required />
                </label>
                <label class="grid gap-1 text-sm">
                  <span>Prioridade</span>
                  <input type="number" step="1" name="priority" class="input" value="${esc(formPriority)}" />
                </label>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="grid gap-1 text-sm">
                  <span>Preço mínimo (€)</span>
                  <input type="number" step="0.01" name="min_price" class="input" value="${esc(formMinPrice)}" />
                </label>
                <label class="grid gap-1 text-sm">
                  <span>Preço máximo (€)</span>
                  <input type="number" step="0.01" name="max_price" class="input" value="${esc(formMaxPrice)}" />
                </label>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="grid gap-1 text-sm">
                  <span>Propriedade</span>
                  <select name="property_id" class="input">${propertyOptions}</select>
                </label>
                <label class="grid gap-1 text-sm">
                  <span>Unidade específica</span>
                  <select name="unit_id" class="input">${unitOptions}</select>
                </label>
              </div>
              <fieldset class="grid gap-3" data-rule-fields data-rule-type="occupancy">
                <legend class="text-sm font-semibold text-slate-700">Condição: Ocupação</legend>
                <div class="grid gap-3 md:grid-cols-3">
                  <label class="grid gap-1 text-sm">
                    <span>Ocupação mínima (%)</span>
                    <input type="number" step="1" min="0" max="100" name="min_occupancy" class="input" value="${esc(occupancyMin)}" />
                  </label>
                  <label class="grid gap-1 text-sm">
                    <span>Ocupação máxima (%)</span>
                    <input type="number" step="1" min="0" max="100" name="max_occupancy" class="input" value="${esc(occupancyMax)}" />
                  </label>
                  <label class="grid gap-1 text-sm">
                    <span>Janela (dias)</span>
                    <input type="number" step="1" min="1" name="occupancy_window" class="input" value="${esc(occupancyWindow)}" />
                  </label>
                </div>
                <p class="text-xs text-slate-500">Compara a ocupação da propriedade/unidade para aplicar o ajuste.</p>
              </fieldset>
              <fieldset class="grid gap-3" data-rule-fields data-rule-type="lead_time">
                <legend class="text-sm font-semibold text-slate-700">Condição: Antecedência</legend>
                <div class="grid gap-3 md:grid-cols-2">
                  <label class="grid gap-1 text-sm">
                    <span>Antecedência mínima (dias)</span>
                    <input type="number" step="1" min="0" name="min_lead" class="input" value="${esc(leadMin)}" />
                  </label>
                  <label class="grid gap-1 text-sm">
                    <span>Antecedência máxima (dias)</span>
                    <input type="number" step="1" min="0" name="max_lead" class="input" value="${esc(leadMax)}" />
                  </label>
                </div>
              </fieldset>
              <fieldset class="grid gap-3" data-rule-fields data-rule-type="weekday">
                <legend class="text-sm font-semibold text-slate-700">Condição: Dia da semana</legend>
                <div class="grid gap-2 md:grid-cols-2">${weekdayInputs}</div>
              </fieldset>
              <fieldset class="grid gap-3" data-rule-fields data-rule-type="event">
                <legend class="text-sm font-semibold text-slate-700">Condição: Evento / Datas especiais</legend>
                <div class="grid gap-3 md:grid-cols-2">
                  <label class="grid gap-1 text-sm">
                    <span>Data inicial</span>
                    <input type="date" name="event_start" class="input" value="${esc(eventStart)}" />
                  </label>
                  <label class="grid gap-1 text-sm">
                    <span>Data final</span>
                    <input type="date" name="event_end" class="input" value="${esc(eventEnd)}" />
                  </label>
                </div>
              </fieldset>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" value="1" ${formActive ? 'checked' : ''} />
                <span>Regra ativa</span>
              </label>
              <div class="flex gap-3">
                <button type="submit" class="btn btn-primary">${editingRule ? 'Atualizar regra' : 'Guardar regra'}</button>
                ${editingRule ? `<a class="btn btn-light" href="/admin/rates/rules">Cancelar</a>` : ''}
              </div>
            </form>
          </section>
          <section class="card p-6 space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-800">Regras configuradas</h2>
              <p class="text-sm text-slate-500">Regras são avaliadas por prioridade e podem combinar entre si. Ajustes percentuais são multiplicativos.</p>
            </div>
            <ul class="space-y-4">${ruleItems}</ul>
          </section>
          </div>
          <script>${ruleFormScript}</script>
        </div>
      `,
      })
    );
  });

  app.post('/admin/rates/rules/save', requireLogin, requirePermission('rates.manage'), (req, res) => {
    try {
      const ruleId = req.body.rule_id ? Number.parseInt(req.body.rule_id, 10) : null;
      const payload = parseRateRuleFormInput(req.body);
      let rule;
      if (ruleId) {
        rule = rateRuleService.updateRule(ruleId, payload);
      } else {
        rule = rateRuleService.createRule(payload);
      }
      if (logActivity && req.user && req.user.id && rule && rule.id) {
        logActivity(req.user.id, 'rate_rule_saved', 'rate_rule', rule.id, {
          type: rule.type,
          adjustment: rule.adjustmentPercent,
        });
      }
      if (wantsJson(req)) {
        return res.json({ ok: true, rule });
      }
      res.redirect('/admin/rates/rules?saved=1');
    } catch (err) {
      const message = err && err.message ? err.message : 'Não foi possível guardar a regra.';
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message });
      }
      const redirectUrl = `/admin/rates/rules?error=${encodeURIComponent(message)}${
        req.body.rule_id ? `&edit=${encodeURIComponent(req.body.rule_id)}` : ''
      }`;
      res.redirect(redirectUrl);
    }
  });

  app.post('/admin/rates/rules/:id/delete', requireLogin, requirePermission('rates.manage'), (req, res) => {
    const ruleId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Identificador inválido.' });
      return res.status(400).send('Identificador inválido.');
    }
    const removed = rateRuleService.deleteRule(ruleId);
    if (!removed) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Regra não encontrada.' });
      return res.status(404).send('Regra não encontrada');
    }
    if (logActivity && req.user && req.user.id) {
      logActivity(req.user.id, 'rate_rule_deleted', 'rate_rule', ruleId, null);
    }
    if (wantsJson(req)) {
      return res.json({ ok: true, id: ruleId });
    }
    res.redirect('/admin/rates/rules?deleted=1');
  });
}

module.exports = { registerRateRules };
