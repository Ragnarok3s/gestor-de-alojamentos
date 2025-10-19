const registerUxApi = require('./ux-api');
const registerContentCenter = require('./content-center');
const { registerCalendar } = require('./calendar');
const { registerBookings } = require('./bookings');
const { registerHousekeeping } = require('./housekeeping');
const { registerRatePlans } = require('./finance/ratePlans');
const { registerRateRules } = require('./finance/rateRules');
const { ValidationError } = require('../../services/errors');
const { setNoIndex } = require('../../middlewares/security');
const { serverRender } = require('../../middlewares/telemetry');
const {
  describePaymentStatus,
  statusToneToBadgeClass,
  normalizePaymentStatus,
  normalizeReconciliationStatus,
  isSuccessfulRefundStatus
} = require('../../services/payments/status');
const { aggregatePaymentData, computeOutstandingCents } = require('../../services/payments/summary');

const FEATURE_PRESETS = [
  {
    icon: 'shower-head',
    label: 'Casas de banho',
    singular: 'casa de banho',
    plural: 'casas de banho'
  },
  {
    icon: 'sun-snow',
    label: 'Ar condicionado',
    singular: 'equipamento de ar condicionado',
    plural: 'equipamentos de ar condicionado'
  },
  {
    icon: 'bed',
    label: 'Quartos',
    singular: 'quarto',
    plural: 'quartos'
  },
  {
    icon: 'wifi',
    label: 'Redes Wi-Fi',
    singular: 'rede Wi-Fi',
    plural: 'redes Wi-Fi'
  },
  {
    icon: 'tv',
    label: 'Televisões',
    singular: 'televisão',
    plural: 'televisões'
  },
  {
    icon: 'coffee',
    label: 'Máquinas de café',
    singular: 'máquina de café',
    plural: 'máquinas de café'
  },
  {
    icon: 'car',
    label: 'Lugares de estacionamento',
    singular: 'lugar de estacionamento',
    plural: 'lugares de estacionamento'
  },
  {
    icon: 'sun',
    label: 'Terraços',
    singular: 'terraço',
    plural: 'terraços'
  },
  {
    icon: 'waves',
    label: 'Piscinas',
    singular: 'piscina',
    plural: 'piscinas'
  },
  {
    icon: 'chef-hat',
    label: 'Kitchenettes equipadas',
    singular: 'kitchenette equipada',
    plural: 'kitchenettes equipadas'
  }
];

module.exports = function registerBackoffice(app, context) {
  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    eur,
    bcrypt,
    crypto,
    fs,
    fsp,
    path,
    sharp,
    upload,
    uploadBrandingAsset,
    uploadChannelFile,
    paths,
    getSession,
    createSession,
    destroySession,
    revokeUserSessions,
    normalizeRole,
    buildUserContext,
    userCan,
    logActivity,
    logChange,
    geocodeAddress,
    logSessionEvent,
    ensureAutomationFresh,
    automationCache,
    buildUserNotifications,
    automationSeverityStyle,
    formatDateRangeShort,
    formatMonthYear,
    capitalizeMonth,
    safeJsonParse,
    wantsJson,
    parseOperationalFilters,
    computeOperationalDashboard,
    ensureDir,
    rememberActiveBrandingProperty,
    resolveBrandingForRequest,
    parseFeaturesStored,
    ratePlanService,
    parseFeaturesInput,
    featuresToTextarea,
    featureChipsHtml,
    titleizeWords,
    deriveUnitType,
    dateRangeNights,
    requireLogin,
    requireBackofficeAccess,
    requirePermission,
    requireAnyPermission,
    requireScope,
    requireAdmin,
    requireDev,
    userHasScope,
    overlaps,
    unitAvailable,
    rateQuote,
    selectUserPermissionOverridesStmt,
    selectAllPermissionOverridesStmt,
    deletePermissionOverridesForUserStmt,
    insertPermissionOverrideStmt,
    emailTemplates,
    messageTemplates,
    bookingEmailer,
    overbookingGuard,
    channelIntegrations,
    otaDispatcher,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    ALL_PERMISSIONS,
    MASTER_ROLE,
    UNIT_TYPE_ICON_HINTS,
    runAutomationSweep,
    readAutomationState,
    writeAutomationState,
    persistBrandingStore,
    AUTO_CHAIN_THRESHOLD,
    AUTO_CHAIN_CLEANUP_NIGHTS,
    HOT_DEMAND_THRESHOLD,
    renderAuditDiff,
    formatJsonSnippet,
    parsePropertyId,
    slugify,
    sanitizeBrandingTheme,
    extractBrandingSubmission,
    removeBrandingLogo,
    compressImage,
    cloneBrandingStoreState,
    computeBrandingTheme,
    isSafeRedirectTarget,
    insertBlockStmt,
    adminBookingUpdateStmt,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    featureFlags,
    isFeatureEnabled
  } = context;

  const selectUnitPropertyIdStmt = db.prepare('SELECT property_id FROM units WHERE id = ?');
  const selectRoleByKeyStmt = db.prepare('SELECT id, key, name FROM roles WHERE key = ?');
  const insertUserRoleAssignmentStmt = db.prepare(
    'INSERT OR IGNORE INTO user_roles(user_id, role_id, property_id, tenant_id) VALUES (?,?,?,?)'
  );
  const deleteUserRoleAssignmentStmt = db.prepare('DELETE FROM user_roles WHERE id = ? AND tenant_id = ?');
  const deleteUserRolesByUserAndRoleKeyStmt = db.prepare(
    'DELETE FROM user_roles WHERE user_id = ? AND tenant_id = ? AND role_id IN (SELECT id FROM roles WHERE key = ?)'
  );
  const selectUserRoleAssignmentStmt = db.prepare(
    `SELECT ur.id, ur.user_id, ur.property_id, r.key AS role_key, r.name AS role_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.id = ?
        AND ur.tenant_id = ?`
  );

  const { UPLOAD_ROOT, UPLOAD_UNITS, UPLOAD_BRANDING } = paths || {};

  const breadcrumbsTemplatePath = path.join(__dirname, '..', '..', 'views', 'partials', 'breadcrumbs.ejs');
  let breadcrumbsTemplate = '';
  try {
    breadcrumbsTemplate = fs.readFileSync(breadcrumbsTemplatePath, 'utf8');
  } catch (err) {
    breadcrumbsTemplate = '';
  }

  const modalTemplatePath = path.join(__dirname, '..', '..', 'views', 'partials', 'modal.ejs');
  let modalTemplate = '';
  try {
    modalTemplate = fs.readFileSync(modalTemplatePath, 'utf8');
  } catch (err) {
    modalTemplate = '';
  }

  function sanitizeId(value, fallback) {
    const safe = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return safe || fallback;
  }

  function renderModalShell({ id, title, body = '', closeLabel = 'Fechar', extraRootAttr = '' }) {
    if (!modalTemplate) return '';
    const modalId = sanitizeId(id, 'modal');
    const labelId = `${modalId}-title`;
    const replacements = [
      ['__ID__', modalId],
      ['__LABEL_ID__', sanitizeId(labelId, `${modalId}-label`)],
      ['__TITLE__', esc(title || 'Detalhes')],
      ['__BODY__', body || ''],
      ['__CLOSE_LABEL__', esc(closeLabel || 'Fechar')],
      ['__ROOT_ATTR__', extraRootAttr ? String(extraRootAttr) : '']
    ];
    return replacements.reduce((output, [token, value]) => output.split(token).join(value), modalTemplate);
  }

  function isFlagEnabled(flagName) {
    if (typeof isFeatureEnabled === 'function') {
      return isFeatureEnabled(flagName);
    }
    if (featureFlags && Object.prototype.hasOwnProperty.call(featureFlags, flagName)) {
      return !!featureFlags[flagName];
    }
    return false;
  }

  function ensureNoIndex(res) {
    if (isFlagEnabled('FEATURE_META_NOINDEX_BACKOFFICE')) {
      setNoIndex(res);
    }
  }

  function renderBreadcrumbs(trail) {
    if (!isFlagEnabled('FEATURE_BREADCRUMBS')) return '';
    if (!Array.isArray(trail) || trail.length === 0) return '';
    if (!breadcrumbsTemplate) return '';
    const items = trail
      .map((item, index) => {
        if (!item || !item.label) return '';
        const label = esc(item.label);
        const isLast = index === trail.length - 1;
        if (!isLast && item.href) {
          return `<li class="bo-breadcrumbs__item"><a class="bo-breadcrumbs__link" href="${esc(item.href)}">${label}</a></li>`;
        }
        return `<li class="bo-breadcrumbs__item"><span class="bo-breadcrumbs__current" aria-current="page">${label}</span></li>`;
      })
      .filter(Boolean)
      .join('');
    if (!items) return '';
    return breadcrumbsTemplate.replace('<!--BREADCRUMB_ITEMS-->', items);
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
                  null
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
          availabilityTo
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
        pricing_rule: pricingRule
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
          to: availabilityTo || null
        };
      }

      output.push(extraRecord);
    });

    return output;
  }

  app.use('/admin', requireLogin, requireBackofficeAccess);
  app.use('/admin', (req, res, next) => {
    ensureNoIndex(res);
    next();
  });

  registerUxApi(app, context);
  registerContentCenter(app, context);

  const deleteLockByBookingStmt = db.prepare('DELETE FROM unit_blocks WHERE lock_owner_booking_id = ?');

  registerCalendar(app, {
    ...context,
    inlineScript,
    renderModalShell,
    isFlagEnabled,
    ensureNoIndex,
    deleteLockByBookingStmt
  });

  registerBookings(app, {
    ...context,
    deleteLockByBookingStmt,
    adminBookingUpdateStmt
  });

  registerRatePlans(app, {
    ...context,
    inlineScript,
    renderBreadcrumbs,
  });

  registerRateRules(app, {
    ...context,
    inlineScript,
    renderBreadcrumbs,
  });

  const { getHousekeepingTasks, computeHousekeepingBoard } = registerHousekeeping(app, {
    ...context,
    renderBreadcrumbs
  });

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
                { label: 'Extras & serviços' }
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
          `
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
      propertyName: selectedProperty.name
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
              { label: 'Extras & serviços' }
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
        `
      })
    );
  }

  const FEATURE_PRESET_OPTIONS_HTML = FEATURE_PRESETS.map(
    item => `<option value="${item.icon}">${esc(item.label)}</option>`
  ).join('');
  const FEATURE_PICKER_OPTIONS_HTML = FEATURE_PRESETS.map(
    item => `
              <button type="button" class="feature-builder__icon-option" data-icon-option data-icon="${item.icon}" data-label="${esc(item.label)}" role="option" aria-selected="false">
                <span class="feature-builder__icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></span>
                <span>${esc(item.label)}</span>
              </button>`
  ).join('');
  const FEATURE_PICKER_LEGEND_HTML = `
    <details class="feature-builder__legend">
      <summary>
        <span class="feature-builder__legend-summary">
          <i aria-hidden="true" data-lucide="list"></i>
          <span>Ver ícones disponíveis</span>
        </span>
      </summary>
      <ul class="feature-builder__legend-list">
        ${FEATURE_PRESETS.map(
          item => `
            <li class="feature-builder__legend-item">
              <span class="feature-builder__icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></span>
              <span>
                <strong>${esc(item.label)}</strong>
                <small>${esc(item.singular)}${item.plural ? ' · ' + esc(item.plural) : ''}</small>
              </span>
            </li>
          `
        ).join('')}
      </ul>
    </details>
  `;
  const FEATURE_PRESETS_JSON = JSON.stringify(FEATURE_PRESETS).replace(/</g, '\\u003c');

  function inlineScript(source) {
    return source.replace(/<\/(script)/gi, '<\\/$1');
  }

  const scriptsDir = path.join(__dirname, 'scripts');
  const featureBuilderSource = fs.readFileSync(path.join(scriptsDir, 'feature-builder-runtime.js'), 'utf8');
  const dashboardTabsSource = fs.readFileSync(path.join(scriptsDir, 'dashboard-tabs.js'), 'utf8');
  const galleryManagerSource = fs.readFileSync(path.join(scriptsDir, 'unit-gallery-manager.js'), 'utf8');
  const revenueDashboardSource = fs.readFileSync(path.join(scriptsDir, 'revenue-dashboard.js'), 'utf8');
  const revenueCalendarSource = fs.readFileSync(path.join(scriptsDir, 'revenue-calendar.js'), 'utf8');
  const uxEnhancementsSource = fs.readFileSync(path.join(scriptsDir, 'ux-enhancements.js'), 'utf8');
  const sidebarControlsSource = fs.readFileSync(path.join(scriptsDir, 'sidebar-controls.js'), 'utf8');
  const extrasManagerSource = fs.readFileSync(path.join(scriptsDir, 'extras-manager.js'), 'utf8');

  const featureBuilderScript = inlineScript(
    featureBuilderSource.replace(/__FEATURE_PRESETS__/g, FEATURE_PRESETS_JSON)
  );
  const galleryManagerScript = inlineScript(galleryManagerSource);
  const revenueDashboardScript = inlineScript(revenueDashboardSource);
  const revenueCalendarScript = inlineScript(revenueCalendarSource);
  const uxEnhancementsScript = inlineScript(uxEnhancementsSource);
  const sidebarControlsScript = inlineScript(sidebarControlsSource);
  const extrasManagerScript = inlineScript(extrasManagerSource);

  function jsonScriptPayload(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function propertyLocationLabel(property) {
    if (!property) return '';
    const parts = [];
    const locality = typeof property.locality === 'string' ? property.locality.trim() : '';
    const district = typeof property.district === 'string' ? property.district.trim() : '';
    if (locality) parts.push(locality);
    if (district) parts.push(district);
    if (parts.length) return parts.join(', ');
    return property.location || '';
  }

  function renderDashboardTabsScript(defaultPaneId) {
    const safePane = typeof defaultPaneId === 'string' ? defaultPaneId : '';
    return inlineScript(
      dashboardTabsSource.replace('__DEFAULT_PANE__', JSON.stringify(safePane))
    );
  }

  function renderFeatureBuilderField({ name, value, helperText, label } = {}) {
    const fieldName = name ? esc(name) : 'features_raw';
    const safeValue = value ? esc(value) : '';
    const helperParts = [];
    if (helperText) helperParts.push(`<p class="form-hint">${esc(helperText)}</p>`);
    helperParts.push(FEATURE_PICKER_LEGEND_HTML);
    const helper = helperParts.join('');
    const heading = label ? `<span class="form-label">${esc(label)}</span>` : '';
    return `
      <div class="feature-builder form-field" data-feature-builder>
        ${heading}
        <div class="feature-builder__controls">
          <label class="feature-builder__control feature-builder__control--select">
            <span class="feature-builder__control-label">Característica</span>
            <div class="feature-builder__icon-picker" data-feature-picker>
              <button type="button" class="feature-builder__icon-toggle" data-feature-picker-toggle aria-haspopup="true" aria-expanded="false" aria-label="Selecionar característica">
                <span class="feature-builder__icon-preview is-empty" data-feature-picker-preview aria-hidden="true"><i data-lucide="plus"></i></span>
                <span class="feature-builder__icon-text">
                  <span class="feature-builder__icon-placeholder" data-feature-picker-label data-placeholder="Selecionar característica">Selecionar característica</span>
                </span>
                <span class="feature-builder__icon-caret" aria-hidden="true"><i data-lucide="chevron-down"></i></span>
              </button>
              <div class="feature-builder__icon-options" data-feature-picker-options hidden role="listbox" aria-label="Selecionar característica">
                ${FEATURE_PICKER_OPTIONS_HTML}
              </div>
              <select data-feature-select hidden>
                <option value="">Selecionar característica</option>
                ${FEATURE_PRESET_OPTIONS_HTML}
              </select>
            </div>
          </label>
          <label class="feature-builder__control feature-builder__control--detail">
            <span class="feature-builder__control-label">Detalhe</span>
            <input type="text" class="input feature-builder__detail" data-feature-detail placeholder="Ex.: 2 camas king" value="" />
          </label>
          <button type="button" class="btn btn-light feature-builder__add" data-feature-add>Adicionar</button>
        </div>
        <ul class="feature-builder__list" data-feature-list data-empty-text="Sem características adicionadas."></ul>
        ${helper}
        <textarea name="${fieldName}" data-feature-output hidden>${safeValue}</textarea>
      </div>
    `;
  }

  app.post('/limpeza/tarefas/:id/progresso', requireLogin, requirePermission('housekeeping.complete'), (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Tarefa inválida' });
      return res.status(400).send('Tarefa inválida');
    }
    const task = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    if (!task) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Tarefa não encontrada' });
      return res.status(404).send('Tarefa não encontrada');
    }
    if (task.status === 'completed') {
      if (wantsJson(req)) return res.json({ ok: true, status: 'completed' });
      return res.redirect(resolveHousekeepingRedirect(req, '/limpeza/tarefas'));
    }
    const now = dayjs().toISOString();
    db.prepare(
      `UPDATE housekeeping_tasks
          SET status = 'in_progress',
              started_at = COALESCE(started_at, ?),
              started_by = COALESCE(started_by, ?)
        WHERE id = ?`
    ).run(now, req.user.id, taskId);
    const afterTask = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    logChange(
      req.user.id,
      'housekeeping_task',
      taskId,
      'start',
      serializeHousekeepingTaskForAudit(task),
      serializeHousekeepingTaskForAudit(afterTask)
    );
    logActivity(req.user.id, 'housekeeping:start', 'housekeeping_task', taskId, {
      from: task.status,
      to: 'in_progress'
    });
    if (wantsJson(req)) return res.json({ ok: true, status: 'in_progress' });
    res.redirect(resolveHousekeepingRedirect(req, '/limpeza/tarefas'));
  });

  app.post('/limpeza/tarefas/:id/concluir', requireLogin, requirePermission('housekeeping.complete'), (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Tarefa inválida' });
      return res.status(400).send('Tarefa inválida');
    }
    const task = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    if (!task) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Tarefa não encontrada' });
      return res.status(404).send('Tarefa não encontrada');
    }
    if (task.status === 'completed') {
      if (wantsJson(req)) return res.json({ ok: true, status: 'completed' });
      return res.redirect(resolveHousekeepingRedirect(req, '/limpeza/tarefas'));
    }
    const now = dayjs().toISOString();
    db.prepare(
      `UPDATE housekeeping_tasks
          SET status = 'completed',
              completed_at = ?,
              completed_by = ?,
              started_at = COALESCE(started_at, ?),
              started_by = COALESCE(started_by, ?)
        WHERE id = ?`
    ).run(now, req.user.id, now, req.user.id, taskId);
    const afterTask = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    logChange(
      req.user.id,
      'housekeeping_task',
      taskId,
      'complete',
      serializeHousekeepingTaskForAudit(task),
      serializeHousekeepingTaskForAudit(afterTask)
    );
    logActivity(req.user.id, 'housekeeping:complete', 'housekeeping_task', taskId, {
      from: task.status,
      to: 'completed'
    });
    if (wantsJson(req)) return res.json({ ok: true, status: 'completed' });
    res.redirect(resolveHousekeepingRedirect(req, '/limpeza/tarefas'));
  });

  app.post('/admin/limpeza/tarefas/:id/reabrir', requireLogin, requirePermission('housekeeping.manage'), (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Tarefa inválida' });
      return res.status(400).send('Tarefa inválida');
    }
    const task = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    if (!task) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Tarefa não encontrada' });
      return res.status(404).send('Tarefa não encontrada');
    }
    db.prepare(
      `UPDATE housekeeping_tasks
          SET status = 'pending',
              started_at = NULL,
              started_by = NULL,
              completed_at = NULL,
              completed_by = NULL
        WHERE id = ?`
    ).run(taskId);
    const afterTask = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
    logChange(
      req.user.id,
      'housekeeping_task',
      taskId,
      'reopen',
      serializeHousekeepingTaskForAudit(task),
      serializeHousekeepingTaskForAudit(afterTask)
    );
    logActivity(req.user.id, 'housekeeping:reopen', 'housekeeping_task', taskId, {
      from: task.status,
      to: 'pending'
    });
    if (wantsJson(req)) return res.json({ ok: true, status: 'pending' });
    res.redirect(resolveHousekeepingRedirect(req, '/admin/limpeza'));
  });


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
          propertyId: propertyIdRaw
        });
      }

      const property = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(propertyId);
      if (!property) {
        return renderExtrasManagementPage(req, res, {
          propertyId,
          errorMessage: 'Propriedade não encontrada.',
          formState: []
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
              formState: []
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
            formState: submittedExtras
          });
        }
        console.error('Falha ao guardar extras:', err);
        return renderExtrasManagementPage(req, res, {
          propertyId: property.id,
          errorMessage: 'Não foi possível guardar os extras. Tenta novamente.',
          formState: submittedExtras
        });
      }
    }
  );

  app.get('/admin', requireLogin, requirePermission('dashboard.view'), (req, res) => {
    const props = db.prepare('SELECT * FROM properties ORDER BY name').all();
    const unitsRaw = db
      .prepare(
        `SELECT u.*, p.name as property_name, p.locality as property_locality, p.district as property_district
         FROM units u
         JOIN properties p ON p.id = u.property_id
        ORDER BY p.name, u.name`
      )
      .all();
    const units = unitsRaw.map(u => {
      const lat = u.latitude != null ? Number.parseFloat(u.latitude) : NaN;
      const lon = u.longitude != null ? Number.parseFloat(u.longitude) : NaN;
      return {
        ...u,
        unit_type: deriveUnitType(u),
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lon) ? lon : null
      };
    });
    const activeUnitBlocks = db
      .prepare(
        `SELECT unit_id, start_date, end_date, reason
           FROM unit_blocks
          WHERE end_date > ?
            AND (lock_type IS NULL OR lock_type <> 'HARD_LOCK')
          ORDER BY start_date`
      )
      .all(dayjs().format('YYYY-MM-DD'));
    const unitBlockIndex = new Map();
    activeUnitBlocks.forEach(block => {
      if (!unitBlockIndex.has(block.unit_id)) unitBlockIndex.set(block.unit_id, []);
      unitBlockIndex.get(block.unit_id).push(block);
    });
    const propertyUnitMap = new Map();
    props.forEach(p => propertyUnitMap.set(p.id, []));
    units.forEach(u => {
      if (!propertyUnitMap.has(u.property_id)) propertyUnitMap.set(u.property_id, []);
      propertyUnitMap.get(u.property_id).push(u);
    });

    const propertyRevenueRows = db
      .prepare(
        `SELECT p.id,
                p.name,
                p.locality,
                p.district,
                SUM(CASE WHEN b.status = 'CONFIRMED' THEN b.total_cents ELSE 0 END) AS confirmed_revenue_cents,
                SUM(CASE WHEN b.status = 'PENDING' THEN b.total_cents ELSE 0 END) AS pending_revenue_cents,
                COUNT(DISTINCT u.id) AS unit_count
           FROM properties p
           LEFT JOIN units u ON u.property_id = p.id
           LEFT JOIN bookings b ON b.unit_id = u.id
          GROUP BY p.id
          ORDER BY p.name`
      )
      .all();

    const recentBookings = db
      .prepare(
        `SELECT b.*, u.name as unit_name, p.name as property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          ORDER BY b.created_at DESC
          LIMIT 12`
      )
      .all();

    const automationData = ensureAutomationFresh(5) || automationCache;
    const automationMetrics = automationData.metrics || {};
    const automationNotifications = automationData.notifications || [];
    const automationSuggestions = automationData.tariffSuggestions || [];
    const automationBlocks = automationData.generatedBlocks || [];
    const automationDaily = (automationData.summaries && automationData.summaries.daily) || [];
    const automationWeekly = (automationData.summaries && automationData.summaries.weekly) || [];
    const automationLastRun = automationData.lastRun ? dayjs(automationData.lastRun).format('DD/MM HH:mm') : '—';
    const automationRevenue7 = automationData.revenue ? automationData.revenue.next7 || 0 : 0;
    const automationRevenue30 = automationData.revenue ? automationData.revenue.next30 || 0 : 0;
    const totalUnitsCount = automationMetrics.totalUnits || units.length || 0;

    const unitTypeOptions = Array.from(new Set(units.map(u => u.unit_type).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt', { sensitivity: 'base' })
    );
    const monthOptions = [];
    const monthBase = dayjs().startOf('month');
    for (let i = 0; i < 12; i++) {
      const m = monthBase.subtract(i, 'month');
      monthOptions.push({ value: m.format('YYYY-MM'), label: capitalizeMonth(m.format('MMMM YYYY')) });
    }
    const defaultMonthValue = monthOptions.length ? monthOptions[0].value : dayjs().format('YYYY-MM');
    const operationalDefault = computeOperationalDashboard({ month: defaultMonthValue });
    const operationalConfig = {
      filters: {
        months: monthOptions,
        properties: props.map(p => ({ id: p.id, name: p.name })),
        unitTypes: unitTypeOptions
      },
      defaults: {
        month: operationalDefault.month,
        propertyId: operationalDefault.filters.propertyId ? String(operationalDefault.filters.propertyId) : '',
        unitType: operationalDefault.filters.unitType || ''
      },
      initialData: operationalDefault
    };
    const operationalConfigJson = jsonScriptPayload(operationalConfig);

    const financialTotals =
      db
        .prepare(
          `SELECT
              SUM(CASE WHEN status = 'CONFIRMED' THEN total_cents ELSE 0 END) AS confirmed_cents,
              SUM(CASE WHEN status = 'PENDING' THEN total_cents ELSE 0 END) AS pending_cents,
              SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_count,
              SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count
           FROM bookings`
        )
        .get() || {};
    const confirmedRevenueCents = financialTotals.confirmed_cents || 0;
    const pendingRevenueCents = financialTotals.pending_cents || 0;
    const confirmedBookingsCount = financialTotals.confirmed_count || 0;
    const pendingBookingsCount = financialTotals.pending_count || 0;
    const averageTicketCents = confirmedBookingsCount ? Math.round(confirmedRevenueCents / confirmedBookingsCount) : 0;

    const canManageProperties = userCan(req.user, 'properties.manage');
    const canViewAutomation = userCan(req.user, 'automation.view');
    const canManageHousekeeping = userCan(req.user, 'housekeeping.manage');
    const canViewHousekeeping = userCan(req.user, 'housekeeping.view');
    const canSeeHousekeeping = canManageHousekeeping || canViewHousekeeping;
    const canManageUsers = userCan(req.user, 'users.manage');
    const canManageEmailTemplates = userCan(req.user, 'bookings.edit');
    const canManageIntegrations = canManageEmailTemplates;
    const canViewCalendar = userCan(req.user, 'calendar.view');
    const canViewRevenueCalendar = userCan(req.user, 'dashboard.view');
    const isDevOperator = req.user && req.user.role === MASTER_ROLE;
    const isDirectorOperator = req.user && req.user.role === 'direcao';
    const canViewHistory = !!(isDevOperator || isDirectorOperator);

    let housekeepingSummary = null;
    let housekeepingCounts = null;
    let housekeepingPending = [];
    let housekeepingInProgress = [];
    let housekeepingCompleted = [];
    if (canSeeHousekeeping) {
      housekeepingSummary = computeHousekeepingBoard({ horizonDays: 3, futureWindowDays: 21 });
      const tasks = Array.isArray(housekeepingSummary.tasks) ? housekeepingSummary.tasks : [];
      housekeepingCounts = {
        pending: tasks.filter(task => task.status === 'pending').length,
        inProgress: tasks.filter(task => task.status === 'in_progress').length,
        highPriority: tasks.filter(task => task.priority === 'alta' && task.status !== 'completed').length,
        completedRecent: 0
      };
      housekeepingPending = tasks.filter(task => task.status === 'pending').slice(0, 6);
      housekeepingInProgress = tasks.filter(task => task.status === 'in_progress').slice(0, 6);
      housekeepingCompleted = getHousekeepingTasks({
        statuses: ['completed'],
        includeCompleted: true,
        limit: 40,
        order: 'completed_desc'
      })
        .filter(task => task.completed_at && dayjs(task.completed_at).isAfter(dayjs().subtract(7, 'day')))
        .slice(0, 6);
      housekeepingCounts.completedRecent = housekeepingCompleted.length;
    }

    const userRows = canManageUsers
      ? db
          .prepare('SELECT id, username, role FROM users WHERE tenant_id = ? ORDER BY username')
          .all(req.tenant && req.tenant.id ? Number(req.tenant.id) : 1)
      : [];

    const calendarPreview = canViewCalendar
      ? db
          .prepare(
            `SELECT b.id, b.guest_name, b.checkin, b.checkout, b.status, u.name AS unit_name, p.name AS property_name
               FROM bookings b
               JOIN units u ON u.id = b.unit_id
               JOIN properties p ON p.id = u.property_id
              WHERE b.status IN ('CONFIRMED','PENDING')
                AND b.checkout >= date('now')
              ORDER BY b.checkin
              LIMIT 12`
          )
          .all()
      : [];

    const historyLimit = 60;
    let historyBookingLogs = [];
    let historyTaskLogs = [];
    if (canViewHistory) {
      const historyStmt = db.prepare(
        `SELECT cl.id,
                cl.entity_type,
                cl.entity_id,
                cl.action,
                cl.before_json,
                cl.after_json,
                cl.created_at,
                u.username AS actor_username
           FROM change_logs cl
           LEFT JOIN users u ON u.id = cl.actor_id
          WHERE cl.entity_type = ?
          ORDER BY cl.created_at DESC
          LIMIT ?`
      );
      historyBookingLogs = historyStmt.all('booking', historyLimit);
      historyTaskLogs = historyStmt.all('housekeeping_task', historyLimit);
    }

    let historyBookingHtml = '';
    let historyTaskHtml = '';
    if (canViewHistory) {
      const renderHistoryEntry = (log, label) => html`
        <article class="bo-card p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-slate-600">${dayjs(log.created_at).format('DD/MM/YYYY HH:mm')}</span>
            <span class="text-xs uppercase tracking-wide text-amber-700">${esc(log.action)}</span>
          </div>
          <div class="flex flex-wrap gap-2 text-sm text-slate-700">
            <span class="pill-indicator">${esc(label)}</span>
            <span class="text-slate-500">por ${esc(log.actor_username || 'Utilizador removido')}</span>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 overflow-x-auto">${renderAuditDiff(log.before_json, log.after_json)}</div>
        </article>
      `;
      historyBookingHtml = historyBookingLogs.length
        ? historyBookingLogs.map(log => renderHistoryEntry(log, `Reserva #${log.entity_id}`)).join('')
        : '<p class="bo-empty">Sem alterações recentes às reservas.</p>';
      historyTaskHtml = historyTaskLogs.length
        ? historyTaskLogs.map(log => renderHistoryEntry(log, `Tarefa #${log.entity_id}`)).join('')
        : '<p class="bo-empty">Sem alterações recentes às tarefas de limpeza.</p>';
    }

    const notifications = buildUserNotifications({
      user: req.user,
      db,
      dayjs,
      userCan,
      automationData,
      automationCache,
      ensureAutomationFresh
    });

    const enableExportShortcuts = isFlagEnabled('FEATURE_NAV_EXPORT_SHORTCUTS');
    const canExportBookings = enableExportShortcuts && userCan(req.user, 'bookings.export');
    const canManageRates = userCan(req.user, 'rates.manage');
    const canAccessAudit = userCan(req.user, 'audit.view') || userCan(req.user, 'logs.view');

    const canViewBookings = userCan(req.user, 'bookings.view');
    const quickLinks = [];
    if (canManageHousekeeping) {
      quickLinks.push({
        title: 'Limpezas',
        description: 'Planeia e acompanha tarefas de housekeeping avançadas.',
        href: '/admin/limpeza',
        cta: 'Abrir limpezas'
      });
    }
    if (canExportBookings) {
      quickLinks.push({
        title: 'Exportar calendário',
        description: 'Gera ficheiros Excel com reservas confirmadas.',
        href: '/admin/export',
        cta: 'Exportar reservas'
      });
    }
    if (canManageRates) {
      quickLinks.push({
        title: 'Regras de tarifas',
        description: 'Configura regras automáticas e ajustes dinâmicos de preço.',
        href: '/admin/rates/rules',
        cta: 'Gerir tarifas'
      });
    }
    if (canManageProperties) {
      const managedProperty =
        props.find(p => userHasScope(req.user, 'properties.manage', p.id)) || props[0] || null;
      if (managedProperty) {
        quickLinks.push({
          title: 'Propriedades',
          description: `Abrir ${managedProperty.name}`,
          href: `/admin/properties/${managedProperty.id}`,
          cta: 'Abrir propriedade'
        });
      } else {
        quickLinks.push({
          title: 'Propriedades',
          description: 'Sem propriedades atribuídas. Adicione uma para começar.',
          href: null,
          locked: true
        });
      }
    }
    if (canManageUsers) {
      quickLinks.push({
        title: 'Utilizadores',
        description: 'Gerir contas internas, perfis e permissões.',
        href: '/admin/utilizadores',
        cta: 'Gerir utilizadores'
      });
    }
    if (userCan(req.user, 'bookings.view')) {
      quickLinks.push({
        title: 'Pagamentos',
        description: 'Consulta cobranças registadas e estado de reconciliação.',
        href: '/admin/pagamentos',
        cta: 'Ver pagamentos'
      });
    }
    if (isFlagEnabled('FEATURE_NAV_AUDIT_LINKS') && canAccessAudit) {
      quickLinks.push({
        title: 'Auditoria',
        description: 'Consulta logs de alterações, sessões e acessos sensíveis.',
        href: '/admin/auditoria',
        cta: 'Abrir auditoria'
      });
    }
    let quickAccessHtml = '';

    const channelRecords = channelIntegrations.listIntegrations();
    const channelNameMap = new Map(channelRecords.map(record => [record.key, record.name]));
    const channelRecentImports = channelIntegrations.listRecentImports(12);
    const manualChannelOptions = channelRecords
      .filter(record => record.supportsManual)
      .map(record => `<option value="${record.key}">${esc(record.name)}</option>`)
      .join('');
    const manualFormatsLegend = channelRecords
      .filter(record => record.supportsManual && record.manualFormats && record.manualFormats.length)
      .map(
        record => `
          <li class="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-xs">
            <span class="font-medium text-slate-700">${esc(record.name)}</span>
            <span class="text-[11px] uppercase tracking-wide text-slate-500">${esc(record.manualFormats.join(', '))}</span>
          </li>`
      )
      .join('');
    const channelNoticeRaw = typeof req.query.channel_notice === 'string' ? req.query.channel_notice : '';
    const buildChannelNotice = (tone, text) => {
      const toneClass =
        tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-rose-200 bg-rose-50 text-rose-700';
      return `<div class="rounded-2xl border px-4 py-3 text-sm leading-relaxed ${toneClass}">${esc(text)}</div>`;
    };
    let channelNoticeHtml = '';
    if (channelNoticeRaw) {
      if (channelNoticeRaw.startsWith('imported:')) {
        const parts = channelNoticeRaw.split(':');
        const inserted = Number(parts[1] || 0);
        const unmatched = Number(parts[2] || 0);
        const duplicates = Number(parts[3] || 0);
        const conflicts = Number(parts[4] || 0);
        const errorsCount = Number(parts[5] || 0);
        const fragments = [`${inserted} reserva${inserted === 1 ? '' : 's'} adicionada${inserted === 1 ? '' : 's'}`];
        if (duplicates) fragments.push(`${duplicates} duplicada${duplicates === 1 ? '' : 's'}`);
        if (conflicts) fragments.push(`${conflicts} em conflito`);
        if (unmatched) fragments.push(`${unmatched} sem correspondência`);
        if (errorsCount) fragments.push(`${errorsCount} erro${errorsCount === 1 ? '' : 's'}`);
        channelNoticeHtml = buildChannelNotice(
          errorsCount || conflicts ? 'warning' : 'success',
          `Importação concluída: ${fragments.join(' · ')}.`
        );
      } else if (channelNoticeRaw.startsWith('sync:')) {
        const parts = channelNoticeRaw.split(':');
        const channelKey = parts[1] || '';
        const inserted = Number(parts[2] || 0);
        const unmatched = Number(parts[3] || 0);
        const duplicates = Number(parts[4] || 0);
        const conflicts = Number(parts[5] || 0);
        const errorsCount = Number(parts[6] || 0);
        const channelName = channelNameMap.get(channelKey) || channelKey;
        const fragments = [`${inserted} nova${inserted === 1 ? '' : 's'}`];
        if (duplicates) fragments.push(`${duplicates} duplicada${duplicates === 1 ? '' : 's'}`);
        if (conflicts) fragments.push(`${conflicts} em conflito`);
        if (unmatched) fragments.push(`${unmatched} sem correspondência`);
        if (errorsCount) fragments.push(`${errorsCount} erro${errorsCount === 1 ? '' : 's'}`);
        channelNoticeHtml = buildChannelNotice(
          errorsCount || conflicts ? 'warning' : 'success',
          `Sincronização de ${channelName}: ${fragments.join(' · ')}.`
        );
      } else if (channelNoticeRaw.startsWith('settings:')) {
        const parts = channelNoticeRaw.split(':');
        const channelKey = parts[1] || '';
        const channelName = channelNameMap.get(channelKey) || channelKey;
        channelNoticeHtml = buildChannelNotice('success', `Definições de ${channelName} guardadas com sucesso.`);
      } else if (channelNoticeRaw.startsWith('skipped:')) {
        const parts = channelNoticeRaw.split(':');
        const channelKey = parts[1] || '';
        const channelName = channelNameMap.get(channelKey) || channelKey;
        channelNoticeHtml = buildChannelNotice(
          'warning',
          `Sincronização ignorada. Verifique a configuração automática de ${channelName}.`
        );
      } else if (channelNoticeRaw.startsWith('error:')) {
        const message = channelNoticeRaw.slice(6).trim() || 'Erro inesperado ao processar a integração.';
        channelNoticeHtml = buildChannelNotice('danger', `Erro na integração: ${message}.`);
      }
    }

    const totalChannels = channelRecords.length;
    const autoActiveCount = channelRecords.filter(record => {
      const settings = record.settings || {};
      return record.supportsAuto && settings.autoEnabled && settings.autoUrl;
    }).length;
    const manualEnabledCount = channelRecords.filter(record => record.supportsManual).length;
    const channelsNeedingAttention = channelRecords.filter(record => {
      const settings = record.settings || {};
      const autoEnabled = record.supportsAuto && settings.autoEnabled;
      return (autoEnabled && !settings.autoUrl) || record.last_status === 'failed' || record.last_error;
    }).length;

    let lastSyncMoment = null;
    channelRecords.forEach(record => {
      if (record.last_synced_at) {
        const candidate = dayjs(record.last_synced_at);
        if (candidate.isValid() && (!lastSyncMoment || candidate.isAfter(lastSyncMoment))) {
          lastSyncMoment = candidate;
        }
      }
    });
    const lastSyncLabel = lastSyncMoment ? lastSyncMoment.format('DD/MM/YYYY HH:mm') : 'Sem registos';
    const recentImportCount = channelRecentImports.length;

    const channelAlerts = channelRecords
      .map(record => {
        const settings = record.settings || {};
        const issues = [];
        if (record.supportsAuto && settings.autoEnabled && !settings.autoUrl) {
          issues.push('Auto-sync ativo sem URL configurado');
        }
        if (record.last_status === 'failed') {
          issues.push('Última sincronização falhou');
        }
        if (record.last_error) {
          issues.push(record.last_error);
        }
        return issues.length ? { name: record.name, issues } : null;
      })
      .filter(Boolean);
    const channelAlertsHtml = channelAlerts.length
      ? channelAlerts
          .map(alert => {
            const issuesList = alert.issues.map(issue => `<li>${esc(issue)}</li>`).join('');
            return `
              <li class="rounded-xl border border-rose-200/70 bg-rose-50/70 p-3 space-y-1">
                <p class="text-sm font-semibold text-rose-700">${esc(alert.name)}</p>
                <ul class="list-disc pl-4 text-xs text-rose-600 space-y-1">${issuesList}</ul>
              </li>`;
          })
          .join('')
      : '<p class="bo-empty text-sm">Sem alertas pendentes.</p>';

    const channelCardsHtml = channelRecords.length
      ? channelRecords
          .map(channel => {
            const autoSettings = channel.settings || {};
            const autoEnabled = channel.supportsAuto && !!autoSettings.autoEnabled;
            const autoConfigured = autoEnabled && !!autoSettings.autoUrl;
            const autoBadgeLabel = autoConfigured
              ? 'Auto-sync ativo'
              : autoEnabled
              ? 'Auto-sync incompleto'
              : 'Auto-sync desligado';
            const autoBadgeClass = autoConfigured
              ? 'bg-emerald-100 text-emerald-700'
              : autoEnabled
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-600';
            const manualBadge = channel.supportsManual
              ? '<span class="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">Upload manual</span>'
              : '';
            const needsAttention =
              (autoEnabled && !autoSettings.autoUrl) || channel.last_status === 'failed' || !!channel.last_error;
            const attentionBadge = needsAttention
              ? '<span class="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">Rever configuração</span>'
              : '';
            const lastSyncLabel = channel.last_synced_at
              ? dayjs(channel.last_synced_at).format('DD/MM/YYYY HH:mm')
              : 'Nunca sincronizado';
            const statusLabel = channel.last_status
              ? channel.last_status === 'processed'
                ? 'Sincronização concluída'
                : channel.last_status === 'partial'
                ? 'Processada com avisos'
                : channel.last_status === 'failed'
                ? 'Falhou'
                : channel.last_status
              : autoConfigured
              ? 'Aguardando próxima execução'
              : '';
            const statusClass =
              channel.last_status === 'failed'
                ? 'text-rose-600'
                : channel.last_status === 'partial'
                ? 'text-amber-600'
                : channel.last_status === 'processed'
                ? 'text-emerald-600'
                : 'text-slate-500';
            const summary = channel.last_summary || null;
            const summaryBadges = summary
              ? `
                <div class="mt-3 flex flex-wrap gap-2 text-[11px] leading-tight">
                  <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">${summary.insertedCount || 0} novas</span>
                  ${summary.duplicateCount ? `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">${summary.duplicateCount} duplicadas</span>` : ''}
                  ${summary.unmatchedCount ? `<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">${summary.unmatchedCount} sem correspondência</span>` : ''}
                  ${summary.conflictCount ? `<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">${summary.conflictCount} conflitos</span>` : ''}
                  ${summary.errorCount ? `<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">${summary.errorCount} erros</span>` : ''}
                </div>`
              : '';
            const manualInfo = channel.supportsManual
              ? `<p class="text-xs text-slate-500">Ficheiros suportados: ${esc(
                  (channel.manualFormats || []).map(format => format.toUpperCase()).join(', ') || '—'
                )}. Utilize a área de upload manual para carregar exportações do canal.</p>`
              : '<p class="text-xs text-slate-500">Este canal é gerido apenas através da sincronização automática.</p>';
            const defaultStatusLabel = autoSettings.defaultStatus === 'PENDING' ? 'Pendente' : 'Confirmada';
            const summaryDetails = summary
              ? `<div class="border-t border-slate-200/70 pt-2">
                  <p class="text-xs font-medium text-slate-600">Última execução</p>
                  <p class="text-xs text-slate-500">${summary.insertedCount || 0} novas · ${summary.duplicateCount || 0} duplicadas · ${summary.conflictCount || 0} conflitos · ${summary.unmatchedCount || 0} sem correspondência · ${summary.errorCount || 0} erros</p>
                </div>`
              : '';
            const infoPanel = `
              <div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
                <p class="text-xs text-slate-500">Reservas importadas com estado <span class="font-semibold text-slate-700">${esc(
                  defaultStatusLabel
                )}</span>.</p>
                ${manualInfo}
                ${summaryDetails}
              </div>`;
            const autoForm = channel.supportsAuto
              ? `<div class="rounded-xl border border-slate-200 bg-white/70 p-3">
                  <h4 class="text-sm font-semibold text-slate-700">Configuração automática</h4>
                  <form method="post" action="/admin/channel-integrations/${channel.key}/settings" class="bo-channel-form grid gap-3 mt-3">
                    <label class="form-field">
                      <span class="form-label">Ligação automática</span>
                      <input name="autoUrl" class="input" placeholder="https://" value="${esc(autoSettings.autoUrl || '')}" />
                    </label>
                    <div class="bo-channel-form__row grid gap-3 md:grid-cols-3 bo-channel-form__row--thirds">
                      <label class="form-field">
                        <span class="form-label">Formato</span>
                        <select name="autoFormat" class="input">
                          <option value="">Deteção automática</option>
                          ${
                            channel.autoFormats && channel.autoFormats.length
                              ? channel.autoFormats
                                  .map(
                                    format =>
                                      `<option value="${esc(format)}"${autoSettings.autoFormat === format ? ' selected' : ''}>${esc(
                                        format.toUpperCase()
                                      )}</option>`
                                  )
                                  .join('')
                              : ''
                          }
                        </select>
                      </label>
                      <label class="form-field">
                        <span class="form-label">Estado das reservas</span>
                        <select name="defaultStatus" class="input">
                          <option value="CONFIRMED"${autoSettings.defaultStatus !== 'PENDING' ? ' selected' : ''}>Confirmada</option>
                          <option value="PENDING"${autoSettings.defaultStatus === 'PENDING' ? ' selected' : ''}>Pendente</option>
                        </select>
                      </label>
                      <label class="form-field">
                        <span class="form-label">Fuso horário</span>
                        <input name="timezone" class="input" placeholder="Europe/Lisbon" value="${esc(autoSettings.timezone || '')}" />
                      </label>
                    </div>
                    <div class="bo-channel-form__row grid gap-3 md:grid-cols-2 bo-channel-form__row--split">
                      <label class="form-field">
                        <span class="form-label">Utilizador (opcional)</span>
                        <input name="autoUsername" class="input" value="${esc(channel.credentials.username || '')}" autocomplete="off" />
                      </label>
                      <label class="form-field">
                        <span class="form-label">Palavra-passe (opcional)</span>
                        <input name="autoPassword" type="password" class="input" placeholder="••••••" autocomplete="new-password" />
                      </label>
                    </div>
                    <label class="form-field">
                      <span class="form-label">Notas internas</span>
                      <textarea name="notes" class="input" rows="3" placeholder="Instruções, contactos ou credenciais adicionais.">${esc(autoSettings.notes || '')}</textarea>
                    </label>
                    <label class="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" name="autoEnabled" value="1"${autoSettings.autoEnabled ? ' checked' : ''} />
                      <span>Ativar sincronização automática</span>
                    </label>
                    <div class="bo-channel-form__actions flex flex-wrap gap-2">
                      <button class="btn btn-primary">Guardar integração</button>
                    </div>
                  </form>
                  <form method="post" action="/admin/channel-integrations/${channel.key}/sync" class="bo-channel-sync mt-2 inline-flex">
                    <button class="btn btn-light"${!autoSettings.autoEnabled || !autoSettings.autoUrl ? ' disabled' : ''}>Sincronizar agora</button>
                  </form>
                </div>`
              : '<div class="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-500">Este canal apenas suporta importação manual.</div>';
            return `
              <article class="rounded-2xl border border-amber-200 bg-white/90 p-4 space-y-4">
                <header class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 class="font-semibold text-slate-800">${esc(channel.name)}</h3>
                    ${channel.description ? `<p class="text-sm text-slate-500 mt-1">${esc(channel.description)}</p>` : ''}
                    <p class="text-xs text-slate-500 mt-2">Última sincronização: <span class="${statusClass}">${esc(lastSyncLabel)}</span>${statusLabel ? ` · <span class="${statusClass}">${esc(statusLabel)}</span>` : ''}</p>
                    ${channel.last_error ? `<p class="text-xs text-rose-600 mt-1">${esc(channel.last_error)}</p>` : ''}
                    ${summaryBadges}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${autoBadgeClass}">${esc(autoBadgeLabel)}</span>
                    ${manualBadge}
                    ${attentionBadge}
                  </div>
                </header>
                <div class="bo-channel-card-grid grid gap-4 lg:grid-cols-2">
                  ${autoForm}
                  ${infoPanel}
                </div>
              </article>`;
          })
          .join('')
      : '<p class="bo-empty">Nenhuma integração configurada.</p>';
    const channelImportsRows = channelRecentImports.length
      ? channelRecentImports
          .map(batch => {
            const createdLabel = batch.created_at ? dayjs(batch.created_at).format('DD/MM/YYYY HH:mm') : '—';
            const sourceLabel =
              batch.source === 'manual-upload'
                ? 'Upload manual'
                : batch.source === 'auto-fetch'
                ? 'Sincronização automática'
                : batch.source || '—';
            const status = batch.status || '—';
            const statusClass =
              status === 'failed'
                ? 'text-rose-600'
                : status === 'partial'
                ? 'text-amber-600'
                : status === 'processed'
                ? 'text-emerald-600'
                : 'text-slate-500';
            const summary = batch.summary || {};
            const parts = [];
            if (summary.insertedCount != null) parts.push(`${summary.insertedCount} novas`);
            if (summary.duplicateCount) parts.push(`${summary.duplicateCount} duplicadas`);
            if (summary.conflictCount) parts.push(`${summary.conflictCount} conflitos`);
            if (summary.unmatchedCount) parts.push(`${summary.unmatchedCount} sem correspondência`);
            if (summary.errorCount) parts.push(`${summary.errorCount} erros`);
            const statsLabel = parts.length ? parts.join(' · ') : 'Sem detalhes';
            const channelName = channelNameMap.get(batch.channel_key) || batch.channel_key;
            return `
              <tr>
                <td data-label="Data"><span class="table-cell-value">${esc(createdLabel)}</span></td>
                <td data-label="Canal"><span class="table-cell-value">${esc(channelName)}</span></td>
                <td data-label="Origem"><span class="table-cell-value">${esc(sourceLabel)}</span></td>
                <td data-label="Estado"><span class="table-cell-value ${statusClass}">${esc(status)}</span></td>
                <td data-label="Resumo"><span class="table-cell-value">${esc(statsLabel)}</span></td>
                <td data-label="Autor"><span class="table-cell-value">${esc(batch.username || '—')}</span></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="py-6 text-center text-sm text-slate-500">Sem importações registadas.</td></tr>';

    const manualUploadSection = manualChannelOptions
      ? `
        <form method="post" action="/admin/channel-imports/upload" enctype="multipart/form-data" class="bo-channel-form grid gap-3">
          <div class="bo-channel-form__row grid gap-3 md:grid-cols-2 bo-channel-form__row--split">
            <label class="form-field">
              <span class="form-label">Canal</span>
              <select name="channel_key" class="input" required>
                <option value="" disabled selected hidden>Seleciona um canal</option>
                ${manualChannelOptions}
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Estado das reservas</span>
              <select name="target_status" class="input">
                <option value="CONFIRMED">Confirmada</option>
                <option value="PENDING">Pendente</option>
              </select>
            </label>
          </div>
          <label class="form-field">
            <span class="form-label">Ficheiro de reservas</span>
            <input type="file" name="file" class="input" required accept=".csv,.tsv,.xlsx,.xls,.ics,.ical,.json" />
          </label>
          <div class="bo-channel-form__actions">
            <button class="btn btn-primary">Importar reservas</button>
          </div>
        </form>`
      : '<p class="bo-empty">Nenhum canal com importação manual disponível.</p>';

    const emailTemplateRecords = emailTemplates.listTemplates();
    const emailTemplateCards = emailTemplateRecords.length
      ? emailTemplateRecords
          .map(t => {
            const updatedLabel = t.updated_at ? dayjs(t.updated_at).format('DD/MM/YYYY HH:mm') : '';
            const updatedMeta = updatedLabel
              ? `<p class="text-xs text-slate-400 mt-1">Atualizado ${esc(updatedLabel)}${t.updated_by ? ` por ${esc(t.updated_by)}` : ''}</p>`
              : '';
            const placeholderList = t.placeholders && t.placeholders.length
              ? `
                <div class="text-xs text-slate-500 space-y-1">
                  <p class="font-medium text-slate-600">Variáveis disponíveis</p>
                  <ul class="flex flex-wrap gap-2">
                    ${t.placeholders
                      .map(
                        p => `
                          <li class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                            <code>${esc(`{{${p.key}}}`)}</code>
                            <span>${esc(p.label)}</span>
                          </li>`
                      )
                      .join('')}
                  </ul>
                </div>
              `
              : '';
            return `
              <article class="rounded-xl border border-amber-200 bg-white/80 p-4 space-y-3">
                <header>
                  <h3 class="font-semibold text-slate-800">${esc(t.name)}</h3>
                  ${t.description ? `<p class="text-sm text-slate-500 mt-1">${esc(t.description)}</p>` : ''}
                  ${updatedMeta}
                </header>
                <form method="post" action="/admin/emails/templates/${t.key}" class="grid gap-3">
                  <label class="form-field">
                    <span class="form-label">Assunto</span>
                    <input name="subject" class="input" value="${esc(t.subject)}" required maxlength="160"/>
                  </label>
                  <label class="form-field">
                    <span class="form-label">Mensagem</span>
                    <textarea name="body" class="input" rows="6" required>${esc(t.body)}</textarea>
                  </label>
                  ${placeholderList}
                  <div>
                    <button class="btn btn-primary">Guardar modelo</button>
                  </div>
                </form>
              </article>`;
          })
          .join('')
      : '<p class="bo-empty">Sem modelos de email configurados.</p>';

    const messageTemplateRecords = messageTemplates.listTemplates();
    const messageTemplateCards = messageTemplateRecords.length
      ? messageTemplateRecords
          .map(t => {
            const placeholderList = t.placeholders && t.placeholders.length
              ? `
                <div class="text-xs text-slate-500 space-y-1">
                  <p class="font-medium text-slate-600">Variáveis disponíveis</p>
                  <ul class="flex flex-wrap gap-2">
                    ${t.placeholders
                      .map(
                        p => `
                          <li class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                            <code>${esc(`{{${p.key}}}`)}</code>
                            <span>${esc(p.label)}</span>
                          </li>`
                      )
                      .join('')}
                  </ul>
                </div>
              `
              : '';

            const languagesHtml = t.languages && t.languages.length
              ? t.languages
                  .map(lang => {
                    const updatedLabel = lang.updated_at ? dayjs(lang.updated_at).format('DD/MM/YYYY HH:mm') : '';
                    const updatedMeta = lang.updated_at
                      ? `<p class="text-xs text-slate-400 mt-1">Atualizado ${esc(updatedLabel)}${lang.updated_by ? ` por ${esc(lang.updated_by)}` : ''}</p>`
                      : '<p class="text-xs text-slate-400 mt-1">A usar texto padrão</p>';
                    const statusTag = lang.is_default
                      ? '<span class="text-xs font-semibold text-amber-600">Padrão</span>'
                      : '<span class="text-xs font-semibold text-emerald-600">Personalizado</span>';
                    const sampleVariables = lang.sampleVariables && Object.keys(lang.sampleVariables).length
                      ? lang.sampleVariables
                      : t.sampleVariables || {};
                    const sampleJson = JSON.stringify(sampleVariables, null, 2);
                    const guestPlaceholder = lang.language === 'pt'
                      ? 'Ex.: Olá, podemos chegar mais cedo?'
                      : 'Ex.: Hello, can we arrive earlier?';
                    return `
                      <form method="post" action="/admin/messages/templates/${t.key}/${lang.language}" class="grid gap-3 rounded-xl border border-amber-200 bg-white/80 p-4" data-message-template data-template-key="${esc(t.key)}" data-template-language="${esc(lang.language)}" data-template-language-label="${esc(lang.label)}">
                        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 class="font-semibold text-slate-800">${esc(lang.label)}</h4>
                            ${updatedMeta}
                          </div>
                          ${statusTag}
                        </div>
                        <label class="form-field">
                          <span class="form-label">Mensagem</span>
                          <textarea name="body" class="input" rows="6" required>${esc(lang.body)}</textarea>
                        </label>
                        <label class="form-field">
                          <span class="form-label">Mensagem recente do hóspede (opcional)</span>
                          <textarea class="input" rows="2" data-template-sample placeholder="${esc(guestPlaceholder)}"></textarea>
                        </label>
                        <div class="grid gap-3 md:grid-cols-2">
                          <label class="form-field">
                            <span class="form-label">Idioma preferido (opcional)</span>
                            <input class="input" data-template-guest-language placeholder="Ex.: pt, en" />
                          </label>
                          <label class="form-field">
                            <span class="form-label">Modo de pré-visualização</span>
                            <select class="input" data-template-mode>
                              <option value="auto" selected>Detetar automaticamente</option>
                              <option value="language">Forçar ${esc(lang.label)}</option>
                            </select>
                          </label>
                        </div>
                        <label class="form-field">
                          <span class="form-label">Dados de exemplo (JSON)</span>
                          <textarea class="input font-mono text-xs" rows="4" data-template-vars>${esc(sampleJson)}</textarea>
                          <p class="text-xs text-slate-500">Edite os dados para testar substituições diferentes.</p>
                        </label>
                        <div class="flex flex-wrap items-center gap-3">
                          <button class="btn btn-primary">Guardar ${esc(lang.label)}</button>
                          <button type="button" class="btn btn-light" data-template-test>Testar modelo</button>
                          <span class="text-xs text-slate-500" data-template-status hidden></span>
                        </div>
                        <pre class="text-xs text-slate-700 bg-slate-100/80 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap" data-template-preview hidden></pre>
                      </form>`;
                  })
                  .join('')
              : '<p class="text-sm text-slate-500">Sem idiomas configurados.</p>';

            return `
              <article class="rounded-xl border border-amber-200 bg-white/80 p-4 space-y-4">
                <header class="space-y-1">
                  <h3 class="font-semibold text-slate-800">${esc(t.name)}</h3>
                  ${t.description ? `<p class="text-sm text-slate-500">${esc(t.description)}</p>` : ''}
                </header>
                <div class="space-y-4" data-message-templates>${languagesHtml}</div>
                ${placeholderList}
              </article>`;
          })
          .join('')
      : '<p class="bo-empty">Sem modelos de mensagens configurados.</p>';

    const broomIconSvg = `
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 21h4l7-7"></path>
        <path d="M14 14l5-5a3 3 0 0 0-4.24-4.24l-5 5"></path>
        <path d="M11 11l2 2"></path>
        <path d="M5 21l-1-4 4 1"></path>
      </svg>
    `.trim();

    const navSections = [
      {
        id: 'operations',
        title: 'Operações diárias',
        items: [
          { id: 'overview', label: 'Propriedades', icon: 'building-2', allowed: true },
          { id: 'calendar', label: 'Calendário', icon: 'calendar-days', allowed: canViewCalendar },
          { id: 'bookings-link', label: 'Reservas', icon: 'notebook-text', allowed: canViewBookings, href: '/admin/bookings' },
          { id: 'housekeeping', label: 'Painel de limpezas', iconSvg: broomIconSvg, icon: 'broom', allowed: canSeeHousekeeping },
          {
            id: 'housekeeping-manage',
            label: 'Gestão de limpezas',
            icon: 'clipboard-check',
            allowed: canManageHousekeeping,
            href: '/admin/limpeza'
          },
          {
            id: 'extras-link',
            label: 'Extras & serviços',
            icon: 'gift',
            allowed: canManageProperties,
            href: '/admin/extras'
          },
          { id: 'channel-manager', label: 'Channel Manager', icon: 'share-2', allowed: canManageIntegrations },
          { id: 'content-center-link', label: 'Centro de Conteúdos', icon: 'notebook-pen', allowed: true, href: '/admin/content-center' }
        ]
      },
      {
        id: 'finance',
        title: 'Finanças e rendimento',
        items: [
          { id: 'finance', label: 'Financeiro', icon: 'piggy-bank', allowed: true },
          {
            id: 'revenue-calendar-link',
            label: 'Calendário de receita',
            icon: 'calendar-range',
            allowed: canViewRevenueCalendar,
            href: '/admin/revenue-calendar'
          },
          { id: 'exports-link', label: 'Exportações', icon: 'file-spreadsheet', allowed: canExportBookings, href: '/admin/export' },
          { id: 'rates-link', label: 'Regras de tarifas', icon: 'wand-2', allowed: canManageRates, href: '/admin/rates/rules' }
        ]
      },
      {
        id: 'communication',
        title: 'Comunicação',
        items: [
          { id: 'estatisticas', label: 'Estatísticas', icon: 'bar-chart-3', allowed: canViewAutomation },
          { id: 'reviews', label: 'Reviews', icon: 'message-square', allowed: true },
          { id: 'emails', label: 'Emails', icon: 'mail', allowed: canManageEmailTemplates },
          { id: 'messages', label: 'Mensagens', icon: 'message-circle', allowed: canManageEmailTemplates }
        ]
      },
      {
        id: 'administration',
        title: 'Administração',
        items: [
          ...(canViewHistory ? [{ id: 'history', label: 'Histórico', icon: 'history', allowed: true }] : []),
          { id: 'users', label: 'Utilizadores', icon: 'users', allowed: canManageUsers },
          { id: 'branding', label: 'Identidade', icon: 'palette', allowed: canManageUsers },
          {
            id: 'audit-link',
            label: 'Auditoria',
            icon: 'clipboard-list',
            allowed: isFlagEnabled('FEATURE_NAV_AUDIT_LINKS') && canAccessAudit,
            href: '/admin/auditoria'
          }
        ]
      }
    ];
    const allNavItems = navSections.flatMap(section => section.items);
    const defaultPane = allNavItems.find(item => item.allowed && !item.href)?.id || 'overview';
    const navButtonsHtml = navSections
      .map(section => {
        const itemsHtml = section.items
          .map(item => {
            const classes = ['bo-tab'];
            if (item.id === 'channel-manager') classes.push('bo-tab--compact');
            if (!item.href && item.id === defaultPane) classes.push('is-active');
            if (item.href) classes.push('bo-tab--link');
            const iconMarkup = item.iconSvg
              ? item.iconSvg
              : `<i data-lucide="${item.icon}" class="w-5 h-5" aria-hidden="true"></i>`;

            if (!item.allowed) {
              return `<button type="button" class="${classes.join(' ')}" data-disabled="true" title="Sem permissões" disabled>${iconMarkup}<span>${esc(item.label)}</span></button>`;
            }

            if (item.href) {
              return `<a class="${classes.join(' ')}" href="${item.href}">${iconMarkup}<span>${esc(item.label)}</span></a>`;
            }

            return `<button type="button" class="${classes.join(' ')}" data-bo-target="${item.id}">${iconMarkup}<span>${esc(item.label)}</span></button>`;
          })
          .join('');

        if (!itemsHtml.trim()) {
          return '';
        }

        const sectionItemsId = `bo-nav-items-${section.id}`;

        return `
          <div class="bo-nav__section is-collapsed" data-nav-section data-nav-start-collapsed="true">
            <button
              type="button"
              class="bo-nav__section-toggle"
              data-nav-toggle
              aria-expanded="false"
              aria-controls="${sectionItemsId}"
            >
              <span>${esc(section.title)}</span>
              <i data-lucide="chevron-down" class="bo-nav__section-toggle-icon" aria-hidden="true"></i>
            </button>
            <div class="bo-nav__section-items" data-nav-items id="${sectionItemsId}" hidden>${itemsHtml}</div>
          </div>
        `;
      })
      .filter(Boolean)
      .join('');

    const navLinkTargets = new Set(allNavItems.filter(item => item.href).map(item => item.href));
    const filteredQuickLinks = quickLinks.filter(link => !link.href || !navLinkTargets.has(link.href));
    quickAccessHtml = filteredQuickLinks.length
      ? html`<section class="bo-card space-y-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-800">Atalhos rápidos</h2>
            <p class="text-sm text-slate-600">Navega rapidamente para as áreas-chave do backoffice.</p>
          </div>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            ${filteredQuickLinks
              .map(link => {
                if (!link.href) {
                  const desc = link.description ? `<p class="text-sm text-slate-500">${esc(link.description)}</p>` : '';
                  return `<article class="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                    <h3 class="font-semibold text-slate-700">${esc(link.title)}</h3>
                    ${desc}
                    <p class="text-xs text-slate-400">Atualize permissões ou dados para ativar este atalho.</p>
                  </article>`;
                }
                return `<article class="rounded-xl border border-slate-200 bg-white/80 p-4 space-y-3">
                  <div>
                    <h3 class="font-semibold text-slate-800">${esc(link.title)}</h3>
                    <p class="text-sm text-slate-600">${esc(link.description)}</p>
                  </div>
                  <a class="btn btn-light" href="${esc(link.href)}">${esc(link.cta || 'Abrir')}</a>
                </article>`;
              })
              .join('')}
          </div>
        </section>`
      : '';

    const propertiesListHtml = props.length
      ? `<ul class="space-y-3">${props
          .map(p => {
            const location = propertyLocationLabel(p);
            const propertyUnits = propertyUnitMap.get(p.id) || [];
            const revenueRow = propertyRevenueRows.find(row => row.id === p.id);
            const revenueLabel = revenueRow ? eur(revenueRow.confirmed_revenue_cents || 0) : '0,00';
            return `
              <li class="bo-property-card rounded-xl border border-amber-200 bg-white/80 p-3">
                <div class="bo-property-card__header">
                  <div class="bo-property-card__title">
                    <div class="bo-property-card__name">${esc(p.name)}</div>
                    ${location ? `<div class="bo-property-card__location">${esc(location)}</div>` : ''}
                  </div>
                  <a class="btn btn-light bo-property-card__cta" href="/admin/properties/${p.id}">Abrir</a>
                </div>
                <div class="bo-property-card__meta">
                  <span class="bo-property-card__meta-item">Unidades: ${propertyUnits.length}</span>
                  <span class="bo-property-card__meta-item">Receita: € ${revenueLabel}</span>
                </div>
              </li>`;
          })
          .join('')}</ul>`
      : '<p class="bo-empty">Sem propriedades registadas.</p>';

    const unitsTableRows = units.length
      ? units
          .map(u => {
            const blocks = unitBlockIndex.get(u.id) || [];
            const blockSummaries = blocks
              .map(block => {
                const endLabel = dayjs(block.end_date).subtract(1, 'day');
                const endDisplay = endLabel.isValid() ? endLabel.format('DD/MM') : dayjs(block.end_date).format('DD/MM');
                return `${dayjs(block.start_date).format('DD/MM')}–${endDisplay}`;
              })
              .join(', ');
            const blockTitle = blocks.length
              ? esc(`Bloqueado ${blockSummaries}${blocks[0].reason ? ` · ${blocks[0].reason}` : ''}`)
              : '';
            const blockBadge = blocks.length
              ? `<span class="bo-status-badge bo-status-badge--warning" data-block-badge="${u.id}" title="${blockTitle}">Bloqueado</span>`
              : `<span class="bo-status-badge bo-status-badge--warning hidden" data-block-badge="${u.id}" hidden>Bloqueado</span>`;
            return `
              <tr data-unit-row="${u.id}">
                <td data-label="Propriedade"><span class="table-cell-value">${esc(u.property_name)}</span></td>
                <td data-label="Unidade">
                  <div class="table-cell-content">
                    <span class="table-cell-value">${esc(u.name)}</span>
                    ${blockBadge}
                  </div>
                </td>
                <td data-label="Cap."><span class="table-cell-value">${u.capacity}</span></td>
                <td data-label="Base €/noite"><span class="table-cell-value">€ ${eur(u.base_price_cents)}</span></td>
                <td data-label="Ações">
                  <div class="table-cell-actions" data-unit-actions>
                    <button type="button" class="btn btn-light btn-compact" data-block-unit="${u.id}" data-unit-name="${esc(
              u.property_name + ' · ' + u.name
            )}">Bloquear unidade</button>
                    <a class="btn btn-light btn-compact" href="/admin/units/${u.id}">Gerir</a>
                  </div>
                </td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="text-sm text-center text-slate-500">Sem unidades registadas.</td></tr>';

    const propertiesRevenueTable = propertyRevenueRows.length
      ? propertyRevenueRows
          .map(row => {
            const propertyUnits = propertyUnitMap.get(row.id) || [];
            const unitList = propertyUnits.length
              ? `<ul class="bo-property-units">${propertyUnits
                  .map(
                    unit => `
                      <li class="bo-property-units__item">
                        <span class="bo-property-unit-name">${esc(unit.name)}</span>
                        <span class="bo-property-unit-price">€ ${eur(unit.base_price_cents)}</span>
                      </li>`
                  )
                  .join('')}</ul>`
              : '<div class="bo-empty bo-property-revenue__empty">Sem unidades associadas.</div>';
            const locationLabel = row.locality || row.district ? `<span class="table-cell-muted bo-property-revenue__location">${esc(propertyLocationLabel(row))}</span>` : '';
            return `
              <tr>
                <td data-label="Propriedade">
                  <div class="bo-property-revenue">
                    <span class="table-cell-value bo-property-revenue__name">${esc(row.name)}</span>
                    ${locationLabel}
                    ${unitList}
                  </div>
                </td>
                <td data-label="Receita total"><span class="table-cell-value">€ ${eur(row.confirmed_revenue_cents || 0)}</span></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="2" class="text-sm text-center text-slate-500">Sem dados de receita.</td></tr>';

    function normalizeChannelLabel(rawValue) {
      const value = (rawValue || '').trim();
      if (!value) return 'Direto';
      const lower = value.toLowerCase();
      if (lower === 'booking' || lower === 'booking.com') return 'Booking.com';
      if (lower === 'airbnb') return 'Airbnb';
      if (lower === 'expedia') return 'Expedia';
      if (lower === 'vrbo') return 'Vrbo';
      return value
        .split(' ')
        .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
        .join(' ');
    }

    const revenueRangeDays = 30;
    const revenueRangeEnd = dayjs().endOf('day');
    const revenueRangeStart = revenueRangeEnd.subtract(revenueRangeDays - 1, 'day').startOf('day');
    const revenueRangeEndExclusive = revenueRangeEnd.add(1, 'day');
    const revenueDayCount = revenueRangeEnd.diff(revenueRangeStart, 'day') + 1;

    const revenueBookings = db
      .prepare(
        `SELECT b.id,
                b.checkin,
                b.checkout,
                b.total_cents,
                b.agency,
                b.created_at
           FROM bookings b
          WHERE b.status = 'CONFIRMED'
            AND b.checkout > ?
            AND b.checkin < ?`
      )
      .all(revenueRangeStart.format('YYYY-MM-DD'), revenueRangeEndExclusive.format('YYYY-MM-DD'));

    const revenueDailyIndex = new Map();
    const revenueDailyRaw = [];
    for (let i = 0; i < revenueDayCount; i++) {
      const day = revenueRangeStart.add(i, 'day');
      const key = day.format('YYYY-MM-DD');
      revenueDailyIndex.set(key, {
        date: key,
        label: day.format('DD/MM'),
        display: day.format('DD MMM'),
        revenueCents: 0,
        nightsSold: 0,
        bookingIds: new Set(),
        createdCount: 0
      });
      revenueDailyRaw.push(revenueDailyIndex.get(key));
    }

    const bookingStayNights = new Map();
    const channelRevenueCents = new Map();

    revenueBookings.forEach(booking => {
      const stayStart = dayjs(booking.checkin);
      const stayEnd = dayjs(booking.checkout);
      if (!stayStart.isValid() || !stayEnd.isValid()) return;
      const totalNights = Math.max(1, dateRangeNights(booking.checkin, booking.checkout));
      bookingStayNights.set(booking.id, totalNights);
      const nightlyRate = totalNights ? (booking.total_cents || 0) / totalNights : booking.total_cents || 0;
      const channelLabel = normalizeChannelLabel(booking.agency);

      if (booking.created_at) {
        const createdAt = dayjs(booking.created_at);
        if (createdAt.isValid()) {
          const createdKey = createdAt.format('YYYY-MM-DD');
          const createdRecord = revenueDailyIndex.get(createdKey);
          if (createdRecord) {
            createdRecord.createdCount = (createdRecord.createdCount || 0) + 1;
          }
        }
      }

      let cursor = stayStart.isAfter(revenueRangeStart) ? stayStart : revenueRangeStart;
      const cursorEnd = stayEnd.isBefore(revenueRangeEndExclusive) ? stayEnd : revenueRangeEndExclusive;
      while (cursor.isBefore(cursorEnd)) {
        const key = cursor.format('YYYY-MM-DD');
        const record = revenueDailyIndex.get(key);
        if (record) {
          record.revenueCents += nightlyRate;
          record.nightsSold += 1;
          record.bookingIds.add(booking.id);
          channelRevenueCents.set(channelLabel, (channelRevenueCents.get(channelLabel) || 0) + nightlyRate);
        }
        cursor = cursor.add(1, 'day');
      }
    });

    const totalUnitsNights = totalUnitsCount * revenueDayCount;

    const revenueDaily = revenueDailyRaw.map(record => {
      const bookingIds = Array.from(record.bookingIds.values());
      const revenueCents = Math.round(record.revenueCents || 0);
      const nightsSold = Math.round(record.nightsSold || 0);
      const bookingsCount = bookingIds.length;
      const staysTotal = bookingIds.reduce((sum, id) => sum + (bookingStayNights.get(id) || 0), 0);
      const averageStay = bookingsCount ? staysTotal / bookingsCount : 0;
      const adrCents = nightsSold ? Math.round(revenueCents / nightsSold) : 0;
      const revparCents = totalUnitsCount ? Math.round(revenueCents / Math.max(totalUnitsCount, 1)) : 0;
      const occupancyRate = totalUnitsCount ? Math.min(1, nightsSold / Math.max(totalUnitsCount, 1)) : 0;
      const bookingPaceCount = record.createdCount || 0;
      return {
        date: record.date,
        label: record.label,
        display: record.display,
        revenueCents,
        nightsSold,
        bookingsCount,
        createdCount: bookingPaceCount,
        adrCents,
        revparCents,
        occupancyRate,
        averageStay,
        bookingPace: bookingPaceCount
      };
    });

    const totalRevenueCents = revenueDaily.reduce((sum, row) => sum + (row.revenueCents || 0), 0);
    const totalNightsSold = revenueDaily.reduce((sum, row) => sum + (row.nightsSold || 0), 0);
    const totalReservations = revenueBookings.length;
    const totalBookingCreations = revenueDaily.reduce((sum, row) => sum + (row.createdCount || 0), 0);

    const revenueSummary = {
      revenueCents: totalRevenueCents,
      adrCents: totalNightsSold ? Math.round(totalRevenueCents / totalNightsSold) : 0,
      revparCents: totalUnitsNights ? Math.round(totalRevenueCents / Math.max(totalUnitsNights, 1)) : 0,
      occupancyRate: totalUnitsNights ? totalNightsSold / Math.max(totalUnitsNights, 1) : 0,
      nights: totalNightsSold,
      reservations: totalReservations,
      averageStay: totalReservations ? totalNightsSold / Math.max(totalReservations, 1) : 0,
      bookingPace: revenueDayCount ? totalBookingCreations / Math.max(revenueDayCount, 1) : 0,
      createdTotal: totalBookingCreations
    };

    const channelTotals = Array.from(channelRevenueCents.entries()).map(([name, cents]) => ({
      name,
      revenueCents: Math.round(cents || 0)
    }));
    channelTotals.sort((a, b) => (b.revenueCents || 0) - (a.revenueCents || 0));
    const channelTotalCents = channelTotals.reduce((sum, item) => sum + (item.revenueCents || 0), 0);
    const revenueChannels = (channelTotals.length ? channelTotals : [{ name: 'Direto', revenueCents: 0 }]).map(item => ({
      ...item,
      percentage: channelTotalCents ? item.revenueCents / Math.max(channelTotalCents, 1) : 0
    }));

    const revenueRangeLabel = `${revenueRangeStart.format('DD/MM/YYYY')} – ${revenueRangeEnd.format('DD/MM/YYYY')}`;
    const revenueAnalytics = {
      range: {
        start: revenueRangeStart.format('YYYY-MM-DD'),
        end: revenueRangeEnd.format('YYYY-MM-DD'),
        label: revenueRangeLabel,
        dayCount: revenueDayCount
      },
      summary: revenueSummary,
      daily: revenueDaily,
      channels: revenueChannels
    };
    const revenueAnalyticsJson = jsonScriptPayload(revenueAnalytics);

    const numberFormatter = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
    const decimalFormatter = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const revenueSummaryLabels = {
      revenue: `€ ${eur(revenueSummary.revenueCents || 0)}`,
      adr: revenueSummary.adrCents ? `€ ${eur(revenueSummary.adrCents)}` : '€ 0,00',
      revpar: revenueSummary.revparCents ? `€ ${eur(revenueSummary.revparCents)}` : '€ 0,00',
      occupancy: percentFormatter.format(revenueSummary.occupancyRate || 0),
      nights: numberFormatter.format(revenueSummary.nights || 0),
      reservations: numberFormatter.format(revenueSummary.reservations || 0),
      averageStay: decimalFormatter.format(revenueSummary.averageStay || 0),
      bookingPace: decimalFormatter.format(revenueSummary.bookingPace || 0)
    };

    const unitsForPricing = units.map(u => ({
      id: u.id,
      name: u.name,
      propertyId: u.property_id,
      propertyName: u.property_name,
      unitType: u.unit_type || null,
      basePriceCents: u.base_price_cents
    }));
    const defaultWeekStart = dayjs().startOf('week');
    const defaultWeekEnd = defaultWeekStart.add(6, 'day');
    const uxDashboardConfig = {
      units: unitsForPricing,
      unitTypes: unitTypeOptions,
      properties: props.map(p => ({ id: p.id, name: p.name })),
      blocks: activeUnitBlocks,
      weeklyDefaults: {
        from: defaultWeekStart.format('YYYY-MM-DD'),
        to: defaultWeekEnd.format('YYYY-MM-DD')
      },
      kpi: {
        occupancyRate: revenueSummary.occupancyRate || 0,
        adrCents: revenueSummary.adrCents || 0,
        revparCents: revenueSummary.revparCents || 0
      }
    };
    const uxDashboardConfigJson = jsonScriptPayload(uxDashboardConfig);

    const revenueChannelsHtml = revenueChannels
      .map(channel => {
        const revenueLabel = `€ ${eur(channel.revenueCents || 0)}`;
        const pctLabel = percentFormatter.format(channel.percentage || 0);
        return `
          <li class="flex items-center justify-between gap-3">
            <div>
              <div class="font-semibold text-slate-700">${esc(channel.name)}</div>
              <div class="text-xs text-slate-500">${revenueLabel}</div>
            </div>
            <div class="text-sm font-semibold text-slate-600">${pctLabel}</div>
          </li>`;
      })
      .join('');

    const revenueDailyTableRows = revenueDaily.length
      ? revenueDaily
          .map(row => {
            const revenueLabel = `€ ${eur(row.revenueCents || 0)}`;
            const adrLabel = row.nightsSold ? `€ ${eur(row.adrCents || 0)}` : '—';
            const revparLabel = `€ ${eur(row.revparCents || 0)}`;
            const occupancyLabel = row.nightsSold ? percentFormatter.format(row.occupancyRate || 0) : '—';
            const nightsLabel = numberFormatter.format(row.nightsSold || 0);
            const bookingsLabel = numberFormatter.format(row.bookingsCount || 0);
            const averageStayLabel = row.bookingsCount ? decimalFormatter.format(row.averageStay || 0) : '—';
            const bookingPaceLabel = row.createdCount ? numberFormatter.format(row.createdCount || 0) : '—';
            return `
              <tr>
                <td data-label="Data"><span class="table-cell-value">${esc(row.display || row.label)}</span></td>
                <td data-label="Receita">${revenueLabel}</td>
                <td data-label="ADR">${adrLabel}</td>
                <td data-label="RevPAR">${revparLabel}</td>
                <td data-label="Ocupação">${occupancyLabel}</td>
                <td data-label="Reservas">${bookingsLabel}</td>
                <td data-label="Noites">${nightsLabel}</td>
                <td data-label="Estadia média">${averageStayLabel}</td>
                <td data-label="Booking pace">${bookingPaceLabel}</td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="9" class="text-sm text-center text-slate-500">Sem dados de revenue para o período analisado.</td></tr>';

    const statisticsCard = html`
      <div class="bo-card bo-span-all space-y-6">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-800">Painel estatístico</h2>
            <p class="text-sm text-slate-600">Analisa ocupação, receita e tendências operacionais.</p>
            <div class="text-xs text-slate-400 mt-1">Última análise automática: ${automationLastRun}</div>
          </div>
          <form id="operational-filters" class="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full md:w-auto">
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Período</span>
              <select name="month" id="operational-filter-month" class="input">
                ${monthOptions.map(opt => `<option value="${opt.value}"${opt.value === operationalDefault.month ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Propriedade</span>
              <select name="property_id" id="operational-filter-property" class="input">
                <option value="">Todas</option>
                ${props
                  .map(p => {
                    const selected = operationalDefault.filters.propertyId === p.id ? ' selected' : '';
                    return `<option value="${p.id}"${selected}>${esc(p.name)}</option>`;
                  })
                  .join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Tipo de unidade</span>
              <select name="unit_type" id="operational-filter-type" class="input">
                <option value="">Todos</option>
                ${unitTypeOptions
                  .map(type => {
                    const selected = operationalDefault.filters.unitType === type ? ' selected' : '';
                    return `<option value="${esc(type)}"${selected}>${esc(type)}</option>`;
                  })
                  .join('')}
              </select>
            </label>
          </form>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-kpi-card>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-slate-800">Ocupação &amp; ADR unificados</h3>
              <p class="text-sm text-slate-600">Visão imediata do equilíbrio entre ocupação e preço médio diário.</p>
            </div>
            <div class="flex items-center gap-2 self-start">
              <a
                href="#operational-metrics"
                class="text-sm font-medium text-sky-700 hover:text-sky-800 focus:outline-none focus-visible:ring focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                data-kpi-detail-link
              >
                Ver detalhe
              </a>
              <button type="button" class="btn btn-light btn-compact" data-kpi-info aria-describedby="kpi-tooltip-text">
                <i data-lucide="info" class="w-4 h-4" aria-hidden="true"></i>
                <span class="sr-only">Como interpretar os KPIs</span>
              </button>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div class="text-xs uppercase tracking-wide text-emerald-600">Ocupação</div>
              <div class="text-2xl font-semibold text-emerald-900" data-kpi-occupancy>${esc(revenueSummaryLabels.occupancy)}</div>
              <div class="text-xs text-emerald-700">Percentagem de noites vendidas no período analisado.</div>
            </div>
            <div class="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div class="text-xs uppercase tracking-wide text-sky-600">ADR</div>
              <div class="text-2xl font-semibold text-sky-900" data-kpi-adr>${esc(revenueSummaryLabels.adr)}</div>
              <div class="text-xs text-sky-700">Preço médio por noite confirmada.</div>
            </div>
          </div>
          <div
            class="rounded-lg border p-3 flex gap-2 items-start bg-amber-50 border-amber-200"
            data-kpi-alert
            hidden
            role="status"
            aria-live="polite"
          >
            <span class="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" data-kpi-alert-icon>
              <i data-lucide="alert-triangle" class="w-5 h-5"></i>
            </span>
            <div class="space-y-1">
              <p class="text-sm font-semibold text-slate-800" data-kpi-alert-title></p>
              <p class="text-sm text-slate-600" data-kpi-alert-message></p>
            </div>
          </div>
          <div class="text-xs text-slate-500">Dados combinados do período ${esc(revenueRangeLabel)}. RevPAR atual: <span data-kpi-revpar>${esc(revenueSummaryLabels.revpar)}</span>.</div>
          <p id="kpi-tooltip-text" class="sr-only">Ocupação mede noites vendidas face à disponibilidade. ADR é a receita média por noite confirmada.</p>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white/80 p-4 space-y-3" data-weekly-export aria-busy="false">
          <div>
            <h3 class="text-base font-semibold text-slate-800">Exportar semana (CSV/PDF)</h3>
            <p class="text-sm text-slate-600">Gera um relatório com ocupação, ADR, RevPAR e receita da semana selecionada.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="form-field" data-field>
              <span class="form-label">Início</span>
              <input type="date" class="input" data-weekly-from />
              <p class="form-error text-xs text-rose-600" data-error hidden></p>
            </label>
            <label class="form-field" data-field>
              <span class="form-label">Fim</span>
              <input type="date" class="input" data-weekly-to />
              <p class="form-error text-xs text-rose-600" data-error hidden></p>
            </label>
            <div class="lg:col-span-2 flex flex-wrap items-center gap-2">
              <button type="button" class="btn btn-light" data-weekly-export-action="csv">Exportar CSV</button>
              <button type="button" class="btn btn-light" data-weekly-export-action="pdf">Exportar PDF</button>
              <span class="text-xs text-slate-500" data-weekly-status role="status" aria-live="polite" tabindex="-1">
                Seleciona o intervalo semanal e escolhe o formato para exportar.
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3" id="operational-metrics">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Ocupação atual</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-occupancy">—</div>
            <div class="text-xs text-slate-500">Noites ocupadas vs. disponíveis no período selecionado.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Receita total</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-revenue">—</div>
            <div class="text-xs text-slate-500">Receita proporcional das reservas confirmadas.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Média de noites</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-average">—</div>
            <div class="text-xs text-slate-500">Duração média das reservas incluídas.</div>
          </div>
          <div class="md:col-span-3 text-xs text-slate-500" id="operational-context">
            <span id="operational-period-label">—</span>
            <span id="operational-filters-label" class="ml-1"></span>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Top unidades por ocupação</h3>
                <a id="operational-export" class="btn btn-light border border-slate-200 text-sm" href="#" download>Exportar CSV</a>
              </div>
              <div id="top-units-wrapper" class="space-y-3">
                <p class="text-sm text-slate-500" id="top-units-empty">Sem dados para os filtros atuais.</p>
                <ol id="top-units-list" class="space-y-3 hidden"></ol>
              </div>
              <p class="text-xs text-slate-500 mt-3" id="operational-summary">—</p>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo diário (próximos 7 dias)</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="responsive-table">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Dia</th><th>Ocup.</th><th>Reservas</th><th>Check-in</th><th>Check-out</th>
                    </tr>
                  </thead>
                  <tbody>${automationDaily.length
                    ? automationDaily
                        .map(d => {
                          const occPct = Math.round((d.occupancyRate || 0) * 100);
                          const arrLabel = d.arrivalsPending
                            ? `${d.arrivalsConfirmed} <span class="text-xs text-slate-500">(+${d.arrivalsPending} pend)</span>`
                            : String(d.arrivalsConfirmed);
                          const depLabel = d.departuresPending
                            ? `${d.departuresConfirmed} <span class="text-xs text-slate-500">(+${d.departuresPending} pend)</span>`
                            : String(d.departuresConfirmed);
                          const pendingBadge = d.pendingCount
                            ? `<span class="text-xs text-slate-500 ml-1">(+${d.pendingCount} pend)</span>`
                            : '';
                          return `
                            <tr>
                              <td class="py-2 text-sm" data-label="Dia"><span class="table-cell-value">${dayjs(d.date).format('DD/MM')}</span></td>
                              <td class="py-2 text-sm" data-label="Ocupação"><span class="table-cell-value">${occPct}%</span></td>
                              <td class="py-2 text-sm" data-label="Reservas"><span class="table-cell-value">${d.confirmedCount}${pendingBadge}</span></td>
                              <td class="py-2 text-sm" data-label="Check-in"><span class="table-cell-value">${arrLabel}</span></td>
                              <td class="py-2 text-sm" data-label="Check-out"><span class="table-cell-value">${depLabel}</span></td>
                            </tr>`;
                        })
                        .join('')
                    : '<tr><td class="py-2 text-sm text-slate-500" data-label="Info">Sem dados para o período.</td></tr>'}</tbody>
                </table>
              </div>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo semanal</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="responsive-table">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Semana</th><th>Ocup.</th><th>Noites confirmadas</th>
                    </tr>
                  </thead>
                  <tbody>${automationWeekly.length
                    ? automationWeekly
                        .map(w => {
                          const occPct = Math.round((w.occupancyRate || 0) * 100);
                          const pending = w.pendingNights ? ` <span class="text-xs text-slate-500">(+${w.pendingNights} pend)</span>` : '';
                          const endLabel = dayjs(w.end).subtract(1, 'day').format('DD/MM');
                          return `
                            <tr>
                              <td class="py-2 text-sm" data-label="Semana"><span class="table-cell-value">${dayjs(w.start).format('DD/MM')} - ${endLabel}</span></td>
                              <td class="py-2 text-sm" data-label="Ocupação"><span class="table-cell-value">${occPct}%</span></td>
                              <td class="py-2 text-sm" data-label="Noites confirmadas"><span class="table-cell-value">${w.confirmedNights}${pending}</span></td>
                            </tr>`;
                        })
                        .join('')
                    : '<tr><td class="py-2 text-sm text-slate-500" data-label="Info">Sem dados agregados.</td></tr>'}</tbody>
                </table>
              </div>
            </section>
          </div>

          <div class="space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Alertas operacionais</h3>
              ${automationNotifications.length
                ? `<ul class="space-y-3">${automationNotifications
                    .map(n => {
                      const styles = automationSeverityStyle(n.severity);
                      const ts = n.created_at ? dayjs(n.created_at).format('DD/MM HH:mm') : automationLastRun;
                      return `
                        <li class="border-l-4 pl-3 ${styles.border} bg-white/40 rounded-sm">
                          <div class="text-[11px] text-slate-400">${esc(ts)}</div>
                          <div class="text-sm font-semibold text-slate-800">${esc(n.title || '')}</div>
                          <div class="text-sm text-slate-600">${esc(n.message || '')}</div>
                        </li>`;
                    })
                    .join('')}</ul>`
                : '<p class="text-sm text-slate-500">Sem alertas no momento.</p>'}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Sugestões de tarifa</h3>
              ${automationSuggestions.length
                ? `<ul class="space-y-2">${automationSuggestions
                    .map(s => {
                      const occPct = Math.round((s.occupancyRate || 0) * 100);
                      const pendLabel = s.pendingCount ? ` <span class="text-xs text-slate-500">(+${s.pendingCount} pend)</span>` : '';
                      return `
                        <li class="border rounded-lg p-3 bg-slate-50">
                          <div class="flex items-center justify-between text-sm font-semibold text-slate-700">
                            <span>${dayjs(s.date).format('DD/MM')}</span>
                            <span>${occPct}% ocup.</span>
                          </div>
                          <div class="text-sm text-slate-600">Sugerir +${s.suggestedIncreasePct}% no preço base · ${s.confirmedCount}/${totalUnitsCount} confirmadas${pendLabel}</div>
                        </li>`;
                    })
                    .join('')}</ul>`
                : '<p class="text-sm text-slate-500">Sem datas de alta procura.</p>'}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Bloqueios automáticos</h3>
              ${automationBlocks.length
                ? `<ul class="space-y-2">${automationBlocks
                    .slice(-6)
                    .reverse()
                    .map(evt => {
                      const label = evt.type === 'minstay' ? 'Estadia mínima' : 'Sequência cheia';
                      const extra = evt.extra_nights ? ` · +${evt.extra_nights} noite(s)` : '';
                      return `
                        <li class="border rounded-lg p-3 bg-white/40">
                          <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(label)}</div>
                          <div class="text-sm font-semibold text-slate-800">${esc(evt.property_name)} · ${esc(evt.unit_name)}</div>
                          <div class="text-sm text-slate-600">${esc(formatDateRangeShort(evt.start, evt.end))}${extra}</div>
                        </li>`;
                    })
                    .join('')}</ul>`
                : '<p class="text-sm text-slate-500">Nenhum bloqueio automático recente.</p>'}
            </section>
          </div>
        </div>
      </div>
      <script type="application/json" id="operational-dashboard-data">${operationalConfigJson}</script>
      <script>
        document.addEventListener('DOMContentLoaded', function () {
          const configEl = document.getElementById('operational-dashboard-data');
          if (!configEl) return;
          let config;
          try {
            config = JSON.parse(configEl.textContent);
          } catch (err) {
            console.error('Dashboard operacional: configuração inválida', err);
            return;
          }
          const form = document.getElementById('operational-filters');
          if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); });
          const monthSelect = document.getElementById('operational-filter-month');
          const propertySelect = document.getElementById('operational-filter-property');
          const typeSelect = document.getElementById('operational-filter-type');
          const occupancyEl = document.getElementById('operational-occupancy');
          const revenueEl = document.getElementById('operational-revenue');
          const averageEl = document.getElementById('operational-average');
          const periodLabelEl = document.getElementById('operational-period-label');
          const filtersLabelEl = document.getElementById('operational-filters-label');
          const summaryEl = document.getElementById('operational-summary');
          const listEl = document.getElementById('top-units-list');
          const emptyEl = document.getElementById('top-units-empty');
          const wrapperEl = document.getElementById('top-units-wrapper');
          const exportBtn = document.getElementById('operational-export');
          const currencyFormatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
          const percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 });
          const nightsFormatter = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          const dateFormatter = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit' });
          let pendingController = null;

          function escHtml(value) {
            return String(value ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }

          function slug(value) {
            return String(value || '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/[^a-z0-9]+/gi, '-')
              .replace(/^-+|-+$/g, '')
              .toLowerCase();
          }

          function formatRange(range) {
            if (!range || !range.start || !range.end) return '';
            const startDate = new Date(range.start + 'T00:00:00');
            const endDate = new Date(range.end + 'T00:00:00');
            endDate.setDate(endDate.getDate() - 1);
            return dateFormatter.format(startDate) + ' - ' + dateFormatter.format(endDate);
          }

          function describeFilters(data) {
            if (!data || !data.filters) return '';
            const labels = [];
            if (data.filters.propertyLabel) labels.push(data.filters.propertyLabel);
            if (data.filters.unitType) labels.push(data.filters.unitType);
            return labels.join(' · ');
          }

          function renderTopUnits(units, totalNights) {
            if (!Array.isArray(units) || !units.length) return '';
            const nightsLabel = Math.max(1, Number(totalNights) || 0);
            return units
              .map((unit, index) => {
                const occPct = percentFormatter.format(unit.occupancyRate || 0);
                const revenueLabel = currencyFormatter.format((unit.revenueCents || 0) / 100);
                const bookingsText = unit.bookingsCount === 1 ? '1 reserva' : (unit.bookingsCount || 0) + ' reservas';
                const nightsText = (unit.occupiedNights || 0) + ' / ' + nightsLabel + ' noites';
                const typeLabel = unit.unitType ? ' · ' + unit.unitType : '';
                return '<li class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">' +
                  '<div>' +
                  '<div class="text-sm font-semibold text-slate-800">' + escHtml((index + 1) + '. ' + unit.propertyName + ' · ' + unit.unitName) + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(bookingsText + ' · ' + nightsText + typeLabel) + '</div>' +
                  '</div>' +
                  '<div class="text-right space-y-1">' +
                  '<div class="text-sm font-semibold text-slate-900">' + occPct + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(revenueLabel) + '</div>' +
                  '</div>' +
                  '</li>';
              })
              .join('');
          }

          function buildExportUrl(data) {
            const params = new URLSearchParams();
            if (data && data.month) params.set('month', data.month);
            if (data && data.filters && data.filters.propertyId) params.set('property_id', data.filters.propertyId);
            if (data && data.filters && data.filters.unitType) params.set('unit_type', data.filters.unitType);
            return '/admin/automation/export.csv?' + params.toString();
          }

          function buildExportFilename(data) {
            const month = data && data.month ? data.month : dayjs().format('YYYY-MM');
            const propertySlug = data && data.filters && data.filters.propertyLabel ? slug(data.filters.propertyLabel) : 'todas';
            const unitTypeSlug = data && data.filters && data.filters.unitType ? slug(data.filters.unitType) : 'todos';
            return 'dashboard-operacional-' + month + '-' + propertySlug + '-' + unitTypeSlug + '.csv';
          }

          function setLoading(isLoading) {
            if (wrapperEl) wrapperEl.dataset.loading = isLoading ? 'true' : 'false';
          }

          function applyData(data) {
            setLoading(false);
            if (!data || !data.summary) return;
            const summary = data.summary;
            if (occupancyEl) occupancyEl.textContent = percentFormatter.format(summary.occupancyRate || 0);
            if (revenueEl) revenueEl.textContent = currencyFormatter.format((summary.revenueCents || 0) / 100);
            if (averageEl) averageEl.textContent = nightsFormatter.format(summary.averageNights || 0);
            if (periodLabelEl) periodLabelEl.textContent = formatRange(data.range);
            if (filtersLabelEl) filtersLabelEl.textContent = describeFilters(data);
            if (summaryEl) {
              summaryEl.textContent =
                'Unidades analisadas: ' +
                (summary.totalUnits || 0) +
                ' · Reservas confirmadas: ' +
                summary.bookingsCount +
                ' · Noites ocupadas: ' +
                summary.occupiedNights +
                '/' +
                (summary.availableNights || summary.occupiedNights);
            }
            if (Array.isArray(data.topUnits) && data.topUnits.length) {
              if (listEl) {
                listEl.innerHTML = renderTopUnits(data.topUnits, summary.availableNights);
                listEl.classList.remove('hidden');
              }
              if (emptyEl) emptyEl.classList.add('hidden');
            } else {
              if (listEl) {
                listEl.innerHTML = '';
                listEl.classList.add('hidden');
              }
              if (emptyEl) emptyEl.classList.remove('hidden');
            }
            if (monthSelect && data.month) monthSelect.value = data.month;
            if (propertySelect) propertySelect.value = data.filters && data.filters.propertyId ? String(data.filters.propertyId) : '';
            if (typeSelect) typeSelect.value = data.filters && data.filters.unitType ? data.filters.unitType : '';
            if (exportBtn) {
              exportBtn.href = buildExportUrl(data);
              exportBtn.setAttribute('download', buildExportFilename(data));
            }
          }

          function requestData() {
            if (!monthSelect) return;
            const params = new URLSearchParams();
            if (monthSelect.value) params.set('month', monthSelect.value);
            if (propertySelect && propertySelect.value) params.set('property_id', propertySelect.value);
            if (typeSelect && typeSelect.value) params.set('unit_type', typeSelect.value);
            setLoading(true);
            if (pendingController) pendingController.abort();
            pendingController = new AbortController();
            fetch('/admin/automation/operational.json?' + params.toString(), { signal: pendingController.signal })
              .then(resp => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
              })
              .then(data => applyData(data))
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.error('Dashboard operacional: falha ao carregar métricas', err);
                  setLoading(false);
                }
              })
              .finally(() => {
                if (pendingController && pendingController.signal.aborted) return;
                pendingController = null;
              });
          }

          if (config && config.defaults) {
            if (monthSelect && config.defaults.month) monthSelect.value = config.defaults.month;
            if (propertySelect) propertySelect.value = config.defaults.propertyId || '';
            if (typeSelect) typeSelect.value = config.defaults.unitType || '';
          }
          if (config && config.initialData) {
            applyData(config.initialData);
          }
          [monthSelect, propertySelect, typeSelect].forEach(select => {
            if (!select) return;
            select.addEventListener('change', requestData);
          });
          configEl.textContent = '';
        });
      </script>
    `;

    const housekeepingPendingHtml = housekeepingPending.length
      ? `<ul class="space-y-3">${housekeepingPending
          .map(task => `
            <li class="rounded-xl border border-amber-200 bg-white/70 p-3">
              <div class="font-semibold text-amber-900">${esc(task.title)}</div>
              <div class="text-xs text-amber-700">${task.property_name ? esc(task.property_name) + ' · ' : ''}${task.unit_name ? esc(task.unit_name) : ''}</div>
              <div class="text-xs text-amber-600 mt-1">Previsto: ${task.due_date ? dayjs(task.due_date).format('DD/MM') : '—'}${task.due_time ? ' às ' + task.due_time : ''}</div>
            </li>`)
          .join('')}</ul>`
      : '<p class="bo-empty">Sem tarefas pendentes.</p>';

    const housekeepingInProgressHtml = housekeepingInProgress.length
      ? `<ul class="space-y-3">${housekeepingInProgress
          .map(task => `
            <li class="rounded-xl border border-amber-200 bg-white/70 p-3">
              <div class="font-semibold text-amber-900">${esc(task.title)}</div>
              <div class="text-xs text-amber-700">${task.property_name ? esc(task.property_name) + ' · ' : ''}${task.unit_name ? esc(task.unit_name) : ''}</div>
              <div class="text-xs text-amber-600 mt-1">Em curso por ${task.started_by_username ? esc(task.started_by_username) : '—'}</div>
            </li>`)
          .join('')}</ul>`
      : '<p class="bo-empty">Sem tarefas em curso.</p>';

    const housekeepingCompletedHtml = housekeepingCompleted.length
      ? `<ul class="space-y-3">${housekeepingCompleted
          .map(task => `
            <li class="rounded-xl border border-amber-200 bg-white/60 p-3">
              <div class="font-semibold text-amber-900">${esc(task.title)}</div>
              <div class="text-xs text-amber-700">${task.property_name ? esc(task.property_name) + ' · ' : ''}${task.unit_name ? esc(task.unit_name) : ''}</div>
              <div class="text-xs text-amber-600 mt-1">Concluída ${task.completed_at ? dayjs(task.completed_at).format('DD/MM HH:mm') : '—'}</div>
            </li>`)
          .join('')}</ul>`
      : '<p class="bo-empty">Sem tarefas concluídas nos últimos dias.</p>';

    const usersTableRows = userRows.length
      ? userRows
          .map(u => {
            const role = ROLE_LABELS[normalizeRole(u.role)] || u.role;
            return `
              <tr>
                <td data-label="Utilizador"><span class="table-cell-value">${esc(u.username)}</span></td>
                <td data-label="Perfil"><span class="table-cell-value">${esc(role)}</span></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="2" class="text-sm text-center text-slate-500">Sem utilizadores adicionais.</td></tr>';

    const calendarPreviewRows = calendarPreview.length
      ? calendarPreview
          .map(b => {
            return `
              <tr>
                <td data-label="Datas"><span class="table-cell-value">${dayjs(b.checkin).format('DD/MM')} - ${dayjs(b.checkout).format('DD/MM')}</span></td>
                <td data-label="Propriedade"><span class="table-cell-value">${esc(b.property_name)} · ${esc(b.unit_name)}</span></td>
                <td data-label="Hóspede"><span class="table-cell-value">${esc(b.guest_name || '—')}</span></td>
                <td data-label="Estado"><span class="table-cell-value">${b.status === 'PENDING' ? 'PENDENTE' : 'CONFIRMADA'}</span></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="4" class="text-sm text-center text-slate-500">Sem reservas futuras.</td></tr>';

    const theme = resolveBrandingForRequest(req);

    serverRender('route:/admin');
    res.send(
      layout({
        title: 'Backoffice',
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        notifications,
        pageClass: 'page-backoffice',
        body: html`
          <div class="bo-page bo-page--wide">
            <div class="bo-shell" data-bo-shell>
              <aside class="bo-sidebar" data-bo-sidebar tabindex="-1">
                <div class="bo-sidebar__header">
                  <div class="bo-sidebar__title">Menu principal</div>
                  <button
                    type="button"
                    class="bo-sidebar__toggle"
                    data-sidebar-toggle
                    aria-expanded="true"
                    aria-controls="bo-backoffice-nav"
                    aria-label="Encolher menu"
                  >
                    <i data-lucide="chevron-left" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--collapse" aria-hidden="true"></i>
                    <i data-lucide="chevron-right" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--expand" aria-hidden="true"></i>
                    <i data-lucide="x" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--close" aria-hidden="true"></i>
                  </button>
                </div>
                <nav class="bo-nav" id="bo-backoffice-nav" data-sidebar-nav>${navButtonsHtml}</nav>
              </aside>
              <div class="bo-sidebar__scrim" data-sidebar-scrim hidden></div>
              <div class="bo-main" data-bo-main>
                <button type="button" class="bo-main__menu" data-sidebar-open>
                  <i data-lucide="menu" aria-hidden="true"></i>
                  <span>Menu</span>
                </button>
                <header class="bo-header">
                  <h1>Gestor Operacional</h1>
                  <p>Todos os dados essenciais de gestão em formato compacto.</p>
                </header>

                ${quickAccessHtml}

                <div class="bo-toast-stack" data-toast-container aria-live="polite" aria-atomic="true"></div>

                <section class="bo-pane bo-pane--split is-active" data-bo-pane="overview">
                <div class="bo-card bo-span-all space-y-4" data-rates-bulk aria-live="polite">
                  <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h2 class="text-lg font-semibold text-slate-800">Gestão rápida de preços</h2>
                      <p class="text-sm text-slate-600">Aplica tarifas por intervalo com filtros por unidade, tipologia e fins-de-semana.</p>
                    </div>
                    <div class="flex flex-col items-start gap-2 md:items-end md:text-right">
                      <a class="btn btn-light" href="/admin/rates/rules">Abrir regras automáticas de tarifas</a>
                      <div
                        class="text-xs text-slate-500"
                        data-rate-feedback
                        role="status"
                        aria-live="polite"
                      >Seleciona datas e unidades para pré-visualizar o impacto.</div>
                    </div>
                  </div>
                  <form class="grid gap-3 md:grid-cols-5" data-rates-form novalidate>
                    <label class="form-field" data-field>
                      <span class="form-label">Data inicial</span>
                      <input type="date" class="input" data-rate-start required />
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <label class="form-field" data-field>
                      <span class="form-label">Data final</span>
                      <input type="date" class="input" data-rate-end required />
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <label class="form-field" data-field>
                      <span class="form-label">Preço €/noite</span>
                      <input type="number" min="1" step="0.01" class="input" data-rate-price placeholder="Ex.: 165" required />
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <label class="form-field" data-field>
                      <span class="form-label">Unidade</span>
                      <select class="input" data-rate-unit>
                        <option value="">Todas</option>
                      </select>
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <label class="form-field" data-field>
                      <span class="form-label">Tipologia</span>
                      <select class="input" data-rate-type>
                        <option value="">Todas</option>
                      </select>
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <div class="md:col-span-5 flex flex-wrap items-center gap-3" data-field>
                      <label class="inline-flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" data-rate-weekends />
                        <span>Aplicar apenas a noites de fim-de-semana</span>
                      </label>
                      <button type="button" class="btn btn-primary" data-rate-apply>Atualizar preços</button>
                      <span class="text-xs text-slate-500" data-rate-loading hidden aria-live="assertive">A atualizar tarifas…</span>
                    </div>
                  </form>
                  <div class="rounded-xl border border-slate-200 bg-white/80 p-3 space-y-3" data-rate-preview-wrapper hidden>
                    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <h3 class="font-semibold text-slate-700">Pré-visualização</h3>
                      <span class="text-xs text-slate-500" data-rate-summary></span>
                    </div>
                    <div class="bo-table responsive-table">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th>Unidade</th>
                            <th>Noites</th>
                            <th>Preço aplicado</th>
                          </tr>
                        </thead>
                        <tbody data-rate-preview>
                          <tr><td colspan="3" class="text-sm text-center text-slate-500">Seleciona um intervalo para visualizar o impacto.</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p class="text-xs text-slate-500">Após confirmar, tens 5 segundos para anular a alteração.</p>
                </div>
                <div class="bo-pane__columns bo-span-all">
                  <div class="bo-card">
                    <h2>Propriedades</h2>
                    <p class="bo-subtitle">Alojamentos atribuídos a este utilizador</p>
                    ${propertiesListHtml}
                    <hr class="my-4" />
                    <h3 class="bo-section-title">Adicionar propriedade</h3>
                    <form method="post" action="/admin/properties/create" class="grid gap-3">
                      <fieldset class="grid gap-2"${canManageProperties ? '' : ' disabled'}>
                        <input required name="name" class="input" placeholder="Nome" />
                        <input required name="address" class="input" placeholder="Morada completa" />
                        <div class="grid gap-2 sm:grid-cols-2">
                          <input required name="locality" class="input" placeholder="Localidade" />
                          <input required name="district" class="input" placeholder="Distrito" />
                        </div>
                        <textarea name="description" class="input" placeholder="Descrição"></textarea>
                      </fieldset>
                      ${canManageProperties ? '' : '<p class="bo-empty">Sem permissões para criar novas propriedades.</p>'}
                      <button class="btn btn-primary"${canManageProperties ? '' : ' disabled'}>Adicionar propriedade</button>
                    </form>
                  </div>

                  <div class="bo-card">
                    <h2>Unidades</h2>
                    <div class="bo-table responsive-table">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th>Propriedade</th><th>Unidade</th><th>Cap.</th><th>Base €/noite</th><th></th>
                          </tr>
                        </thead>
                        <tbody>${unitsTableRows}</tbody>
                      </table>
                    </div>
                    <hr class="my-4" />
                    <h3 class="bo-section-title">Adicionar unidade</h3>
                    <form method="post" action="/admin/units/create" class="grid gap-3">
                      <fieldset class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"${canManageProperties ? '' : ' disabled'}>
                        <label class="form-field md:col-span-2 lg:col-span-2">
                          <span class="form-label">Propriedade</span>
                          <select required name="property_id" class="input">
                            <option value="" disabled selected hidden>Seleciona um alojamento</option>
                            ${props.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                          </select>
                        </label>
                        <label class="form-field md:col-span-2 lg:col-span-2">
                          <span class="form-label">Nome da unidade</span>
                          <input required name="name" class="input" placeholder="Ex.: Suite Vista Rio" />
                        </label>
                        <label class="form-field">
                          <span class="form-label">Capacidade</span>
                          <input required type="number" min="1" name="capacity" class="input" placeholder="Número de hóspedes" />
                        </label>
                        <label class="form-field">
                          <span class="form-label">Preço base €/noite</span>
                          <input required type="number" step="0.01" min="0" name="base_price_eur" class="input" placeholder="Valor por noite" />
                        </label>
                        <div class="md:col-span-2 lg:col-span-4">
                          ${renderFeatureBuilderField({
                            name: 'features_raw',
                            label: 'Características',
                            helperText: 'Seleciona uma característica, escreve o detalhe pretendido e adiciona à lista.'
                          })}
                        </div>
                      </fieldset>
                      <div>
                        <button class="btn btn-primary"${canManageProperties ? '' : ' disabled'}>Adicionar unidade</button>
                      </div>
                    </form>
                  </div>
                </div>

                <div class="bo-card bo-span-all">
                  <h2>Listagem de propriedades</h2>
                  <div class="bo-table responsive-table">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="text-left text-slate-500">
                          <th>Propriedade · Unidades</th><th>Receita total</th>
                        </tr>
                      </thead>
                      <tbody>${propertiesRevenueTable}</tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="finance">
                <div class="bo-pane__columns">
                  <div class="bo-card">
                    <h2>Resumo financeiro</h2>
                    <div class="bo-metrics">
                      <div class="bo-metric"><strong>€ ${eur(confirmedRevenueCents)}</strong><span>Receita confirmada (histórico)</span></div>
                      <div class="bo-metric"><strong>€ ${eur(pendingRevenueCents)}</strong><span>Receita pendente (${pendingBookingsCount} reservas)</span></div>
                      <div class="bo-metric"><strong>€ ${eur(automationRevenue7)}</strong><span>Receita prevista (próximos 7 dias)</span></div>
                      <div class="bo-metric"><strong>€ ${eur(automationRevenue30)}</strong><span>Receita prevista (próximos 30 dias)</span></div>
                      <div class="bo-metric"><strong>€ ${eur(averageTicketCents)}</strong><span>Ticket médio confirmado</span></div>
                    </div>
                  </div>
                  <div class="bo-card">
                    <h2>Reservas recentes</h2>
                    <div class="bo-table responsive-table">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th>Quando</th><th>Propriedade / Unidade</th><th>Hóspede</th><th>Contacto</th><th>Ocupação</th><th>Datas</th><th>Total</th>
                          </tr>
                        </thead>
                        <tbody>${recentBookings
                          .map(b => `
                            <tr>
                              <td data-label="Quando"><span class="table-cell-value">${dayjs(b.created_at).format('DD/MM HH:mm')}</span></td>
                              <td data-label="Propriedade / Unidade"><span class="table-cell-value">${esc(b.property_name)} · ${esc(b.unit_name)}</span></td>
                              <td data-label="Hóspede"><span class="table-cell-value">${esc(b.guest_name)}</span></td>
                              <td data-label="Contacto"><span class="table-cell-value">${esc(b.guest_phone || '-')}${b.guest_email ? `<span class="table-cell-muted">${esc(b.guest_email)}</span>` : ''}</span></td>
                              <td data-label="Ocupação"><span class="table-cell-value">${b.adults}A+${b.children}C</span></td>
                              <td data-label="Datas"><span class="table-cell-value">${dayjs(b.checkin).format('DD/MM')} - ${dayjs(b.checkout).format('DD/MM')}</span></td>
                              <td data-label="Total"><span class="table-cell-value">€ ${eur(b.total_cents)}</span></td>
                            </tr>`)
                          .join('')}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="revenue">
                <div class="bo-pane__columns">
                  <div class="bo-card bo-span-all">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2>Painel de revenue</h2>
                        <p class="bo-subtitle">Desempenho dos últimos ${revenueRangeDays} dias com foco em receita e ocupação.</p>
                      </div>
                      <div class="text-xs text-slate-500">Período analisado: <span data-revenue-range>${esc(revenueRangeLabel)}</span></div>
                    </div>
                    <div class="bo-metrics bo-metrics--wrap mt-4" data-revenue-summary>
                      <div class="bo-metric"><strong data-revenue-metric="revenue">${esc(revenueSummaryLabels.revenue)}</strong><span>Receita total</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="adr">${esc(revenueSummaryLabels.adr)}</strong><span>ADR médio</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="revpar">${esc(revenueSummaryLabels.revpar)}</strong><span>RevPAR</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="occupancy">${esc(revenueSummaryLabels.occupancy)}</strong><span>Ocupação</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="nights">${esc(revenueSummaryLabels.nights)}</strong><span>Noites vendidas</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="reservations">${esc(revenueSummaryLabels.reservations)}</strong><span>Reservas</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="averageStay">${esc(revenueSummaryLabels.averageStay)}</strong><span>Estadia média (noites)</span></div>
                      <div class="bo-metric"><strong data-revenue-metric="bookingPace">${esc(revenueSummaryLabels.bookingPace)}</strong><span>Booking pace (média diária)</span></div>
                    </div>
                  </div>

                  <div class="grid gap-6 lg:grid-cols-3 bo-span-all">
                    <div class="bo-card lg:col-span-2">
                      <div class="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <h3 class="bo-section-title">Receita vs noites</h3>
                          <p class="bo-subtitle">Comparativo diário entre receita gerada e noites vendidas.</p>
                        </div>
                      </div>
                      <div style="height:260px">
                        <canvas id="revenue-line-chart" aria-label="Gráfico de receita e noites"></canvas>
                      </div>
                    </div>
                    <div class="bo-card">
                      <div class="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <h3 class="bo-section-title">Canais de venda</h3>
                          <p class="bo-subtitle">Distribuição da receita confirmada.</p>
                        </div>
                      </div>
                      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
                        <div style="height:220px">
                          <canvas id="revenue-channel-chart" aria-label="Gráfico de canais de revenue"></canvas>
                        </div>
                        <ul class="space-y-3" id="revenue-channel-legend">${revenueChannelsHtml || '<li class="text-sm text-slate-500">Sem dados de canais disponíveis.</li>'}</ul>
                      </div>
                    </div>
                    <div class="bo-card lg:col-span-3">
                      <div class="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <h3 class="bo-section-title">Ocupação diária</h3>
                          <p class="bo-subtitle">Percentual de ocupação ao longo do período.</p>
                        </div>
                      </div>
                      <div style="height:260px">
                        <canvas id="revenue-occupancy-chart" aria-label="Gráfico de barras de ocupação diária"></canvas>
                      </div>
                    </div>
                  </div>

                  <p class="bo-empty bo-span-all" data-revenue-chart-fallback hidden>Não foi possível carregar os gráficos de revenue neste navegador.</p>

                  <div class="bo-card bo-span-all">
                    <h3 class="bo-section-title">Resumo diário detalhado</h3>
                    <p class="bo-subtitle">Tabela com todos os indicadores financeiros e operacionais por data.</p>
                    <div class="bo-table responsive-table mt-3">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th>Data</th><th>Receita</th><th>ADR</th><th>RevPAR</th><th>Ocupação</th><th>Reservas</th><th>Noites</th><th>Estadia média</th><th>Booking pace</th>
                          </tr>
                        </thead>
                        <tbody id="revenue-daily-table">${revenueDailyTableRows}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="channel-manager">
                <div class="bo-pane__columns">
                  <div class="bo-card bo-span-all">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h2>Channel Manager</h2>
                        <p class="bo-subtitle">Centralize as integrações com Booking.com, Airbnb, i-escape e Splendia numa única área de controlo.</p>
                      </div>
                      <div class="text-xs text-slate-500">Última sincronização registada: <span class="font-medium text-slate-700">${esc(lastSyncLabel)}</span></div>
                    </div>
                    ${channelNoticeHtml ? `<div class="mt-4">${channelNoticeHtml}</div>` : ''}
                    <div class="bo-metrics bo-metrics--wrap mt-4">
                      <div class="bo-metric"><strong>${totalChannels}</strong><span>Canais disponíveis</span></div>
                      <div class="bo-metric"><strong>${autoActiveCount}</strong><span>Auto-sync ativos</span></div>
                      <div class="bo-metric"><strong>${manualEnabledCount}</strong><span>Importações manuais</span></div>
                      <div class="bo-metric"><strong>${channelsNeedingAttention}</strong><span>Alertas a resolver</span></div>
                      <div class="bo-metric"><strong>${recentImportCount}</strong><span>Importações recentes</span></div>
                    </div>
                  </div>

                  <div class="bo-channel-layout grid gap-6 xl:grid-cols-[2fr_1fr] bo-span-all">
                    <div class="bo-channel-stack space-y-6">
                      <div class="bo-card">
                        <h3 class="bo-section-title">Conexões de canais</h3>
                        <p class="bo-subtitle">Revê e ajusta as credenciais, URLs e notas operacionais de cada integração.</p>
                        <div class="bo-channel-card-list mt-4 space-y-4">${channelCardsHtml}</div>
                      </div>

                      <div class="bo-card">
                        <h3 class="bo-section-title">Upload manual de reservas</h3>
                        <p class="bo-subtitle">Carrega ficheiros exportados das plataformas quando precisares de um reforço manual ou recuperação rápida.</p>
                        ${manualFormatsLegend ? `<ul class="bo-channel-upload-legend mt-4 grid gap-2">${manualFormatsLegend}</ul>` : ''}
                        <div class="mt-4">${manualUploadSection}</div>
                      </div>
                    </div>

                    <div class="bo-channel-stack space-y-6">
                      <div class="bo-card">
                        <h3 class="bo-section-title">Alertas do Channel Manager</h3>
                        <p class="bo-subtitle">Pendências de configuração ou falhas recentes que exigem atenção.</p>
                        <div class="bo-channel-alerts mt-3 space-y-3">${channelAlertsHtml}</div>
                      </div>

                      <div class="bo-card">
                        <h3 class="bo-section-title">Histórico de importações</h3>
                        <div class="bo-table responsive-table mt-3">
                          <table class="w-full text-sm">
                            <thead>
                              <tr class="text-left text-slate-500">
                                <th>Data</th><th>Canal</th><th>Origem</th><th>Estado</th><th>Resumo</th><th>Autor</th>
                              </tr>
                            </thead>
                            <tbody>${channelImportsRows}</tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="estatisticas" id="estatisticas">
                <div class="bo-pane__columns">
                  ${canViewAutomation ? statisticsCard : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para visualizar o painel estatístico.</p></div>'}
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="reviews" data-reviews-pane>
                <div class="bo-pane__columns">
                  <div class="bo-card space-y-4" data-reviews-root aria-live="polite">
                    <header class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 class="text-lg font-semibold text-slate-800">Avaliações dos hóspedes</h2>
                        <p class="text-sm text-slate-600">Filtra rapidamente as reviews recentes ou negativas e responde com confirmação imediata.</p>
                      </div>
                      <div class="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600" data-reviews-counter>—</div>
                    </header>
                    <div class="flex flex-wrap items-center gap-2" role="tablist">
                      <button type="button" class="btn btn-light btn-compact is-active" data-review-filter="all" role="tab" aria-selected="true">Todas</button>
                      <button type="button" class="btn btn-light btn-compact" data-review-filter="negative" role="tab" aria-selected="false">Negativas</button>
                      <button type="button" class="btn btn-light btn-compact" data-review-filter="recent" role="tab" aria-selected="false">Recentes</button>
                    </div>
                    <div class="space-y-3" data-reviews-list aria-busy="true">
                      <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 animate-pulse" data-review-skeleton>
                        <div class="h-4 bg-slate-200 rounded w-1/3 mb-2"></div>
                        <div class="h-3 bg-slate-200 rounded w-2/3"></div>
                      </div>
                      <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 animate-pulse" data-review-skeleton>
                        <div class="h-4 bg-slate-200 rounded w-1/2 mb-2"></div>
                        <div class="h-3 bg-slate-200 rounded w-3/4"></div>
                      </div>
                    </div>
                    <p class="text-sm text-slate-500" data-reviews-empty hidden role="status" aria-live="polite">
                      Sem novas avaliações esta semana.
                    </p>
                  </div>
                  <div class="bo-card space-y-3" data-review-composer hidden>
                    <header>
                      <h3 class="text-base font-semibold text-slate-800">Responder à avaliação</h3>
                      <p class="text-xs text-slate-500">A resposta ficará visível no portal após sincronização com o canal.</p>
                    </header>
                    <article class="rounded-lg border border-slate-200 bg-white/70 p-3 space-y-1" data-selected-review aria-live="polite"></article>
                    <label class="form-field" data-field>
                      <span class="form-label">Resposta</span>
                      <textarea class="input" rows="3" maxlength="1000" data-review-response placeholder="Obrigado pela partilha..." required></textarea>
                      <div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                        <span data-review-hint>Máx. 1000 caracteres.</span>
                        <span data-review-count>0 / 1000</span>
                      </div>
                      <p class="form-error text-xs text-rose-600" data-error hidden></p>
                    </label>
                    <div class="flex items-center gap-3">
                      <button type="button" class="btn btn-primary" data-review-submit>Enviar resposta</button>
                      <button type="button" class="btn btn-light" data-review-cancel>Cancelar</button>
                      <span class="text-xs text-slate-500" data-review-loading hidden aria-live="assertive">A enviar resposta…</span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="housekeeping">
                <div class="bo-pane__columns">
                  ${canSeeHousekeeping
                    ? html`
                        <div class="bo-card">
                          <h2>Resumo de limpeza</h2>
                          <div class="bo-metrics">
                            <div class="bo-metric"><strong>${housekeepingCounts ? housekeepingCounts.pending : 0}</strong><span>Tarefas pendentes</span></div>
                            <div class="bo-metric"><strong>${housekeepingCounts ? housekeepingCounts.inProgress : 0}</strong><span>Em curso</span></div>
                            <div class="bo-metric"><strong>${housekeepingCounts ? housekeepingCounts.highPriority : 0}</strong><span>Prioridade alta</span></div>
                            <div class="bo-metric"><strong>${housekeepingCounts ? housekeepingCounts.completedRecent : 0}</strong><span>Concluídas 7 dias</span></div>
                          </div>
                        </div>
                        <div class="bo-card">
                          <h2>Tarefas pendentes</h2>
                          ${housekeepingPendingHtml}
                        </div>
                        <div class="bo-card">
                          <h2>Em curso</h2>
                          ${housekeepingInProgressHtml}
                        </div>
                        <div class="bo-card">
                          <h2>Concluídas recentemente</h2>
                          ${housekeepingCompletedHtml}
                        </div>
                        <div class="bo-card">
                          <a class="btn btn-primary" href="/admin/limpeza">Abrir gestão de limpezas</a>
                        </div>
                      `
                    : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para consultar tarefas de limpeza.</p></div>'}
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="emails">
                <div class="bo-pane__columns">
                  ${canManageEmailTemplates
                    ? html`
                        <div class="bo-card bo-span-all">
                          <h2>Emails de reserva</h2>
                          <p class="bo-subtitle">Personaliza as mensagens automáticas enviadas aos hóspedes.</p>
                          <div class="space-y-6">${emailTemplateCards}</div>
                        </div>
                      `
                    : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para editar modelos de email.</p></div>'}
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="messages">
                <div class="bo-pane__columns">
                  ${canManageEmailTemplates
                    ? html`
                        <div class="bo-card bo-span-all" data-message-templates-root>
                          <h2>Mensagens automáticas</h2>
                          <p class="bo-subtitle">Personalize respostas rápidas para WhatsApp, SMS ou chat com os hóspedes.</p>
                          <div class="space-y-6">${messageTemplateCards}</div>
                        </div>
                      `
                    : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para editar modelos de mensagens.</p></div>'}
                </div>
              </section>

              ${canViewHistory
                ? html`
                    <section class="bo-pane" data-bo-pane="history">
                      <div class="bo-pane__columns">
                        <div class="bo-card bo-span-all space-y-6">
                          <div>
                            <h2>Histórico de alterações</h2>
                            <p class="bo-subtitle">
                              Acompanhe as edições efetuadas pela equipa em reservas e tarefas de limpeza.
                            </p>
                          </div>
                          <div class="grid gap-6 lg:grid-cols-2">
                            <div class="space-y-3">
                              <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-600">Reservas</h3>
                              <div class="space-y-4">${historyBookingHtml}</div>
                            </div>
                            <div class="space-y-3">
                              <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-600">Tarefas de limpeza</h3>
                              <div class="space-y-4">${historyTaskHtml}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  `
                : ''}

              <section class="bo-pane" data-bo-pane="branding">
                <div class="bo-pane__columns">
                  <div class="bo-card bo-span-all">
                    <h2>Identidade visual</h2>
                    <p class="bo-subtitle">Cores e imagem aplicadas ao portal</p>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <div class="rounded-xl border border-amber-200 p-4">
                        <div class="text-xs uppercase text-amber-600">Nome</div>
                        <div class="text-lg font-semibold text-amber-900">${esc(theme.brandName)}</div>
                        ${theme.tagline ? `<div class="text-sm text-amber-700 mt-2">${esc(theme.tagline)}</div>` : ''}
                      </div>
                      <div class="rounded-xl border border-amber-200 p-4 flex gap-3 items-center">
                        <span class="w-10 h-10 rounded-full" style="background:${esc(theme.primaryColor)}"></span>
                        <span class="w-10 h-10 rounded-full" style="background:${esc(theme.secondaryColor)}"></span>
                        <span class="w-10 h-10 rounded-full" style="background:${esc(theme.highlightColor)}"></span>
                      </div>
                    </div>
                    ${canManageUsers
                      ? '<div class="mt-4"><a class="btn btn-primary" href="/admin/identidade-visual">Gerir identidade visual</a></div>'
                      : '<p class="bo-empty mt-4">Sem permissões para editar a identidade.</p>'}
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="users">
                <div class="bo-pane__columns">
                  ${canManageUsers
                    ? html`
                        <div class="bo-card bo-span-all">
                          <h2>Utilizadores</h2>
                          <div class="bo-table responsive-table">
                            <table class="w-full text-sm">
                              <thead>
                                <tr class="text-left text-slate-500">
                                  <th>Utilizador</th><th>Perfil</th>
                                </tr>
                              </thead>
                              <tbody>${usersTableRows}</tbody>
                            </table>
                          </div>
                          <div class="mt-4 flex gap-3 flex-wrap">
                            <a class="btn btn-primary" href="/admin/utilizadores">Gerir utilizadores</a>
                          </div>
                        </div>
                      `
                    : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para gerir utilizadores.</p></div>'}
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="calendar">
                <div class="bo-pane__columns">
                  ${canViewCalendar
                    ? html`
                        <div class="bo-card bo-span-all">
                          <h2>Agenda de reservas</h2>
                          <p class="bo-subtitle">Próximas reservas confirmadas ou pendentes</p>
                          <div class="bo-table responsive-table">
                            <table class="w-full text-sm">
                              <thead>
                                <tr class="text-left text-slate-500">
                                  <th>Datas</th><th>Propriedade</th><th>Hóspede</th><th>Estado</th>
                                </tr>
                              </thead>
                              <tbody>${calendarPreviewRows}</tbody>
                            </table>
                          </div>
                          <div class="mt-4"><a class="btn btn-primary" href="/calendar">Abrir calendário completo</a></div>
                        </div>
                      `
                    : '<div class="bo-card bo-span-all"><p class="bo-empty">Sem permissões para consultar o calendário de reservas.</p></div>'}
                </div>
              </section>
              </div>
            </div>
          </div>
          <div class="bo-modal hidden" data-block-modal aria-hidden="true" role="dialog" aria-modal="true">
            <div class="bo-modal__backdrop" data-block-dismiss tabindex="-1"></div>
            <div class="bo-modal__content" role="document">
              <header class="bo-modal__header">
                <h2 class="text-lg font-semibold text-slate-800" data-block-title>Bloquear unidade</h2>
                <button type="button" class="bo-modal__close" data-block-dismiss aria-label="Fechar">×</button>
              </header>
              <form class="bo-modal__body space-y-3" data-block-form novalidate>
                <p class="text-sm text-slate-600">Seleciona o intervalo e descreve o motivo visível para a equipa.</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="form-field" data-field>
                    <span class="form-label">Data inicial</span>
                    <input type="date" class="input" data-block-start required />
                    <p class="form-error text-xs text-rose-600" data-error hidden></p>
                  </label>
                  <label class="form-field" data-field>
                    <span class="form-label">Data final</span>
                    <input type="date" class="input" data-block-end required />
                    <p class="form-error text-xs text-rose-600" data-error hidden></p>
                  </label>
                </div>
                <label class="form-field" data-field>
                  <span class="form-label">Motivo</span>
                  <textarea class="input" rows="3" maxlength="240" data-block-reason placeholder="Ex.: Manutenção preventiva nas casas de banho" required></textarea>
                  <div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                    <span data-block-hint>Máx. 240 caracteres.</span>
                    <span data-block-count>0 / 240</span>
                  </div>
                  <p class="form-error text-xs text-rose-600" data-error hidden></p>
                </label>
                <p class="text-xs text-slate-500" data-block-conflict hidden role="alert"></p>
                <div class="flex items-center gap-3">
                  <button type="submit" class="btn btn-primary" data-block-submit>Confirmar bloqueio</button>
                  <button type="button" class="btn btn-light" data-block-dismiss>Cancelar</button>
                  <span class="text-xs text-slate-500" data-block-loading hidden aria-live="assertive">A criar bloqueio…</span>
                </div>
              </form>
            </div>
          </div>
          <script type="application/json" id="ux-dashboard-config">${uxDashboardConfigJson}</script>
          <script type="application/json" id="revenue-analytics-data">${revenueAnalyticsJson}</script>
          <script>${sidebarControlsScript}</script>
          <script>${featureBuilderScript}</script>
          <script>${revenueDashboardScript}</script>
          <script>${renderDashboardTabsScript(defaultPane)}</script>
          <script>${uxEnhancementsScript}</script>
        `
      })
    );
  });

  app.get('/admin/revenue-calendar', requireLogin, requirePermission('dashboard.view'), (req, res) => {
    setNoIndex(res);
    const startParam = typeof req.query.start === 'string' ? req.query.start : null;
    const endParam = typeof req.query.end === 'string' ? req.query.end : null;
    const pickupParam = typeof req.query.pickupWindows === 'string' ? req.query.pickupWindows : null;

    const defaultStart = startParam && dayjs(startParam, 'YYYY-MM-DD', true).isValid()
      ? dayjs(startParam)
      : dayjs();
    const parsedEnd = endParam && dayjs(endParam, 'YYYY-MM-DD', true).isValid()
      ? dayjs(endParam)
      : null;
    const defaultEnd = parsedEnd || defaultStart.add(29, 'day');
    const normalizedEnd = defaultEnd.isBefore(defaultStart) ? defaultStart : defaultEnd;
    const safeStart = defaultStart.format('YYYY-MM-DD');
    const safeEnd = normalizedEnd.format('YYYY-MM-DD');
    const defaultPickupWindows = pickupParam && pickupParam.trim() ? pickupParam : '7,30';

    const body = `
      <div class="bo-wrapper">
        <header class="bo-header">
          <div>
            <h1>Calendário de receita</h1>
            <p class="bo-subtitle">Visão tática diária da performance com alertas de pricing e pickups por período.</p>
          </div>
          <div class="text-xs text-slate-500">Período em análise: <span data-revenue-calendar-range>${esc(
            `${safeStart} a ${safeEnd}`
          )}</span></div>
        </header>

        <section class="bo-card space-y-4">
          <form class="grid gap-4 md:grid-cols-[repeat(4,minmax(0,1fr))]" data-revenue-calendar-form>
            <label class="form-field">
              <span class="form-label">Data inicial</span>
              <input type="date" class="input" name="start" value="${esc(safeStart)}" required />
            </label>
            <label class="form-field">
              <span class="form-label">Data final</span>
              <input type="date" class="input" name="end" value="${esc(safeEnd)}" required />
            </label>
            <label class="form-field">
              <span class="form-label">Pickups (dias)</span>
              <input type="text" class="input" name="pickupWindows" value="${esc(defaultPickupWindows)}" placeholder="Ex.: 7,30" />
              <small class="text-xs text-slate-500">Separar por vírgulas para comparar múltiplos períodos.</small>
            </label>
            <div class="flex items-end gap-3">
              <button class="btn btn-primary" type="submit">Aplicar filtros</button>
              <button class="btn btn-light" type="button" data-revenue-calendar-refresh>Recarregar</button>
            </div>
          </form>
          <div class="flex flex-col gap-2 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
            <span data-revenue-calendar-loading hidden>Carregando dados mais recentes…</span>
            <span data-revenue-calendar-error hidden class="text-sm text-rose-600"></span>
          </div>
          <div class="bo-card bg-white/70" data-revenue-calendar-summary></div>
        </section>

        <section class="bo-card p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="bo-table bo-table--dense min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Ocupação</th>
                  <th scope="col">Receita</th>
                  <th scope="col">ADR</th>
                  <th scope="col">RevPAR</th>
                  <th scope="col">Reservas</th>
                  <th scope="col">Noites</th>
                  <th scope="col">Pickups</th>
                  <th scope="col">Alertas</th>
                </tr>
              </thead>
              <tbody data-revenue-calendar-table></tbody>
            </table>
          </div>
        </section>
      </div>
      <script>${revenueCalendarScript}</script>
    `;

    res.send(
      layout({
        pageTitle: 'Calendário de receita',
        pageClass: 'page-backoffice page-revenue-calendar',
        body
      })
    );
  });
app.get('/admin/automation/operational.json', requireLogin, requirePermission('automation.view'), (req, res) => {
  const data = computeOperationalDashboard(req.query || {});
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(data));
});

app.get('/admin/automation/export.csv', requireLogin, requirePermission('automation.export'), (req, res) => {
  const filters = parseOperationalFilters(req.query || {});
  const operational = computeOperationalDashboard(filters);
  const automationData = ensureAutomationFresh(5) || automationCache;
  const daily = (automationData.summaries && automationData.summaries.daily) || [];
  const weekly = (automationData.summaries && automationData.summaries.weekly) || [];

  const rows = [];
  rows.push(['Secção', 'Referência', 'Valor']);
  const rangeEnd = dayjs(operational.range.end).subtract(1, 'day');
  const rangeLabel = `${operational.range.start} - ${rangeEnd.isValid() ? rangeEnd.format('YYYY-MM-DD') : operational.range.end}`;
  rows.push(['Filtro', 'Período', `${operational.monthLabel} (${rangeLabel})`]);
  if (operational.filters.propertyLabel) {
    rows.push(['Filtro', 'Propriedade', operational.filters.propertyLabel]);
  }
  if (operational.filters.unitType) {
    rows.push(['Filtro', 'Tipo de unidade', operational.filters.unitType]);
  }
  rows.push(['Métrica', 'Unidades analisadas', operational.summary.totalUnits]);
  rows.push([
    'Métrica',
    'Ocupação período (%)',
    Math.round((operational.summary.occupancyRate || 0) * 100)
  ]);
  rows.push(['Métrica', 'Reservas confirmadas', operational.summary.bookingsCount]);
  rows.push([
    'Métrica',
    'Noites ocupadas',
    operational.summary.availableNights
      ? `${operational.summary.occupiedNights}/${operational.summary.availableNights}`
      : 'Sem unidades'
  ]);
  rows.push([
    'Métrica',
    'Média noites/reserva',
    operational.summary.bookingsCount ? operational.summary.averageNights.toFixed(2) : '0.00'
  ]);
  rows.push(['Financeiro', 'Receita período (€)', eur(operational.summary.revenueCents || 0)]);
  if (operational.topUnits.length) {
    operational.topUnits.forEach((unit, idx) => {
      rows.push([
        'Top unidades',
        `${idx + 1}. ${unit.propertyName} · ${unit.unitName}`,
        `${Math.round((unit.occupancyRate || 0) * 100)}% · ${unit.bookingsCount} reservas · € ${eur(unit.revenueCents || 0)}`
      ]);
    });
  } else {
    rows.push(['Top unidades', '—', 'Sem dados para os filtros selecionados.']);
  }

  rows.push(['', '', '']);
  rows.push([
    'Execução',
    'Última automação',
    automationData.lastRun ? dayjs(automationData.lastRun).format('YYYY-MM-DD HH:mm') : '-'
  ]);
  rows.push(['Receita', 'Próximos 7 dias (€)', eur(automationData.revenue ? automationData.revenue.next7 || 0 : 0)]);
  rows.push(['Receita', 'Próximos 30 dias (€)', eur(automationData.revenue ? automationData.revenue.next30 || 0 : 0)]);
  rows.push(['Métrica', 'Check-ins 48h', (automationData.metrics && automationData.metrics.checkins48h) || 0]);
  rows.push(['Métrica', 'Estadias longas', (automationData.metrics && automationData.metrics.longStays) || 0]);
  rows.push([
    'Métrica',
    'Ocupação hoje (%)',
    Math.round(((automationData.metrics && automationData.metrics.occupancyToday) || 0) * 100)
  ]);

  daily.forEach(d => {
    rows.push([
      'Resumo diário',
      `${dayjs(d.date).format('YYYY-MM-DD')}`,
      `${Math.round((d.occupancyRate || 0) * 100)}% · ${d.confirmedCount} confirmadas`
    ]);
  });

  weekly.forEach(w => {
    const endLabel = dayjs(w.end).subtract(1, 'day').format('YYYY-MM-DD');
    rows.push([
      'Resumo semanal',
      `${dayjs(w.start).format('YYYY-MM-DD')} - ${endLabel}`,
      `${Math.round((w.occupancyRate || 0) * 100)}% · ${w.confirmedNights} noites`
    ]);
  });

  const csv = rows
    .map(cols => cols.map(col => `"${String(col ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const filenameParts = [
    'dashboard',
    operational.month || dayjs().format('YYYY-MM')
  ];
  if (operational.filters.propertyLabel) {
    filenameParts.push(`prop-${slugify(operational.filters.propertyLabel)}`);
  } else if (operational.filters.propertyId) {
    filenameParts.push(`prop-${operational.filters.propertyId}`);
  }
  if (operational.filters.unitType) {
    filenameParts.push(`tipo-${slugify(operational.filters.unitType)}`);
  }
  const filenameBase = filenameParts.filter(Boolean).join('_') || 'dashboard';
  const filename = `${filenameBase}.csv`;

  logActivity(req.user.id, 'export:automation_csv', null, null, filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csv);
});

  app.post(
    '/admin/channel-integrations/:key/settings',
    requireLogin,
    requirePermission('bookings.edit'),
    (req, res) => {
      const channelKey = String(req.params.key || '').trim();
      try {
        channelIntegrations.saveIntegrationSettings(
          channelKey,
          {
            autoEnabled: req.body.autoEnabled === '1' || req.body.autoEnabled === 'on',
            autoUrl: req.body.autoUrl,
            autoFormat: req.body.autoFormat,
            defaultStatus: req.body.defaultStatus,
            autoUsername: req.body.autoUsername,
            autoPassword: req.body.autoPassword,
            timezone: req.body.timezone,
            notes: req.body.notes
          },
          req.user.id
        );
        logActivity(req.user.id, 'channel.settings.save', 'channel', channelKey, {
          autoUrl: req.body.autoUrl || null,
          autoFormat: req.body.autoFormat || null
        });
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`settings:${channelKey}`)}#channel-manager`);
      } catch (err) {
        console.warn('Falha ao guardar configuração de canal:', err.message);
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`error:${err.message}`)}#channel-manager`);
      }
    }
  );

  app.post(
    '/admin/channel-integrations/:key/sync',
    requireLogin,
    requirePermission('bookings.edit'),
    async (req, res) => {
      const channelKey = String(req.params.key || '').trim();
      try {
        const result = await channelIntegrations.autoSyncChannel(channelKey, {
          userId: req.user.id,
          reason: 'manual-trigger'
        });
        if (result && result.skipped) {
          return res.redirect(`/admin?channel_notice=${encodeURIComponent(`skipped:${channelKey}`)}#channel-manager`);
        }
        const summary = result && result.summary ? result.summary : {};
        logActivity(req.user.id, 'channel.sync.manual', 'channel', channelKey, summary);
        const payload = `sync:${channelKey}:${summary.insertedCount || 0}:${summary.unmatchedCount || 0}:${summary.duplicateCount || 0}:${summary.conflictCount || 0}:${summary.errorCount || 0}`;
        res.redirect(`/admin?channel_notice=${encodeURIComponent(payload)}#channel-manager`);
      } catch (err) {
        console.warn('Falha ao sincronizar canal:', err.message);
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`error:${err.message}`)}#channel-manager`);
      }
    }
  );

  app.post(
    '/admin/channel-integrations/:key/test-connection',
    requireLogin,
    requirePermission('bookings.edit'),
    async (req, res) => {
      const channelKey = String(req.params.key || '').trim();
      try {
        if (!otaDispatcher || typeof otaDispatcher.testConnection !== 'function') {
          throw new Error('Dispatcher indisponível');
        }
        const result = await otaDispatcher.testConnection(channelKey);
        if (wantsJson(req)) {
          return res.json({ ok: true, result });
        }
        const payload = `test:${channelKey}:${result.ok ? 'ok' : 'fail'}`;
        res.redirect(`/admin?channel_notice=${encodeURIComponent(payload)}#channel-manager`);
      } catch (err) {
        console.warn('Teste de ligação OTA falhou:', err.message);
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`error:${err.message}`)}#channel-manager`);
      }
    }
  );

  app.post(
    '/admin/channel-sync/flush',
    requireLogin,
    requirePermission('bookings.edit'),
    async (req, res) => {
      try {
        if (!otaDispatcher || typeof otaDispatcher.flushQueue !== 'function') {
          throw new Error('Dispatcher indisponível');
        }
        if (typeof otaDispatcher.flushPendingDebounce === 'function') {
          otaDispatcher.flushPendingDebounce();
        }
        const limit = Number(req.body && req.body.limit);
        const result = await otaDispatcher.flushQueue({ limit: Number.isFinite(limit) && limit > 0 ? limit : undefined });
        if (wantsJson(req)) {
          return res.json({ ok: true, result });
        }
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`flush:${(result.processed || []).length}`)}#channel-manager`);
      } catch (err) {
        console.warn('Flush OTA falhou:', err.message);
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`error:${err.message}`)}#channel-manager`);
      }
    }
  );

  app.post(
    '/admin/channel-imports/upload',
    requireLogin,
    requirePermission('bookings.edit'),
    uploadChannelFile.single('file'),
    async (req, res) => {
      const channelKey = String(req.body.channel_key || '').trim();
      if (!channelKey) {
        return res.status(400).send('Canal obrigatório.');
      }
      if (!req.file) {
        return res.status(400).send('Ficheiro obrigatório.');
      }
      try {
        const targetStatus = req.body.target_status === 'PENDING' ? 'PENDING' : 'CONFIRMED';
        const result = await channelIntegrations.importFromFile({
          channelKey,
          filePath: req.file.path,
          originalName: req.file.originalname,
          uploadedBy: req.user.id,
          targetStatus
        });
        const summary = result && result.summary ? result.summary : {};
        logActivity(req.user.id, 'channel.import.manual', 'channel', channelKey, summary);
        const payload = `imported:${summary.insertedCount || 0}:${summary.unmatchedCount || 0}:${summary.duplicateCount || 0}:${summary.conflictCount || 0}:${summary.errorCount || 0}`;
        res.redirect(`/admin?channel_notice=${encodeURIComponent(payload)}#channel-manager`);
      } catch (err) {
        console.warn('Falha ao importar reservas do canal:', err.message);
        res.redirect(`/admin?channel_notice=${encodeURIComponent(`error:${err.message}`)}#channel-manager`);
      }
    }
  );

  app.post('/admin/emails/templates/:key', requireLogin, requirePermission('bookings.edit'), (req, res) => {
    const key = String(req.params.key || '').trim();
    try {
      const updated = emailTemplates.updateTemplate(key, { subject: req.body.subject, body: req.body.body }, req.user.id);
      logActivity(req.user.id, 'email_template.update', 'email_template', updated && updated.id ? updated.id : null, {
        key,
        subject: updated ? updated.subject : req.body.subject
      });
      res.redirect('/admin#emails');
    } catch (err) {
      console.warn('Falha ao atualizar modelo de email:', err.message);
      res.status(400).send(err.message);
    }
  });

  app.post('/admin/messages/templates/:key/:language', requireLogin, requirePermission('bookings.edit'), (req, res) => {
    const key = String(req.params.key || '').trim();
    const language = String(req.params.language || '').trim();
    try {
      const updated = messageTemplates.updateTemplate(key, language, { body: req.body.body }, req.user.id);
      logActivity(req.user.id, 'message_template.update', 'message_template', null, {
        key,
        language,
        preview: updated ? updated.body.slice(0, 80) : null
      });
      res.redirect('/admin#messages');
    } catch (err) {
      console.warn('Falha ao atualizar modelo de mensagem:', err.message);
      res.status(400).send(err.message);
    }
  });

app.post('/admin/properties/create', requireLogin, requirePermission('properties.manage'), async (req, res) => {
  const { name, locality, district, address, description } = req.body;
  const trimmedLocality = String(locality || '').trim();
  const trimmedDistrict = String(district || '').trim();
  const trimmedAddress = String(address || '').trim();
  if (!trimmedAddress) return res.status(400).send('Morada obrigatória');
  const locationLabel = [trimmedLocality, trimmedDistrict].filter(Boolean).join(', ');
  let latitude = null;
  let longitude = null;

  try {
    const queryParts = [trimmedAddress, trimmedLocality, trimmedDistrict, 'Portugal'].filter(Boolean);
    if (queryParts.length) {
      const coords = await geocodeAddress(queryParts.join(', '));
      if (coords) {
        latitude = coords.latitude != null ? coords.latitude : null;
        longitude = coords.longitude != null ? coords.longitude : null;
      }
    }
  } catch (err) {
    console.warn('Falha ao geocodificar nova propriedade:', err.message);
  }

  db.prepare(
    'INSERT INTO properties(name, location, locality, district, address, description, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    name,
    locationLabel,
    trimmedLocality || null,
    trimmedDistrict || null,
    trimmedAddress,
    description ? String(description) : null,
    latitude,
    longitude
  );
  res.redirect('/admin');
});

app.post(
  '/admin/properties/:id/delete',
  requireLogin,
  requireScope('properties', 'manage', req => req.params.id),
  (req, res) => {
    const id = req.params.id;
    const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
    if (!property) return res.status(404).send('Propriedade não encontrada');
    db.prepare('DELETE FROM properties WHERE id = ?').run(id);
    res.redirect('/admin');
  }
);

app.get(
  '/admin/properties/:id',
  requireLogin,
  requireScope('properties', 'manage', req => req.params.id),
  (req, res) => {
    const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).send('Propriedade não encontrada');

  const addressDisplay = typeof p.address === 'string' ? p.address.trim() : '';
  const locationDisplay = propertyLocationLabel(p);
  const addressInfo = addressDisplay ? `Morada atual: ${addressDisplay}` : 'Sem morada registada.';
  const locationInfo = locationDisplay ? `Localidade atual: ${locationDisplay}` : 'Sem localidade registada.';

  const units = db.prepare('SELECT * FROM units WHERE property_id = ? ORDER BY name').all(p.id);
  const unitsListHtml = units.length
    ? units
        .map(u => {
          const priceLabel = `€ ${eur(u.base_price_cents)}`;
          return `
            <li class="border-b border-slate-200 last:border-0 pb-2">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div class="font-medium text-slate-700">
                  <a class="text-slate-700 underline" href="/admin/units/${u.id}">${esc(u.name)}</a>
                  <span class="text-xs text-slate-500 ml-2">cap ${u.capacity}</span>
                </div>
                <div class="text-xs text-slate-500">${esc(priceLabel)}</div>
              </div>
            </li>`;
        })
        .join('')
    : '<li class="text-sm text-slate-500">Sem unidades</li>';
  const bookings = db.prepare(
    `SELECT b.*, u.name as unit_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
      WHERE u.property_id = ?
      ORDER BY b.checkin`
  ).all(p.id);

  const theme = resolveBrandingForRequest(req, { propertyId: p.id, propertyName: p.name });
  rememberActiveBrandingProperty(res, p.id);

    res.send(
      layout({
        title: p.name,
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        body: html`
      ${renderBreadcrumbs([
        { label: 'Backoffice', href: '/admin' },
        { label: 'Propriedades', href: '/admin#overview' },
        { label: p.name }
      ])}
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 class="text-2xl font-semibold">${esc(p.name)}</h1>
            ${addressDisplay
              ? `<p class="text-slate-600 mt-1">${esc(addressDisplay)}</p>`
              : '<p class="text-slate-400 mt-1">Morada não definida</p>'}
            ${locationDisplay ? `<p class="text-slate-500 mt-1">${esc(locationDisplay)}</p>` : ''}
            ${p.description ? `<p class="text-sm text-slate-500 mt-2 whitespace-pre-line">${esc(p.description)}</p>` : ''}
          </div>
          <form method="post" action="/admin/properties/${p.id}/delete" class="shrink-0" onsubmit="return confirm('Tem a certeza que quer eliminar esta propriedade? Isto remove unidades e reservas associadas.');">
            <button type="submit" class="text-rose-600 hover:text-rose-800 underline">Eliminar propriedade</button>
          </form>
        </div>

        <section class="card p-4 grid gap-3">
          <h2 class="text-lg font-semibold text-slate-800">Editar alojamento</h2>
          <form method="post" action="/admin/properties/${p.id}/update" class="grid gap-3 md:grid-cols-2">
            <label class="grid gap-1 text-sm text-slate-600 md:col-span-2">
              <span>Nome</span>
              <input required name="name" class="input" value="${esc(p.name)}" />
            </label>
            <label class="grid gap-1 text-sm text-slate-600 md:col-span-2">
              <span>Morada completa</span>
              <input required name="address" class="input" value="${esc(addressDisplay)}" placeholder="Rua, número, código postal" />
            </label>
            <label class="grid gap-1 text-sm text-slate-600">
              <span>Localidade</span>
              <input required name="locality" class="input" value="${esc(p.locality || '')}" placeholder="Ex.: Lagos" />
            </label>
            <label class="grid gap-1 text-sm text-slate-600">
              <span>Distrito</span>
              <input required name="district" class="input" value="${esc(p.district || '')}" placeholder="Ex.: Faro" />
            </label>
            <label class="grid gap-1 text-sm text-slate-600 md:col-span-2">
              <span>Descrição</span>
              <textarea name="description" class="input" rows="3" placeholder="Notas internas ou destaques">${esc(p.description || '')}</textarea>
            </label>
            <p class="text-xs text-slate-500 md:col-span-2">A morada completa fica disponível para a equipa assim que guardar as alterações.</p>
            <div class="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="text-xs text-slate-500 leading-relaxed">
                ${esc(addressInfo)}
                ${locationInfo ? `<br/><span>${esc(locationInfo)}</span>` : ''}
              </div>
              <button class="btn btn-primary w-full sm:w-auto">Guardar alterações</button>
            </div>
          </form>
        </section>

        <section id="property-units" class="card p-4">
          <h2 class="font-semibold mb-2">Unidades</h2>
          <ul class="space-y-2">${unitsListHtml}</ul>
        </section>

        <section class="card p-4">
          <h2 class="font-semibold mb-2">Reservas</h2>
          <ul class="space-y-1">
            ${bookings.length
              ? bookings
                  .map(b => `
                    <li>${esc(b.unit_name)}: ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')} · ${esc(b.guest_name)} (${b.adults}A+${b.children}C)</li>
                  `)
                  .join('')
              : '<li class="text-sm text-slate-500">Sem reservas</li>'}
          </ul>
        </section>
      </div>
        `
      })
    );
  }
);

app.post(
  '/admin/properties/:id/update',
  requireLogin,
  requireScope('properties', 'manage', req => req.params.id),
  async (req, res) => {
    const propertyId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
    if (!existing) return res.status(404).send('Propriedade não encontrada');

  const { name, locality, district, address, description } = req.body;
  const trimmedLocality = String(locality || '').trim();
  const trimmedDistrict = String(district || '').trim();
  const trimmedAddress = String(address || '').trim();
  if (!trimmedAddress) return res.status(400).send('Morada obrigatória');
  const locationLabel = [trimmedLocality, trimmedDistrict].filter(Boolean).join(', ');

  let latitude = existing.latitude != null ? Number.parseFloat(existing.latitude) : null;
  let longitude = existing.longitude != null ? Number.parseFloat(existing.longitude) : null;
  const addressChanged = trimmedAddress !== String(existing.address || '').trim();
  const localityChanged = trimmedLocality !== String(existing.locality || '').trim();
  const districtChanged = trimmedDistrict !== String(existing.district || '').trim();
  const hasValidCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (addressChanged || localityChanged || districtChanged || !hasValidCoords) {
    try {
      const queryParts = [trimmedAddress, trimmedLocality, trimmedDistrict, 'Portugal'].filter(Boolean);
      if (queryParts.length) {
        const coords = await geocodeAddress(queryParts.join(', '));
        if (coords) {
          latitude = coords.latitude != null ? coords.latitude : null;
          longitude = coords.longitude != null ? coords.longitude : null;
        }
      }
    } catch (err) {
      console.warn(`Falha ao geocodificar propriedade #${propertyId}:`, err.message);
    }
  }

  const finalLatitude = Number.isFinite(latitude) ? latitude : null;
  const finalLongitude = Number.isFinite(longitude) ? longitude : null;

    db.prepare(
      'UPDATE properties SET name = ?, location = ?, locality = ?, district = ?, address = ?, description = ?, latitude = ?, longitude = ? WHERE id = ?'
    ).run(
      name,
      locationLabel,
      trimmedLocality || null,
      trimmedDistrict || null,
      trimmedAddress,
      description ? String(description) : null,
      finalLatitude,
      finalLongitude,
      propertyId
    );

    res.redirect(`/admin/properties/${propertyId}`);
  }
);

app.post(
  '/admin/units/create',
  requireLogin,
  requireScope('properties', 'manage', req => {
    const raw = req.body ? req.body.property_id : null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }),
  (req, res) => {
  let { property_id, name, capacity, base_price_eur, features_raw } = req.body;
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(property_id);
  if (!property) return res.status(400).send('Propriedade inválida');

  const cents = Math.round(parseFloat(String(base_price_eur || '0').replace(',', '.')) * 100);
  const features = parseFeaturesInput(features_raw);

  db.prepare(
    'INSERT INTO units(property_id, name, capacity, base_price_cents, features, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    property_id,
    name,
    Number(capacity),
    cents,
    JSON.stringify(features),
    null,
    null,
    null
  );
  res.redirect('/admin');
}
);

app.get(
  '/admin/units/:id',
  requireLogin,
  requireScope('properties', 'manage', req => {
    const unitId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(unitId)) return null;
    const row = selectUnitPropertyIdStmt.get(unitId);
    return row ? row.property_id : null;
  }),
  (req, res) => {
  const u = db.prepare(
    `SELECT u.*, p.name as property_name, p.locality as property_locality, p.district as property_district, p.address as property_address
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.id = ?`
  ).get(req.params.id);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (!userHasScope(req.user, 'properties.manage', u.property_id)) {
    return res.status(403).send('Sem permissão para esta unidade.');
  }

  const unitFeatures = parseFeaturesStored(u.features);
  const unitFeaturesTextarea = esc(featuresToTextarea(unitFeatures));
  const propertyLocation = propertyLocationLabel({ locality: u.property_locality, district: u.property_district, location: null });
  const propertyAddress = typeof u.property_address === 'string' ? u.property_address.trim() : '';
  const unitFeaturesPreview = featureChipsHtml(unitFeatures, {
    className: 'flex flex-wrap gap-2 text-xs text-slate-600 mb-3',
    badgeClass: 'inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2 py-1 rounded-full',
    iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
  });
  const bookings = db.prepare('SELECT * FROM bookings WHERE unit_id = ? ORDER BY checkin').all(u.id);
  const legacyBlocks = db.prepare('SELECT * FROM blocks WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const modernBlocks = db
    .prepare(
      `SELECT id, start_date, end_date, reason
         FROM unit_blocks
        WHERE unit_id = ?
          AND (lock_type IS NULL OR lock_type <> 'HARD_LOCK')
        ORDER BY start_date`
    )
    .all(u.id);
  const blockEntries = modernBlocks
    .map(block => {
      const startDate = dayjs(block.start_date);
      const endDate = dayjs(block.end_date);
      return {
        id: block.id,
        start: block.start_date,
        endExclusive: block.end_date,
        startLabel: startDate.isValid() ? startDate.format('DD/MM/YYYY') : block.start_date,
        endLabel: endDate.isValid()
          ? endDate.subtract(1, 'day').format('DD/MM/YYYY')
          : block.end_date,
        reason: block.reason || '',
        source: 'modern'
      };
    })
    .concat(
      legacyBlocks.map(block => {
        const startDate = dayjs(block.start_date);
        const endDate = dayjs(block.end_date);
        return {
          id: block.id,
          start: block.start_date,
          endExclusive: endDate.isValid()
            ? endDate.add(1, 'day').format('YYYY-MM-DD')
            : block.end_date,
          startLabel: startDate.isValid() ? startDate.format('DD/MM/YYYY') : block.start_date,
          endLabel: endDate.isValid() ? endDate.format('DD/MM/YYYY') : block.end_date,
          reason: '',
          source: 'legacy'
        };
      })
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const rates = db.prepare('SELECT * FROM rates WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const images = db.prepare(
    'SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id'
  ).all(u.id);

  const theme = resolveBrandingForRequest(req, { propertyId: u.property_id, propertyName: u.property_name });
  rememberActiveBrandingProperty(res, u.property_id);

  const enableUnitCardModal = isFlagEnabled('FEATURE_CALENDAR_UNIT_CARD_MODAL');
  const unitCardButton = enableUnitCardModal
    ? `<button type="button" class="btn btn-light" data-unit-card-trigger data-unit-card-title="Cartão da unidade" data-unit-card-loading="A preparar o cartão da unidade..." data-unit-id="${u.id}" data-unit-card-name="${esc(u.name)}" data-unit-card-fetch="/calendar/unit/${u.id}/card">Cartão da unidade</button>`
    : '';
  const unitCardModalShell = enableUnitCardModal
    ? html`${renderModalShell({
        id: 'unit-card-modal',
        title: 'Cartão da unidade',
        body: '<div class="bo-modal__placeholder">A carregar cartão da unidade…</div>',
        extraRootAttr: 'data-unit-card-modal'
      })}`
    : '';
  const unitCardScriptTag = enableUnitCardModal ? html`<script src="/public/js/card-modal.js"></script>` : '';

  serverRender('route:/admin/units/:id');
  res.send(layout({
    title: `${esc(u.property_name)} – ${esc(u.name)}`,
    user: req.user,
    activeNav: 'backoffice',
    branding: theme,
    body: html`
      ${renderBreadcrumbs([
        { label: 'Backoffice', href: '/admin' },
        { label: 'Propriedades', href: '/admin#overview' },
        { label: u.property_name, href: `/admin/properties/${u.property_id}` },
        { label: 'Unidades', href: `/admin/properties/${u.property_id}#property-units` },
        { label: u.name }
      ])}
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <h1 class="text-2xl font-semibold">${esc(u.property_name)} - ${esc(u.name)}</h1>
        ${unitCardButton ? `<div class="flex items-center justify-end">${unitCardButton}</div>` : ''}
      </div>
      <div class="text-sm text-slate-500 mb-4 leading-relaxed">
        ${propertyAddress ? esc(propertyAddress) : 'Morada do alojamento não definida'}
        ${propertyLocation ? `<br/><span>${esc(`Localidade: ${propertyLocation}`)}</span>` : ''}
      </div>
      <p class="text-xs text-slate-500 mb-4">A morada e geolocalização são geridas na página do alojamento.</p>
      ${unitFeaturesPreview}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section class="card p-4 md:col-span-2">
          <h2 class="font-semibold mb-3">Reservas</h2>
          <ul class="space-y-1 mb-4">
            ${bookings.length ? bookings.map(b => `
              <li class="flex items-center justify-between gap-3" title="${esc(b.guest_name||'')}">
                <div>
                  ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}
                  - <strong>${esc(b.guest_name)}</strong> ${b.agency ? `[${esc(b.agency)}]` : ''} (${b.adults}A+${b.children}C)
                  <span class="text-slate-500">(&euro; ${eur(b.total_cents)})</span>
                  <span class="ml-2 text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                    ${b.status}
                  </span>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <a class="text-slate-600 hover:text-slate-900 underline" href="/admin/bookings/${b.id}">Editar</a>
                  <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                    <button class="text-rose-600">Cancelar</button>
                  </form>
                </div>
              </li>
            `).join('') : '<em>Sem reservas</em>'}
          </ul>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form method="post" action="/admin/units/${u.id}/block" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Bloquear datas</div>
              <div class="flex gap-2">
                <input required type="date" name="start_date" class="input"/>
                <input required type="date" name="end_date" class="input"/>
              </div>
              <button class="btn btn-primary">Bloquear</button>
            </form>

            <form method="post" action="/admin/units/${u.id}/rates/create" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Adicionar rate</div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">De</label>
                  <input required type="date" name="start_date" class="input"/>
                </div>
                <div>
                  <label class="text-sm">Até</label>
                  <input required type="date" name="end_date" class="input"/>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">€/noite</label>
                  <input required type="number" step="0.01" min="0" name="price_eur" class="input" placeholder="Preço €/noite"/>
                </div>
                <div>
                  <label class="text-sm">Mín. noites</label>
                  <input type="number" min="1" name="min_stay" class="input" placeholder="Mínimo de noites"/>
                </div>
              </div>
              <button class="btn btn-primary">Guardar rate</button>
              <p class="text-xs text-slate-500">
                <a class="text-slate-600 underline" href="/admin/rates/rules">Gerir regras automáticas de tarifas</a>
              </p>
            </form>
          </div>

          ${blockEntries.length ? `
            <div class="mt-6">
              <h3 class="font-semibold mb-2">Bloqueios ativos</h3>
              <ul class="space-y-2">
                ${blockEntries.map(block => `
                  <li class="flex items-center justify-between text-sm">
                    <span>
                      ${esc(block.startLabel)} &rarr; ${esc(block.endLabel)}
                      ${block.reason
                        ? `<span class="ml-2 text-xs text-slate-500" title="${esc(block.reason)}">${esc(block.reason)}</span>`
                        : ''}
                    </span>
                    <form method="post" action="${
                      block.source === 'modern'
                        ? `/admin/unit-blocks/${block.id}/delete`
                        : `/admin/blocks/${block.id}/delete`
                    }" onsubmit="return confirm('Desbloquear estas datas?');">
                      <button class="text-rose-600">Desbloquear</button>
                    </form>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </section>

        <section class="card p-4">
          <h2 class="font-semibold mb-3">Editar Unidade</h2>
          <form method="post" action="/admin/units/${u.id}/update" class="grid gap-2">
            <label class="text-sm">Nome</label>
            <input name="name" class="input" value="${esc(u.name)}"/>

            <label class="text-sm">Capacidade</label>
            <input type="number" min="1" name="capacity" class="input" value="${u.capacity}"/>

            <label class="text-sm">Preço base €/noite</label>
            <input type="number" step="0.01" name="base_price_eur" class="input" value="${eur(u.base_price_cents)}"/>

            ${renderFeatureBuilderField({
              name: 'features_raw',
              value: unitFeaturesTextarea,
              label: 'Características',
              helperText: 'Utiliza o seletor para atualizar as quantidades ou descrições das características desta unidade.'
            })}
            <div class="text-xs text-slate-500">Morada e localidade são configuradas na página do alojamento.</div>

            <button class="btn btn-primary">Guardar</button>
          </form>

          <h2 class="font-semibold mt-6 mb-2">Rates</h2>
          <div class="responsive-table">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th>De</th><th>Até</th><th>€/noite (weekday)</th><th>€/noite (weekend)</th><th>Mín</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${rates.map(r => `
                  <tr>
                    <td data-label="Início"><span class="table-cell-value">${dayjs(r.start_date).format('DD/MM/YYYY')}</span></td>
                    <td data-label="Fim"><span class="table-cell-value">${dayjs(r.end_date).format('DD/MM/YYYY')}</span></td>
                    <td data-label="€/noite (weekday)"><span class="table-cell-value">€ ${eur(r.weekday_price_cents)}</span></td>
                    <td data-label="€/noite (weekend)"><span class="table-cell-value">€ ${eur(r.weekend_price_cents)}</span></td>
                    <td data-label="Mín. noites"><span class="table-cell-value">${r.min_stay || 1}</span></td>
                    <td data-label="Ações">
                      <div class="table-cell-actions">
                        <form method="post" action="/admin/rates/${r.id}/delete" onsubmit="return confirm('Apagar rate?');">
                          <button class="text-rose-600">Apagar</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <h2 class="font-semibold mt-6 mb-2">Galeria</h2>
          <form method="post" action="/admin/units/${u.id}/images" enctype="multipart/form-data" class="grid gap-2 bg-slate-50 p-3 rounded">
            <input type="hidden" name="unit_id" value="${u.id}"/>
            <input type="file" name="images" class="input" accept="image/*" multiple required />
            <div class="text-xs text-slate-500">As imagens são comprimidas e redimensionadas automaticamente para otimizar o carregamento.</div>
            <button class="btn btn-primary">Carregar imagens</button>
          </form>
          <div class="mt-4 space-y-3" data-gallery-manager data-unit-id="${u.id}">
            <div class="gallery-flash" data-gallery-flash hidden></div>
            <div class="gallery-grid ${images.length ? '' : 'hidden'}" data-gallery-list>
              ${images.map(img => `
                <article class="gallery-tile${img.is_primary ? ' is-primary' : ''}" data-gallery-tile data-image-id="${img.id}" draggable="true" tabindex="0">
                  <span class="gallery-tile__badge">Principal</span>
                  <img src="/uploads/units/${u.id}/${encodeURIComponent(img.file)}" alt="${esc(img.alt||'')}" loading="lazy" class="gallery-tile__img"/>
                  <div class="gallery-tile__overlay">
                    <div class="gallery-tile__hint">Arraste para reordenar</div>
                    <div class="gallery-tile__meta">
                      <span>${dayjs(img.created_at).format('DD/MM/YYYY')}</span>
                    </div>
                    <div class="gallery-tile__actions">
                      <button type="button" class="btn btn-light" data-gallery-action="primary" ${img.is_primary ? 'disabled' : ''}>${img.is_primary ? 'Em destaque' : 'Tornar destaque'}</button>
                      <button type="button" class="btn btn-danger" data-gallery-action="delete">Remover</button>
                    </div>
                  </div>
                </article>
              `).join('')}
            </div>
            <div class="gallery-empty ${images.length ? 'hidden' : ''}" data-gallery-empty>
              <p class="text-sm text-slate-500">Ainda não existem imagens carregadas para esta unidade.</p>
            </div>
          </div>
        </section>
      </div>

      <script>${featureBuilderScript}</script>
      <script>${galleryManagerScript}</script>
      ${unitCardModalShell}
      ${unitCardScriptTag}

    `
  }));
});

app.post(
  '/admin/units/:id/update',
  requireLogin,
  requireScope('properties', 'manage', req => {
    const unitId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(unitId)) return null;
    const row = selectUnitPropertyIdStmt.get(unitId);
    return row ? row.property_id : null;
  }),
  (req, res) => {
  const unitId = Number(req.params.id);
  const existing = db.prepare('SELECT id, property_id FROM units WHERE id = ?').get(unitId);
  if (!existing) return res.status(404).send('Unidade não encontrada');
  if (!userHasScope(req.user, 'properties.manage', existing.property_id)) {
    return res.status(403).send('Sem permissão para esta unidade.');
  }

  const { name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur || '0').replace(',', '.')) * 100);
  const features = parseFeaturesInput(features_raw);

  db.prepare(
    'UPDATE units SET name = ?, capacity = ?, base_price_cents = ?, features = ?, address = NULL, latitude = NULL, longitude = NULL WHERE id = ?'
  ).run(
    name,
    Number(capacity),
    cents,
    JSON.stringify(features),
    unitId
  );
  res.redirect(`/admin/units/${unitId}`);
}
);

app.post(
  '/admin/units/:id/delete',
  requireLogin,
  requireScope('properties', 'manage', req => {
    const unitId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(unitId)) return null;
    const row = selectUnitPropertyIdStmt.get(unitId);
    return row ? row.property_id : null;
  }),
  (req, res) => {
    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
    res.redirect('/admin');
  }
);

app.post('/admin/units/:id/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
  const { start_date, end_date } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');

  const conflicts = db.prepare(
    `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
      AND NOT (checkout <= ? OR checkin >= ?)`
  ).all(req.params.id, start_date, end_date);
  if (conflicts.length)
    return res.status(409).send('As datas incluem reservas existentes');

  const inserted = insertBlockStmt.run(req.params.id, start_date, end_date);
  logChange(req.user.id, 'block', inserted.lastInsertRowid, 'create', null, { start_date, end_date, unit_id: Number(req.params.id) });
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/blocks/:blockId/delete', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
  const block = db.prepare('SELECT unit_id, start_date, end_date FROM blocks WHERE id = ?').get(req.params.blockId);
  if (!block) return res.status(404).send('Bloqueio não encontrado');
  db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.blockId);
  logChange(req.user.id, 'block', Number(req.params.blockId), 'delete', {
    unit_id: block.unit_id,
    start_date: block.start_date,
    end_date: block.end_date
  }, null);
  res.redirect(`/admin/units/${block.unit_id}`);
});

app.post('/admin/unit-blocks/:blockId/delete', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
  const blockId = Number(req.params.blockId);
  const block = db
    .prepare('SELECT id, unit_id, start_date, end_date, reason, lock_type FROM unit_blocks WHERE id = ?')
    .get(blockId);
  if (!block) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Bloqueio não encontrado.' });
    return res.status(404).send('Bloqueio não encontrado');
  }
  if (block.lock_type === 'HARD_LOCK') {
    if (wantsJson(req)) return res.status(409).json({ ok: false, message: 'Bloqueio protegido pelo sistema.' });
    return res.status(409).send('Bloqueio protegido pelo sistema.');
  }
  db.prepare('DELETE FROM unit_blocks WHERE id = ?').run(blockId);
  if (req.user && req.user.id) {
    logActivity(req.user.id, 'unit_block_deleted', 'unit', block.unit_id, {
      blockId,
      start: block.start_date,
      end: block.end_date,
      hadReason: !!(block.reason && String(block.reason).trim())
    });
  }
  if (wantsJson(req)) return res.json({ ok: true, unit_id: block.unit_id });
  res.redirect(`/admin/units/${block.unit_id}`);
});

// Imagens
app.post('/admin/units/:id/images', requireLogin, requirePermission('gallery.manage'), upload.array('images', 24), async (req, res) => {
  const unitId = Number(req.params.id);
  const files = req.files || [];
  if (!files.length) {
    if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Nenhum ficheiro recebido.' });
    return res.redirect(`/admin/units/${unitId}`);
  }

  const insert = db.prepare('INSERT INTO unit_images(unit_id,file,alt,position) VALUES (?,?,?,?)');
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) as p FROM unit_images WHERE unit_id = ?').get(unitId).p;
  const existingPrimary = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);
  const insertedIds = [];

  try {
    for (const file of files) {
      const filePath = path.join(UPLOAD_UNITS, String(unitId), file.filename);
      await compressImage(filePath);
      const inserted = insert.run(unitId, file.filename, null, ++pos);
      insertedIds.push(inserted.lastInsertRowid);
    }

    if (!existingPrimary && insertedIds.length) {
      const primaryId = insertedIds[0];
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        primaryId,
        unitId
      );
    }

    if (wantsJson(req)) {
      const rows = db
        .prepare('SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id')
        .all(unitId);
      return res.json({ ok: true, images: rows, primaryId: rows.find(img => img.is_primary)?.id || null });
    }

    res.redirect(`/admin/units/${unitId}`);
  } catch (err) {
    console.error('Falha ao processar upload de imagens', err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: 'Não foi possível guardar as imagens. Tente novamente.' });
    }
    res.status(500).send('Não foi possível guardar as imagens.');
  }
});

app.post('/admin/images/:imageId/delete', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  const filePath = path.join(UPLOAD_UNITS, String(img.unit_id), img.file);
  db.prepare('DELETE FROM unit_images WHERE id = ?').run(img.id);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) { console.warn('Não foi possível remover ficheiro físico', err.message); }
  }

  let nextPrimaryId = null;
  if (img.is_primary) {
    const fallback = db
      .prepare(
        'SELECT id FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 1'
      )
      .get(img.unit_id);
    if (fallback) {
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        fallback.id,
        img.unit_id
      );
      nextPrimaryId = fallback.id;
    }
  }

  if (wantsJson(req)) {
    return res.json({ ok: true, message: 'Imagem removida.', primaryId: nextPrimaryId });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/images/:imageId/primary', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
    img.id,
    img.unit_id
  );

  if (wantsJson(req)) {
    return res.json({ ok: true, primaryId: img.id, message: 'Imagem definida como destaque.' });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/units/:id/images/reorder', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const unitId = Number(req.params.id);
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const ids = order
    .map(item => ({ id: Number(item.id), position: Number(item.position) }))
    .filter(item => item.id && item.position);

  if (!ids.length) {
    return res.json({ ok: true, message: 'Nada para atualizar.', primaryId: null });
  }

  const existingIds = new Set(
    db
      .prepare('SELECT id FROM unit_images WHERE unit_id = ?')
      .all(unitId)
      .map(row => row.id)
  );

  const updates = ids.filter(item => existingIds.has(item.id));
  const updateStmt = db.prepare('UPDATE unit_images SET position = ? WHERE id = ? AND unit_id = ?');
  const runUpdates = db.transaction(items => {
    items.forEach(item => {
      updateStmt.run(item.position, item.id, unitId);
    });
  });

  runUpdates(updates);

  const primaryRow = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);

  res.json({ ok: true, message: 'Ordem atualizada.', primaryId: primaryRow ? primaryRow.id : null });
});

// ===================== Booking Management (Admin) =====================
app.get('/admin/pagamentos', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const provider = String(req.query.provider || '').trim();
  const status = normalizePaymentStatus(req.query.status || '');
  const reconciliation = normalizeReconciliationStatus(req.query.reconciliation || '');
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];

  if (provider) {
    where.push('LOWER(p.provider) = ?');
    params.push(provider.toLowerCase());
  }
  if (status) {
    where.push('LOWER(p.status) = ?');
    params.push(status);
  }
  if (reconciliation) {
    where.push('LOWER(p.reconciliation_status) = ?');
    params.push(reconciliation);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      p.id LIKE ? OR
      p.provider_payment_id LIKE ? OR
      CAST(p.booking_id AS TEXT) LIKE ? OR
      COALESCE(b.guest_name, '') LIKE ? OR
      COALESCE(b.guest_email, '') LIKE ? OR
      COALESCE(p.customer_email, '') LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }

  const paymentsSql = `
    SELECT p.id, p.booking_id, p.provider, p.provider_payment_id, p.intent_type,
           p.status, p.amount_cents, p.currency, p.customer_email, p.metadata,
           p.reconciliation_status, p.captured_at, p.cancelled_at, p.created_at,
           p.updated_at, p.last_error, p.next_action_json,
           b.guest_name, b.guest_email, b.status AS booking_status, b.checkin,
           b.checkout, b.total_cents AS booking_total_cents, b.agency,
           u.name AS unit_name, prop.name AS property_name
      FROM payments p
      LEFT JOIN bookings b ON b.id = p.booking_id
      LEFT JOIN units u ON u.id = b.unit_id
      LEFT JOIN properties prop ON prop.id = u.property_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.created_at DESC
      LIMIT 500
  `;
  const paymentRows = db.prepare(paymentsSql).all(...params);
  const paymentIds = paymentRows.map(row => row.id);

  let refundRows = [];
  if (paymentIds.length) {
    const placeholders = paymentIds.map(() => '?').join(',');
    const refundsSql = `
      SELECT r.*
        FROM refunds r
       WHERE r.payment_id IN (${placeholders})
       ORDER BY r.created_at ASC
    `;
    refundRows = db.prepare(refundsSql).all(...paymentIds);
  }

  const { bookingSummaries, paymentSummaries, refundIndex } = aggregatePaymentData({
    payments: paymentRows,
    refunds: refundRows
  });

  const providerOptions = db
    .prepare('SELECT DISTINCT provider FROM payments ORDER BY provider')
    .all()
    .map(row => row.provider)
    .filter(Boolean);
  const statusOptions = db
    .prepare('SELECT DISTINCT status FROM payments ORDER BY status')
    .all()
    .map(row => normalizePaymentStatus(row.status))
    .filter(Boolean);
  const reconciliationOptions = db
    .prepare('SELECT DISTINCT reconciliation_status FROM payments ORDER BY reconciliation_status')
    .all()
    .map(row => normalizeReconciliationStatus(row.reconciliation_status))
    .filter(Boolean);

  const uniqueStatusOptions = Array.from(new Set(statusOptions)).sort();
  const uniqueReconciliationOptions = Array.from(new Set(reconciliationOptions)).sort();
  providerOptions.sort((a, b) => a.localeCompare(b));

  let totalCapturedCents = 0;
  let totalRefundedCents = 0;
  let totalPendingCents = 0;
  let totalActionCents = 0;
  let totalFailedCents = 0;

  const reconciliationLabels = {
    pending: 'Pendente',
    matched: 'Conciliado',
    failed: 'Falhou',
    manual: 'Manual'
  };

  const reconciliationTones = {
    matched: 'success',
    failed: 'danger',
    manual: 'info',
    pending: 'warning'
  };

  const payments = paymentRows.map(row => {
    const paymentSummary = paymentSummaries.get(row.id) || {
      capturedCents: 0,
      refundedCents: 0,
      pendingCents: 0,
      actionCents: 0,
      failedCents: 0,
      cancelledCents: 0,
      netCapturedCents: 0
    };

    totalCapturedCents += paymentSummary.capturedCents;
    totalRefundedCents += paymentSummary.refundedCents;
    totalPendingCents += paymentSummary.pendingCents;
    totalActionCents += paymentSummary.actionCents;
    totalFailedCents += paymentSummary.failedCents;

    const statusInfo = describePaymentStatus(row.status);
    const statusBadge = statusToneToBadgeClass(statusInfo.tone);
    const reconciliationStatus = normalizeReconciliationStatus(row.reconciliation_status || 'pending') || 'pending';
    const reconciliationBadge = statusToneToBadgeClass(
      reconciliationTones[reconciliationStatus] || 'warning'
    );

    const bookingSummary = row.booking_id ? bookingSummaries.get(row.booking_id) : null;
    const outstandingCents = bookingSummary
      ? computeOutstandingCents(bookingSummary, row.booking_total_cents)
      : 0;

    const refundsForPayment = refundIndex.get(row.id) || [];

    return {
      row,
      statusInfo,
      statusBadge,
      reconciliationStatus,
      reconciliationBadge,
      paymentSummary,
      outstandingCents,
      refunds: refundsForPayment
    };
  });

  const netCapturedCents = Math.max(totalCapturedCents - totalRefundedCents, 0);

  const formatCurrency = (value) => `€ ${eur(value)}`;

  const pageTitle = 'Pagamentos';
  res.send(layout({
    title: pageTitle,
    user: req.user,
    activeNav: 'backoffice',
    branding: resolveBrandingForRequest(req),
    body: html`
      <h1 class="text-2xl font-semibold mb-4">${pageTitle}</h1>

      <div class="card p-4 mb-4">
        <div class="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <div class="text-xs uppercase tracking-wide text-slate-500">Cobrado</div>
            <div class="text-lg font-semibold text-slate-800">${formatCurrency(totalCapturedCents)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-slate-500">Reembolsado</div>
            <div class="text-lg font-semibold text-slate-800">${formatCurrency(totalRefundedCents)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-slate-500">Líquido</div>
            <div class="text-lg font-semibold text-emerald-700">${formatCurrency(netCapturedCents)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-slate-500">Pendente</div>
            <div class="text-lg font-semibold text-amber-700">${formatCurrency(totalPendingCents)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-slate-500">Ação necessária</div>
            <div class="text-lg font-semibold text-sky-700">${formatCurrency(totalActionCents)}</div>
          </div>
        </div>
      </div>

      <form method="get" class="card p-4 grid gap-3 md:grid-cols-5 mb-4">
        <input class="input md:col-span-2" name="q" placeholder="Pesquisar por ID, reserva ou hóspede" value="${esc(q)}" />
        <select class="input" name="status">
          <option value="">Todos os estados</option>
          ${uniqueStatusOptions
            .map(value => {
              const optionLabel = describePaymentStatus(value).label;
              const selected = value === status ? 'selected' : '';
              return `<option value="${esc(value)}" ${selected}>${esc(optionLabel)} (${esc(value)})</option>`;
            })
            .join('')}
        </select>
        <select class="input" name="reconciliation">
          <option value="">Todos os estados de conciliação</option>
          ${uniqueReconciliationOptions
            .map(value => {
              const label = reconciliationLabels[value] || value || 'Pendente';
              const selected = value === reconciliation ? 'selected' : '';
              return `<option value="${esc(value)}" ${selected}>${esc(label)}</option>`;
            })
            .join('')}
        </select>
        <select class="input" name="provider">
          <option value="">Todos os métodos</option>
          ${providerOptions
            .map(value => {
              const selected = value && value.toLowerCase() === provider.toLowerCase() ? 'selected' : '';
              return `<option value="${esc(value)}" ${selected}>${esc(value)}</option>`;
            })
            .join('')}
        </select>
        <button class="btn btn-primary">Filtrar</button>
      </form>

      <div class="card p-0">
        <div class="responsive-table">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Data</th>
                <th>Reserva</th>
                <th>Hóspede</th>
                <th>Método</th>
                <th>Intento</th>
                <th>Montante</th>
                <th>Estado</th>
                <th>Conciliação</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              ${payments
                .map(({ row, statusInfo, statusBadge, reconciliationStatus, reconciliationBadge, paymentSummary, outstandingCents, refunds }) => {
                  const bookingLink = row.booking_id
                    ? `<a class="underline" href="/admin/bookings/${row.booking_id}">Reserva #${row.booking_id}</a>`
                    : '<span class="table-cell-muted">Sem reserva</span>';
                  const bookingMeta = row.property_name
                    ? `<span class="table-cell-muted">${esc(row.property_name)}${row.unit_name ? ' · ' + esc(row.unit_name) : ''}</span>`
                    : '';
                  const guestInfo = row.guest_name || row.customer_email
                    ? `<span class="table-cell-value">${esc(row.guest_name || row.customer_email || '-')}</span>`
                    : '<span class="table-cell-muted">—</span>';
                  const guestContact = row.guest_email
                    ? `<span class="table-cell-muted">${esc(row.guest_email)}</span>`
                    : row.customer_email
                    ? `<span class="table-cell-muted">${esc(row.customer_email)}</span>`
                    : '';
                  const providerRef = row.provider_payment_id
                    ? `<span class="table-cell-muted">${esc(row.provider_payment_id)}</span>`
                    : '';
                  const intentLabel = row.intent_type === 'preauth' ? 'Pré-autorização' : 'Cobrança';
                  const refundsList = refunds.length
                    ? `<div class="mt-1 text-xs text-slate-500">${refunds
                        .map(ref => {
                          const successful = isSuccessfulRefundStatus(ref.status);
                          const label = successful ? 'Reembolso concluído' : `Reembolso ${esc(ref.status || '').toLowerCase()}`;
                          return `<div>${label}: € ${eur(ref.amount_cents)}</div>`;
                        })
                        .join('')}</div>`
                    : '';

                  const lastError = row.last_error ? safeJsonParse(row.last_error) : null;
                  const errorBlock = lastError && lastError.message
                    ? `<div class="mt-1 text-xs text-rose-600">Erro: ${esc(lastError.message)}</div>`
                    : '';

                  const pendingDetails = [];
                  if (paymentSummary.pendingCents > 0) {
                    pendingDetails.push(`Pendente: € ${eur(paymentSummary.pendingCents)}`);
                  }
                  if (paymentSummary.actionCents > 0) {
                    pendingDetails.push(`Ação necessária: € ${eur(paymentSummary.actionCents)}`);
                  }
                  if (paymentSummary.failedCents > 0) {
                    pendingDetails.push(`Falhou: € ${eur(paymentSummary.failedCents)}`);
                  }
                  if (paymentSummary.cancelledCents > 0) {
                    pendingDetails.push(`Cancelado: € ${eur(paymentSummary.cancelledCents)}`);
                  }
                  const pendingBlock = pendingDetails.length
                    ? `<div class="mt-1 text-xs text-slate-500">${pendingDetails.join(' · ')}</div>`
                    : '';

                  const outstandingBlock = row.booking_id
                    ? `<div class="mt-1 text-xs ${outstandingCents > 0 ? 'text-amber-700' : 'text-emerald-700'}">Saldo reserva: € ${eur(outstandingCents)}</div>`
                    : '';

                  return `
                    <tr>
                      <td data-label="Data"><span class="table-cell-value">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</span></td>
                      <td data-label="Reserva">
                        <div class="table-cell-value">${bookingLink}</div>
                        ${bookingMeta}
                      </td>
                      <td data-label="Hóspede">
                        ${guestInfo}
                        ${guestContact}
                      </td>
                      <td data-label="Método">
                        <span class="table-cell-value">${esc(row.provider)}</span>
                        ${providerRef}
                      </td>
                      <td data-label="Intento"><span class="table-cell-value">${intentLabel}</span></td>
                      <td data-label="Montante"><span class="table-cell-value">€ ${eur(row.amount_cents)}</span></td>
                      <td data-label="Estado">
                        <span class="inline-flex items-center text-xs font-semibold rounded px-2 py-0.5 ${statusBadge}">
                          ${esc(statusInfo.label)}
                        </span>
                        <div class="mt-1 text-xs text-slate-500">Líquido: € ${eur(paymentSummary.netCapturedCents)}</div>
                        ${pendingBlock}
                        ${errorBlock}
                      </td>
                      <td data-label="Conciliação">
                        <span class="inline-flex items-center text-xs font-semibold rounded px-2 py-0.5 ${reconciliationBadge}">
                          ${esc(reconciliationLabels[reconciliationStatus] || reconciliationStatus)}
                        </span>
                        ${outstandingBlock}
                      </td>
                      <td data-label="Detalhes">
                        <div class="text-xs text-slate-500">
                          Capturado: € ${eur(paymentSummary.capturedCents)}<br />
                          Reembolsado: € ${eur(paymentSummary.refundedCents)}
                        </div>
                        ${refundsList}
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        ${payments.length === 0 ? '<div class="p-4 text-slate-500">Sem pagamentos registados.</div>' : ''}
      </div>
    `
  }));
});

app.get('/admin/identidade-visual', requireAdmin, (req, res) => {
  const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
  const propertyQuery = parsePropertyId(req.query ? (req.query.property_id ?? req.query.propertyId ?? null) : null);
  const propertyId = propertyQuery || null;
  const propertyRow = propertyId ? properties.find(p => p.id === propertyId) || null : null;
  const theme = resolveBrandingForRequest(req, { propertyId, propertyName: propertyRow ? propertyRow.name : null });
  if (propertyQuery !== null) rememberActiveBrandingProperty(res, propertyId);

  const store = cloneBrandingStoreState();
  const globalThemeRaw = store.global || {};
  const propertyThemeRaw = propertyId ? (store.properties[propertyId] || {}) : {};
  const formMode = propertyThemeRaw.mode || globalThemeRaw.mode || 'quick';
  const formCorner = propertyThemeRaw.cornerStyle || globalThemeRaw.cornerStyle || 'rounded';
  const formBrandName = propertyThemeRaw.brandName ?? globalThemeRaw.brandName ?? theme.brandName;
  const formInitials = propertyThemeRaw.brandInitials ?? globalThemeRaw.brandInitials ?? '';
  const formTagline = propertyThemeRaw.tagline ?? globalThemeRaw.tagline ?? '';
  const formPrimary = propertyThemeRaw.primaryColor ?? globalThemeRaw.primaryColor ?? theme.primaryColor;
  const formSecondary = propertyThemeRaw.secondaryColor ?? globalThemeRaw.secondaryColor ?? theme.secondaryColor;
  const formHighlight = propertyThemeRaw.highlightColor ?? globalThemeRaw.highlightColor ?? theme.highlightColor;
  const formLogoAlt = propertyThemeRaw.logoAlt ?? globalThemeRaw.logoAlt ?? theme.logoAlt;
  const logoPath = theme.logoPath;
  const successKey = typeof req.query.success === 'string' ? req.query.success : '';
  const errorMessage = typeof req.query.error === 'string' ? req.query.error : '';
  const successMessage = (() => {
    switch (successKey) {
      case 'saved':
      case '1':
        return 'Preferências guardadas. A barra de navegação foi atualizada.';
      case 'reset': return 'Tema da barra de navegação reposto aos valores padrão.';
      case 'template': return 'Tema personalizado da barra de navegação guardado para reutilização futura.';
      case 'applied': return 'Tema personalizado aplicado à barra de navegação.';
      case 'deleted': return 'Tema personalizado removido.';
      case 'logo_removed': return 'Logotipo removido. Será utilizada a sigla da marca na barra de navegação.';
      default: return '';
    }
  })();
  const savedThemes = store.savedThemes || [];
  const propertyLabel = propertyRow ? propertyRow.name : 'tema global';
  const previewStyle = [
    `--nav-background:${theme.surface}`,
    `--nav-border:${theme.surfaceBorder}`,
    `--nav-foreground:${theme.surfaceContrast}`,
    `--nav-muted:${theme.mutedText}`,
    `--nav-link:${theme.mutedText}`,
    `--nav-link-hover:${theme.primaryHover}`,
    `--nav-link-active:${theme.primaryColor}`,
    `--nav-accent-gradient:linear-gradient(90deg, ${theme.secondaryColor}, ${theme.primaryColor})`,
    `--nav-highlight:${theme.highlightColor}`,
    `--nav-logo-from:${theme.secondaryColor}`,
    `--nav-logo-to:${theme.primaryColor}`,
    `--nav-logo-contrast:${theme.primaryContrast}`,
    `--nav-pill-bg:${theme.primarySoft}`,
    `--nav-pill-text:${theme.primaryContrast}`,
    `--nav-button:${theme.primarySoft}`,
    `--nav-button-hover:${theme.primaryHover}`,
    `--nav-radius:${theme.radius}`,
    `--nav-radius-sm:${theme.radiusSm}`,
    `--nav-radius-lg:${theme.radiusLg}`,
    `--nav-radius-pill:${theme.radiusPill}`
  ].join(';');

  res.send(layout({
    title: 'Identidade visual',
    user: req.user,
    activeNav: 'branding',
    branding: theme,
    pageClass: 'page-backoffice page-branding',
    body: html`
      <div class="bo-page bo-page--wide">
        <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mt-2">Identidade visual</h1>
      <p class="text-slate-600 mb-4">Personalize logotipo, cores e mensagens da barra de navegação principal. As alterações aplicam-se apenas à navbar superior visível em toda a aplicação.</p>

      <form method="get" class="card p-4 mb-4 flex flex-wrap gap-3 items-end max-w-xl">
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Propriedade ativa</span>
          <select class="input" name="property_id" onchange="this.form.submit()">
            <option value="" ${!propertyId ? 'selected' : ''}>Tema global (aplicado por defeito)</option>
            ${properties.map(p => `<option value="${p.id}" ${propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
            <p class="text-xs text-slate-500 max-w-sm">Ao selecionar uma propriedade pode definir um tema próprio. Sem seleção, edita a aparência global da barra de navegação.</p>
      </form>

      ${successMessage ? `
        <div class="inline-feedback mb-4" data-variant="success">
          <span class="inline-feedback-icon">✓</span>
          <div>${esc(successMessage)}</div>
        </div>
      ` : ''}
      ${errorMessage ? `
        <div class="inline-feedback mb-4" data-variant="danger">
          <span class="inline-feedback-icon">!</span>
          <div>${esc(errorMessage)}</div>
        </div>
      ` : ''}

      <div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <form method="post" action="/admin/identidade-visual" enctype="multipart/form-data" class="card p-4 grid gap-4">
          <input type="hidden" name="property_id" value="${propertyId || ''}" />
          <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold text-slate-800">Configurar ${esc(propertyLabel)}</h2>
            <p class="text-sm text-slate-500">Definições guardadas são aplicadas de imediato à barra de navegação da seleção atual.</p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="grid gap-2 text-sm text-slate-600">
              <span>Nome da marca</span>
              <input class="input" name="brand_name" value="${esc(formBrandName)}" maxlength="80" required />
            </label>
            <label class="grid gap-2 text-sm text-slate-600">
              <span>Sigla do logotipo</span>
              <input class="input" name="brand_initials" value="${esc(formInitials)}" maxlength="3" placeholder="Ex: GA" />
              <span class="text-xs text-slate-500">Utilizada quando não existe imagem carregada.</span>
            </label>
          </div>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Slogan / mensagem de apoio</span>
            <input class="input" name="tagline" value="${esc(formTagline)}" maxlength="140" placeholder="Ex: Reservas com confiança" />
            <span class="text-xs text-slate-500">Deixe em branco para usar o texto padrão.</span>
          </label>

          <fieldset class="grid gap-3">
            <legend class="text-sm font-semibold text-slate-600">Paleta de cores</legend>
            <div class="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="mode" value="quick" ${formMode !== 'manual' ? 'checked' : ''} data-mode-toggle />
                Modo rápido (gerar automaticamente tons derivados)
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="mode" value="manual" ${formMode === 'manual' ? 'checked' : ''} data-mode-toggle />
                Avançado (definir todas as cores manualmente)
              </label>
            </div>
            <div class="grid gap-4 md:grid-cols-3">
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor primária</span>
                <input class="input" type="color" name="primary_color" value="${esc(formPrimary)}" data-theme-input />
              </label>
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor secundária</span>
                <input class="input" type="color" name="secondary_color" value="${esc(formSecondary)}" data-theme-input data-manual-color ${formMode === 'manual' ? '' : 'disabled'} />
              </label>
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor de destaque</span>
                <input class="input" type="color" name="highlight_color" value="${esc(formHighlight)}" data-theme-input data-manual-color ${formMode === 'manual' ? '' : 'disabled'} />
              </label>
            </div>
          </fieldset>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Estilo dos cantos</span>
            <select class="input" name="corner_style" data-theme-input>
              <option value="rounded" ${formCorner !== 'square' ? 'selected' : ''}>Arredondados suaves</option>
              <option value="square" ${formCorner === 'square' ? 'selected' : ''}>Retos geométricos</option>
            </select>
          </label>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Logotipo (PNG, JPG, WEBP ou SVG &middot; até 3 MB)</span>
            <input class="input" type="file" name="logo_file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
            ${logoPath ? `<span class="text-xs text-slate-500">Logotipo atual: <a class="underline" href="${esc(logoPath)}" target="_blank" rel="noopener">ver imagem</a></span>` : '<span class="text-xs text-slate-500">Sem imagem carregada — será usada a sigla.</span>'}
          </label>

          ${logoPath ? `
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-muted" name="action" value="remove_logo" onclick="return confirm('Remover o logotipo atual e utilizar a sigla?');">Remover logotipo</button>
            </div>
          ` : ''}

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Texto alternativo do logotipo</span>
            <input class="input" name="logo_alt" value="${esc(formLogoAlt)}" maxlength="140" placeholder="Descrição para leitores de ecrã" />
            <span class="text-xs text-slate-500">Deixe em branco para utilizar automaticamente o nome da marca.</span>
          </label>

          <div class="flex flex-wrap gap-3">
            <button class="btn btn-primary" name="action" value="save">Guardar alterações</button>
            <button class="btn btn-muted" name="action" value="reset" onclick="return confirm('Repor o tema para os valores padrão?');">Repor padrão</button>
          </div>

          <div class="border-t border-slate-200 pt-4 grid gap-3">
            <h3 class="text-sm font-semibold text-slate-700">Guardar como tema reutilizável</h3>
            <p class="text-xs text-slate-500">Crie um tema nomeado para aplicar rapidamente noutras propriedades.</p>
            <label class="grid gap-1 text-sm text-slate-600 max-w-sm">
              <span>Nome do tema</span>
              <input class="input" name="theme_name" maxlength="80" placeholder="Ex: Azul praia" />
            </label>
            <button class="btn btn-light w-fit" name="action" value="save_template">Guardar como tema personalizado</button>
          </div>
        </form>

        <aside class="grid gap-4">
          <section class="card p-4 grid gap-4" data-theme-preview>
            <h2 class="text-sm font-semibold text-slate-700">Pré-visualização da barra de navegação</h2>
            <div class="nav-preview" data-preview-root style="${esc(previewStyle)}">
              <div class="nav-preview-bar">
                <div class="nav-preview-brand">
                  <div class="nav-preview-logo" data-preview-logo>
                    ${logoPath ? `<img src="${esc(logoPath)}" alt="${esc(formLogoAlt)}" />` : `<span data-preview-initials>${esc(formInitials || theme.brandInitials)}</span>`}
                  </div>
                  <div class="nav-preview-meta">
                    <span class="nav-preview-name" data-preview-name>${esc(formBrandName)}</span>
                    <span class="nav-preview-tagline" data-preview-tagline>${esc(formTagline)}</span>
                  </div>
                </div>
                <div class="nav-preview-links">
                  <span class="nav-preview-link is-active">Início</span>
                  <span class="nav-preview-link">Reservas</span>
                  <span class="nav-preview-link">Proprietários</span>
                </div>
                <div class="nav-preview-actions">
                  <span class="nav-preview-pill">Utilizador</span>
                  <button type="button" class="nav-preview-button">Login</button>
                </div>
              </div>
              <div class="nav-preview-accent"></div>
            </div>
            <ul class="preview-palette">
              <li><span class="swatch" data-preview-swatch="primary"></span> Primária (links ativos e gradiente) <code data-preview-code="primary">${esc(theme.primaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="secondary"></span> Secundária (início do gradiente) <code data-preview-code="secondary">${esc(theme.secondaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="highlight"></span> Destaque (elementos auxiliares) <code data-preview-code="highlight">${esc(theme.highlightColor)}</code></li>
            </ul>
          </section>

          <section class="card p-4 grid gap-3">
            <h2 class="text-sm font-semibold text-slate-700">Temas personalizados</h2>
            ${savedThemes.length ? `
              <ul class="grid gap-3">
                ${savedThemes.map(entry => {
                  const sample = computeBrandingTheme({ ...entry.theme }, {});
                  return `
                    <li class="saved-theme" style="--saved-primary:${sample.primaryColor};--saved-secondary:${sample.secondaryColor}">
                      <div class="saved-theme-header">
                        <span class="saved-theme-name">${esc(entry.name)}</span>
                        <form method="post" action="/admin/identidade-visual" class="flex gap-2">
                          <input type="hidden" name="property_id" value="${propertyId || ''}" />
                          <input type="hidden" name="template_id" value="${esc(entry.id)}" />
                          <button class="btn btn-primary btn-xs" name="action" value="apply_template">Aplicar</button>
                          <button class="btn btn-muted btn-xs" name="action" value="delete_template" onclick="return confirm('Remover este tema personalizado?');">Remover</button>
                        </form>
                      </div>
                      <div class="saved-theme-preview">
                        <span class="saved-theme-gradient"></span>
                        <span class="text-xs text-slate-500">${esc(sample.brandName)}</span>
                      </div>
                    </li>
                  `;
                }).join('')}
              </ul>
            ` : `<p class="text-sm text-slate-500">Ainda não existem temas guardados. Crie um acima para reutilizar noutros alojamentos.</p>`}
          </section>
        </aside>
      </div>

      <style>
        [data-theme-preview] .nav-preview{border-radius:var(--nav-radius-lg,var(--brand-radius-lg));border:1px solid var(--nav-border,var(--brand-surface-border));background:var(--nav-background,#fff);box-shadow:0 16px 32px rgba(15,23,42,.08);display:grid;gap:0;overflow:hidden;}
        [data-theme-preview] .nav-preview-bar{display:flex;flex-wrap:wrap;align-items:center;gap:18px;padding:20px 22px;background:var(--nav-background,#fff);color:var(--nav-foreground,#1f2937);}
        [data-theme-preview] .nav-preview-brand{display:flex;align-items:center;gap:12px;min-width:220px;}
        [data-theme-preview] .nav-preview-logo{width:44px;height:44px;border-radius:var(--nav-radius-sm,var(--brand-radius-sm));background:linear-gradient(130deg,var(--nav-logo-from,var(--brand-primary)),var(--nav-logo-to,var(--brand-secondary)));display:flex;align-items:center;justify-content:center;color:var(--nav-logo-contrast,var(--brand-primary-contrast));font-weight:700;overflow:hidden;box-shadow:0 8px 18px rgba(15,23,42,.12);}
        [data-theme-preview] .nav-preview-logo img{width:100%;height:100%;object-fit:cover;display:block;}
        [data-theme-preview] .nav-preview-meta{display:flex;flex-direction:column;gap:2px;}
        [data-theme-preview] .nav-preview-name{font-weight:600;font-size:1rem;color:inherit;}
        [data-theme-preview] .nav-preview-tagline{font-size:.78rem;color:var(--nav-muted,#7a7b88);}
        [data-theme-preview] .nav-preview-links{display:flex;flex-wrap:wrap;gap:18px;font-size:.9rem;}
        [data-theme-preview] .nav-preview-link{position:relative;padding-bottom:6px;color:var(--nav-link,#7a7b88);font-weight:500;}
        [data-theme-preview] .nav-preview-link.is-active{color:var(--nav-link-active,#2f3140);}
        [data-theme-preview] .nav-preview-link.is-active::after{content:'';position:absolute;left:0;right:0;bottom:-10px;height:3px;border-radius:999px;background:var(--nav-accent-gradient,linear-gradient(90deg,var(--brand-secondary),var(--brand-primary)));}
        [data-theme-preview] .nav-preview-actions{display:flex;align-items:center;gap:12px;margin-left:auto;}
        [data-theme-preview] .nav-preview-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--nav-radius-pill,999px);background:var(--nav-pill-bg,#f1f5f9);color:var(--nav-pill-text,#475569);font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;}
        [data-theme-preview] .nav-preview-button{border:none;border-radius:var(--nav-radius-pill,999px);background:var(--nav-button,#7a7b88);color:var(--nav-link-active,#2f3140);padding:6px 14px;font-size:.8rem;font-weight:600;cursor:pointer;transition:background .18s ease;}
        [data-theme-preview] .nav-preview-button:hover{background:var(--nav-button-hover,#424556);}
        [data-theme-preview] .nav-preview-accent{height:4px;background:var(--nav-accent-gradient,linear-gradient(90deg,var(--brand-secondary),var(--brand-primary)));opacity:.85;}
        [data-theme-preview] .preview-palette{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:.8rem;color:#475569;}
        [data-theme-preview] .preview-palette .swatch{display:inline-block;width:18px;height:18px;border-radius:6px;margin-right:6px;vertical-align:middle;border:1px solid rgba(15,23,42,.12);}
        .saved-theme{border:1px solid var(--brand-surface-border);border-radius:var(--brand-radius-sm);padding:12px;display:grid;gap:8px;}
        .saved-theme-header{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .saved-theme-name{font-size:.9rem;font-weight:600;color:#1f2937;}
        .saved-theme-preview{display:flex;align-items:center;gap:10px;font-size:.75rem;color:#475569;}
        .saved-theme-gradient{width:56px;height:10px;border-radius:999px;background:linear-gradient(90deg,var(--saved-secondary),var(--saved-primary));box-shadow:0 4px 10px rgba(15,23,42,.12);}
        .btn.btn-xs{padding:4px 10px;font-size:.75rem;border-radius:999px;}
      </style>

      <script>
        (function(){
          const root = document.querySelector('[data-theme-preview]');
          if (!root) return;
          const modeToggles = Array.from(document.querySelectorAll('[data-mode-toggle]'));
          const manualInputs = Array.from(document.querySelectorAll('[data-manual-color]'));
          const previewRoot = root.querySelector('[data-preview-root]');
          const previewName = root.querySelector('[data-preview-name]');
          const previewTagline = root.querySelector('[data-preview-tagline]');
          const previewInitials = root.querySelector('[data-preview-initials]');
          const swatches = {
            primary: root.querySelector('[data-preview-swatch="primary"]'),
            secondary: root.querySelector('[data-preview-swatch="secondary"]'),
            highlight: root.querySelector('[data-preview-swatch="highlight"]')
          };
          const codes = {
            primary: root.querySelector('[data-preview-code="primary"]'),
            secondary: root.querySelector('[data-preview-code="secondary"]'),
            highlight: root.querySelector('[data-preview-code="highlight"]')
          };

          function hexToRgb(hex){
            const clean = String(hex || '').replace('#','');
            if (clean.length !== 6) return null;
            return { r: parseInt(clean.slice(0,2),16), g: parseInt(clean.slice(2,4),16), b: parseInt(clean.slice(4,6),16) };
          }
          function rgbToHex(rgb){
            const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0');
            return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
          }
          function mix(aHex, bHex, ratio){
            const a = hexToRgb(aHex); const b = hexToRgb(bHex);
            if (!a || !b) return aHex;
            const t = Math.max(0, Math.min(1, ratio));
            return rgbToHex({ r: a.r * (1-t) + b.r * t, g: a.g * (1-t) + b.g * t, b: a.b * (1-t) + b.b * t });
          }
          function contrast(hex){
            const rgb = hexToRgb(hex);
            if (!rgb) return '#ffffff';
            const luminance = (0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b)/255;
            return luminance > 0.6 ? '#0f172a' : '#ffffff';
          }

          function currentMode(){
            const active = modeToggles.find(r => r.checked);
            return active && active.value === 'manual' ? 'manual' : 'quick';
          }

          function applyManualState(){
            const manual = currentMode() === 'manual';
            manualInputs.forEach(input => {
              input.disabled = !manual;
              input.closest('label')?.classList.toggle('opacity-60', !manual);
            });
          }

          function updatePreview(){
            const mode = currentMode();
            const primaryInput = document.querySelector('input[name="primary_color"]');
            const secondaryInput = document.querySelector('input[name="secondary_color"]');
            const highlightInput = document.querySelector('input[name="highlight_color"]');
            const nameInput = document.querySelector('input[name="brand_name"]');
            const taglineInput = document.querySelector('input[name="tagline"]');
            const initialsInput = document.querySelector('input[name="brand_initials"]');
            const cornerSelect = document.querySelector('select[name="corner_style"]');

            const primary = primaryInput ? primaryInput.value : '#2563eb';
            let secondary = secondaryInput ? secondaryInput.value : '#1d4ed8';
            let highlight = highlightInput ? highlightInput.value : '#f97316';
            if (mode !== 'manual') {
              secondary = mix(primary, '#1f2937', 0.18);
              highlight = mix(primary, '#f97316', 0.35);
            }

            const surface = mix(primary, '#ffffff', 0.94);
            const surfaceBorder = mix(primary, '#1f2937', 0.12);
            const navForeground = contrast(surface);
            const navMuted = mix(navForeground, surface, 0.55);
            const navLink = mix(navForeground, surface, 0.65);
            const navLinkHover = mix(navForeground, surface, 0.4);
            const navLinkActive = mix(navForeground, surface, 0.18);
            const navButton = mix(navForeground, surface, 0.5);
            const navButtonHover = mix(navForeground, primary, 0.35);
            const navPillBg = mix(surface, highlight, 0.25);
            const navPillText = mix(navForeground, highlight, 0.35);

            const cornerStyle = cornerSelect && cornerSelect.value === 'square' ? 'square' : 'rounded';
            const radius = cornerStyle === 'square' ? '14px' : '24px';
            const radiusSm = cornerStyle === 'square' ? '8px' : '16px';
            const radiusLg = cornerStyle === 'square' ? '24px' : '32px';
            const radiusPill = cornerStyle === 'square' ? '22px' : '999px';

            if (previewRoot) {
              previewRoot.style.setProperty('--nav-background', surface);
              previewRoot.style.setProperty('--nav-border', surfaceBorder);
              previewRoot.style.setProperty('--nav-foreground', navForeground);
              previewRoot.style.setProperty('--nav-muted', navMuted);
              previewRoot.style.setProperty('--nav-link', navLink);
              previewRoot.style.setProperty('--nav-link-hover', navLinkHover);
              previewRoot.style.setProperty('--nav-link-active', navLinkActive);
              previewRoot.style.setProperty(
                '--nav-accent-gradient',
                'linear-gradient(90deg, ' + secondary + ', ' + primary + ')'
              );
              previewRoot.style.setProperty('--nav-highlight', highlight);
              previewRoot.style.setProperty('--nav-logo-from', secondary);
              previewRoot.style.setProperty('--nav-logo-to', primary);
              previewRoot.style.setProperty('--nav-logo-contrast', contrast(primary));
              previewRoot.style.setProperty('--nav-pill-bg', navPillBg);
              previewRoot.style.setProperty('--nav-pill-text', navPillText);
              previewRoot.style.setProperty('--nav-button', navButton);
              previewRoot.style.setProperty('--nav-button-hover', navButtonHover);
              previewRoot.style.setProperty('--nav-radius', radius);
              previewRoot.style.setProperty('--nav-radius-sm', radiusSm);
              previewRoot.style.setProperty('--nav-radius-lg', radiusLg);
              previewRoot.style.setProperty('--nav-radius-pill', radiusPill);
            }

            if (swatches.primary) swatches.primary.style.background = primary;
            if (swatches.secondary) swatches.secondary.style.background = secondary;
            if (swatches.highlight) swatches.highlight.style.background = highlight;
            if (codes.primary) codes.primary.textContent = primary;
            if (codes.secondary) codes.secondary.textContent = secondary;
            if (codes.highlight) codes.highlight.textContent = highlight;

            if (previewName && nameInput) previewName.textContent = nameInput.value || '${esc(theme.brandName)}';
            if (previewTagline && taglineInput) previewTagline.textContent = taglineInput.value;
            if (previewInitials && initialsInput) previewInitials.textContent = initialsInput.value || '${esc(theme.brandInitials)}';
          }

          modeToggles.forEach(el => el.addEventListener('change', () => { applyManualState(); updatePreview(); }));
          ['input','change'].forEach(evt => {
            document.querySelectorAll('[data-theme-input]').forEach(input => input.addEventListener(evt, updatePreview));
          });

          applyManualState();
          updatePreview();
        })();
      </script>
      </div>
    `
  }));
});

app.post('/admin/identidade-visual', requireAdmin, (req, res) => {
  uploadBrandingAsset.single('logo_file')(req, res, async (err) => {
    const propertyId = parsePropertyId((req.body ? req.body.property_id : null));
    const baseRedirect = propertyId ? `/admin/identidade-visual?property_id=${propertyId}` : '/admin/identidade-visual';
    const redirectWith = (key, value) => `${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}${key}=${value}`;
    const cleanupUpload = async () => { if (req.file) await fsp.unlink(req.file.path).catch(() => {}); };

    if (err) {
      console.error('Identidade visual: erro no upload', err.message);
      await cleanupUpload();
      return res.redirect(redirectWith('error', encodeURIComponent('Falha ao carregar o logotipo: ' + err.message)));
    }

    const actionRaw = typeof (req.body && req.body.action) === 'string' ? req.body.action.toLowerCase() : 'save';
    const action = ['save','reset','save_template','apply_template','delete_template','remove_logo'].includes(actionRaw) ? actionRaw : 'save';
    const store = cloneBrandingStoreState();
    const previousScope = propertyId ? (store.properties[propertyId] || {}) : (store.global || {});
    let previousLogo = previousScope.logoFile || null;

    try {
      if (action === 'reset') {
        const previous = propertyId ? store.properties[propertyId] || {} : store.global || {};
        const oldLogo = previous.logoFile || null;
        if (propertyId) {
          delete store.properties[propertyId];
        } else {
          store.global = {};
        }
        persistBrandingStore(store);
        if (oldLogo) await removeBrandingLogo(oldLogo);
        await cleanupUpload();
        rememberActiveBrandingProperty(res, propertyId);
        return res.redirect(redirectWith('success', 'reset'));
      }

      if (action === 'apply_template') {
        const templateId = String((req.body && req.body.template_id) || '').trim();
        const template = store.savedThemes.find(entry => entry.id === templateId);
        if (!template) {
          await cleanupUpload();
          return res.redirect(redirectWith('error', encodeURIComponent('Tema personalizado não encontrado.')));
        }
        const appliedTheme = sanitizeBrandingTheme({ ...template.theme });
        if (propertyId) store.properties[propertyId] = appliedTheme; else store.global = appliedTheme;
        persistBrandingStore(store);
        if (propertyId) rememberActiveBrandingProperty(res, propertyId);
        await cleanupUpload();
        if (previousLogo && (!appliedTheme.logoFile || appliedTheme.logoFile !== previousLogo)) {
          await removeBrandingLogo(previousLogo);
        }
        return res.redirect(redirectWith('success', 'applied'));
      }

      if (action === 'delete_template') {
        const templateId = String((req.body && req.body.template_id) || '').trim();
        const originalLength = store.savedThemes.length;
        store.savedThemes = store.savedThemes.filter(entry => entry.id !== templateId);
        persistBrandingStore(store);
        await cleanupUpload();
        if (originalLength === store.savedThemes.length) {
          return res.redirect(redirectWith('error', encodeURIComponent('Tema personalizado não encontrado.')));
        }
        return res.redirect(redirectWith('success', 'deleted'));
      }

      if (action === 'remove_logo') {
        const target = propertyId ? { ...(store.properties[propertyId] || {}) } : { ...store.global };
        const oldLogo = target.logoFile || null;
        delete target.logoFile;
        delete target.logoAlt;
        target.logoHidden = true;
        if (propertyId) {
          if (Object.keys(target).length) {
            store.properties[propertyId] = target;
          } else {
            delete store.properties[propertyId];
          }
        } else {
          store.global = target;
        }
        persistBrandingStore(store);
        await cleanupUpload();
        rememberActiveBrandingProperty(res, propertyId);
        if (oldLogo) await removeBrandingLogo(oldLogo);
        return res.redirect(redirectWith('success', 'logo_removed'));
      }

      const submission = extractBrandingSubmission((req.body || {}));
      const updates = submission.updates;
      const clears = submission.clears;
      const mode = submission.mode;
      const existingTheme = propertyId ? { ...(store.properties[propertyId] || {}) } : { ...store.global };

      if (req.file) {
        updates.logoFile = req.file.filename;
        clears.add('logoHidden');
      }

      clears.forEach(field => { delete existingTheme[field]; });
      Object.assign(existingTheme, updates);
      if (mode !== 'manual') {
        delete existingTheme.secondaryColor;
        delete existingTheme.highlightColor;
      }

      if (req.file) {
        await compressImage(req.file.path).catch(() => {});
      }

      if (action === 'save_template') {
        const templateName = String((req.body && req.body.theme_name) || '').trim();
        if (!templateName) {
          await cleanupUpload();
          return res.redirect(redirectWith('error', encodeURIComponent('Indique o nome para o tema personalizado.')));
        }
        const savedTheme = sanitizeBrandingTheme({ ...existingTheme });
        store.savedThemes.push({ id: crypto.randomBytes(6).toString('hex'), name: templateName.slice(0, 80), theme: savedTheme });
      }

      if (propertyId) {
        store.properties[propertyId] = existingTheme;
      } else {
        store.global = existingTheme;
      }

      persistBrandingStore(store);
      if (previousLogo && previousLogo !== existingTheme.logoFile) await removeBrandingLogo(previousLogo);
      rememberActiveBrandingProperty(res, propertyId);
      const successKey = action === 'save_template' ? 'template' : 'saved';
      return res.redirect(redirectWith('success', successKey));
    } catch (saveErr) {
      console.error('Identidade visual: falha ao guardar', saveErr);
      await cleanupUpload();
      return res.redirect(redirectWith('error', encodeURIComponent('Não foi possível guardar as alterações.')));
    }
  });
});
app.get('/admin/auditoria', requireLogin, requireAnyPermission(['audit.view', 'logs.view']), (req, res) => {
  const entityRaw = typeof req.query.entity === 'string' ? req.query.entity.trim().toLowerCase() : '';
  const idRaw = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const canViewAudit = userCan(req.user, 'audit.view');
  const canViewLogs = userCan(req.user, 'logs.view');

  let changeLogs = [];
  if (canViewAudit) {
    const filters = [];
    const params = [];
    if (entityRaw) { filters.push('cl.entity_type = ?'); params.push(entityRaw); }
    const idNumber = Number(idRaw);
    if (idRaw && !Number.isNaN(idNumber)) { filters.push('cl.entity_id = ?'); params.push(idNumber); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    changeLogs = db.prepare(`
      SELECT cl.*, u.username
        FROM change_logs cl
        JOIN users u ON u.id = cl.actor_id
       ${where}
       ORDER BY cl.created_at DESC
       LIMIT 200
    `).all(...params);
  }

  const sessionLogs = canViewLogs
    ? db.prepare(`
        SELECT sl.*, u.username
          FROM session_logs sl
          LEFT JOIN users u ON u.id = sl.user_id
         ORDER BY sl.created_at DESC
         LIMIT 120
      `).all()
    : [];

  const activityLogs = canViewLogs
    ? db.prepare(`
        SELECT al.*, u.username
          FROM activity_logs al
          LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT 200
      `).all()
    : [];

  const theme = resolveBrandingForRequest(req);

  res.send(layout({
    title: 'Auditoria',
    user: req.user,
    activeNav: 'audit',
    branding: theme,
    pageClass: 'page-backoffice page-audit',
    body: html`
      <div class="bo-page bo-page--wide">
        <h1 class="text-2xl font-semibold mb-4">Auditoria e registos internos</h1>
        ${canViewAudit ? `
          <form class="card p-4 mb-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get" action="/admin/auditoria">
            <div class="grid gap-1">
              <label class="text-sm text-slate-600">Entidade</label>
              <select class="input" name="entity">
                <option value="" ${!entityRaw ? 'selected' : ''}>Todas</option>
                <option value="booking" ${entityRaw === 'booking' ? 'selected' : ''}>Reservas</option>
                <option value="block" ${entityRaw === 'block' ? 'selected' : ''}>Bloqueios</option>
              </select>
            </div>
            <div class="grid gap-1">
              <label class="text-sm text-slate-600">ID</label>
              <input class="input" name="id" value="${esc(idRaw)}" placeholder="Opcional" />
            </div>
          <div class="self-end">
            <button class="btn btn-primary w-full">Filtrar</button>
          </div>
        </form>

        <div class="space-y-4">
          ${changeLogs.length ? changeLogs.map(log => html`
            <article class="card p-4 grid gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm text-slate-600">${dayjs(log.created_at).format('DD/MM/YYYY HH:mm')}</div>
                <div class="text-xs uppercase tracking-wide text-slate-500">${esc(log.action)}</div>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span class="pill-indicator">${esc(log.entity_type)} #${log.entity_id}</span>
                <span class="text-slate-500">por ${esc(log.username)}</span>
              </div>
              <div class="bg-slate-50 rounded-lg p-3 overflow-x-auto">${renderAuditDiff(log.before_json, log.after_json)}</div>
            </article>
          `).join('') : `<div class="text-sm text-slate-500">Sem registos para os filtros selecionados.</div>`}
        </div>
      ` : `<div class="card p-4 text-sm text-slate-500">Sem permissões para consultar o histórico de alterações.</div>`}

      ${canViewLogs ? `
        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Logs de sessão</h2>
            <span class="text-xs text-slate-500">Últimos ${sessionLogs.length} registos</span>
          </div>
          <div class="card p-0">
            <div class="responsive-table">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="text-left px-4 py-2">Quando</th>
                    <th class="text-left px-4 py-2">Utilizador</th>
                    <th class="text-left px-4 py-2">Ação</th>
                    <th class="text-left px-4 py-2">IP</th>
                    <th class="text-left px-4 py-2">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  ${sessionLogs.length ? sessionLogs.map(row => `
                    <tr>
                      <td class="px-4 py-2 text-slate-600" data-label="Quando"><span class="table-cell-value">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</span></td>
                      <td class="px-4 py-2" data-label="Utilizador"><span class="table-cell-value">${esc(row.username || '—')}</span></td>
                      <td class="px-4 py-2" data-label="Ação"><span class="table-cell-value">${esc(row.action)}</span></td>
                      <td class="px-4 py-2" data-label="IP"><span class="table-cell-value">${esc(row.ip || '') || '—'}</span></td>
                      <td class="px-4 py-2 text-slate-500" data-label="User-Agent"><span class="table-cell-value">${esc((row.user_agent || '').slice(0, 120))}</span></td>
                    </tr>
                  `).join('') : '<tr><td class="px-4 py-3 text-slate-500" data-label="Info">Sem atividade de sessão registada.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Atividade da aplicação</h2>
            <span class="text-xs text-slate-500">Últimos ${activityLogs.length} eventos</span>
          </div>
          <div class="card p-0">
            <div class="responsive-table">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="text-left px-4 py-2">Quando</th>
                    <th class="text-left px-4 py-2">Utilizador</th>
                    <th class="text-left px-4 py-2">Ação</th>
                    <th class="text-left px-4 py-2">Entidade</th>
                    <th class="text-left px-4 py-2">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  ${activityLogs.length ? activityLogs.map(row => `
                    <tr class="align-top">
                      <td class="px-4 py-2 text-slate-600" data-label="Quando"><span class="table-cell-value">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</span></td>
                      <td class="px-4 py-2" data-label="Utilizador"><span class="table-cell-value">${esc(row.username || '—')}</span></td>
                      <td class="px-4 py-2" data-label="Ação"><span class="table-cell-value">${esc(row.action)}</span></td>
                      <td class="px-4 py-2" data-label="Entidade"><span class="table-cell-value">${row.entity_type ? esc(row.entity_type) + (row.entity_id ? ' #' + row.entity_id : '') : '—'}</span></td>
                      <td class="px-4 py-2" data-label="Detalhes"><span class="table-cell-value">${formatJsonSnippet(row.meta_json)}</span></td>
                    </tr>
                  `).join('') : '<tr><td class="px-4 py-3 text-slate-500" data-label="Info">Sem atividade registada.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ` : ''}
      </div>
    `
  }));
});

// ===================== Utilizadores (admin) =====================
const USER_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizeUserEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidUserEmail(email) {
  if (!email) return false;
  if (email.length > 160) return false;
  return USER_EMAIL_REGEX.test(email);
}

function maskUserEmail(email) {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  if (local.length <= 2) {
    return `${local.charAt(0)}…@${domain}`;
  }
  return `${local.slice(0, 2)}…@${domain}`;
}

app.get('/admin/utilizadores', requireAdmin, (req,res)=>{
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const users = db
    .prepare('SELECT id, username, email, role FROM users WHERE tenant_id = ? ORDER BY username')
    .all(tenantId)
    .map(u => ({
    ...u,
    role_key: normalizeRole(u.role)
  }));
  const isDevOperator = req.user && req.user.role === MASTER_ROLE;
  const roleOptions = [
    { key: 'rececao', label: ROLE_LABELS.rececao },
    { key: 'gestao', label: ROLE_LABELS.gestao },
    { key: 'direcao', label: ROLE_LABELS.direcao },
    { key: 'limpeza', label: ROLE_LABELS.limpeza },
    { key: 'owner', label: ROLE_LABELS.owner }
  ];
  if (isDevOperator) {
    roleOptions.unshift({ key: MASTER_ROLE, label: ROLE_LABELS[MASTER_ROLE] });
  }
  const propertyChoices = db
    .prepare('SELECT id, name FROM properties WHERE tenant_id = ? ORDER BY name')
    .all(tenantId);
  const scopeRoleOptions = db
    .prepare('SELECT key, name FROM roles WHERE key != ? ORDER BY name COLLATE NOCASE')
    .all(MASTER_ROLE)
    .map(row => ({
      key: row.key,
      label: row.name || ROLE_LABELS[row.key] || row.key
    }));
  const scopeAssignments = db
    .prepare(
      `SELECT ur.id,
              ur.user_id,
              ur.property_id,
              u.username,
              r.key AS role_key,
              COALESCE(r.name, r.key) AS role_name,
              p.name AS property_name
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN roles r ON r.id = ur.role_id
    LEFT JOIN properties p ON p.id = ur.property_id
        WHERE u.tenant_id = ?
          AND (p.id IS NULL OR p.tenant_id = u.tenant_id)
        ORDER BY u.username COLLATE NOCASE,
                 r.name COLLATE NOCASE,
                 COALESCE(p.name, '') COLLATE NOCASE`
    )
    .all(tenantId);
  const query = req.query || {};
  let successMessage = null;
  if (query.updated === 'permissions') {
    successMessage = 'Permissões personalizadas atualizadas com sucesso.';
  } else if (query.updated === 'scopes') {
    successMessage = 'Escopos atualizados com sucesso.';
  }
  let errorMessage = null;
  switch (query.error) {
    case 'permissions_forbidden':
      errorMessage = 'Não é possível alterar as permissões desse utilizador.';
      break;
    case 'permissions_invalid':
      errorMessage = 'Seleção de permissões inválida. Tente novamente.';
      break;
    case 'scopes_invalid':
      errorMessage = 'Selecione utilizador, perfil e propriedade válidos antes de guardar.';
      break;
    case 'scopes_exists':
      errorMessage = 'O escopo selecionado já está atribuído a esse utilizador.';
      break;
    case 'scopes_not_found':
      errorMessage = 'Escopo indicado não foi encontrado.';
      break;
    case 'scopes_forbidden':
      errorMessage = 'Sem permissão para gerir escopos desse utilizador.';
      break;
    default:
      break;
  }

  let permissionGroupEntries = [];
  let permissionPayload = null;
  if (isDevOperator) {
    const grouped = {};
    Array.from(ALL_PERMISSIONS)
      .sort((a, b) => a.localeCompare(b, 'pt'))
      .forEach(permission => {
        const [groupKey] = permission.split('.');
        const key = groupKey || 'outros';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          key: permission,
          label: permission.replace(/\./g, ' → ')
        });
      });
    permissionGroupEntries = Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt'))
      .map(([groupKey, permissions]) => ({ groupKey, permissions }));

    const overridesByUser = {};
    selectAllPermissionOverridesStmt.all().forEach(row => {
      if (!row || !row.user_id || !row.permission) return;
      if (!overridesByUser[row.user_id]) overridesByUser[row.user_id] = [];
      overridesByUser[row.user_id].push({
        permission: row.permission,
        is_granted: row.is_granted ? 1 : 0
      });
    });

    const baseByUser = {};
    const effectiveByUser = {};
    users.forEach(user => {
      const baseSet = new Set(ROLE_PERMISSIONS[user.role_key] || []);
      baseByUser[user.id] = Array.from(baseSet);
      const effectiveSet = new Set(baseSet);
      (overridesByUser[user.id] || []).forEach(entry => {
        if (!entry || !entry.permission || !ALL_PERMISSIONS.has(entry.permission)) return;
        if (entry.is_granted) {
          effectiveSet.add(entry.permission);
        } else {
          effectiveSet.delete(entry.permission);
        }
      });
      effectiveByUser[user.id] = Array.from(effectiveSet);
    });

    const roleLabelsByUser = Object.fromEntries(
      users.map(user => [user.id, ROLE_LABELS[user.role_key] || user.role_key])
    );
    const devUser = users.find(u => u.role_key === MASTER_ROLE) || null;
    const payload = {
      base: baseByUser,
      effective: effectiveByUser,
      overrides: overridesByUser,
      roleLabels: roleLabelsByUser,
      devUserId: devUser ? devUser.id : null
    };
    permissionPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  }
  const theme = resolveBrandingForRequest(req);
  res.send(layout({
    title: 'Utilizadores',
    user: req.user,
    activeNav: 'users',
    branding: theme,
    pageClass: 'page-backoffice page-users',
    body: html`
      <div class="bo-page bo-page--wide">
        <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
        <h1 class="text-2xl font-semibold mb-4">Utilizadores</h1>
        ${errorMessage
          ? `<div class="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${esc(errorMessage)}</div>`
          : ''}
        ${successMessage
          ? `<div class="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">${esc(successMessage)}</div>`
          : ''}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section class="card p-4">
        <h2 class="font-semibold mb-3">Criar novo utilizador</h2>
        <form method="post" action="/admin/users/create" class="grid gap-2">
          <input required name="username" class="input" placeholder="Utilizador" />
          <input required type="email" name="email" class="input" placeholder="Email" />
          <input required type="password" name="password" class="input" placeholder="Password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <select name="role" id="create-user-role" class="input">
            ${roleOptions
              .filter(opt => opt.key !== MASTER_ROLE)
              .map(opt => `<option value="${esc(opt.key)}">${esc(opt.label)}</option>`)
              .join('')}
          </select>
          <div id="owner-property-select" class="rounded-lg border border-slate-200 bg-slate-50 p-3 hidden" aria-hidden="true" style="display:none;">
            <p class="text-sm text-slate-600 mb-2">Selecione as propriedades a que este owner terá acesso.</p>
            ${propertyChoices.length
              ? `<div class="grid max-h-48 gap-2 overflow-y-auto pr-1">
                  ${propertyChoices
                    .map(
                      prop => `
                        <label class="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="property_ids" value="${prop.id}" class="accent-slate-700" />
                          <span>${esc(prop.name)}</span>
                        </label>
                      `
                    )
                    .join('')}
                </div>`
              : '<p class="text-sm text-slate-500">Ainda não existem propriedades registadas para atribuir.</p>'}
            <p class="mt-3 text-xs text-slate-500">Este passo é obrigatório para contas Owners.</p>
          </div>
          <button class="btn btn-primary">Criar</button>
        </form>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Alterar password</h2>
        <form method="post" action="/admin/users/password" class="grid gap-2">
          <label class="text-sm">Selecionar utilizador</label>
          <select required name="user_id" class="input">
            ${users
              .map(
                u =>
                  `<option value="${u.id}">${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''} (${esc(
                    ROLE_LABELS[u.role_key] || u.role_key
                  )})</option>`
              )
              .join('')}
          </select>
          <input required type="password" name="new_password" class="input" placeholder="Nova password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <button class="btn btn-primary">Alterar</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">Ao alterar, as sessões desse utilizador são terminadas.</p>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Atualizar email</h2>
        <form method="post" action="/admin/users/email" class="grid gap-2">
          <label class="text-sm">Selecionar utilizador</label>
          <select required name="user_id" class="input">
            ${users
              .map(
                u =>
                  `<option value="${u.id}">${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''} (${esc(
                    ROLE_LABELS[u.role_key] || u.role_key
                  )})</option>`
              )
              .join('')}
          </select>
          <input required type="email" name="email" class="input" placeholder="novo email" />
          <button class="btn btn-primary">Guardar email</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">O email é usado para 2FA e recuperação de password.</p>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Atualizar privilégios</h2>
        <form method="post" action="/admin/users/role" class="grid gap-2">
          <label class="text-sm" for="user-role-user">Selecionar utilizador</label>
          <select id="user-role-user" required name="user_id" class="input">
            ${users
              .map(
                u =>
                  `<option value="${u.id}">${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''} (${esc(
                    ROLE_LABELS[u.role_key] || u.role_key
                  )})</option>`
              )
              .join('')}
          </select>
          <label class="text-sm" for="user-role-role">Novo perfil</label>
          <select id="user-role-role" name="role" class="input">
            ${roleOptions.map(opt => `<option value="${esc(opt.key)}">${esc(opt.label)}</option>`).join('')}
          </select>
          <button class="btn btn-primary">Atualizar privilégios</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">As sessões ativas serão terminadas ao atualizar as permissões.</p>
      </section>

      ${isDevOperator
        ? html`
            <section class="card p-4 md:col-span-2">
              <h2 class="font-semibold mb-3">Permissões personalizadas</h2>
              <form id="user-permissions-form" method="post" action="/admin/users/permissions" class="grid gap-3">
                <label class="grid gap-1 text-sm">
                  <span>Selecionar utilizador</span>
                  <select id="user-permissions-user" name="user_id" class="input" required>
                    <option value="">— Escolher —</option>
                    ${users
                      .map(
                        user =>
                          `<option value="${user.id}">${esc(user.username)}${user.email ? ` · ${esc(user.email)}` : ''} (${esc(
                            ROLE_LABELS[user.role_key] || user.role_key
                          )})</option>`
                      )
                      .join('')}
                  </select>
                </label>
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-72 overflow-y-auto" data-permission-checkboxes>
                  ${permissionGroupEntries
                    .map(
                      group => `
                        <fieldset class="mb-3 last:mb-0">
                          <legend class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">${esc(group.groupKey.replace(/_/g, ' '))}</legend>
                          <div class="grid gap-2 md:grid-cols-2">
                            ${group.permissions
                              .map(
                                perm => `
                                  <label class="flex items-start gap-2 text-sm leading-snug">
                                    <input type="checkbox" class="mt-1 accent-slate-700" name="permissions" value="${esc(perm.key)}" />
                                    <span>${esc(perm.label)}</span>
                                  </label>
                                `
                              )
                              .join('')}
                          </div>
                        </fieldset>
                      `
                    )
                    .join('')}
                </div>
                <div class="rounded border border-slate-200 bg-white/60 p-3 text-xs text-slate-600" data-permission-summary>
                  <p><strong>Perfil base:</strong> <span data-summary-role>—</span> · <span data-summary-base-count>0</span> permissões base</p>
                  <p><strong>Ajustes personalizados:</strong> <span data-summary-added>0 adicionadas</span>, <span data-summary-removed>0 removidas</span></p>
                </div>
                <p class="text-xs text-amber-600 hidden" data-permission-guard>As permissões da conta de desenvolvimento não podem ser alteradas.</p>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-xs text-slate-500">Ao guardar, todas as sessões do utilizador selecionado serão terminadas.</p>
                  <button class="btn btn-primary" data-permission-submit>Guardar permissões</button>
                </div>
              </form>
            </section>
            ${permissionPayload ? html`<script id="user-permissions-data" type="application/json">${permissionPayload}</script>` : ''}
          `
        : ''}

      <section class="card p-4 md:col-span-2">
        <h2 class="font-semibold mb-3">Escopos por propriedade</h2>
        <form method="post" action="/admin/user-roles" class="grid gap-3 md:grid-cols-4">
          <label class="grid gap-1 text-sm">
            <span>Utilizador</span>
            <select name="user_id" class="input" required>
              <option value="">— Selecionar —</option>
              ${users
                .map(
                  user =>
                    `<option value="${user.id}">${esc(user.username)}${user.email ? ` · ${esc(user.email)}` : ''} (${esc(
                      ROLE_LABELS[user.role_key] || user.role_key
                    )})</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="grid gap-1 text-sm">
            <span>Perfil</span>
            <select name="role_key" class="input" required>
              <option value="">— Selecionar —</option>
              ${scopeRoleOptions.map(opt => `<option value="${esc(opt.key)}">${esc(opt.label)}</option>`).join('')}
            </select>
          </label>
          <label class="grid gap-1 text-sm md:col-span-2">
            <span>Propriedade</span>
            <select name="property_id" class="input">
              <option value="">Todas as propriedades</option>
              ${propertyChoices.map(prop => `<option value="${prop.id}">${esc(prop.name)}</option>`).join('')}
            </select>
          </label>
          <div class="md:col-span-4 flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs text-slate-500">Ao guardar, todas as sessões do utilizador selecionado serão terminadas.</p>
            <button class="btn btn-primary">Adicionar escopo</button>
          </div>
        </form>
        <div class="responsive-table mt-4">
          <table class="w-full text-sm">
            <thead>
              <tr>
                <th class="text-left px-4 py-2">Utilizador</th>
                <th class="text-left px-4 py-2">Perfil</th>
                <th class="text-left px-4 py-2">Propriedade</th>
                <th class="text-left px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${scopeAssignments.length
                ? scopeAssignments
                    .map(scope => {
                      const roleLabel = ROLE_LABELS[scope.role_key] || scope.role_name || scope.role_key;
                      const propertyLabel = scope.property_id == null
                        ? 'Todas as propriedades'
                        : scope.property_name
                        ? scope.property_name
                        : `Propriedade #${scope.property_id}`;
                      return `
                        <tr>
                          <td class="px-4 py-2" data-label="Utilizador"><span class="table-cell-value">${esc(scope.username)}</span></td>
                          <td class="px-4 py-2" data-label="Perfil"><span class="table-cell-value">${esc(roleLabel)}</span></td>
                          <td class="px-4 py-2" data-label="Propriedade"><span class="table-cell-value">${esc(propertyLabel)}</span></td>
                          <td class="px-4 py-2" data-label="Ações">
                            <form method="post" action="/admin/user-roles/${scope.id}/delete" class="inline">
                              <button class="btn btn-light btn-xs" onclick="return confirm('Remover este escopo?');">Remover</button>
                            </form>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
                : '<tr><td class="px-4 py-3 text-slate-500" colspan="4">Ainda não existem escopos atribuídos.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="card p-4 mt-6">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="font-semibold">Utilizadores registados</h2>
        ${isDevOperator ? '<span class="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Acesso total do desenvolvedor</span>' : ''}
      </div>
      <p class="text-sm text-slate-500 mb-4">
        ${isDevOperator
          ? 'As passwords são guardadas encriptadas. Para ver o hash de uma conta precisa de confirmar a sua password.'
          : 'Contacte a direção ou desenvolvimento para obter suporte adicional.'}
      </p>
      <div class="responsive-table">
        <table class="w-full text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-2">Utilizador</th>
              <th class="text-left px-4 py-2">Email</th>
              <th class="text-left px-4 py-2">Perfil</th>
              <th class="text-left px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${users.length ? users.map(u => `
              <tr>
                <td class="px-4 py-2" data-label="Utilizador"><span class="table-cell-value">${esc(u.username)}</span></td>
                <td class="px-4 py-2" data-label="Email">${u.email ? `<span class="table-cell-value">${esc(u.email)}</span>` : '<span class="table-cell-muted">—</span>'}</td>
                <td class="px-4 py-2" data-label="Perfil"><span class="table-cell-value">${esc(ROLE_LABELS[u.role_key] || u.role_key)}</span></td>
                <td class="px-4 py-2" data-label="Ações">
                  ${isDevOperator
                    ? `<button type="button" class="btn btn-light btn-xs js-reveal-password" data-user-id="${u.id}" data-username="${esc(u.username)}">Ver password</button>`
                    : '<span class="text-xs text-slate-400">—</span>'}
                </td>
              </tr>
            `).join('') : '<tr><td class="px-4 py-3 text-slate-500" colspan="4">Sem utilizadores registados.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <script>
      (function(){
        const roleSelect = document.getElementById('create-user-role');
        const ownerSection = document.getElementById('owner-property-select');
        if(!roleSelect || !ownerSection) return;
        const checkboxes = ownerSection.querySelectorAll('input[type="checkbox"]');
        function syncOwnerSection(){
          const isOwner = roleSelect.value === 'owner';
          ownerSection.classList.toggle('hidden', !isOwner);
          ownerSection.style.display = isOwner ? 'block' : 'none';
          ownerSection.setAttribute('aria-hidden', isOwner ? 'false' : 'true');
          checkboxes.forEach(box => {
            box.disabled = !isOwner;
            if(!isOwner) box.checked = false;
          });
        }
        roleSelect.addEventListener('change', syncOwnerSection);
        syncOwnerSection();
      })();
    </script>

      ${isDevOperator && permissionPayload ? html`
      <script>
        (function(){
          const dataEl = document.getElementById('user-permissions-data');
          const form = document.getElementById('user-permissions-form');
          if (!dataEl || !form) return;
          let payload = {};
          try {
            payload = JSON.parse(dataEl.textContent || '{}');
          } catch (err) {
            console.error('Permissões personalizadas: payload inválido', err);
            return;
          }
          const userSelect = document.getElementById('user-permissions-user');
          const checkboxes = Array.from(form.querySelectorAll('input[name="permissions"]'));
          const summaryRole = form.querySelector('[data-summary-role]');
          const summaryBaseCount = form.querySelector('[data-summary-base-count]');
          const summaryAdded = form.querySelector('[data-summary-added]');
          const summaryRemoved = form.querySelector('[data-summary-removed]');
          const guardNotice = form.querySelector('[data-permission-guard]');
          const submitButton = form.querySelector('[data-permission-submit]');

          const baseSetFor = (userId) => new Set((payload.base && payload.base[userId]) || []);
          const effectiveSetFor = (userId) => new Set((payload.effective && payload.effective[userId]) || []);
          const isDevTarget = (userId) => payload.devUserId != null && String(payload.devUserId) === String(userId);

          function applyStoredState() {
            const userId = userSelect.value;
            if (!userId) {
              checkboxes.forEach(box => {
                box.checked = false;
                box.disabled = true;
              });
              if (summaryRole) summaryRole.textContent = '—';
              if (summaryBaseCount) summaryBaseCount.textContent = '0';
              if (summaryAdded) summaryAdded.textContent = '0 adicionadas';
              if (summaryRemoved) summaryRemoved.textContent = '0 removidas';
              if (guardNotice) guardNotice.classList.add('hidden');
              if (submitButton) submitButton.disabled = true;
              return;
            }
            const effective = effectiveSetFor(userId);
            const devLocked = isDevTarget(userId);
            checkboxes.forEach(box => {
              box.checked = effective.has(box.value);
              box.disabled = devLocked;
            });
            if (summaryRole) summaryRole.textContent = (payload.roleLabels && payload.roleLabels[userId]) || '—';
            if (summaryBaseCount) summaryBaseCount.textContent = baseSetFor(userId).size || 0;
            if (guardNotice) guardNotice.classList.toggle('hidden', !devLocked);
            if (submitButton) submitButton.disabled = devLocked;
          }

          function updateSummary() {
            const userId = userSelect.value;
            if (!userId) return;
            const base = baseSetFor(userId);
            let added = 0;
            let removed = 0;
            checkboxes.forEach(box => {
              const hasBase = base.has(box.value);
              if (box.checked && !hasBase) added += 1;
              if (!box.checked && hasBase) removed += 1;
            });
            if (summaryAdded) summaryAdded.textContent = added + ' adicionadas';
            if (summaryRemoved) summaryRemoved.textContent = removed + ' removidas';
          }

          if (userSelect) {
            userSelect.addEventListener('change', () => {
              applyStoredState();
              updateSummary();
            });
          }
          checkboxes.forEach(box => {
            box.addEventListener('change', () => {
              if (!userSelect.value) return;
              if (submitButton) submitButton.disabled = isDevTarget(userSelect.value);
              updateSummary();
            });
          });

          applyStoredState();
          updateSummary();
        })();
      </script>
      ` : ''}

      </div>

    ${isDevOperator ? html`
      <div id="reveal-password-modal" class="modal-overlay modal-hidden" role="dialog" aria-modal="true" aria-labelledby="reveal-password-title">
        <div class="modal-card">
          <h2 id="reveal-password-title" class="text-lg font-semibold mb-2">Confirmar identidade</h2>
          <p class="text-sm text-slate-600 mb-4">Volte a introduzir a sua password para ver o hash da conta <strong id="reveal-password-target"></strong>.</p>
          <form id="reveal-password-form" class="grid gap-3">
            <input type="hidden" name="user_id" />
            <label class="grid gap-1 text-sm">
              <span>Password do desenvolvedor</span>
              <input name="confirm_password" type="password" class="input" required autocomplete="current-password" />
            </label>
            <div id="reveal-password-error" class="text-sm text-rose-600 hidden"></div>
            <pre id="reveal-password-result" class="hidden bg-slate-100 rounded p-3 text-xs overflow-x-auto"></pre>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn btn-muted" data-modal-close>Cancelar</button>
              <button type="submit" class="btn btn-primary">Ver hash</button>
            </div>
          </form>
        </div>
      </div>
      <style>
        .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:50;padding:1rem;}
        .modal-card{background:#fff;border-radius:0.75rem;max-width:26rem;width:100%;box-shadow:0 25px 50px -12px rgba(15,23,42,0.45);padding:1.5rem;}
        .modal-hidden{display:none;}
      </style>
      <script>
        (function(){
          const modal = document.getElementById('reveal-password-modal');
          if(!modal) return;
          const form = document.getElementById('reveal-password-form');
          const targetNameEl = document.getElementById('reveal-password-target');
          const errorEl = document.getElementById('reveal-password-error');
          const resultEl = document.getElementById('reveal-password-result');
          const passwordInput = form.querySelector('input[name="confirm_password"]');
          function closeModal(){
            modal.classList.add('modal-hidden');
            form.reset();
            errorEl.classList.add('hidden');
            resultEl.classList.add('hidden');
            resultEl.textContent='';
          }
          document.querySelectorAll('.js-reveal-password').forEach(btn => {
            btn.addEventListener('click', () => {
              const userId = btn.getAttribute('data-user-id');
              const username = btn.getAttribute('data-username');
              form.user_id.value = userId;
              targetNameEl.textContent = username;
              errorEl.classList.add('hidden');
              errorEl.textContent='';
              resultEl.classList.add('hidden');
              resultEl.textContent='';
              modal.classList.remove('modal-hidden');
              setTimeout(() => passwordInput.focus(), 50);
            });
          });
          modal.addEventListener('click', evt => {
            if(evt.target === modal){
              closeModal();
            }
          });
          document.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', closeModal));
          document.addEventListener('keydown', evt => {
            if(evt.key === 'Escape' && !modal.classList.contains('modal-hidden')){
              closeModal();
            }
          });
          form.addEventListener('submit', async evt => {
            evt.preventDefault();
            errorEl.classList.add('hidden');
            resultEl.classList.add('hidden');
            resultEl.textContent='';
            const payload = {
              user_id: form.user_id.value,
              confirm_password: passwordInput.value
            };
            try{
              const response = await fetch('/admin/users/reveal-password', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
              });
              const data = await response.json();
              if(!response.ok){
                throw new Error(data && data.error ? data.error : 'Não foi possível validar as credenciais.');
              }
              resultEl.textContent = data.password_hash || 'Hash indisponível.';
              resultEl.classList.remove('hidden');
            } catch(err){
              errorEl.textContent = err.message || 'Falha ao confirmar identidade.';
              errorEl.classList.remove('hidden');
            }
          });
        })();
      </script>
    ` : ''}
  `}));
});

app.post('/admin/users/create', requireAdmin, (req,res)=>{
  const { username, password, confirm, role } = req.body;
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return res.status(400).send('Utilizador inválido.');
  if (!password || password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const email = normalizeUserEmail(req.body.email);
  if (!isValidUserEmail(email)) {
    return res.status(400).send('Indique um email válido (máx. 160 caracteres).');
  }
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const exists = db
    .prepare('SELECT 1 FROM users WHERE username = ? AND tenant_id = ?')
    .get(normalizedUsername, tenantId);
  if (exists) return res.status(400).send('Utilizador já existe.');
  const emailTaken = db
    .prepare('SELECT 1 FROM users WHERE tenant_id = ? AND email = ?')
    .get(tenantId, email);
  if (emailTaken) {
    return res.status(400).send('Já existe um utilizador com esse email.');
  }
  const hash = bcrypt.hashSync(password, 10);
  const roleKey = normalizeRole(role);
  let ownerPropertyIds = [];
  const ownerRoleRow = selectRoleByKeyStmt.get('owner');
  if (roleKey === 'owner') {
    const rawPropertyIds = req.body.property_ids;
    const selectable = new Set(
      db
        .prepare('SELECT id FROM properties WHERE tenant_id = ? ORDER BY id')
        .all(tenantId)
        .map(row => Number(row.id))
    );
    const normalizedSelection = Array.isArray(rawPropertyIds)
      ? rawPropertyIds
      : rawPropertyIds != null
      ? [rawPropertyIds]
      : [];
    ownerPropertyIds = Array.from(
      new Set(
        normalizedSelection
          .map(value => Number.parseInt(value, 10))
          .filter(value => Number.isInteger(value) && selectable.has(value))
      )
    );
    if (!ownerPropertyIds.length) {
      return res.status(400).send('Selecione pelo menos uma propriedade para o owner.');
    }
  }
  const insertUser = db.prepare('INSERT INTO users(username,email,password_hash,role,tenant_id) VALUES (?,?,?,?,?)');
  const assignOwnerProperty = db.prepare(
    'INSERT INTO property_owners(property_id, user_id, tenant_id) VALUES (?, ?, ?)'
  );
  let newUserId = null;
  db.transaction(() => {
    const result = insertUser.run(normalizedUsername, email, hash, roleKey, tenantId);
    newUserId = Number(result.lastInsertRowid);
    if (roleKey === 'owner' && ownerPropertyIds.length) {
      ownerPropertyIds.forEach(propertyId => {
        assignOwnerProperty.run(propertyId, newUserId, tenantId);
        if (ownerRoleRow && ownerRoleRow.id) {
          insertUserRoleAssignmentStmt.run(newUserId, ownerRoleRow.id, propertyId, tenantId);
        }
      });
    }
  })();
  if (!newUserId) {
    return res.status(500).send('Não foi possível criar o utilizador.');
  }
  logActivity(req.user.id, 'user:create', 'user', newUserId, {
    username: normalizedUsername,
    email,
    role: roleKey,
    properties: ownerPropertyIds
  });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/email', requireAdmin, (req, res) => {
  const { user_id, email } = req.body;
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const userId = Number.parseInt(user_id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).send('Utilizador inválido.');
  }
  const normalizedEmail = normalizeUserEmail(email);
  if (!isValidUserEmail(normalizedEmail)) {
    return res.status(400).send('Indique um email válido (máx. 160 caracteres).');
  }
  const target = db.prepare('SELECT id, username, email FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!target) {
    return res.status(404).send('Utilizador não encontrado');
  }
  const conflict = db
    .prepare('SELECT 1 FROM users WHERE tenant_id = ? AND email = ? AND id != ?')
    .get(tenantId, normalizedEmail, userId);
  if (conflict) {
    return res.status(400).send('Já existe um utilizador com esse email.');
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ? AND tenant_id = ?').run(normalizedEmail, userId, tenantId);
  logActivity(req.user.id, 'user:email_update', 'user', userId, {
    previous: target.email || null,
    email: normalizedEmail
  });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/password', requireAdmin, (req,res)=>{
  const { user_id, new_password, confirm } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (new_password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(user_id, tenantId);
  if (!user) return res.status(404).send('Utilizador não encontrado');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?').run(hash, user_id, tenantId);
  revokeUserSessions(user_id, req);
  logActivity(req.user.id, 'user:password_reset', 'user', Number(user_id), {});
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/role', requireAdmin, (req,res)=>{
  const { user_id, role } = req.body;
  if (!user_id || !role) return res.status(400).send('Dados inválidos');
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ? AND tenant_id = ?').get(user_id, tenantId);
  if (!target) return res.status(404).send('Utilizador não encontrado');
  const newRole = normalizeRole(role);
  const currentRole = normalizeRole(target.role);
  const actorIsDev = req.user && req.user.role === MASTER_ROLE;
  if ((currentRole === MASTER_ROLE || newRole === MASTER_ROLE) && !actorIsDev) {
    return res.status(403).send('Apenas o desenvolvedor pode gerir contas de desenvolvimento.');
  }
  if (newRole === currentRole) {
    return res.redirect('/admin/utilizadores');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?').run(newRole, target.id, tenantId);
  if (currentRole === 'owner' && newRole !== 'owner') {
    db.prepare('DELETE FROM property_owners WHERE user_id = ? AND tenant_id = ?').run(target.id, tenantId);
    deleteUserRolesByUserAndRoleKeyStmt.run(target.id, tenantId, 'owner');
  }
  revokeUserSessions(target.id, req);
  logChange(req.user.id, 'user', Number(target.id), 'role_change', { role: currentRole }, { role: newRole });
  logActivity(req.user.id, 'user:role_change', 'user', Number(target.id), { from: currentRole, to: newRole });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/user-roles', requireAdmin, (req, res) => {
  const { user_id, role_key, property_id } = req.body;
  const userId = Number.parseInt(user_id, 10);
  const normalizedRoleKey = typeof role_key === 'string' ? role_key.trim().toLowerCase() : '';
  if (!Number.isInteger(userId) || !normalizedRoleKey) {
    return res.redirect('/admin/utilizadores?error=scopes_invalid');
  }
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!target) {
    return res.redirect('/admin/utilizadores?error=scopes_invalid');
  }
  const actorIsDev = req.user && req.user.role === MASTER_ROLE;
  const targetRole = normalizeRole(target.role);
  if (targetRole === MASTER_ROLE && !actorIsDev) {
    return res.redirect('/admin/utilizadores?error=scopes_forbidden');
  }
  if (normalizedRoleKey === MASTER_ROLE && !actorIsDev) {
    return res.redirect('/admin/utilizadores?error=scopes_forbidden');
  }
  const roleRow = selectRoleByKeyStmt.get(normalizedRoleKey);
  if (!roleRow || !roleRow.id) {
    return res.redirect('/admin/utilizadores?error=scopes_invalid');
  }
  let resolvedPropertyId = null;
  if (property_id !== undefined && property_id !== null && String(property_id).trim() !== '') {
    const parsedProperty = Number.parseInt(property_id, 10);
    if (!Number.isInteger(parsedProperty)) {
      return res.redirect('/admin/utilizadores?error=scopes_invalid');
    }
    const propertyExists = db
      .prepare('SELECT id FROM properties WHERE id = ? AND tenant_id = ?')
      .get(parsedProperty, tenantId);
    if (!propertyExists) {
      return res.redirect('/admin/utilizadores?error=scopes_invalid');
    }
    resolvedPropertyId = parsedProperty;
  }
  const result = insertUserRoleAssignmentStmt.run(userId, roleRow.id, resolvedPropertyId, tenantId);
  if (!result || result.changes === 0) {
    return res.redirect('/admin/utilizadores?error=scopes_exists');
  }
  revokeUserSessions(userId, req);
  logActivity(req.user.id, 'user:scope_grant', 'user_role', Number(result.lastInsertRowid), {
    user_id: userId,
    role_key: roleRow.key,
    property_id: resolvedPropertyId
  });
  res.redirect('/admin/utilizadores?updated=scopes');
});

app.post('/admin/user-roles/:id/delete', requireAdmin, (req, res) => {
  const assignmentId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(assignmentId)) {
    return res.redirect('/admin/utilizadores?error=scopes_not_found');
  }
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const assignment = selectUserRoleAssignmentStmt.get(assignmentId, tenantId);
  if (!assignment) {
    return res.redirect('/admin/utilizadores?error=scopes_not_found');
  }
  const target = db.prepare('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?').get(assignment.user_id, tenantId);
  const actorIsDev = req.user && req.user.role === MASTER_ROLE;
  if (target && normalizeRole(target.role) === MASTER_ROLE && !actorIsDev) {
    return res.redirect('/admin/utilizadores?error=scopes_forbidden');
  }
  const outcome = deleteUserRoleAssignmentStmt.run(assignmentId, tenantId);
  if (outcome && outcome.changes > 0) {
    revokeUserSessions(assignment.user_id, req);
    logActivity(req.user.id, 'user:scope_revoke', 'user_role', assignmentId, {
      user_id: assignment.user_id,
      role_key: assignment.role_key,
      property_id: assignment.property_id
    });
  }
  res.redirect('/admin/utilizadores?updated=scopes');
});

app.post('/admin/users/permissions', requireDev, (req, res) => {
  const rawUserId = req.body && req.body.user_id;
  const userId = Number.parseInt(rawUserId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.redirect('/admin/utilizadores?error=permissions_invalid');
  }
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!target) {
    return res.redirect('/admin/utilizadores?error=permissions_invalid');
  }
  const normalizedRole = normalizeRole(target.role);
  if (normalizedRole === MASTER_ROLE) {
    return res.redirect('/admin/utilizadores?error=permissions_forbidden');
  }

  const existingOverrides = selectUserPermissionOverridesStmt.all(target.id).map(entry => ({
    permission: entry.permission,
    is_granted: entry.is_granted ? 1 : 0
  }));
  const existingMap = new Map(existingOverrides.map(entry => [entry.permission, entry.is_granted]));

  const rawPermissions = req.body ? req.body.permissions : null;
  const normalizedSelection = Array.isArray(rawPermissions)
    ? rawPermissions
    : rawPermissions != null
    ? [rawPermissions]
    : [];
  const desiredSet = new Set();
  normalizedSelection.forEach(value => {
    const key = String(value || '').trim();
    if (ALL_PERMISSIONS.has(key)) desiredSet.add(key);
  });

  const baseSet = new Set(ROLE_PERMISSIONS[normalizedRole] || []);
  const overridesToPersist = [];
  Array.from(ALL_PERMISSIONS).forEach(permission => {
    const baseHas = baseSet.has(permission);
    const wantHas = desiredSet.has(permission);
    if (baseHas === wantHas) return;
    overridesToPersist.push({ permission, is_granted: wantHas ? 1 : 0 });
  });

  let changed = false;
  if (existingOverrides.length !== overridesToPersist.length) {
    changed = true;
  } else {
    for (const entry of overridesToPersist) {
      if (!existingMap.has(entry.permission) || existingMap.get(entry.permission) !== entry.is_granted) {
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    const apply = db.transaction(() => {
      deletePermissionOverridesForUserStmt.run(target.id);
      overridesToPersist.forEach(entry => {
        insertPermissionOverrideStmt.run(target.id, entry.permission, entry.is_granted);
      });
    });
    apply();
    revokeUserSessions(target.id, req);
    logChange(
      req.user.id,
      'user',
      Number(target.id),
      'permissions_update',
      { overrides: existingOverrides },
      { overrides: overridesToPersist }
    );
    const added = overridesToPersist.filter(entry => entry.is_granted).map(entry => entry.permission);
    const removed = overridesToPersist.filter(entry => !entry.is_granted).map(entry => entry.permission);
    logActivity(req.user.id, 'user:permissions_update', 'user', Number(target.id), { added, removed });
  }

  res.redirect('/admin/utilizadores?updated=permissions');
});

app.post('/admin/users/reveal-password', requireAdmin, (req,res)=>{
  if (!req.user || req.user.role !== MASTER_ROLE) {
    return res.status(403).json({ error: 'Sem permissão para consultar esta informação.' });
  }
  const { user_id, confirm_password } = req.body || {};
  if (!user_id || !confirm_password) {
    return res.status(400).json({ error: 'É necessário indicar o utilizador e confirmar a password.' });
  }
  const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) : 1;
  const self = db.prepare('SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?').get(req.user.id, tenantId);
  if (!self || !bcrypt.compareSync(confirm_password, self.password_hash)) {
    logActivity(req.user.id, 'user:password_reveal_denied', 'user', Number(user_id), {});
    return res.status(401).json({ error: 'Password inválida.' });
  }
  const target = db
    .prepare('SELECT id, username, password_hash FROM users WHERE id = ? AND tenant_id = ?')
    .get(user_id, tenantId);
  if (!target) {
    return res.status(404).json({ error: 'Utilizador não encontrado.' });
  }
  logActivity(req.user.id, 'user:password_reveal', 'user', Number(target.id), { username: target.username });
  res.json({
    user_id: target.id,
    username: target.username,
    password_hash: target.password_hash
  });
});
};
