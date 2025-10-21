// Gere as rotas de extras e addons no backoffice.
const { ValidationError } = require('../../../services/errors');

function registerExtras(app, context) {
  const {
    db,
    html,
    layout,
    renderIcon,
    esc,
    eur,
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
    renderDataTable,
    isSafeRedirectTarget,
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

  function buildQueryString(params) {
    if (!params || typeof params !== 'object') return '';
    return Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }

  function appendNotice(url, notice) {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}notice=${encodeURIComponent(notice)}`;
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

  function translateText(translator, key, defaultValue, values) {
    if (typeof translator === 'function') {
      return translator(key, { defaultValue, values });
    }
    if (defaultValue === undefined) {
      return key;
    }
    if (typeof defaultValue === 'string') {
      return formatTemplate(defaultValue, values);
    }
    return defaultValue;
  }

  function resolveExtrasRedirect(rawTarget, fallback) {
    if (typeof rawTarget === 'string' && rawTarget && isSafeRedirectTarget && isSafeRedirectTarget(rawTarget)) {
      return rawTarget;
    }
    return fallback;
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
    const translate = (key, defaultValue, values) => translateText(translator, key, defaultValue, values);
    const extrasArray = payload && Array.isArray(payload.extras) ? payload.extras : [];
    const output = [];
    const usedCodes = new Set();

    extrasArray.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) {
        throw new ValidationError(
          translate(
            'backoffice.extras.validation.nameRequired',
            'Please add a name to extra #{position}.',
            { position: index + 1 }
          )
        );
      }
      const codeInput = typeof raw.code === 'string' ? raw.code.trim() : '';
      const normalizedCode = slugify(codeInput || name);
      if (!normalizedCode) {
        throw new ValidationError(
          translate('backoffice.extras.validation.invalidCode', 'The code for "{name}" is invalid.', {
            name
          })
        );
      }
      const codeKey = normalizedCode.toLowerCase();
      if (usedCodes.has(codeKey)) {
        throw new ValidationError(
          translate('backoffice.extras.validation.duplicateCode', 'The code "{code}" is already being used.', {
            code: normalizedCode
          })
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
            translate('backoffice.extras.validation.invalidPrice', 'The price for "{name}" is not valid.', {
              name
            })
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
              translate('backoffice.extras.validation.invalidMinNights', 'The minimum nights for "{name}" must be greater than 0.', {
                name
              })
            );
          }
        }
        if (discountRaw != null && String(discountRaw).trim() !== '') {
          const discountValue = Number.parseInt(String(discountRaw).trim(), 10);
          if (!Number.isNaN(discountValue) && discountValue >= 0 && discountValue <= 100) {
            config.discount_percent = discountValue;
          } else {
            throw new ValidationError(
              translate('backoffice.extras.validation.invalidDiscount', 'The discount for "{name}" must be between 0 and 100.', {
                name
              })
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
    { propertyId, formState, successMessage, errorMessage } = {}
  ) {
    const translate = (key, defaultValue, values) => translateText(req.t, key, defaultValue, values);
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();

    if (!properties.length) {
      const theme = resolveBrandingForRequest(req);
      serverRender('route:/admin/extras');
      return res.send(
        layout({
          title: translate('backoffice.extras.title', 'Extras & add-ons'),
          language: req.language,
          t: req.t,
          user: req.user,
          activeNav: 'backoffice',
          branding: theme,
          body: html`
            <div class="bo-page bo-page--wide">
              ${renderBreadcrumbs([
                {
                  label: translate('backoffice.common.breadcrumb.backoffice', 'Backoffice'),
                  href: '/admin'
                },
                { label: translate('backoffice.extras.breadcrumb', 'Extras & add-ons') },
              ])}
              <a class="text-slate-600 underline" href="/admin">&larr; ${esc(
                translate('backoffice.common.breadcrumb.backoffice', 'Backoffice')
              )}</a>
              <div class="card p-6 space-y-4 mt-6">
                <h1 class="text-2xl font-semibold text-slate-900">${esc(
                  translate('backoffice.extras.title', 'Extras & add-ons')
                )}</h1>
                <p class="text-sm text-slate-600">
                  ${esc(
                    translate(
                      'backoffice.extras.noProperty.description',
                      'You need at least one active property to configure extras.'
                    )
                  )}
                </p>
                <div>
                  <a class="bo-button bo-button--primary" href="/admin">${esc(
                    translate(
                      'backoffice.extras.noProperty.cta',
                      'Go to the properties dashboard'
                    )
                  )}</a>
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

    const scriptTranslations = {
      actions: {
        remove: translate('actions.remove', 'Remove')
      },
      form: {
        itemFallback: translate('backoffice.extras.form.itemFallback', 'Extra {number}'),
        detailsHint: translate(
          'backoffice.extras.form.detailsHint',
          'Set the information visible to guests and choose pricing rules.'
        ),
        sectionTitle: translate('backoffice.extras.form.sectionTitle', 'Configured extras'),
        sectionDescription: translate(
          'backoffice.extras.form.sectionDescription',
          'Extras added here become available in the guest portal for this property.'
        ),
        addButton: translate('backoffice.extras.form.addButton', 'Add extra'),
        emptyTitle: translate('backoffice.extras.form.emptyTitle', 'No extras configured yet.'),
        emptyDescription: translate(
          'backoffice.extras.form.emptyDescription',
          'Use the “Add extra” button to create the first service.'
        ),
        autosaveNote: translate(
          'backoffice.extras.form.autosaveNote',
          'Changes go live for guests as soon as you save.'
        ),
        submit: translate('backoffice.extras.form.submit', 'Save extras')
      },
      fields: {
        name: {
          label: translate('backoffice.extras.form.fields.name.label', 'Name'),
          placeholder: translate('backoffice.extras.form.fields.name.placeholder', 'Ex.: Airport transfer')
        },
        code: {
          label: translate('backoffice.extras.form.fields.code.label', 'Internal code'),
          placeholder: translate('backoffice.extras.form.fields.code.placeholder', 'Ex.: transfer'),
          help: translate(
            'backoffice.extras.form.fields.code.help',
            'No spaces; used to identify the extra in bookings.'
          )
        },
        description: {
          label: translate('backoffice.extras.form.fields.description.label', 'Description (optional)'),
          placeholder: translate(
            'backoffice.extras.form.fields.description.placeholder',
            'Notes or limits for the service'
          )
        },
        price: {
          label: translate('backoffice.extras.form.fields.price.label', 'Price (€)'),
          placeholder: translate('backoffice.extras.form.fields.price.placeholder', 'Ex.: 30'),
          help: translate(
            'backoffice.extras.form.fields.price.help',
            'Use 0 to include it without additional cost.'
          )
        },
        rule: {
          label: translate('backoffice.extras.form.fields.rule.label', 'Pricing rule'),
          options: {
            standard: translate(
              'backoffice.extras.form.fields.rule.options.standard',
              'Fixed price per booking'
            ),
            long_stay: translate(
              'backoffice.extras.form.fields.rule.options.longStay',
              'Long-stay discount'
            )
          }
        },
        minNights: {
          label: translate('backoffice.extras.form.fields.minNights.label', 'Minimum nights'),
          placeholder: translate('backoffice.extras.form.fields.minNights.placeholder', 'Ex.: 7')
        },
        discountPercent: {
          label: translate('backoffice.extras.form.fields.discountPercent.label', 'Discount (%)'),
          placeholder: translate('backoffice.extras.form.fields.discountPercent.placeholder', 'Ex.: 15')
        },
        availabilityFrom: {
          label: translate(
            'backoffice.extras.form.fields.availabilityFrom.label',
            'Available from (optional)'
          )
        },
        availabilityTo: {
          label: translate(
            'backoffice.extras.form.fields.availabilityTo.label',
            'Available until (optional)'
          )
        }
      }
    };

    const extrasPayloadJson = JSON.stringify({
      extras: extrasFormState,
      translations: scriptTranslations
    }).replace(/</g, '\\u003c');

    let extrasTableHtml = '';
    if (typeof renderDataTable === 'function') {
      const query = req.query || {};
      const searchValue = typeof query.search === 'string' ? query.search : '';
      const searchTerm = searchValue.trim().toLowerCase();
      const ruleRaw = typeof query.rule === 'string' ? query.rule.trim().toLowerCase() : '';
      const ruleFilter = ruleRaw === 'long_stay' || ruleRaw === 'standard' ? ruleRaw : '';
      const allowedSort = new Set(['name', 'price', 'rule', 'availability']);
      const requestedSort = typeof query.sort === 'string' ? query.sort.trim() : '';
      const sortKey = allowedSort.has(requestedSort) ? requestedSort : 'name';
      const sortDirection = query.direction === 'desc' ? 'desc' : 'asc';
      const requestedPage = Number.parseInt(query.page, 10);
      const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const pageSize = 10;
      const locale = req.language || 'pt';

      const ruleLabels = {
        standard: scriptTranslations.fields.rule.options.standard,
        long_stay: scriptTranslations.fields.rule.options.long_stay
      };
      const alwaysAvailableLabel = translate(
        'backoffice.extras.rules.alwaysAvailable',
        'Always available'
      );

      const extrasEntries = extrasFormState.map((extra, index) => {
        const code = extra.code || slugify(extra.name || `extra-${index + 1}`);
        const safeCode = code || `extra-${index + 1}`;
        const nameLabel = extra.name
          || translate('backoffice.extras.form.itemFallback', 'Extra {number}', { number: index + 1 });
        const description = extra.description || '';
        const priceValue = extra.priceEuros
          ? Number.parseFloat(String(extra.priceEuros).replace(',', '.'))
          : null;
        const priceLabel = extra.priceEuros
          ? `<span class="bo-data-table__value">€ ${esc(extra.priceEuros)}</span>`
          : '<span class="bo-data-table__muted">—</span>';
        const ruleKey = extra.pricingRule === 'long_stay' ? 'long_stay' : 'standard';
        const ruleLabel = ruleLabels[ruleKey] || ruleLabels.standard;
        const ruleTone = ruleKey === 'long_stay' ? 'is-warning' : 'is-muted';
        const availabilityFrom = extra.availabilityFrom || '';
        const availabilityTo = extra.availabilityTo || '';
        const availabilityLabel = availabilityFrom || availabilityTo
          ? `<span class="bo-data-table__value">${esc(availabilityFrom || '00:00')} – ${esc(availabilityTo || '23:59')}</span>`
          : `<span class="bo-data-table__muted">${esc(alwaysAvailableLabel)}</span>`;
        const availabilitySort = `${(availabilityFrom || '').padStart(5, '0')}|${(availabilityTo || '').padStart(5, '0')}`;
        const editAnchor = `#extra-${slugify(safeCode)}`;

        return {
          id: safeCode,
          nameLabel,
          nameSearch: `${nameLabel} ${description}`.toLowerCase(),
          description,
          priceLabel,
          priceValue: Number.isFinite(priceValue) ? priceValue : null,
          ruleKey,
          ruleLabel,
          ruleTone,
          availabilityLabel,
          availabilitySort,
          editAnchor
        };
      });

      const filteredEntries = extrasEntries.filter(entry => {
        if (searchTerm && !entry.nameSearch.includes(searchTerm)) return false;
        if (ruleFilter && entry.ruleKey !== ruleFilter) return false;
        return true;
      });

      const sorters = {
        name: (a, b) => a.nameLabel.localeCompare(b.nameLabel, locale),
        price: (a, b) => {
          const left = a.priceValue != null ? a.priceValue : Number.POSITIVE_INFINITY;
          const right = b.priceValue != null ? b.priceValue : Number.POSITIVE_INFINITY;
          return left - right;
        },
        rule: (a, b) => a.ruleLabel.localeCompare(b.ruleLabel, locale),
        availability: (a, b) => a.availabilitySort.localeCompare(b.availabilitySort)
      };
      const sorter = sorters[sortKey] || sorters.name;
      filteredEntries.sort(sorter);
      if (sortDirection === 'desc') {
        filteredEntries.reverse();
      }

      const total = filteredEntries.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, pageCount);
      const startIndex = (currentPage - 1) * pageSize;
      const paginatedEntries = filteredEntries.slice(startIndex, startIndex + pageSize);

      const queryState = {
        propertyId: String(selectedProperty.id),
        search: searchValue,
        rule: ruleFilter,
        sort: sortKey,
        direction: sortDirection,
        page: currentPage
      };
      const redirectQuery = buildQueryString(queryState);
      const redirectBase = redirectQuery
        ? `/admin/extras?${redirectQuery}`
        : `/admin/extras?propertyId=${selectedProperty.id}`;

      const extrasTableRows = paginatedEntries.map(entry => {
        const redirectHidden = { name: 'redirect', value: redirectBase };
        return {
          id: entry.id,
          cells: [
            {
              html: `<span class="bo-data-table__value">${esc(entry.nameLabel)}</span>${entry.description
                ? `<span class="bo-data-table__muted">${esc(entry.description)}</span>`
                : ''}`
            },
            { html: entry.priceLabel },
            { html: `<span class="bo-data-table__badge ${entry.ruleTone}">${esc(entry.ruleLabel)}</span>` },
            { html: entry.availabilityLabel }
          ],
          actions: [
            {
              type: 'link',
              href: entry.editAnchor,
              label: translate('actions.edit', 'Edit'),
              icon: 'pencil',
              variant: 'ghost',
              name: 'edit'
            },
            {
              type: 'post',
              action: `/admin/extras/${encodeURIComponent(entry.id)}/duplicate`,
              label: translate('actions.duplicate', 'Duplicate'),
              icon: 'copy',
              variant: 'ghost',
              name: 'duplicate',
              hidden: [
                { name: 'property_id', value: String(selectedProperty.id) },
                redirectHidden
              ],
              confirm: {
                title: translate('backoffice.extras.actions.duplicate.title', 'Duplicate extra'),
                message: translate(
                  'backoffice.extras.actions.duplicate.message',
                  'Create a copy of "{name}" with the same details?',
                  { name: entry.nameLabel }
                ),
                confirmLabel: translate('actions.duplicate', 'Duplicate')
              }
            },
            {
              type: 'post',
              action: `/admin/extras/${encodeURIComponent(entry.id)}/delete`,
              label: translate('actions.delete', 'Delete'),
              icon: 'trash-2',
              variant: 'danger',
              name: 'delete',
              hidden: [
                { name: 'property_id', value: String(selectedProperty.id) },
                redirectHidden
              ],
              confirm: {
                title: translate('backoffice.extras.actions.delete.title', 'Delete extra'),
                message: translate(
                  'backoffice.extras.actions.delete.message',
                  'Are you sure you want to delete "{name}"?',
                  { name: entry.nameLabel }
                ),
                confirmLabel: translate('actions.delete', 'Delete')
              }
            }
          ]
        };
      });

      extrasTableHtml = renderDataTable({
        id: 'extras-table',
        action: '/admin/extras',
        columns: [
          {
            key: 'name',
            label: translate('backoffice.extras.table.columns.name', 'Extra'),
            sortable: true
          },
          {
            key: 'price',
            label: translate('backoffice.extras.table.columns.price', 'Price (€)'),
            sortable: true,
            align: 'right'
          },
          {
            key: 'rule',
            label: translate('backoffice.extras.table.columns.rule', 'Rule'),
            sortable: true
          },
          {
            key: 'availability',
            label: translate('backoffice.extras.table.columns.availability', 'Availability'),
            sortable: true
          }
        ],
        rows: extrasTableRows,
        search: {
          name: 'search',
          label: translate('backoffice.extras.table.search.label', 'Search'),
          placeholder: translate(
            'backoffice.extras.table.search.placeholder',
            'Search by name or description'
          ),
          value: searchValue
        },
        filters: [
          {
            name: 'rule',
            label: translate('backoffice.extras.table.filters.rule.label', 'Type'),
            options: [
              {
                value: '',
                label: translate('backoffice.extras.table.filters.rule.all', 'All types')
              },
              { value: 'standard', label: scriptTranslations.fields.rule.options.standard },
              { value: 'long_stay', label: scriptTranslations.fields.rule.options.long_stay }
            ],
            value: ruleFilter
          }
        ],
        sort: { key: sortKey, direction: sortDirection },
        pagination: { page: currentPage, pageSize, pageCount, total },
        query: queryState,
        preserve: ['propertyId', 'sort', 'direction'],
        emptyState: translate('backoffice.extras.table.empty', 'No extras configured.'),
        t: req.t
      });
    }

    const propertyOptions = properties
      .map(p => {
        const isSelected = String(p.id) === String(selectedProperty.id) ? 'selected' : '';
        return `<option value="${p.id}" ${isSelected}>${esc(p.name)}</option>`;
      })
      .join('');

    const propertyLabel = translate('backoffice.extras.form.propertyLabel', 'Property');
    const propertySubmitLabel = translate('backoffice.extras.form.propertySubmit', 'Switch property');
    const sectionTitle = scriptTranslations.form.sectionTitle;
    const sectionDescription = scriptTranslations.form.sectionDescription;
    const addButtonLabel = scriptTranslations.form.addButton;
    const emptyTitle = scriptTranslations.form.emptyTitle;
    const emptyDescription = scriptTranslations.form.emptyDescription;
    const autosaveNote = scriptTranslations.form.autosaveNote;
    const submitLabel = scriptTranslations.form.submit;
    const headerLead = translate(
      'backoffice.extras.header.lead',
      'Define extras available to guests, including pricing, long-stay discounts, and availability windows.'
    );
    const breadcrumbBackoffice = translate('backoffice.common.breadcrumb.backoffice', 'Backoffice');
    const extrasTitle = translate('backoffice.extras.title', 'Extras & add-ons');
    const breadcrumbExtras = translate('backoffice.extras.breadcrumb', extrasTitle);

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
        title: extrasTitle,
        language: req.language,
        t: req.t,
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        body: html`
          <div class="bo-page bo-page--wide">
            ${renderBreadcrumbs([
              { label: breadcrumbBackoffice, href: '/admin' },
              { label: breadcrumbExtras }
            ])}
            <a class="text-slate-600 underline" href="/admin">&larr; ${esc(breadcrumbBackoffice)}</a>
            <header class="space-y-2 mt-6">
              <div class="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
                <span class="inline-flex items-center gap-1">
                  ${renderIcon('building-2', { className: 'w-4 h-4', label: propertyLabel })}
                  <span>${esc(selectedProperty.name)}</span>
                </span>
              </div>
              <h1 class="text-2xl font-semibold text-slate-900">${esc(extrasTitle)}</h1>
              <p class="text-sm text-slate-600 max-w-3xl">${esc(headerLead)}</p>
            </header>
            <form method="get" class="card p-4 mt-6 mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div class="grid gap-2 md:grid-cols-2 md:gap-4 w-full">
                <label class="grid gap-1 text-sm md:col-span-2 md:max-w-sm">
                  <span>${esc(propertyLabel)}</span>
                  <select class="input" name="propertyId">${propertyOptions}</select>
                </label>
              </div>
              <button type="submit" class="bo-button bo-button--secondary self-start md:self-auto">${esc(
                propertySubmitLabel
              )}</button>
            </form>
            ${feedbackBlocks.join('')}
            ${extrasTableHtml ? `<div class="card p-4 mt-6">${extrasTableHtml}</div>` : ''}
            <form method="post" action="/admin/extras" class="space-y-6" data-extras-form>
              <input type="hidden" name="property_id" value="${selectedProperty.id}" />
              <input type="hidden" name="extras_json" data-extras-json />
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 class="text-lg font-semibold text-slate-800">${esc(sectionTitle)}</h2>
                  <p class="text-sm text-slate-600">${esc(sectionDescription)}</p>
                </div>
                <button type="button" class="bo-button bo-button--ghost" data-add-extra>
                  ${renderIcon('plus', { className: 'w-4 h-4', label: addButtonLabel })}
                  <span>${esc(addButtonLabel)}</span>
                </button>
              </div>
              <div class="space-y-4" data-extras-list></div>
              <div class="border border-dashed border-slate-300 rounded-xl p-6 text-center text-sm text-slate-500" data-extras-empty>
                <p class="font-medium text-slate-700 mb-1">${esc(emptyTitle)}</p>
                <p>${esc(emptyDescription)}</p>
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200 pt-4">
                <div class="text-xs text-slate-500">${esc(autosaveNote)}</div>
                <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
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
      let successMessage = null;
      let errorMessage = null;
      if (req.query && req.query.saved) {
        successMessage = translateText(
          req.t,
          'backoffice.extras.notices.saved',
          'Extras updated successfully.'
        );
      } else if (req.query && req.query.notice === 'deleted') {
        successMessage = translateText(
          req.t,
          'backoffice.extras.notices.deleted',
          'Extra deleted successfully.'
        );
      } else if (req.query && req.query.notice === 'duplicated') {
        successMessage = translateText(
          req.t,
          'backoffice.extras.notices.duplicated',
          'Extra duplicated successfully.'
        );
      } else if (req.query && req.query.notice === 'not_found') {
        errorMessage = translateText(
          req.t,
          'backoffice.extras.notices.notFound',
          'We couldn’t find the selected extra.'
        );
      }
      renderExtrasManagementPage(req, res, { propertyId, successMessage, errorMessage });
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
          errorMessage: translateText(
            req.t,
            'backoffice.extras.errors.invalidProperty',
            'Select a valid property.'
          ),
          formState: [],
          propertyId: propertyIdRaw,
        });
      }

      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return renderExtrasManagementPage(req, res, {
          propertyId,
          errorMessage: translateText(
            req.t,
            'backoffice.extras.errors.propertyNotFound',
            'The selected property could not be found.'
          ),
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
              errorMessage: translateText(
                req.t,
                'backoffice.extras.errors.invalidPayload',
                'We couldn’t read the submitted extras.'
              ),
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
        const parsedExtras = parseExtrasSubmission(payloadRaw || {}, req.t);
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
        console.error('Failed to save extras:', err);
        return renderExtrasManagementPage(req, res, {
          propertyId: property.id,
          errorMessage: translateText(
            req.t,
            'backoffice.extras.errors.saveFailed',
            'We couldn’t save the extras. Please try again.'
          ),
          formState: submittedExtras,
        });
      }
    }
  );

  app.post(
    '/admin/extras/:code/delete',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const propertyId = Number.parseInt(req.body.property_id, 10);
      if (!Number.isInteger(propertyId)) {
        return res
          .status(400)
          .send(translateText(req.t, 'backoffice.extras.errors.invalidProperty', 'Select a valid property.'));
      }
      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return res
          .status(404)
          .send(
            translateText(req.t, 'backoffice.extras.errors.propertyNotFound', 'The selected property could not be found.')
          );
      }
      const code = String(req.params.code || '').trim();
      const redirectBase = resolveExtrasRedirect(req.body && req.body.redirect, `/admin/extras?propertyId=${propertyId}`);
      if (!code) {
        return res.redirect(appendNotice(redirectBase, 'not_found'));
      }
      const existingPolicy = db.prepare('SELECT extras FROM property_policies WHERE property_id = ?').get(propertyId);
      const storedExtras = existingPolicy ? safeJsonParse(existingPolicy.extras, []) : [];
      const formExtras = normalizePolicyExtrasForForm(storedExtras);
      const filteredExtras = formExtras.filter(extra => extra.code !== code);
      if (filteredExtras.length === formExtras.length) {
        return res.redirect(appendNotice(redirectBase, 'not_found'));
      }
      const parsedExtras = parseExtrasSubmission({ extras: filteredExtras }, req.t);
      db.prepare(
        `INSERT INTO property_policies(property_id, extras)
         VALUES (?, ?)
         ON CONFLICT(property_id) DO UPDATE SET extras = excluded.extras`
      ).run(propertyId, JSON.stringify(parsedExtras));
      logChange(
        req.user.id,
        'property_policy',
        propertyId,
        'update',
        { extras: storedExtras },
        { extras: parsedExtras }
      );
      res.redirect(appendNotice(redirectBase, 'deleted'));
    }
  );

  app.post(
    '/admin/extras/:code/duplicate',
    requireLogin,
    requirePermission('properties.manage'),
    (req, res) => {
      const propertyId = Number.parseInt(req.body.property_id, 10);
      if (!Number.isInteger(propertyId)) {
        return res
          .status(400)
          .send(translateText(req.t, 'backoffice.extras.errors.invalidProperty', 'Select a valid property.'));
      }
      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return res
          .status(404)
          .send(
            translateText(req.t, 'backoffice.extras.errors.propertyNotFound', 'The selected property could not be found.')
          );
      }
      const code = String(req.params.code || '').trim();
      const redirectBase = resolveExtrasRedirect(req.body && req.body.redirect, `/admin/extras?propertyId=${propertyId}`);
      const existingPolicy = db.prepare('SELECT extras FROM property_policies WHERE property_id = ?').get(propertyId);
      const storedExtras = existingPolicy ? safeJsonParse(existingPolicy.extras, []) : [];
      const formExtras = normalizePolicyExtrasForForm(storedExtras);
      const target = formExtras.find(extra => extra.code === code);
      if (!target) {
        return res.redirect(appendNotice(redirectBase, 'not_found'));
      }
      const copyName = target.name
        ? translateText(req.t, 'backoffice.extras.duplicate.copyOfName', '{name} (copy)', { name: target.name })
        : translateText(req.t, 'backoffice.extras.duplicate.fallbackName', 'Duplicated extra');
      const baseCode = slugify(`${target.code || target.name || 'extra'}-copy`) || `extra-${Date.now().toString(36)}`;
      let newCode = baseCode;
      let attempt = 2;
      while (formExtras.some(extra => extra.code === newCode)) {
        newCode = `${baseCode}-${attempt}`;
        attempt += 1;
      }
      const duplicateExtra = {
        ...target,
        name: copyName,
        code: newCode
      };
      formExtras.push(duplicateExtra);
      const parsedExtras = parseExtrasSubmission({ extras: formExtras }, req.t);
      db.prepare(
        `INSERT INTO property_policies(property_id, extras)
         VALUES (?, ?)
         ON CONFLICT(property_id) DO UPDATE SET extras = excluded.extras`
      ).run(propertyId, JSON.stringify(parsedExtras));
      logChange(
        req.user.id,
        'property_policy',
        propertyId,
        'update',
        { extras: storedExtras },
        { extras: parsedExtras }
      );
      res.redirect(appendNotice(redirectBase, 'duplicated'));
    }
  );
}

module.exports = { registerExtras };
