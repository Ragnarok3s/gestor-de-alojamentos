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
    renderTable,
    extrasTemplateRenderer,
    i18n,
  } = context;

  function resolveTranslator(req, res) {
    if (res && res.locals && typeof res.locals.t === 'function') {
      return res.locals.t;
    }
    if (req && typeof req.t === 'function') {
      return req.t;
    }
    if (i18n && typeof i18n.createTranslator === 'function') {
      const language =
        (res && res.locals && res.locals.language) ||
        (req && req.language) ||
        (typeof i18n.defaultLanguage === 'string' ? i18n.defaultLanguage : 'pt');
      return i18n.createTranslator(language);
    }
    return key => key;
  }

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

  function parseExtrasSubmission(payload, translator) {
    const extrasArray = payload && Array.isArray(payload.extras) ? payload.extras : [];
    const output = [];
    const usedCodes = new Set();
    const t = typeof translator === 'function' ? translator : (key => key);

    extrasArray.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) {
        throw new ValidationError(
          t('errors.extras.nameRequired', { index: index + 1 })
        );
      }
      const codeInput = typeof raw.code === 'string' ? raw.code.trim() : '';
      const normalizedCode = slugify(codeInput || name);
      if (!normalizedCode) {
        throw new ValidationError(
          t('errors.extras.codeInvalid', { name: name || codeInput || '' })
        );
      }
      const codeKey = normalizedCode.toLowerCase();
      if (usedCodes.has(codeKey)) {
        throw new ValidationError(
          t('errors.extras.codeDuplicate', { code: normalizedCode })
        );
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
          throw new ValidationError(
            t('errors.extras.priceInvalid', { name })
          );
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
            throw new ValidationError(
              t('errors.extras.minNightsInvalid', { name })
            );
          }
        }
        if (discountRaw != null && String(discountRaw).trim() !== '') {
          const discountValue = Number.parseInt(String(discountRaw).trim(), 10);
          if (!Number.isNaN(discountValue) && discountValue >= 0 && discountValue <= 100) {
            config.discount_percent = discountValue;
          } else {
            throw new ValidationError(
              t('errors.extras.discountInvalid', { name })
            );
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
    {
      propertyId,
      formState,
      successMessage,
      errorMessage,
      search: searchOverride,
      status: statusOverride,
      sort: sortOverride,
      order: orderOverride,
    } = {}
  ) {
    const translator = resolveTranslator(req, res);
    const languageInput =
      (res.locals && res.locals.language) ||
      req.language ||
      'pt';
    const normalizedLanguage =
      typeof languageInput === 'string' ? languageInput.toLowerCase() : 'pt';
    const locale = normalizedLanguage.startsWith('en') ? 'en-US' : 'pt-PT';
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();

    if (!properties.length) {
      const theme = resolveBrandingForRequest(req);
      serverRender('route:/admin/extras');
      return res.send(
        layout({
          title: translator('extras.headerTitle'),
          user: req.user,
          activeNav: 'backoffice',
          branding: theme,
          body: html`
            <div class="bo-page bo-page--wide">
              ${renderBreadcrumbs([
                { label: translator('extras.breadcrumb.backoffice'), href: '/admin' },
                { label: translator('extras.breadcrumb.current') },
              ])}
              <a class="text-slate-600 underline" href="/admin">&larr; ${translator('extras.breadcrumb.backoffice')}</a>
              <div class="card p-6 space-y-4 mt-6">
                <h1 class="text-2xl font-semibold text-slate-900">${translator('extras.headerTitle')}</h1>
                <p class="text-sm text-slate-600">
                  ${translator('extras.alerts.noPropertiesDescription')}
                </p>
                <div>
                  <a class="bo-button bo-button--primary" href="/admin">${translator('extras.alerts.noPropertiesCta')}</a>
                </div>
              </div>
            </div>
          `,
        })
      );
    }

    const query = req.query || {};
    const successNotice =
      typeof successMessage === 'string'
        ? successMessage
        : query.saved
        ? translator('extras.messages.updated')
        : null;
    const errorNotice = typeof errorMessage === 'string' ? errorMessage : null;
    const rawPropertyId = propertyId != null ? propertyId : query.propertyId;
    const fallbackProperty = properties[0];
    const selectedId = rawPropertyId != null ? String(rawPropertyId) : String(fallbackProperty.id);
    const selectedProperty =
      properties.find(p => String(p.id) === selectedId) || fallbackProperty;

    const rawSearch = searchOverride != null ? searchOverride : query.search;
    const searchValue = typeof rawSearch === 'string' ? rawSearch.trim() : '';
    const rawStatus = statusOverride != null ? statusOverride : query.status;
    const allowedStatus = ['standard', 'long_stay'];
    const statusValue =
      typeof rawStatus === 'string' && allowedStatus.includes(rawStatus) ? rawStatus : 'all';
    const rawSort = sortOverride != null ? sortOverride : query.sort;
    const allowedSort = ['name', 'code', 'price', 'rule', 'availability'];
    const sortKey =
      typeof rawSort === 'string' && allowedSort.includes(rawSort) ? rawSort : 'name';
    const rawOrder = orderOverride != null ? orderOverride : query.order;
    const sortOrder = String(rawOrder || '').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const policyRow = db
      .prepare('SELECT extras FROM property_policies WHERE property_id = ?')
      .get(selectedProperty.id);
    const storedExtras = policyRow ? safeJsonParse(policyRow.extras, []) : [];
    const extrasFormState = Array.isArray(formState)
      ? formState
      : normalizePolicyExtrasForForm(storedExtras);
    const extrasPayloadJson = JSON.stringify({ extras: extrasFormState }).replace(/</g, '\\u003c');

    const extrasSummary = extrasFormState.map((extra, index) => {
      const name = typeof extra.name === 'string' ? extra.name.trim() : '';
      const code = typeof extra.code === 'string' ? extra.code.trim() : '';
      const priceInput =
        typeof extra.priceEuros === 'string' || typeof extra.priceEuros === 'number'
          ? String(extra.priceEuros).trim()
          : '';
      let priceNumber = null;
      if (priceInput) {
        const parsed = Number.parseFloat(priceInput.replace(',', '.'));
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
          priceNumber = parsed;
        }
      }
      const priceLabel =
        priceNumber != null
          ? translator('extras.table.priceValue', {
              amount: priceNumber.toLocaleString(locale, {
                minimumFractionDigits: priceNumber % 1 === 0 ? 0 : 2,
                maximumFractionDigits: 2,
              }),
            })
          : '—';
      const ruleKey = extra.pricingRule === 'long_stay' ? 'long_stay' : 'standard';
      const ruleLabel =
        ruleKey === 'long_stay'
          ? translator('extras.table.rules.longStay')
          : translator('extras.table.rules.standard');
      const availabilityFrom =
        typeof extra.availabilityFrom === 'string' ? extra.availabilityFrom.trim() : '';
      const availabilityTo =
        typeof extra.availabilityTo === 'string' ? extra.availabilityTo.trim() : '';
      const availabilityLabel =
        availabilityFrom || availabilityTo
          ? `${availabilityFrom || '—'} – ${availabilityTo || '—'}`
          : '—';

      return {
        index,
        name,
        code,
        priceNumber,
        priceLabel,
        ruleKey,
        ruleLabel,
        availabilityFrom,
        availabilityTo,
        availabilityLabel,
        searchKey: `${name} ${code}`.toLowerCase(),
      };
    });

    const loweredSearch = searchValue.toLowerCase();
    const filteredSummary = extrasSummary.filter(item => {
      if (statusValue !== 'all' && item.ruleKey !== statusValue) {
        return false;
      }
      if (loweredSearch && !item.searchKey.includes(loweredSearch)) {
        return false;
      }
      return true;
    });

    const multiplier = sortOrder === 'desc' ? -1 : 1;
    const sortedSummary = filteredSummary.slice().sort((a, b) => {
      switch (sortKey) {
        case 'code': {
          const aCode = a.code || '';
          const bCode = b.code || '';
          if (!aCode && bCode) return 1;
          if (aCode && !bCode) return -1;
          return multiplier * aCode.localeCompare(bCode, 'pt', { sensitivity: 'base' });
        }
        case 'price': {
          const aHas = a.priceNumber != null;
          const bHas = b.priceNumber != null;
          if (!aHas && !bHas) return 0;
          if (!aHas) return 1;
          if (!bHas) return -1;
          return multiplier * (a.priceNumber - b.priceNumber);
        }
        case 'rule':
          return multiplier * a.ruleLabel.localeCompare(b.ruleLabel, 'pt', { sensitivity: 'base' });
        case 'availability': {
          const aHas = a.availabilityFrom || a.availabilityTo;
          const bHas = b.availabilityFrom || b.availabilityTo;
          if (!aHas && !bHas) return 0;
          if (!aHas) return 1;
          if (!bHas) return -1;
          const valueA = `${a.availabilityFrom || ''}${a.availabilityTo || ''}`;
          const valueB = `${b.availabilityFrom || ''}${b.availabilityTo || ''}`;
          return multiplier * valueA.localeCompare(valueB, 'pt', { sensitivity: 'base' });
        }
        case 'name':
        default: {
          const aName = a.name || '';
          const bName = b.name || '';
          if (!aName && bName) return 1;
          if (aName && !bName) return -1;
          return multiplier * aName.localeCompare(bName, 'pt', { sensitivity: 'base' });
        }
      }
    });

    const tableRows = sortedSummary.map(item => {
      const anchorId = `extra-${item.index}`;
      return {
        id: anchorId,
        cells: {
          name: { text: item.name || translator('extras.table.noName') },
          code: {
            text: item.code || '—',
            className: item.code ? 'font-mono text-xs text-slate-600' : 'text-xs text-slate-400',
          },
          price: {
            className: 'text-right',
            html: `<span class="table-cell-value">${esc(item.priceLabel)}</span>`,
          },
          rule: { text: item.ruleLabel },
          availability: { text: item.availabilityLabel },
        },
        actions: [
          {
            type: 'link',
            href: `#${anchorId}`,
            label: translator('actions.edit'),
            icon: 'pencil',
          },
        ],
      };
    });

    const propertyOptions = properties.map(p => ({
      value: String(p.id),
      label: p.name,
      selected: String(p.id) === String(selectedProperty.id),
    }));

    const table = {
      id: 'extras-table',
      formAction: '/admin/extras',
      searchValue,
      searchPlaceholder: translator('extras.table.searchPlaceholder'),
      statusOptions: [
        { value: 'all', label: translator('extras.table.statusAll') },
        { value: 'standard', label: translator('extras.table.statusStandard') },
        { value: 'long_stay', label: translator('extras.table.statusLongStay') },
      ],
      statusValue,
      columns: [
        { key: 'name', label: translator('extras.table.columnName'), sortable: true },
        { key: 'code', label: translator('extras.table.columnCode'), sortable: true },
        {
          key: 'price',
          label: translator('extras.table.columnPrice'),
          sortable: true,
          className: 'text-right',
        },
        { key: 'rule', label: translator('extras.table.columnRule'), sortable: true },
        {
          key: 'availability',
          label: translator('extras.table.columnAvailability'),
          sortable: true,
        },
      ],
      rows: tableRows,
      sortKey,
      sortOrder,
      resetUrl: `/admin/extras?propertyId=${selectedProperty.id}`,
      hiddenInputs: { propertyId: selectedProperty.id },
      buildSortUrl: key => {
        const params = new URLSearchParams();
        params.set('propertyId', selectedProperty.id);
        if (searchValue) params.set('search', searchValue);
        if (statusValue !== 'all') params.set('status', statusValue);
        params.set('sort', key);
        params.set('order', sortKey === key && sortOrder === 'asc' ? 'desc' : 'asc');
        return `/admin/extras?${params.toString()}`;
      },
      emptyMessage: translator('extras.table.emptyMessage'),
      actionsLabel: translator('table.actions'),
      statusLabel: translator('table.status'),
      t: translator,
    };

    const theme = resolveBrandingForRequest(req, {
      propertyId: selectedProperty.id,
      propertyName: selectedProperty.name,
    });
    rememberActiveBrandingProperty(res, selectedProperty.id);
    serverRender('route:/admin/extras');

    const breadcrumbsHtml = renderBreadcrumbs([
      { label: translator('extras.breadcrumb.backoffice'), href: '/admin' },
      { label: translator('extras.breadcrumb.current') },
    ]);

    const bodyHtml =
      extrasTemplateRenderer && typeof extrasTemplateRenderer === 'function'
        ? extrasTemplateRenderer({
            esc,
            renderTable: (config) => renderTable(config, req, res),
            table,
            totalCount: extrasSummary.length,
            visibleCount: sortedSummary.length,
            selectedProperty: {
              id: selectedProperty.id,
              name: selectedProperty.name,
            },
            propertyOptions,
            breadcrumbsHtml,
            successMessage: successNotice,
            errorMessage: errorNotice,
            extrasPayloadJson,
            extrasManagerScript,
            searchValue,
            statusValue,
            sortKey,
            sortOrder,
            t: translator,
          })
        : html`
            <div class="bo-page bo-page--wide">
              ${breadcrumbsHtml}
              <a class="text-slate-600 underline" href="/admin">&larr; ${translator('extras.breadcrumb.backoffice')}</a>
              <h1 class="text-2xl font-semibold mt-6">${translator('extras.headerTitle')}</h1>
              ${successNotice
                ? html`<div class="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">${
                    esc(successNotice)
                  }</div>`
                : ''}
              ${errorNotice
                ? html`<div class="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${
                    esc(errorNotice)
                  }</div>`
                : ''}
              ${renderTable(table, req, res)}
              <form method="post" action="/admin/extras" class="space-y-6" data-extras-form>
                <input type="hidden" name="property_id" value="${selectedProperty.id}" />
                <input type="hidden" name="extras_json" data-extras-json />
                <button type="submit" class="btn btn-primary">${translator('extras.save')}</button>
              </form>
              <script type="application/json" id="extras-data">${extrasPayloadJson}</script>
              <script>${extrasManagerScript}</script>
            </div>
          `;

    res.send(
      layout({
        title: translator('extras.headerTitle'),
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        body: bodyHtml,
      })
    );
  }

  app.get(
    '/admin/extras',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const translator = resolveTranslator(req, res);
      const propertyId = req.query && req.query.propertyId ? String(req.query.propertyId) : undefined;
      const successMessage =
        req.query && req.query.saved ? translator('extras.messages.updated') : null;
      renderExtrasManagementPage(req, res, { propertyId, successMessage });
    }
  );

  app.post(
    '/admin/extras',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const translator = resolveTranslator(req, res);
      const body = req.body || {};
      const propertyIdRaw = body.property_id;
      const propertyId = Number.parseInt(propertyIdRaw, 10);
      if (!Number.isInteger(propertyId)) {
        return renderExtrasManagementPage(req, res, {
          errorMessage: translator('errors.extras.invalidProperty'),
          formState: [],
          propertyId: propertyIdRaw,
        });
      }

      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return renderExtrasManagementPage(req, res, {
          propertyId,
          errorMessage: translator('errors.extras.propertyNotFound'),
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
              errorMessage: translator('errors.extras.invalidPayload'),
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
        const parsedExtras = parseExtrasSubmission(payloadRaw || {}, translator);
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
          errorMessage: translator('errors.extras.saveFailed'),
          formState: submittedExtras,
        });
      }
    }
  );
}

module.exports = { registerExtras };
