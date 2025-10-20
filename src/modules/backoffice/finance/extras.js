// Gere as rotas de extras e addons no backoffice.
const { ValidationError } = require('../../../services/errors');

function registerExtras(app, context) {
  const {
    db,
    html,
    layout,
    esc,
    renderBreadcrumbs,
    resolveBrandingForRequest,
    rememberActiveBrandingProperty,
    safeJsonParse,
    slugify,
    serverRender,
    logChange,
    requireLogin,
    requirePermission,
    extrasManagerScript,
  } = context;

  function normalizePricingRuleValue(value) {
    if (typeof value !== 'string') return 'standard';
    const normalized = value.trim().toLowerCase();
    return normalized === 'long_stay' ? 'long_stay' : 'standard';
  }

  function sanitizeTime(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(trimmed);
    if (!match) return '';
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return '';
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function normalizePolicyExtrasForForm(rawExtras) {
    const extras = Array.isArray(rawExtras) ? rawExtras : [];
    return extras
      .map(item => {
        if (!item) return null;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const codeSource =
          (typeof item.code === 'string' && item.code.trim()) ||
          (typeof item.id === 'string' && item.id.trim()) ||
          '';
        const code = codeSource || (name ? slugify(name) : '');
        const description = typeof item.description === 'string' ? item.description : '';
        let priceCents = null;
        if (item.price_cents != null && Number.isFinite(Number(item.price_cents))) {
          priceCents = Math.round(Number(item.price_cents));
        } else if (item.price != null && Number.isFinite(Number(item.price))) {
          priceCents = Math.round(Number(item.price) * 100);
        }
        const pricingRule = normalizePricingRuleValue(item.pricing_rule);
        const rawConfig =
          item.pricing_config && typeof item.pricing_config === 'object' ? item.pricing_config : {};
        const minNightsRaw = rawConfig.min_nights != null ? rawConfig.min_nights : rawConfig.minNights;
        const discountRaw =
          rawConfig.discount_percent != null ? rawConfig.discount_percent : rawConfig.discountPercent;
        const minNights = Number.isFinite(Number(minNightsRaw))
          ? Math.max(1, Math.round(Number(minNightsRaw)))
          : '';
        const discountPercent = Number.isFinite(Number(discountRaw))
          ? Math.max(0, Math.min(100, Math.round(Number(discountRaw))))
          : '';
        const availabilitySource =
          item.availability && typeof item.availability === 'object'
            ? item.availability
            : {
                from:
                  (typeof item.available_from === 'string' && item.available_from) ||
                  (typeof item.availableFrom === 'string' && item.availableFrom) ||
                  null,
                to:
                  (typeof item.available_until === 'string' && item.available_until) ||
                  (typeof item.availableUntil === 'string' && item.availableUntil) ||
                  null,
              };
        const availabilityFrom =
          availabilitySource && typeof availabilitySource.from === 'string'
            ? sanitizeTime(availabilitySource.from)
            : '';
        const availabilityTo =
          availabilitySource && typeof availabilitySource.to === 'string'
            ? sanitizeTime(availabilitySource.to)
            : '';

        return {
          name,
          code,
          description,
          priceEuros:
            priceCents != null
              ? String((priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2))
              : '',
          pricingRule,
          minNights: pricingRule === 'long_stay' && minNights ? String(minNights) : '',
          discountPercent:
            pricingRule === 'long_stay' && discountPercent !== '' ? String(discountPercent) : '',
          availabilityFrom,
          availabilityTo,
        };
      })
      .filter(extra => extra && (extra.name || extra.code));
  }

  function parseExtrasSubmission(payload) {
    const extrasArray = payload && Array.isArray(payload.extras) ? payload.extras : [];
    const output = [];
    const usedCodes = new Set();

    extrasArray.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) {
        throw new ValidationError(`Nome obrigatório no extra #${index + 1}`);
      }
      const codeInput = typeof raw.code === 'string' ? raw.code.trim() : '';
      const normalizedCode = slugify(codeInput || name);
      if (!normalizedCode) {
        throw new ValidationError(`Código inválido no extra "${name}"`);
      }
      const codeKey = normalizedCode.toLowerCase();
      if (usedCodes.has(codeKey)) {
        throw new ValidationError(`Código duplicado: ${normalizedCode}`);
      }
      usedCodes.add(codeKey);

      const description = typeof raw.description === 'string' ? raw.description.trim() : '';
      const pricingRule = normalizePricingRuleValue(raw.pricingRule);
      const priceInput =
        raw.priceEuros != null && raw.priceEuros !== ''
          ? raw.priceEuros
          : raw.price != null && raw.price !== ''
          ? raw.price
          : '';
      let priceCents = null;
      if (priceInput !== '') {
        const priceNumber = Number.parseFloat(String(priceInput).replace(',', '.'));
        if (!Number.isNaN(priceNumber) && Number.isFinite(priceNumber) && priceNumber >= 0) {
          priceCents = Math.round(priceNumber * 100);
        } else {
          throw new ValidationError(`Preço inválido no extra "${name}"`);
        }
      }

      const extraRecord = {
        id: normalizedCode,
        code: normalizedCode,
        name,
        pricing_rule: pricingRule,
      };

      if (description) {
        extraRecord.description = description;
      }
      if (priceCents != null) {
        extraRecord.price_cents = priceCents;
      }

      if (pricingRule === 'long_stay') {
        const config = {};
        const minNightsRaw = raw.minNights != null ? raw.minNights : raw.min_nights;
        const discountRaw = raw.discountPercent != null ? raw.discountPercent : raw.discount_percent;
        if (minNightsRaw != null && String(minNightsRaw).trim() !== '') {
          const minValue = Number.parseInt(String(minNightsRaw).trim(), 10);
          if (!Number.isNaN(minValue) && minValue > 0) {
            config.min_nights = minValue;
          } else {
            throw new ValidationError(`Noites mínimas inválidas no extra "${name}"`);
          }
        }
        if (discountRaw != null && String(discountRaw).trim() !== '') {
          const discountValue = Number.parseInt(String(discountRaw).trim(), 10);
          if (!Number.isNaN(discountValue) && discountValue >= 0 && discountValue <= 100) {
            config.discount_percent = discountValue;
          } else {
            throw new ValidationError(`Desconto inválido no extra "${name}"`);
          }
        }
        if (Object.keys(config).length) {
          extraRecord.pricing_config = config;
        }
      }

      const availabilityFrom = sanitizeTime(
        typeof raw.availabilityFrom === 'string'
          ? raw.availabilityFrom
          : raw.availability && typeof raw.availability.from === 'string'
          ? raw.availability.from
          : ''
      );
      const availabilityTo = sanitizeTime(
        typeof raw.availabilityTo === 'string'
          ? raw.availabilityTo
          : raw.availability && typeof raw.availability.to === 'string'
          ? raw.availability.to
          : ''
      );

      if (availabilityFrom || availabilityTo) {
        extraRecord.availability = {
          from: availabilityFrom || null,
          to: availabilityTo || null,
        };
      }

      output.push(extraRecord);
    });

    return output;
  }

  function renderExtrasManagementPage(
    req,
    res,
    { propertyId, formState, successMessage, errorMessage } = {}
  ) {
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();

    if (!properties.length) {
      const theme = resolveBrandingForRequest(req);
      serverRender('route:/admin/extras');
      return res.send(
        layout({
          title: 'Extras & serviços',
          user: req.user,
          activeNav: 'backoffice',
          branding: theme,
          body: html`
            <div class="bo-page bo-page--wide">
              ${renderBreadcrumbs([
                { label: 'Backoffice', href: '/admin' },
                { label: 'Extras & serviços' },
              ])}
              <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
              <div class="card p-6 space-y-4 mt-6">
                <h1 class="text-2xl font-semibold text-slate-900">Extras & serviços</h1>
                <p class="text-sm text-slate-600">
                  Para configurar extras é necessário ter pelo menos uma propriedade ativa no sistema.
                </p>
                <div>
                  <a class="bo-button bo-button--primary" href="/admin">Ir para o painel de propriedades</a>
                </div>
              </div>
            </div>
          `,
        })
      );
    }

    const fallbackProperty = properties[0];
    const selectedId = propertyId != null ? String(propertyId) : String(fallbackProperty.id);
    const selectedProperty =
      properties.find(p => String(p.id) === selectedId) || fallbackProperty;

    const policyRow = db
      .prepare('SELECT extras FROM property_policies WHERE property_id = ?')
      .get(selectedProperty.id);
    const storedExtras = policyRow ? safeJsonParse(policyRow.extras, []) : [];
    const extrasFormState = Array.isArray(formState)
      ? formState
      : normalizePolicyExtrasForForm(storedExtras);
    const extrasPayloadJson = JSON.stringify({ extras: extrasFormState }).replace(/</g, '\\u003c');

    const propertyOptions = properties
      .map(p => {
        const isSelected = String(p.id) === String(selectedProperty.id) ? 'selected' : '';
        return `<option value="${p.id}" ${isSelected}>${esc(p.name)}</option>`;
      })
      .join('');

    const theme = resolveBrandingForRequest(req, {
      propertyId: selectedProperty.id,
      propertyName: selectedProperty.name,
    });
    rememberActiveBrandingProperty(res, selectedProperty.id);
    const feedbackBlocks = [];
    if (successMessage) {
      feedbackBlocks.push(`
        <div class="inline-feedback mb-4" data-variant="success" role="status">
          <span class="inline-feedback-icon">✓</span>
          <div>${esc(successMessage)}</div>
        </div>
      `);
    }
    if (errorMessage) {
      feedbackBlocks.push(`
        <div class="inline-feedback mb-4" data-variant="danger" role="alert">
          <span class="inline-feedback-icon">!</span>
          <div>${esc(errorMessage)}</div>
        </div>
      `);
    }

    serverRender('route:/admin/extras');
    res.send(
      layout({
        title: 'Extras & serviços',
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        body: html`
          <div class="bo-page bo-page--wide">
            ${renderBreadcrumbs([
              { label: 'Backoffice', href: '/admin' },
              { label: 'Extras & serviços' },
            ])}
            <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
            <header class="space-y-2 mt-6">
              <div class="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
                <span class="inline-flex items-center gap-1">
                  <i data-lucide="building-2" class="w-4 h-4" aria-hidden="true"></i>
                  <span>${esc(selectedProperty.name)}</span>
                </span>
              </div>
              <h1 class="text-2xl font-semibold text-slate-900">Extras & serviços</h1>
              <p class="text-sm text-slate-600 max-w-3xl">
                Define os extras disponíveis para a reserva do hóspede, incluindo preços, descontos de estadias longas e janelas de disponibilidade.
              </p>
            </header>
            <form method="get" class="card p-4 mt-6 mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div class="grid gap-2 md:grid-cols-2 md:gap-4 w-full">
                <label class="grid gap-1 text-sm md:col-span-2 md:max-w-sm">
                  <span>Propriedade</span>
                  <select class="input" name="propertyId">${propertyOptions}</select>
                </label>
              </div>
              <button type="submit" class="bo-button bo-button--secondary self-start md:self-auto">Trocar propriedade</button>
            </form>
            ${feedbackBlocks.join('')}
            <form method="post" action="/admin/extras" class="space-y-6" data-extras-form>
              <input type="hidden" name="property_id" value="${selectedProperty.id}" />
              <input type="hidden" name="extras_json" data-extras-json />
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 class="text-lg font-semibold text-slate-800">Extras configurados</h2>
                  <p class="text-sm text-slate-600">Itens adicionados aqui ficam disponíveis no portal do hóspede para esta propriedade.</p>
                </div>
                <button type="button" class="bo-button bo-button--ghost" data-add-extra>
                  <i data-lucide="plus" class="w-4 h-4" aria-hidden="true"></i>
                  <span>Adicionar extra</span>
                </button>
              </div>
              <div class="space-y-4" data-extras-list></div>
              <div class="border border-dashed border-slate-300 rounded-xl p-6 text-center text-sm text-slate-500" data-extras-empty>
                <p class="font-medium text-slate-700 mb-1">Sem extras configurados.</p>
                <p>Utiliza o botão "Adicionar extra" para criar o primeiro serviço disponível.</p>
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200 pt-4">
                <div class="text-xs text-slate-500">As alterações são aplicadas de imediato no portal do hóspede assim que guardares.</div>
                <button type="submit" class="btn btn-primary">Guardar extras</button>
              </div>
            </form>
            <script type="application/json" id="extras-data">${extrasPayloadJson}</script>
            <script>${extrasManagerScript}</script>
          </div>
        `,
      })
    );
  }

  app.get(
    '/admin/extras',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const propertyId = req.query && req.query.propertyId ? String(req.query.propertyId) : undefined;
      const successMessage = req.query && req.query.saved ? 'Extras atualizados com sucesso.' : null;
      renderExtrasManagementPage(req, res, { propertyId, successMessage });
    }
  );

  app.post(
    '/admin/extras',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const body = req.body || {};
      const propertyIdRaw = body.property_id;
      const propertyId = Number.parseInt(propertyIdRaw, 10);
      if (!Number.isInteger(propertyId)) {
        return renderExtrasManagementPage(req, res, {
          errorMessage: 'Propriedade inválida.',
          formState: [],
          propertyId: propertyIdRaw,
        });
      }

      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return renderExtrasManagementPage(req, res, {
          propertyId,
          errorMessage: 'Propriedade não encontrada.',
          formState: [],
        });
      }

      let payloadRaw = {};
      const extrasJsonRaw = body.extras_json;
      if (typeof extrasJsonRaw === 'string') {
        if (extrasJsonRaw.trim()) {
          const parsed = safeJsonParse(extrasJsonRaw, undefined);
          if (parsed === undefined) {
            return renderExtrasManagementPage(req, res, {
              propertyId: property.id,
              errorMessage: 'Formato de dados inválido.',
              formState: [],
            });
          }
          payloadRaw = parsed;
        } else {
          payloadRaw = {};
        }
      } else if (extrasJsonRaw && typeof extrasJsonRaw === 'object') {
        payloadRaw = extrasJsonRaw;
      }

      const submittedExtras = payloadRaw && Array.isArray(payloadRaw.extras) ? payloadRaw.extras : [];

      try {
        const parsedExtras = parseExtrasSubmission(payloadRaw || {});
        const extrasJson = JSON.stringify(parsedExtras);
        const existingPolicy = db
          .prepare('SELECT extras FROM property_policies WHERE property_id = ?')
          .get(property.id);
        const beforeExtras = existingPolicy ? safeJsonParse(existingPolicy.extras, []) : [];

        db.prepare(
          `INSERT INTO property_policies(property_id, extras)
           VALUES (?, ?)
           ON CONFLICT(property_id) DO UPDATE SET extras = excluded.extras`
        ).run(property.id, extrasJson);

        logChange(
          req.user.id,
          'property_policy',
          Number(property.id),
          'update',
          { extras: beforeExtras },
          { extras: parsedExtras }
        );

        return res.redirect(`/admin/extras?propertyId=${property.id}&saved=1`);
      } catch (err) {
        if (err instanceof ValidationError) {
          return renderExtrasManagementPage(req, res, {
            propertyId: property.id,
            errorMessage: err.message,
            formState: submittedExtras,
          });
        }
        console.error('Falha ao guardar extras:', err);
        return renderExtrasManagementPage(req, res, {
          propertyId: property.id,
          errorMessage: 'Não foi possível guardar os extras. Tenta novamente.',
          formState: submittedExtras,
        });
      }
    }
  );
}

module.exports = { registerExtras };
