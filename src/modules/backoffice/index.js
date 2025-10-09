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
    capitalizeMonth,
    safeJsonParse,
    wantsJson,
    parseOperationalFilters,
    computeOperationalDashboard,
    ensureDir,
    rememberActiveBrandingProperty,
    resolveBrandingForRequest,
    parseFeaturesStored,
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
    requireAdmin,
    overlaps,
    unitAvailable,
    rateQuote,
    emailTemplates,
    bookingEmailer,
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
    rescheduleBlockUpdateStmt
  } = context;

  const { UPLOAD_ROOT, UPLOAD_UNITS, UPLOAD_BRANDING } = paths || {};

  app.use('/admin', requireLogin, requireBackofficeAccess);

  const HOUSEKEEPING_TASK_TYPES = new Set(['checkout', 'checkin', 'midstay', 'custom']);
  const HOUSEKEEPING_TYPE_LABELS = {
    checkout: 'Limpeza de saída',
    checkin: 'Preparar entrada',
    midstay: 'Arrumação intermédia',
    custom: 'Tarefa de limpeza'
  };
  const HOUSEKEEPING_PRIORITIES = new Set(['alta', 'normal', 'baixa']);
  const HOUSEKEEPING_PRIORITY_ORDER = { alta: 0, normal: 1, baixa: 2 };

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

  const featureBuilderScript = inlineScript(
    featureBuilderSource.replace(/__FEATURE_PRESETS__/g, FEATURE_PRESETS_JSON)
  );
  const galleryManagerScript = inlineScript(galleryManagerSource);
  const revenueDashboardScript = inlineScript(revenueDashboardSource);

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

  const HOUSEKEEPING_TASK_BASE = `
    SELECT
      t.id,
      t.booking_id,
      t.unit_id,
      t.property_id,
      t.task_type,
      t.title,
      t.details,
      t.due_date,
      t.due_time,
      t.status,
      t.priority,
      t.source,
      t.created_by,
      t.created_at,
      t.started_at,
      t.started_by,
      t.completed_at,
      t.completed_by,
      u.id AS resolved_unit_id,
      u.name AS resolved_unit_name,
      prop_task.id AS task_property_id,
      prop_task.name AS task_property_name,
      prop_unit.id AS unit_property_id,
      prop_unit.name AS unit_property_name,
      b.guest_name AS booking_guest_name,
      b.checkin AS booking_checkin,
      b.checkout AS booking_checkout,
      b.status AS booking_status,
      creator.username AS created_by_username,
      starter.username AS started_by_username,
      completer.username AS completed_by_username
    FROM housekeeping_tasks t
    LEFT JOIN bookings b ON b.id = t.booking_id
    LEFT JOIN units u ON u.id = COALESCE(t.unit_id, b.unit_id)
    LEFT JOIN properties prop_unit ON prop_unit.id = u.property_id
    LEFT JOIN properties prop_task ON prop_task.id = t.property_id
    LEFT JOIN users creator ON creator.id = t.created_by
    LEFT JOIN users starter ON starter.id = t.started_by
    LEFT JOIN users completer ON completer.id = t.completed_by
  `;

  function mapHousekeepingTask(row) {
    const propertyId = row.property_id || row.task_property_id || row.unit_property_id || null;
    const propertyName = row.task_property_name || row.unit_property_name || '';
    const unitId = row.unit_id || row.resolved_unit_id || null;
    const unitName = row.resolved_unit_name || '';
    const effectiveDate =
      row.due_date ||
      (row.task_type === 'checkout'
        ? row.booking_checkout
        : row.task_type === 'checkin'
        ? row.booking_checkin
        : null);
    return {
      id: row.id,
      booking_id: row.booking_id,
      unit_id: unitId,
      property_id: propertyId,
      property_name: propertyName,
      unit_name: unitName,
      task_type: row.task_type,
      title: row.title,
      details: row.details,
      due_date: row.due_date,
      due_time: row.due_time,
      status: row.status,
      priority: row.priority,
      source: row.source,
      created_by: row.created_by,
      created_at: row.created_at,
      started_at: row.started_at,
      started_by: row.started_by,
      started_by_username: row.started_by_username,
      completed_at: row.completed_at,
      completed_by: row.completed_by,
      completed_by_username: row.completed_by_username,
      created_by_username: row.created_by_username,
      booking_checkin: row.booking_checkin,
      booking_checkout: row.booking_checkout,
      booking_guest_name: row.booking_guest_name,
      booking_status: row.booking_status,
      effective_date: effectiveDate || null
    };
  }

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

  function defaultHousekeepingTitle(taskType, booking) {
    const baseLabel = HOUSEKEEPING_TYPE_LABELS[taskType] || HOUSEKEEPING_TYPE_LABELS.custom;
    if (!booking) return baseLabel;
    const unitName = booking.unit_name || 'Unidade';
    const propertyName = booking.property_name ? `${booking.property_name} · ` : '';
    return `${propertyName}${baseLabel} · ${unitName}`;
  }

  function syncHousekeepingAutoTasks({ today, windowStart, windowEnd }) {
    const deleteTaskStmt = db.prepare('DELETE FROM housekeeping_tasks WHERE id = ?');
    const orphanTasks = db
      .prepare(
        `SELECT ht.id
           FROM housekeeping_tasks ht
           LEFT JOIN bookings b ON b.id = ht.booking_id
          WHERE ht.source = 'auto'
            AND ht.task_type = 'checkout'
            AND (b.id IS NULL OR b.status <> 'CONFIRMED')`
      )
      .all();
    orphanTasks.forEach(task => deleteTaskStmt.run(task.id));

    const startIso = windowStart.format('YYYY-MM-DD');
    const endIso = windowEnd.format('YYYY-MM-DD');
    const bookings = db
      .prepare(
        `SELECT b.id,
                b.unit_id,
                b.checkin,
                b.checkout,
                b.guest_name,
                u.property_id,
                u.name AS unit_name,
                p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.status = 'CONFIRMED'
            AND b.checkout BETWEEN ? AND ?`
      )
      .all(startIso, endIso);

    if (!bookings.length) return;

    const bookingIds = bookings.map(b => b.id);
    const placeholders = bookingIds.map(() => '?').join(',');
    const existing = placeholders
      ? db
          .prepare(
            `SELECT id, booking_id, status, source, due_date, priority
               FROM housekeeping_tasks
              WHERE task_type = 'checkout'
                AND booking_id IN (${placeholders})`
          )
          .all(...bookingIds)
      : [];

    const tasksByBooking = new Map();
    existing.forEach(task => {
      if (!tasksByBooking.has(task.booking_id)) tasksByBooking.set(task.booking_id, []);
      tasksByBooking.get(task.booking_id).push(task);
    });

    const insertStmt = db.prepare(
      `INSERT INTO housekeeping_tasks
         (booking_id, unit_id, property_id, task_type, title, details, due_date, due_time, status, priority, source, created_by)
       VALUES (?, ?, ?, 'checkout', ?, NULL, ?, NULL, 'pending', ?, 'auto', NULL)`
    );
    const updateStmt = db.prepare(
      `UPDATE housekeeping_tasks
          SET due_date = ?, priority = ?
        WHERE id = ?`
    );

    const priorityFor = dueDateIso => {
      const due = dayjs(dueDateIso);
      if (!due.isValid()) return 'normal';
      if (due.isBefore(today, 'day') || due.isSame(today, 'day')) return 'alta';
      if (due.diff(today, 'day') <= 1) return 'normal';
      return 'baixa';
    };

    db.transaction(() => {
      bookings.forEach(booking => {
        const existingTasks = tasksByBooking.get(booking.id) || [];
        const autoTask = existingTasks.find(task => task.source === 'auto');
        const desiredPriority = priorityFor(booking.checkout);
        if (autoTask) {
          if (autoTask.due_date !== booking.checkout || autoTask.priority !== desiredPriority) {
            updateStmt.run(booking.checkout, desiredPriority, autoTask.id);
          }
        } else if (existingTasks.length === 0) {
          const title = defaultHousekeepingTitle('checkout', booking);
          insertStmt.run(
            booking.id,
            booking.unit_id,
            booking.property_id,
            title,
            booking.checkout,
            desiredPriority
          );
        }
      });
    })();
  }

  function getHousekeepingTasks(options = {}) {
    const {
      statuses = null,
      includeCompleted = false,
      startDate = null,
      endDate = null,
      limit = null,
      order = 'default'
    } = options;
    const filters = [];
    const params = [];
    if (statuses && statuses.length) {
      filters.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    } else if (!includeCompleted) {
      filters.push("t.status IN ('pending','in_progress')");
    }
    if (startDate) {
      filters.push('(t.due_date IS NULL OR t.due_date >= ?)');
      params.push(startDate);
    }
    if (endDate) {
      filters.push('(t.due_date IS NULL OR t.due_date <= ?)');
      params.push(endDate);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const orderClause =
      order === 'completed_desc'
        ? 'ORDER BY t.completed_at DESC'
        : `ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, CASE t.priority WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.due_date IS NULL, t.due_date, t.due_time, t.created_at`;
    let limitClause = '';
    if (limit !== null && limit !== undefined) {
      const parsedLimit = Number(limit);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limitClause = ` LIMIT ${Math.floor(parsedLimit)}`;
      }
    }
    const sql = `${HOUSEKEEPING_TASK_BASE} ${whereClause} ${orderClause}${limitClause}`;
    const rows = db.prepare(sql).all(...params);
    return rows.map(mapHousekeepingTask);
  }

  function computeHousekeepingBoard({ horizonDays = 5, futureWindowDays = 21 } = {}) {
    const today = dayjs().startOf('day');
    const buckets = [];
    for (let i = 0; i < horizonDays; i++) {
      const date = today.add(i, 'day');
      buckets.push({
        iso: date.format('YYYY-MM-DD'),
        displayLabel: capitalizeMonth(date.format('D [de] MMMM')),
        shortLabel: date.format('DD/MM'),
        weekdayLabel: capitalizeMonth(date.format('dddd')),
        isToday: i === 0,
        checkins: [],
        checkouts: [],
        tasks: []
      });
    }
    const bucketMap = new Map(buckets.map((b) => [b.iso, b]));
    const extendedEnd = today.add(futureWindowDays, 'day');
    const bookingsWindowStart = today.subtract(3, 'day');

    syncHousekeepingAutoTasks({
      today,
      windowStart: bookingsWindowStart,
      windowEnd: extendedEnd
    });

    const taskList = getHousekeepingTasks({ includeCompleted: false, endDate: extendedEnd.format('YYYY-MM-DD') });
    const bookingRows = db
      .prepare(
        `SELECT b.id,
                b.guest_name,
                b.checkin,
                b.checkout,
                b.status,
                u.name AS unit_name,
                p.name AS property_name,
                p.id AS property_id
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.status IN ('CONFIRMED','PENDING')
            AND (
              b.checkin BETWEEN ? AND ?
              OR b.checkout BETWEEN ? AND ?
            )
          ORDER BY b.checkout, b.checkin`
      )
      .all(
        bookingsWindowStart.format('YYYY-MM-DD'),
        extendedEnd.format('YYYY-MM-DD'),
        bookingsWindowStart.format('YYYY-MM-DD'),
        extendedEnd.format('YYYY-MM-DD')
      );

    const overdueTasks = [];
    const futureTasks = [];
    const unscheduledTasks = [];
    const backlogCheckouts = [];
    const futureCheckins = [];
    const futureCheckouts = [];

    taskList.forEach((task) => {
      const effective = task.effective_date ? dayjs(task.effective_date) : null;
      const effectiveIso = effective ? effective.format('YYYY-MM-DD') : null;
      const enriched = { ...task, effective_iso: effectiveIso };
      if (effective && effective.isBefore(today, 'day')) {
        overdueTasks.push(enriched);
      } else if (effectiveIso && bucketMap.has(effectiveIso)) {
        bucketMap.get(effectiveIso).tasks.push(enriched);
      } else if (effective) {
        futureTasks.push(enriched);
      } else {
        unscheduledTasks.push(enriched);
      }
    });

    const sortBookings = (arr) =>
      arr.sort((a, b) => {
        const propDiff = (a.property_name || '').localeCompare(b.property_name || '', 'pt', { sensitivity: 'base' });
        if (propDiff !== 0) return propDiff;
        return (a.unit_name || '').localeCompare(b.unit_name || '', 'pt', { sensitivity: 'base' });
      });

    bookingRows.forEach((row) => {
      const checkoutDate = dayjs(row.checkout);
      const checkinDate = dayjs(row.checkin);
      const enriched = {
        ...row,
        range_label: formatDateRangeShort(row.checkin, row.checkout)
      };
      if (checkoutDate.isBefore(today, 'day')) {
        if (!checkoutDate.isBefore(today.subtract(3, 'day'), 'day')) {
          backlogCheckouts.push(enriched);
        }
      } else {
        const iso = checkoutDate.format('YYYY-MM-DD');
        if (bucketMap.has(iso)) {
          bucketMap.get(iso).checkouts.push(enriched);
        } else {
          futureCheckouts.push(enriched);
        }
      }

      if (!checkinDate.isBefore(today, 'day')) {
        const iso = checkinDate.format('YYYY-MM-DD');
        if (bucketMap.has(iso)) {
          bucketMap.get(iso).checkins.push(enriched);
        } else {
          futureCheckins.push(enriched);
        }
      }
    });

    buckets.forEach((bucket) => {
      sortBookings(bucket.checkouts);
      sortBookings(bucket.checkins);
      bucket.tasks.sort((a, b) => {
        const priorityDiff = (HOUSEKEEPING_PRIORITY_ORDER[a.priority] ?? 1) - (HOUSEKEEPING_PRIORITY_ORDER[b.priority] ?? 1);
        if (priorityDiff !== 0) return priorityDiff;
        if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
        if (a.due_time) return -1;
        if (b.due_time) return 1;
        return a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' });
      });
    });

    const sortTasksByDate = (arr) =>
      arr.sort((a, b) => {
        if (a.effective_date && b.effective_date) {
          return a.effective_date.localeCompare(b.effective_date);
        }
        if (a.effective_date) return -1;
        if (b.effective_date) return 1;
        return a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' });
      });

    sortTasksByDate(overdueTasks);
    sortTasksByDate(futureTasks);
    unscheduledTasks.sort((a, b) => a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' }));
    sortBookings(futureCheckins);
    sortBookings(futureCheckouts);

    return {
      today,
      buckets,
      overdueTasks,
      futureTasks,
      unscheduledTasks,
      backlogCheckouts,
      futureCheckins,
      futureCheckouts,
      tasks: taskList
    };
  }

  function renderHousekeepingBoard(options = {}) {
    const {
      buckets = [],
      overdueTasks = [],
      futureTasks = [],
      unscheduledTasks = [],
      backlogCheckouts = [],
      futureCheckins = [],
      futureCheckouts = [],
      canStart = false,
      canComplete = false,
      actionBase = '/limpeza/tarefas',
      redirectPath = '/limpeza/tarefas',
      variant = 'default'
    } = options;

    const isBackofficeVariant = variant === 'backoffice';
    const cardClass = isBackofficeVariant ? 'bo-card' : 'card';
    const statusLabels = { pending: 'Pendente', in_progress: 'Em curso', completed: 'Concluída' };
    const priorityLabels = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
    const safeActionBase = actionBase.replace(/\/+$/, '');
    const safeRedirect = esc(redirectPath || '/limpeza/tarefas');

    const statusBadgeClass = (status) => {
      if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
      if (status === 'in_progress') return 'bg-amber-100 text-amber-700';
      return 'bg-slate-100 text-slate-700';
    };
    const priorityBadgeClass = (priority) => {
      if (priority === 'alta') return 'bg-rose-100 text-rose-700';
      if (priority === 'baixa') return 'bg-slate-100 text-slate-600';
      return 'bg-sky-100 text-sky-700';
    };

    const renderTaskActions = (task) => {
      const actions = [];
      if (canStart && task.status === 'pending') {
        actions.push(html`<form method="post" action="${safeActionBase}/${task.id}/progresso" class="inline-flex">
            <input type="hidden" name="redirect" value="${safeRedirect}" />
            <button class="btn btn-light btn-xs" type="submit">Iniciar</button>
          </form>`);
      }
      if (canComplete && task.status !== 'completed') {
        actions.push(html`<form method="post" action="${safeActionBase}/${task.id}/concluir" class="inline-flex">
            <input type="hidden" name="redirect" value="${safeRedirect}" />
            <button class="btn btn-primary btn-xs" type="submit">Concluir</button>
          </form>`);
      }
      return actions.join('');
    };

    const renderTaskCard = (task, { highlight = false, showDate = false } = {}) => {
      const propertyUnitLine = `${task.property_name ? `${task.property_name} · ` : ''}${task.unit_name || 'Sem unidade associada'}`;
      const meta = [];
      if (showDate && task.effective_date) {
        meta.push(
          html`<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">${esc(
            capitalizeMonth(dayjs(task.effective_date).format('D [de] MMMM'))
          )}</span>`
        );
      }
      if (task.due_time) {
        meta.push(
          html`<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">${esc(
            task.due_time
          )}</span>`
        );
      }
      if (task.source && task.source !== 'manual') {
        meta.push(
          html`<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Automático</span>`
        );
      }
      if (task.created_by_username) {
        meta.push(
          html`<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Por ${esc(
            task.created_by_username
          )}</span>`
        );
      }

      const articleBaseClass = isBackofficeVariant
        ? `bo-housekeeping-task${highlight ? ' is-highlighted' : ''}`
        : `rounded-lg border ${highlight ? 'border-rose-200 bg-rose-50/70' : 'border-slate-200 bg-white'} shadow-sm`;
      const headerClass = isBackofficeVariant
        ? 'bo-housekeeping-task__header'
        : 'flex items-start justify-between gap-3';
      const statusWrapperClass = isBackofficeVariant
        ? 'bo-housekeeping-task__status'
        : 'flex flex-col items-end gap-1 text-right';
      const metaClass = isBackofficeVariant
        ? 'bo-housekeeping-task__meta'
        : 'flex flex-wrap gap-2 text-xs text-slate-500';
      const actionsClass = isBackofficeVariant
        ? 'bo-housekeeping-task__actions'
        : 'flex flex-wrap gap-2 pt-1';

      return html`<article class="${articleBaseClass} p-3 shadow-sm space-y-2">
        <div class="${headerClass}">
          <div>
            <p class="font-medium text-slate-900">${esc(task.title)}</p>
            <p class="text-sm text-slate-500">${esc(propertyUnitLine)}</p>
          </div>
          <div class="${statusWrapperClass}">
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(task.status)}">${esc(
              statusLabels[task.status] || task.status
            )}</span>
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(task.priority)}">${esc(
              priorityLabels[task.priority] || task.priority
            )}</span>
          </div>
        </div>
        ${task.booking_guest_name ? `<p class="text-sm text-slate-600">Hóspede: ${esc(task.booking_guest_name)}</p>` : ''}
        ${task.booking_checkin && task.booking_checkout
          ? `<p class="text-xs text-slate-500">Estadia: ${esc(formatDateRangeShort(task.booking_checkin, task.booking_checkout))}</p>`
          : ''}
        ${task.details ? `<p class="text-sm text-slate-600 whitespace-pre-line">${esc(task.details)}</p>` : ''}
        ${meta.length ? `<div class="${metaClass}">${meta.join('')}</div>` : ''}
        ${canStart || canComplete
          ? `<div class="${actionsClass}">${renderTaskActions(task)}</div>`
          : ''}
      </article>`;
    };

    const renderBookingCard = (booking, type) => {
      const badgeClass =
        type === 'checkout' ? 'bg-rose-100 text-rose-700' : type === 'backlog' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700';
      const label = type === 'checkout' ? 'Checkout' : type === 'backlog' ? 'Pendente' : 'Check-in';
      const cardClassName = isBackofficeVariant
        ? `bo-housekeeping-booking bo-housekeeping-booking--${type}`
        : `rounded-lg border ${
            type === 'checkout' || type === 'backlog' ? 'border-rose-200 bg-rose-50/60' : 'border-sky-200 bg-sky-50/60'
          } p-3 shadow-sm space-y-1`;
      return html`<article class="${cardClassName} space-y-1">
        <div class="flex items-center justify-between text-sm font-medium text-slate-800">
          <span>${esc(booking.property_name || '')} · ${esc(booking.unit_name || '')}</span>
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}">${label}</span>
        </div>
        <div class="text-sm text-slate-600">${esc(booking.guest_name || '—')}</div>
        <div class="text-xs text-slate-500">${esc(booking.range_label || '')}</div>
      </article>`;
    };

    const backlogSection = backlogCheckouts.length
      ? html`<section class="${cardClass} border border-rose-100 bg-rose-50/40 p-4 space-y-3">
          <div>
            <h3 class="text-base font-semibold text-rose-700">Check-outs recentes a aguardar limpeza</h3>
            <p class="text-sm text-rose-600">Garanta a higienização destas unidades para libertar novas entradas.</p>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            ${backlogCheckouts.map((item) => renderBookingCard(item, 'backlog')).join('')}
          </div>
        </section>`
      : '';

    const overdueSection = overdueTasks.length
      ? html`<section class="${cardClass} border border-rose-100 bg-rose-50/40 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-rose-700">Tarefas de limpeza em atraso</h3>
            <span class="text-sm text-rose-600 font-medium">${overdueTasks.length}</span>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            ${overdueTasks.map((task) => renderTaskCard(task, { highlight: true, showDate: true })).join('')}
          </div>
        </section>`
      : '';

    const bucketGrid = buckets.length
      ? html`<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          ${buckets
            .map(
              (bucket) => html`<section class="${cardClass} p-4 space-y-4">
                <header class="flex items-start justify-between gap-2">
                  <div>
                    <p class="text-xs uppercase tracking-wide text-slate-500">${esc(bucket.weekdayLabel)}</p>
                    <h3 class="text-lg font-semibold text-slate-900">${esc(bucket.displayLabel)}</h3>
                    <p class="text-xs text-slate-500">${esc(bucket.shortLabel)}</p>
                  </div>
                  ${bucket.isToday
                    ? '<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Hoje</span>'
                    : ''}
                </header>
                <div class="space-y-4">
                  ${bucket.checkouts.length
                    ? html`<div class="space-y-2">
                        <h4 class="text-sm font-semibold text-rose-700">Saídas</h4>
                        <div class="space-y-2">
                          ${bucket.checkouts.map((booking) => renderBookingCard(booking, 'checkout')).join('')}
                        </div>
                      </div>`
                    : ''}
                  ${bucket.checkins.length
                    ? html`<div class="space-y-2">
                        <h4 class="text-sm font-semibold text-sky-700">Entradas</h4>
                        <div class="space-y-2">
                          ${bucket.checkins.map((booking) => renderBookingCard(booking, 'checkin')).join('')}
                        </div>
                      </div>`
                    : ''}
                  ${bucket.tasks.length
                    ? html`<div class="space-y-2">
                        <h4 class="text-sm font-semibold text-slate-700">Tarefas</h4>
                        <div class="space-y-2">
                          ${bucket.tasks.map((task) => renderTaskCard(task)).join('')}
                        </div>
                      </div>`
                    : ''}
                  ${!bucket.checkouts.length && !bucket.checkins.length && !bucket.tasks.length
                    ? '<p class="text-sm text-slate-500">Sem tarefas planeadas.</p>'
                    : ''}
                </div>
              </section>`
            )
            .join('')}
        </div>`
      : isBackofficeVariant
      ? html`<section class="${cardClass} p-4"><p class="text-sm text-slate-500">Sem tarefas planeadas para os próximos dias.</p></section>`
      : '<p class="text-sm text-slate-500">Sem tarefas planeadas para os próximos dias.</p>';

    const futureGroups = [];
    const groupMap = new Map();
    futureTasks.forEach((task) => {
      const key = task.effective_iso || task.effective_date || 'future';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          label: task.effective_date ? capitalizeMonth(dayjs(task.effective_date).format('D [de] MMMM')) : 'Próximas',
          tasks: []
        });
        futureGroups.push(groupMap.get(key));
      }
      groupMap.get(key).tasks.push(task);
    });

    const futureSection = futureGroups.length
      ? html`<section class="${cardClass} p-4 space-y-4">
          <h3 class="text-base font-semibold text-slate-800">Próximas limpezas</h3>
          ${futureGroups
            .map(
              (group) => html`<div class="space-y-2">
                <h4 class="text-sm font-semibold text-slate-600">${esc(group.label)}</h4>
                <div class="space-y-2">
                  ${group.tasks.map((task) => renderTaskCard(task, { showDate: true })).join('')}
                </div>
              </div>`
            )
            .join('')}
        </section>`
      : '';

    const unscheduledSection = unscheduledTasks.length
      ? html`<section class="${cardClass} p-4 space-y-3">
          <h3 class="text-base font-semibold text-slate-800">Tarefas sem data definida</h3>
          <div class="grid gap-3 md:grid-cols-2">
            ${unscheduledTasks.map((task) => renderTaskCard(task)).join('')}
          </div>
        </section>`
      : '';

    const futureEventsSection = futureCheckins.length || futureCheckouts.length
      ? html`<section class="${cardClass} p-4 space-y-4">
          <h3 class="text-base font-semibold text-slate-800">Agenda futura</h3>
          <div class="grid gap-4 md:grid-cols-2">
            ${futureCheckouts.length
              ? html`<div class="space-y-2">
                  <h4 class="text-sm font-semibold text-rose-700">Saídas planeadas</h4>
                  <div class="space-y-2">
                    ${futureCheckouts.map((booking) => renderBookingCard(booking, 'checkout')).join('')}
                  </div>
                </div>`
              : ''}
            ${futureCheckins.length
              ? html`<div class="space-y-2">
                  <h4 class="text-sm font-semibold text-sky-700">Entradas planeadas</h4>
                  <div class="space-y-2">
                    ${futureCheckins.map((booking) => renderBookingCard(booking, 'checkin')).join('')}
                  </div>
                </div>`
              : ''}
          </div>
        </section>`
      : '';

    return [backlogSection, overdueSection, bucketGrid, futureSection, unscheduledSection, futureEventsSection]
      .filter(Boolean)
      .join('');
  }

  function resolveHousekeepingRedirect(req, fallback) {
    const target = req.body && typeof req.body.redirect === 'string' ? req.body.redirect : null;
    if (target && isSafeRedirectTarget(target)) {
      return target;
    }
    return fallback;
  }

  // ===================== Backoffice (protegido) =====================
  app.get('/limpeza/tarefas', requireLogin, requirePermission('housekeeping.view'), (req, res) => {
    const board = computeHousekeepingBoard({ horizonDays: 5, futureWindowDays: 21 });
    const canCompleteTasks = userCan(req.user, 'housekeeping.complete');
    const totalTasks = board.tasks || [];
    const pendingCount = totalTasks.filter(task => task.status === 'pending').length;
    const inProgressCount = totalTasks.filter(task => task.status === 'in_progress').length;
    const completedWindowStart = dayjs().subtract(1, 'day');
    const completedRecent = getHousekeepingTasks({
      statuses: ['completed'],
      includeCompleted: true,
      limit: 40,
      order: 'completed_desc'
    }).filter(task => task.completed_at && dayjs(task.completed_at).isAfter(completedWindowStart));
    const completedLast24h = completedRecent.length;
    const boardHtml = renderHousekeepingBoard({
      ...board,
      canStart: canCompleteTasks,
      canComplete: canCompleteTasks,
      actionBase: '/limpeza/tarefas',
      redirectPath: '/limpeza/tarefas',
      variant: 'backoffice'
    });
    const body = html`
      <div class="bo-main">
        <header class="bo-header">
          <h1>Mapa de limpezas</h1>
          <p>Acompanhe entradas, saídas e tarefas atribuídas em tempo real.</p>
        </header>
        <section class="bo-card">
          <h2>Resumo rápido</h2>
          <div class="bo-metrics">
            <div class="bo-metric"><strong>${pendingCount}</strong><span>Tarefas pendentes</span></div>
            <div class="bo-metric"><strong>${inProgressCount}</strong><span>Em curso</span></div>
            <div class="bo-metric"><strong>${completedLast24h}</strong><span>Concluídas (24h)</span></div>
          </div>
        </section>
        <div class="bo-stack">
          ${boardHtml}
        </div>
      </div>
    `;
    res.send(
      layout({
        title: 'Mapa de limpezas',
        activeNav: 'housekeeping',
        user: req.user,
        branding: resolveBrandingForRequest(req),
        pageClass: 'page-backoffice page-housekeeping',
        body
      })
    );
  });

  app.get('/admin/limpeza', requireLogin, requirePermission('housekeeping.manage'), (req, res) => {
    const board = computeHousekeepingBoard({ horizonDays: 6, futureWindowDays: 30 });
    const canCompleteTasks = userCan(req.user, 'housekeeping.complete');
    const totalTasks = board.tasks || [];
    const pendingCount = totalTasks.filter(task => task.status === 'pending').length;
    const inProgressCount = totalTasks.filter(task => task.status === 'in_progress').length;
    const highPriorityCount = totalTasks.filter(task => task.priority === 'alta' && task.status !== 'completed').length;
    const completedLast7 = getHousekeepingTasks({
      statuses: ['completed'],
      includeCompleted: true,
      limit: 80,
      order: 'completed_desc'
    }).filter(task => task.completed_at && dayjs(task.completed_at).isAfter(dayjs().subtract(7, 'day')));
    const boardHtml = renderHousekeepingBoard({
      ...board,
      canStart: canCompleteTasks,
      canComplete: canCompleteTasks,
      actionBase: '/limpeza/tarefas',
      redirectPath: '/admin/limpeza'
    });
    const upcomingBookings = db
      .prepare(
        `SELECT b.id,
                b.checkin,
                b.checkout,
                b.guest_name,
                u.name AS unit_name,
                p.id AS property_id,
                p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.status IN ('CONFIRMED','PENDING')
            AND b.checkout >= date('now','-3 day')
          ORDER BY b.checkout ASC
          LIMIT 80`
      )
      .all();
    const units = db
      .prepare(
        `SELECT u.id, u.name, p.id AS property_id, p.name AS property_name
           FROM units u
           JOIN properties p ON p.id = u.property_id
          ORDER BY p.name, u.name`
      )
      .all();
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const recentCompleted = completedLast7.slice(0, 12);
    const typeOptions = ['checkout', 'checkin', 'midstay', 'custom'];
    const priorityOptions = ['alta', 'normal', 'baixa'];
    const today = board.today || dayjs().startOf('day');
    const todayBucket = Array.isArray(board.buckets)
      ? board.buckets.find(bucket => bucket && bucket.isToday) || {}
      : {};
    const todaysTasks = Array.isArray(todayBucket.tasks) ? todayBucket.tasks : [];
    const todaysCheckins = Array.isArray(todayBucket.checkins) ? todayBucket.checkins : [];
    const todaysCheckouts = Array.isArray(todayBucket.checkouts) ? todayBucket.checkouts : [];
    const priorityText = priority => (priority === 'alta' ? 'Prioridade alta' : priority === 'baixa' ? 'Prioridade baixa' : 'Prioridade normal');
    const statusText = status => (status === 'in_progress' ? 'Em curso' : status === 'completed' ? 'Concluída' : 'Pendente');
    const renderTodayTask = task => html`<article class="rounded-2xl border border-amber-200/80 bg-white/80 p-3 shadow-sm space-y-1">
        <p class="font-semibold text-slate-900">${esc(task.title)}</p>
        <p class="text-xs text-slate-600">${esc(`${task.property_name ? `${task.property_name} · ` : ''}${task.unit_name || 'Sem unidade associada'}`)}</p>
        ${task.due_time
          ? `<p class="text-xs text-amber-600 mt-1 flex items-center gap-1"><span class="inline-block h-2 w-2 rounded-full bg-amber-500"></span>${esc(task.due_time)}</p>`
          : ''}
        <div class="mt-2 flex flex-wrap gap-2 text-[11px] font-medium">
          <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">${esc(priorityText(task.priority))}</span>
          <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">${esc(statusText(task.status))}</span>
        </div>
      </article>`;
    const todayTasksHtml = todaysTasks.length
      ? `<div class="grid gap-3 sm:grid-cols-2">${todaysTasks.slice(0, 6).map(renderTodayTask).join('')}</div>`
      : '<p class="text-sm text-amber-700">Sem tarefas programadas para hoje.</p>';
    const todayMetaBadges = [];
    if (todaysCheckouts.length) {
      todayMetaBadges.push(
        html`<span class="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-amber-700"><span class="h-2 w-2 rounded-full bg-rose-400"></span>${todaysCheckouts.length} saída${todaysCheckouts.length === 1 ? '' : 's'}</span>`
      );
    }
    if (todaysCheckins.length) {
      todayMetaBadges.push(
        html`<span class="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-amber-700"><span class="h-2 w-2 rounded-full bg-emerald-400"></span>${todaysCheckins.length} entrada${todaysCheckins.length === 1 ? '' : 's'}</span>`
      );
    }
    const todayMetaHtml = todayMetaBadges.length ? `<div class="flex flex-wrap gap-2">${todayMetaBadges.join('')}</div>` : '';
    const todayWeekdayLabel = todayBucket.weekdayLabel || capitalizeMonth(today.format('dddd'));
    const importantMessages = [];
    if (board.overdueTasks && board.overdueTasks.length) {
      importantMessages.push({
        tone: 'alert',
        text: `${board.overdueTasks.length} tarefa${board.overdueTasks.length === 1 ? '' : 's'} em atraso aguardam ação.`
      });
    }
    if (board.backlogCheckouts && board.backlogCheckouts.length) {
      importantMessages.push({
        tone: 'warning',
        text: `${board.backlogCheckouts.length} unidade${board.backlogCheckouts.length === 1 ? '' : 's'} aguardam limpeza após check-out.`
      });
    }
    if (highPriorityCount) {
      importantMessages.push({
        tone: 'info',
        text: `${highPriorityCount} tarefa${highPriorityCount === 1 ? '' : 's'} com prioridade alta estão abertas.`
      });
    }
    if (!importantMessages.length) {
      importantMessages.push({ tone: 'info', text: 'Sem alertas no momento. Continue o excelente trabalho!' });
    }
    const messageToneClass = tone => {
      if (tone === 'alert') return 'bg-rose-50 border-rose-200 text-rose-700';
      if (tone === 'warning') return 'bg-amber-50 border-amber-200 text-amber-700';
      return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    };
    const messagesHtml = `<ul class="space-y-3">${importantMessages
      .map(
        message => html`<li class="rounded-2xl border ${messageToneClass(message.tone)} px-4 py-3 text-sm leading-relaxed">${esc(
          message.text
        )}</li>`
      )
      .join('')}</ul>`;
    const quickStats = [
      {
        label: 'Pendentes',
        value: pendingCount,
        className: 'border-amber-200 bg-amber-50 text-amber-700'
      },
      {
        label: 'Em curso',
        value: inProgressCount,
        className: 'border-orange-200 bg-orange-50 text-orange-700'
      },
      {
        label: 'Prioridade alta',
        value: highPriorityCount,
        className: 'border-rose-200 bg-rose-50 text-rose-700'
      }
    ];
    const quickStatsHtml = quickStats
      .map(
        stat => html`<div class="rounded-2xl border ${stat.className} px-4 py-3 shadow-sm">
          <p class="text-xs uppercase tracking-wide text-slate-500">${esc(stat.label)}</p>
          <p class="text-2xl font-semibold">${stat.value}</p>
        </div>`
      )
      .join('');
    const computeAverageDurationMinutes = taskList => {
      if (!Array.isArray(taskList) || !taskList.length) return null;
      const durations = taskList
        .map(task => {
          if (!task.started_at || !task.completed_at) return null;
          const duration = dayjs(task.completed_at).diff(dayjs(task.started_at), 'minute');
          return Number.isFinite(duration) && duration >= 0 ? duration : null;
        })
        .filter(value => value !== null);
      if (!durations.length) return null;
      const total = durations.reduce((sum, value) => sum + value, 0);
      return Math.round(total / durations.length);
    };
    const formatDurationLabel = minutes => {
      if (minutes === null || minutes === undefined) return '—';
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins ? `${hours}h ${mins}min` : `${hours}h`;
    };
    const averageDuration = computeAverageDurationMinutes(recentCompleted);
    const averageHighPriorityDuration = computeAverageDurationMinutes(
      recentCompleted.filter(task => task.priority === 'alta')
    );
    const tempoMetrics = [
      {
        label: 'Média geral',
        value: formatDurationLabel(averageDuration),
        className: 'border-amber-200 bg-amber-50 text-amber-700'
      },
      {
        label: 'Alta prioridade',
        value: averageHighPriorityDuration !== null ? formatDurationLabel(averageHighPriorityDuration) : 'Sem dados',
        className: 'border-rose-200 bg-rose-50 text-rose-700'
      },
      {
        label: 'Concluídas (7 dias)',
        value: recentCompleted.length,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }
    ];
    const tempoMetricsHtml = tempoMetrics
      .map(
        metric => html`<div class="rounded-2xl border ${metric.className} px-4 py-3 shadow-sm">
          <p class="text-xs uppercase tracking-wide text-slate-500">${esc(metric.label)}</p>
          <p class="text-xl font-semibold">${esc(String(metric.value))}</p>
        </div>`
      )
      .join('');
    const weeklyBuckets = Array.isArray(board.buckets) ? board.buckets.slice(0, 6) : [];
    const weeklyHtml = weeklyBuckets.length
      ? `<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${weeklyBuckets
          .map(bucket => {
            const taskList = Array.isArray(bucket.tasks) ? bucket.tasks : [];
            const checkinCount = Array.isArray(bucket.checkins) ? bucket.checkins.length : 0;
            const checkoutCount = Array.isArray(bucket.checkouts) ? bucket.checkouts.length : 0;
            return html`<article class="rounded-2xl border border-amber-100 bg-white/80 p-4 shadow-sm space-y-3">
              <header class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-xs uppercase tracking-wide text-amber-600">${esc(bucket.weekdayLabel || '')}</p>
                  <h3 class="text-base font-semibold text-slate-900">${esc(bucket.displayLabel || '')}</h3>
                </div>
                ${bucket.isToday
                  ? '<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Hoje</span>'
                  : ''}
              </header>
              <p class="text-sm text-slate-500">${taskList.length ? `${taskList.length} tarefa${taskList.length === 1 ? '' : 's'}` : 'Sem tarefas'}</p>
              ${taskList.length
                ? `<ul class="space-y-1 text-xs text-slate-600">${taskList
                    .slice(0, 3)
                    .map(task => `<li>• ${esc(task.title)}</li>`)
                    .join('')}</ul>${taskList.length > 3 ? '<p class="text-xs text-slate-400">+' + (taskList.length - 3) + ' tarefa(s)</p>' : ''}`
                : ''}
              ${(checkinCount || checkoutCount)
                ? `<div class="flex flex-wrap gap-2 text-[11px] text-slate-600">
                    ${checkoutCount ? `<span class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-600">${checkoutCount} saída${checkoutCount === 1 ? '' : 's'}</span>` : ''}
                    ${checkinCount ? `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600">${checkinCount} entrada${checkinCount === 1 ? '' : 's'}</span>` : ''}
                  </div>`
                : ''}
            </article>`;
          })
          .join('')}</div>`
      : '<p class="text-sm text-amber-700">Sem tarefas planeadas para os próximos dias.</p>';
    const taskTypeInventory = typeOptions.map(type => {
      const label = HOUSEKEEPING_TYPE_LABELS[type] || type;
      const tasksForType = totalTasks.filter(task => task.task_type === type);
      const pending = tasksForType.filter(task => task.status === 'pending').length;
      const inProgress = tasksForType.filter(task => task.status === 'in_progress').length;
      return { type, label, pending, inProgress };
    });
    const inventoryRowsHtml = taskTypeInventory.length
      ? taskTypeInventory
          .map(item => {
            const totalActive = item.pending + item.inProgress;
            const statusLabel = totalActive
              ? `${item.pending} pendente${item.pending === 1 ? '' : 's'} · ${item.inProgress} em curso`
              : 'Sem tarefas ativas';
            return html`<tr>
              <td data-label="Item">
                <div class="font-medium text-slate-800">${esc(item.label)}</div>
                <div class="text-xs text-slate-500">${esc(item.type === 'custom' ? 'Manual' : item.type)}</div>
              </td>
              <td data-label="Quantidade" class="text-sm text-slate-600">${esc(statusLabel)}</td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="2" class="text-sm text-center text-amber-700">Sem tarefas registadas.</td></tr>';
    const propertyTaskStats = new Map();
    const propertyKey = (id, name) => (id !== null && id !== undefined ? `prop:${id}` : `none:${name || 'Sem propriedade'}`);
    totalTasks.forEach(task => {
      const key = propertyKey(task.property_id, task.property_name);
      if (!propertyTaskStats.has(key)) {
        propertyTaskStats.set(key, {
          id: task.property_id ?? null,
          name: task.property_name || 'Sem propriedade',
          pending: 0,
          inProgress: 0,
          highPriority: 0
        });
      }
      const stats = propertyTaskStats.get(key);
      if (task.status === 'in_progress') {
        stats.inProgress += 1;
      } else if (task.status === 'pending') {
        stats.pending += 1;
      }
      if (task.priority === 'alta') {
        stats.highPriority += 1;
      }
    });
    const occupancyPriority = { Livre: 0, 'Check-out hoje': 1, 'Check-in hoje': 2, Ocupado: 3 };
    const propertyOccupancy = new Map();
    const setPropertyStatus = (id, name, status) => {
      const key = propertyKey(id, name);
      const current = propertyOccupancy.get(key);
      if (!current || occupancyPriority[status] > occupancyPriority[current.status]) {
        propertyOccupancy.set(key, { id: id ?? null, name, status });
      }
    };
    upcomingBookings.forEach(booking => {
      const checkinDate = dayjs(booking.checkin);
      const checkoutDate = dayjs(booking.checkout);
      let status = 'Livre';
      if ((today.isSame(checkinDate, 'day') || today.isAfter(checkinDate, 'day')) && today.isBefore(checkoutDate, 'day')) {
        status = 'Ocupado';
      } else if (today.isSame(checkinDate, 'day')) {
        status = 'Check-in hoje';
      } else if (today.isSame(checkoutDate, 'day')) {
        status = 'Check-out hoje';
      }
      setPropertyStatus(booking.property_id ?? null, booking.property_name, status);
    });
    const occupancyBadgeClass = status => {
      if (status === 'Ocupado') return 'bg-rose-100 text-rose-700';
      if (status === 'Check-in hoje') return 'bg-amber-100 text-amber-700';
      if (status === 'Check-out hoje') return 'bg-orange-100 text-orange-700';
      return 'bg-emerald-100 text-emerald-700';
    };
    const propertyRows = [];
    properties.forEach(property => {
      const key = propertyKey(property.id, property.name);
      const stats = propertyTaskStats.get(key) || {
        id: property.id,
        name: property.name,
        pending: 0,
        inProgress: 0,
        highPriority: 0
      };
      const occupancy = propertyOccupancy.get(key);
      const status = occupancy ? occupancy.status : 'Livre';
      propertyRows.push(
        html`<tr>
          <td data-label="Propriedade">
            <div class="font-medium text-slate-800">${esc(property.name)}</div>
            <div class="text-xs text-slate-500">${stats.pending} pendente${stats.pending === 1 ? '' : 's'} · ${stats.inProgress} em curso</div>
            ${stats.highPriority
              ? `<div class="text-xs text-rose-600">Prioridade alta: ${stats.highPriority}</div>`
              : ''}
          </td>
          <td data-label="Ocupação" class="text-right md:text-left">
            <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${occupancyBadgeClass(status)}">${esc(
              status
            )}</span>
          </td>
        </tr>`
      );
    });
    propertyTaskStats.forEach(stats => {
      if (stats.id !== null && stats.id !== undefined) return;
      propertyRows.push(
        html`<tr>
          <td data-label="Propriedade">
            <div class="font-medium text-slate-800">${esc(stats.name)}</div>
            <div class="text-xs text-slate-500">${stats.pending} pendente${stats.pending === 1 ? '' : 's'} · ${stats.inProgress} em curso</div>
            ${stats.highPriority
              ? `<div class="text-xs text-rose-600">Prioridade alta: ${stats.highPriority}</div>`
              : ''}
          </td>
          <td data-label="Ocupação" class="text-right md:text-left">
            <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-600">Sem reservas</span>
          </td>
        </tr>`
      );
    });
    const propertyTableRowsHtml = propertyRows.length
      ? propertyRows.join('')
      : '<tr><td colspan="2" class="text-sm text-center text-amber-700">Sem propriedades registadas.</td></tr>';
    const body = html`
      <div class="hk-dashboard space-y-8">
        <header class="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 p-6 shadow-sm">
          <div class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 class="text-3xl font-semibold text-amber-900">Gestão de limpezas</h1>
              <p class="mt-1 text-sm text-amber-800">Visualize prioridades, acompanhe tarefas em tempo real e mantenha a equipa alinhada.</p>
            </div>
            <div class="grid w-full gap-3 sm:grid-cols-3 md:w-auto">
              <div class="rounded-2xl border border-amber-300 bg-white/80 px-4 py-3 text-center shadow-sm">
                <p class="text-xs uppercase tracking-wide text-amber-600">Pendentes</p>
                <p class="text-2xl font-semibold text-amber-900">${pendingCount}</p>
              </div>
              <div class="rounded-2xl border border-orange-300 bg-white/80 px-4 py-3 text-center shadow-sm">
                <p class="text-xs uppercase tracking-wide text-orange-500">Em curso</p>
                <p class="text-2xl font-semibold text-orange-700">${inProgressCount}</p>
              </div>
              <div class="rounded-2xl border border-rose-300 bg-white/80 px-4 py-3 text-center shadow-sm">
                <p class="text-xs uppercase tracking-wide text-rose-500">Alta prioridade</p>
                <p class="text-2xl font-semibold text-rose-600">${highPriorityCount}</p>
              </div>
            </div>
          </div>
        </header>
        <section class="grid gap-5 lg:grid-cols-[1.8fr_1.2fr_1fr]">
          <div class="rounded-3xl border border-amber-200 bg-amber-50/80 p-5 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-amber-900">Tarefas de hoje</h2>
              <span class="text-xs uppercase tracking-wide text-amber-600">${esc(todayWeekdayLabel)}</span>
            </div>
            ${todayTasksHtml}
            ${todayMetaHtml}
          </div>
          <div class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-amber-900">Mensagens</h2>
              <span class="text-xs text-amber-500">Resumo diário</span>
            </div>
            ${messagesHtml}
          </div>
          <div class="space-y-4">
            <div class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-3">
              <h2 class="text-lg font-semibold text-amber-900">Tarefas</h2>
              <div class="grid gap-3">${quickStatsHtml}</div>
            </div>
            <div class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-3">
              <h2 class="text-lg font-semibold text-amber-900">Tempo médio por limpeza</h2>
              <div class="grid gap-3">${tempoMetricsHtml}</div>
            </div>
          </div>
        </section>
        <section class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-amber-900">Tarefas semanais</h2>
            <span class="text-sm text-amber-600">${weeklyBuckets.length
              ? `${weeklyBuckets.reduce(
                  (sum, bucket) => sum + (Array.isArray(bucket.tasks) ? bucket.tasks.length : 0),
                  0
                )} tarefa${weeklyBuckets.reduce(
                  (sum, bucket) => sum + (Array.isArray(bucket.tasks) ? bucket.tasks.length : 0),
                  0
                ) === 1 ? '' : 's'} nos próximos dias`
              : 'Sem tarefas agendadas'}</span>
          </div>
          ${weeklyHtml}
        </section>
        <section class="grid gap-5 lg:grid-cols-2">
          <div class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
            <h2 class="text-lg font-semibold text-amber-900">Inventário de material</h2>
            <div class="bo-table responsive-table">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-amber-600">
                    <th>Item</th>
                    <th>Quantidade</th>
                  </tr>
                </thead>
                <tbody>${inventoryRowsHtml}</tbody>
              </table>
            </div>
          </div>
          <div class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
            <h2 class="text-lg font-semibold text-amber-900">Listagem de propriedades</h2>
            <div class="bo-table responsive-table">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-amber-600">
                    <th>Propriedade</th>
                    <th class="md:text-right">Ocupação</th>
                  </tr>
                </thead>
                <tbody>${propertyTableRowsHtml}</tbody>
              </table>
            </div>
          </div>
        </section>
        <section class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 class="text-lg font-semibold text-amber-900">Nova tarefa de limpeza</h2>
            <p class="text-sm text-amber-700">Associe a tarefa a uma reserva existente ou defina manualmente a unidade e as datas.</p>
          </div>
          <form method="post" action="/admin/limpeza/tarefas" class="grid gap-4">
            <input type="hidden" name="redirect" value="/admin/limpeza" />
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Tipo de tarefa</span>
                <select name="task_type" class="input">
                  ${typeOptions
                    .map(
                      value =>
                        `<option value="${esc(value)}">${esc(HOUSEKEEPING_TYPE_LABELS[value] || value)}</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Prioridade</span>
                <select name="priority" class="input">
                  ${priorityOptions
                    .map(value => `<option value="${esc(value)}">${esc(value === 'alta' ? 'Alta' : value === 'baixa' ? 'Baixa' : 'Normal')}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
            <label class="grid gap-2 text-sm">
              <span class="font-medium text-slate-700">Reserva (opcional)</span>
              <select name="booking_id" class="input">
                <option value="">Selecionar reserva...</option>
                ${upcomingBookings
                  .map(
                    booking =>
                      `<option value="${booking.id}">${esc(
                        `${booking.property_name} · ${booking.unit_name} — ${booking.guest_name || 'Sem hóspede'} (${formatDateRangeShort(
                          booking.checkin,
                          booking.checkout
                        )})`
                      )}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Unidade (opcional)</span>
                <select name="unit_id" class="input">
                  <option value="">Selecionar unidade...</option>
                  ${units
                    .map(unit => `<option value="${unit.id}">${esc(`${unit.property_name} · ${unit.name}`)}</option>`)
                    .join('')}
                </select>
              </label>
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Propriedade (opcional)</span>
                <select name="property_id" class="input">
                  <option value="">Selecionar propriedade...</option>
                  ${properties.map(property => `<option value="${property.id}">${esc(property.name)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Data prevista</span>
                <input type="date" name="due_date" class="input" />
              </label>
              <label class="grid gap-2 text-sm">
                <span class="font-medium text-slate-700">Hora limite (opcional)</span>
                <input type="time" name="due_time" class="input" />
              </label>
            </div>
            <label class="grid gap-2 text-sm">
              <span class="font-medium text-slate-700">Título</span>
              <input name="title" class="input" placeholder="Ex.: Preparar para nova entrada" />
            </label>
            <label class="grid gap-2 text-sm">
              <span class="font-medium text-slate-700">Notas para a equipa (opcional)</span>
              <textarea name="details" class="input min-h-[96px]" placeholder="Indique instruções específicas ou pedidos dos hóspedes"></textarea>
            </label>
            <div class="flex justify-end">
              <button class="btn btn-primary">Criar tarefa</button>
            </div>
          </form>
        </section>
        <section class="space-y-6">${boardHtml}</section>
        ${recentCompleted.length
          ? html`<section class="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm space-y-4">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-amber-900">Concluídas nos últimos 7 dias</h2>
                <span class="text-sm text-amber-600">${completedLast7.length} no total</span>
              </div>
              <div class="responsive-table">
                <table>
                  <thead>
                    <tr>
                      <th>Tarefa</th>
                      <th>Unidade</th>
                      <th>Concluída</th>
                      <th>Por</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recentCompleted
                      .map(
                        task => html`<tr>
                          <td data-label="Tarefa">
                            <div class="font-medium text-slate-800">${esc(task.title)}</div>
                            <div class="text-xs text-slate-500">${esc(HOUSEKEEPING_TYPE_LABELS[task.task_type] || task.task_type)}</div>
                          </td>
                          <td data-label="Unidade">
                            ${task.property_name ? `<div>${esc(task.property_name)}</div>` : ''}
                            ${task.unit_name ? `<div class="text-xs text-slate-500">${esc(task.unit_name)}</div>` : ''}
                          </td>
                          <td data-label="Concluída">
                            ${task.completed_at ? esc(dayjs(task.completed_at).format('DD/MM HH:mm')) : '—'}
                          </td>
                          <td data-label="Por">${task.completed_by_username ? esc(task.completed_by_username) : '—'}</td>
                          <td class="text-right">
                            <form method="post" action="/admin/limpeza/tarefas/${task.id}/reabrir">
                              <input type="hidden" name="redirect" value="/admin/limpeza" />
                              <button class="btn btn-light btn-xs" type="submit">Reabrir</button>
                            </form>
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </section>`
          : ''}
      </div>
    `;
    res.send(
      layout({
        title: 'Gestão de limpezas',
        activeNav: 'housekeeping',
        user: req.user,
        branding: resolveBrandingForRequest(req),
        body
      })
    );
  });

  app.post('/admin/limpeza/tarefas', requireLogin, requirePermission('housekeeping.manage'), (req, res) => {
    const data = req.body || {};
    const bookingId = data.booking_id ? Number.parseInt(data.booking_id, 10) : null;
    const unitIdRaw = data.unit_id ? Number.parseInt(data.unit_id, 10) : null;
    const propertyIdRaw = data.property_id ? Number.parseInt(data.property_id, 10) : null;
    const typeKey = typeof data.task_type === 'string' ? data.task_type.toLowerCase() : 'custom';
    const taskType = HOUSEKEEPING_TASK_TYPES.has(typeKey) ? typeKey : 'custom';
    const priorityKey = typeof data.priority === 'string' ? data.priority.toLowerCase() : 'normal';
    const taskPriority = HOUSEKEEPING_PRIORITIES.has(priorityKey) ? priorityKey : 'normal';
    const trimmedTitle = typeof data.title === 'string' ? data.title.trim() : '';
    const trimmedDetails = typeof data.details === 'string' ? data.details.trim() : '';
    let dueDate = typeof data.due_date === 'string' && data.due_date.trim() ? data.due_date.trim() : null;
    if (dueDate && !dayjs(dueDate, 'YYYY-MM-DD', true).isValid()) dueDate = null;
    let dueTime = typeof data.due_time === 'string' && data.due_time.trim() ? data.due_time.trim() : null;
    if (dueTime && !/^[0-2]\d:[0-5]\d$/.test(dueTime)) dueTime = null;
    let resolvedUnitId = Number.isInteger(unitIdRaw) ? unitIdRaw : null;
    let resolvedPropertyId = Number.isInteger(propertyIdRaw) ? propertyIdRaw : null;
    let booking = null;
    if (bookingId) {
      booking = db
        .prepare(
          `SELECT b.id,
                  b.unit_id,
                  b.checkin,
                  b.checkout,
                  b.guest_name,
                  u.property_id AS unit_property_id,
                  u.name AS unit_name,
                  p.name AS property_name
             FROM bookings b
             JOIN units u ON u.id = b.unit_id
             JOIN properties p ON p.id = u.property_id
            WHERE b.id = ?`
        )
        .get(bookingId);
      if (!booking) {
        const message = 'Reserva inválida';
        if (wantsJson(req)) return res.status(400).json({ ok: false, message });
        return res.status(400).send(message);
      }
      if (!resolvedUnitId) resolvedUnitId = booking.unit_id;
      if (!resolvedPropertyId) resolvedPropertyId = booking.unit_property_id;
      if (!dueDate) {
        if (taskType === 'checkout') {
          dueDate = booking.checkout;
        } else if (taskType === 'checkin') {
          dueDate = booking.checkin;
        }
      }
    }

    let unitRow = null;
    if (resolvedUnitId) {
      unitRow = db
        .prepare(
          `SELECT u.id, u.property_id, u.name, p.name AS property_name
             FROM units u
             JOIN properties p ON p.id = u.property_id
            WHERE u.id = ?`
        )
        .get(resolvedUnitId);
      if (!unitRow) {
        resolvedUnitId = null;
      } else if (!resolvedPropertyId) {
        resolvedPropertyId = unitRow.property_id;
      }
    }

    let propertyRow = null;
    if (resolvedPropertyId) {
      propertyRow = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(resolvedPropertyId);
      if (!propertyRow) {
        resolvedPropertyId = null;
      }
    }

    const fallbackContext =
      booking ||
      (unitRow ? { unit_name: unitRow.name, property_name: unitRow.property_name } : null) ||
      (propertyRow ? { unit_name: '', property_name: propertyRow.name } : null);
    const finalTitle = trimmedTitle || defaultHousekeepingTitle(taskType, fallbackContext);

    const result = db
      .prepare(
        `INSERT INTO housekeeping_tasks
           (booking_id, unit_id, property_id, task_type, title, details, due_date, due_time, priority, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`
      )
      .run(
        bookingId,
        resolvedUnitId,
        resolvedPropertyId,
        taskType,
        finalTitle,
        trimmedDetails ? trimmedDetails : null,
        dueDate,
        dueTime,
        taskPriority,
        req.user.id
      );

    const taskId = result.lastInsertRowid;
    logActivity(req.user.id, 'housekeeping:create', 'housekeeping_task', taskId, {
      bookingId: bookingId || null,
      unitId: resolvedUnitId || null,
      propertyId: resolvedPropertyId || null,
      taskType,
      dueDate,
      dueTime,
      priority: taskPriority
    });

    if (wantsJson(req)) {
      return res.json({ ok: true, id: taskId });
    }
    res.redirect(resolveHousekeepingRedirect(req, '/admin/limpeza'));
  });

  app.post('/limpeza/tarefas/:id/progresso', requireLogin, requirePermission('housekeeping.complete'), (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Tarefa inválida' });
      return res.status(400).send('Tarefa inválida');
    }
    const task = db.prepare('SELECT id, status FROM housekeeping_tasks WHERE id = ?').get(taskId);
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
    const task = db.prepare('SELECT id, status FROM housekeeping_tasks WHERE id = ?').get(taskId);
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
    const task = db.prepare('SELECT id, status FROM housekeeping_tasks WHERE id = ?').get(taskId);
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
    logActivity(req.user.id, 'housekeeping:reopen', 'housekeeping_task', taskId, {
      from: task.status,
      to: 'pending'
    });
    if (wantsJson(req)) return res.json({ ok: true, status: 'pending' });
    res.redirect(resolveHousekeepingRedirect(req, '/admin/limpeza'));
  });

  
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
    const canViewCalendar = userCan(req.user, 'calendar.view');

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
      ? db.prepare('SELECT id, username, role FROM users ORDER BY username').all()
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

    const notifications = buildUserNotifications({
      user: req.user,
      db,
      dayjs,
      userCan,
      automationData,
      automationCache,
      ensureAutomationFresh
    });

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

    const broomIconSvg = `
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 21h4l7-7"></path>
        <path d="M14 14l5-5a3 3 0 0 0-4.24-4.24l-5 5"></path>
        <path d="M11 11l2 2"></path>
        <path d="M5 21l-1-4 4 1"></path>
      </svg>
    `.trim();

    const navItems = [
      { id: 'overview', label: 'Propriedades', icon: 'building-2', allowed: true },
      { id: 'finance', label: 'Financeiro', icon: 'piggy-bank', allowed: true },
      { id: 'revenue', label: 'Revenue', icon: 'trending-up', allowed: true },
      { id: 'estatisticas', label: 'Estatísticas', icon: 'bar-chart-3', allowed: canViewAutomation },
      { id: 'housekeeping', label: 'Limpezas', icon: 'broom', iconSvg: broomIconSvg, allowed: canSeeHousekeeping },
      { id: 'emails', label: 'Emails', icon: 'mail', allowed: canManageEmailTemplates },
      { id: 'branding', label: 'Identidade', icon: 'palette', allowed: canManageUsers },
      { id: 'users', label: 'Utilizadores', icon: 'users', allowed: canManageUsers },
      { id: 'calendar', label: 'Calendário', icon: 'calendar-days', allowed: canViewCalendar }
    ];
    const defaultPane = navItems.find(item => item.allowed)?.id || 'overview';
    const navButtonsHtml = navItems
      .map(item => {
        const classes = ['bo-tab'];
        if (item.id === defaultPane) classes.push('is-active');
        const disabledAttr = item.allowed ? '' : ' disabled data-disabled="true" title="Sem permissões"';
        const iconMarkup = item.iconSvg
          ? item.iconSvg
          : `<i data-lucide="${item.icon}" class="w-5 h-5" aria-hidden="true"></i>`;
        return `<button type="button" class="${classes.join(' ')}" data-bo-target="${item.id}"${disabledAttr}>${iconMarkup}<span>${esc(item.label)}</span></button>`;
      })
      .join('');

    const propertiesListHtml = props.length
      ? `<ul class="space-y-3">${props
          .map(p => {
            const location = propertyLocationLabel(p);
            const propertyUnits = propertyUnitMap.get(p.id) || [];
            const revenueRow = propertyRevenueRows.find(row => row.id === p.id);
            const revenueLabel = revenueRow ? eur(revenueRow.confirmed_revenue_cents || 0) : '0,00';
            return `
              <li class="rounded-xl border border-amber-200 bg-white/80 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-semibold text-slate-800">${esc(p.name)}</div>
                    ${location ? `<div class="text-xs text-amber-700">${esc(location)}</div>` : ''}
                  </div>
                  <a class="btn btn-light text-sm" href="/admin/properties/${p.id}">Abrir</a>
                </div>
                <div class="text-xs text-amber-700 mt-2 flex flex-wrap gap-2">
                  <span>Unidades: ${propertyUnits.length}</span>
                  <span>Receita: € ${revenueLabel}</span>
                </div>
              </li>`;
          })
          .join('')}</ul>`
      : '<p class="bo-empty">Sem propriedades registadas.</p>';

    const unitsTableRows = units.length
      ? units
          .map(u => `
            <tr>
              <td data-label="Propriedade"><span class="table-cell-value">${esc(u.property_name)}</span></td>
              <td data-label="Unidade"><span class="table-cell-value">${esc(u.name)}</span></td>
              <td data-label="Cap."><span class="table-cell-value">${u.capacity}</span></td>
              <td data-label="Base €/noite"><span class="table-cell-value">€ ${eur(u.base_price_cents)}</span></td>
              <td data-label="Ações"><div class="table-cell-actions"><a class="btn btn-light btn-compact" href="/admin/units/${u.id}">Gerir</a></div></td>
            </tr>`)
          .join('')
      : '<tr><td colspan="5" class="text-sm text-center text-slate-500">Sem unidades registadas.</td></tr>';

    const propertiesRevenueTable = propertyRevenueRows.length
      ? propertyRevenueRows
          .map(row => {
            const propertyUnits = propertyUnitMap.get(row.id) || [];
            const unitList = propertyUnits.length
              ? `<ul class="bo-property-units">${propertyUnits
                  .map(unit => `<li>${esc(unit.name)} · € ${eur(unit.base_price_cents)}</li>`)
                  .join('')}</ul>`
              : '<div class="bo-empty">Sem unidades associadas.</div>';
            return `
              <tr>
                <td data-label="Propriedade">
                  <span class="table-cell-value font-semibold">${esc(row.name)}</span>
                  ${row.locality || row.district ? `<span class="table-cell-muted">${esc(propertyLocationLabel(row))}</span>` : ''}
                  ${unitList}
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
      <div class="bo-card space-y-6">
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
                              <td class="py-2 text-sm" data-label="Semana"><span class="table-cell-value">${dayjs(w.start).format('DD/MM')} → ${endLabel}</span></td>
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
            return dateFormatter.format(startDate) + ' → ' + dateFormatter.format(endDate);
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
                <td data-label="Datas"><span class="table-cell-value">${dayjs(b.checkin).format('DD/MM')} → ${dayjs(b.checkout).format('DD/MM')}</span></td>
                <td data-label="Propriedade"><span class="table-cell-value">${esc(b.property_name)} · ${esc(b.unit_name)}</span></td>
                <td data-label="Hóspede"><span class="table-cell-value">${esc(b.guest_name || '—')}</span></td>
                <td data-label="Estado"><span class="table-cell-value">${b.status === 'PENDING' ? 'PENDENTE' : 'CONFIRMADA'}</span></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="4" class="text-sm text-center text-slate-500">Sem reservas futuras.</td></tr>';

    const theme = resolveBrandingForRequest(req);

    res.send(
      layout({
        title: 'Backoffice',
        user: req.user,
        activeNav: 'backoffice',
        branding: theme,
        notifications,
        pageClass: 'page-backoffice',
        body: html`
          <div class="bo-shell">
            <aside class="bo-sidebar">
              <div class="bo-sidebar__title">Menu principal</div>
              <div class="bo-nav">${navButtonsHtml}</div>
            </aside>
            <div class="bo-main">
              <header class="bo-header">
                <h1>Gestor Operacional</h1>
                <p>Todos os dados essenciais de gestão em formato compacto.</p>
              </header>

              <section class="bo-pane bo-pane--split is-active" data-bo-pane="overview">
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
                            <td data-label="Datas"><span class="table-cell-value">${dayjs(b.checkin).format('DD/MM')} → ${dayjs(b.checkout).format('DD/MM')}</span></td>
                            <td data-label="Total"><span class="table-cell-value">€ ${eur(b.total_cents)}</span></td>
                          </tr>`)
                        .join('')}</tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section class="bo-pane" data-bo-pane="revenue">
                <div class="bo-card">
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

                <div class="grid gap-6 lg:grid-cols-3">
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

                <p class="bo-empty" data-revenue-chart-fallback hidden>Não foi possível carregar os gráficos de revenue neste navegador.</p>

                <div class="bo-card">
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
              </section>

              <section class="bo-pane" data-bo-pane="estatisticas" id="estatisticas">
                ${canViewAutomation ? statisticsCard : '<div class="bo-card"><p class="bo-empty">Sem permissões para visualizar o painel estatístico.</p></div>'}
              </section>

              <section class="bo-pane" data-bo-pane="housekeeping">
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
                  : '<div class="bo-card"><p class="bo-empty">Sem permissões para consultar tarefas de limpeza.</p></div>'}
              </section>

              <section class="bo-pane" data-bo-pane="emails">
                ${canManageEmailTemplates
                  ? html`
                      <div class="bo-card">
                        <h2>Emails de reserva</h2>
                        <p class="bo-subtitle">Personaliza as mensagens automáticas enviadas aos hóspedes.</p>
                        <div class="space-y-6">${emailTemplateCards}</div>
                      </div>
                    `
                  : '<div class="bo-card"><p class="bo-empty">Sem permissões para editar modelos de email.</p></div>'}
              </section>

              <section class="bo-pane" data-bo-pane="branding">
                <div class="bo-card">
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
              </section>

              <section class="bo-pane" data-bo-pane="users">
                ${canManageUsers
                  ? html`
                      <div class="bo-card">
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
                  : '<div class="bo-card"><p class="bo-empty">Sem permissões para gerir utilizadores.</p></div>'}
              </section>

              <section class="bo-pane" data-bo-pane="calendar">
                ${canViewCalendar
                  ? html`
                      <div class="bo-card">
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
                  : '<div class="bo-card"><p class="bo-empty">Sem permissões para consultar o calendário de reservas.</p></div>'}
              </section>
            </div>
          </div>
          <script type="application/json" id="revenue-analytics-data">${revenueAnalyticsJson}</script>
          <script>${featureBuilderScript}</script>
          <script>${revenueDashboardScript}</script>
          <script>${renderDashboardTabsScript(defaultPane)}</script>
        `
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
  const rangeLabel = `${operational.range.start} → ${rangeEnd.isValid() ? rangeEnd.format('YYYY-MM-DD') : operational.range.end}`;
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
      `${dayjs(w.start).format('YYYY-MM-DD')} → ${endLabel}`,
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

app.post('/admin/properties/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const id = req.params.id;
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
  if (!property) return res.status(404).send('Propriedade não encontrada');
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  res.redirect('/admin');
});

app.get('/admin/properties/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
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

  res.send(layout({
    title: p.name,
    user: req.user,
    activeNav: 'backoffice',
    branding: theme,
    body: html`
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

        <section class="card p-4">
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
  }));
});

app.post('/admin/properties/:id/update', requireLogin, requirePermission('properties.manage'), async (req, res) => {
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
});

app.post('/admin/units/create', requireLogin, requirePermission('properties.manage'), (req, res) => {
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
});

app.get('/admin/units/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const u = db.prepare(
    `SELECT u.*, p.name as property_name, p.locality as property_locality, p.district as property_district, p.address as property_address
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.id = ?`
  ).get(req.params.id);
  if (!u) return res.status(404).send('Unidade não encontrada');

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
  const blocks = db.prepare('SELECT * FROM blocks WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const rates = db.prepare('SELECT * FROM rates WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const images = db.prepare(
    'SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id'
  ).all(u.id);

  const theme = resolveBrandingForRequest(req, { propertyId: u.property_id, propertyName: u.property_name });
  rememberActiveBrandingProperty(res, u.property_id);

  res.send(layout({
    title: `${esc(u.property_name)} – ${esc(u.name)}`,
    user: req.user,
    activeNav: 'backoffice',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mb-4">${esc(u.property_name)} - ${esc(u.name)}</h1>
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
            </form>
          </div>

          ${blocks.length ? `
            <div class="mt-6">
              <h3 class="font-semibold mb-2">Bloqueios ativos</h3>
              <ul class="space-y-2">
                ${blocks.map(block => `
                  <li class="flex items-center justify-between text-sm">
                    <span>${dayjs(block.start_date).format('DD/MM/YYYY')} &rarr; ${dayjs(block.end_date).format('DD/MM/YYYY')}</span>
                    <form method="post" action="/admin/blocks/${block.id}/delete" onsubmit="return confirm('Desbloquear estas datas?');">
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
      </script>

    `
  }));
});

app.post('/admin/units/:id/update', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const unitId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
  if (!existing) return res.status(404).send('Unidade não encontrada');

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
});

app.post('/admin/units/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

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

app.post('/admin/units/:id/rates/create', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const { start_date, end_date, price_eur, min_stay } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');
  const price_cents = Math.round(parseFloat(String(price_eur || '0').replace(',', '.')) * 100);
  if (!(price_cents >= 0)) return res.status(400).send('Preço inválido');
  db.prepare(
    'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
  ).run(req.params.id, start_date, end_date, price_cents, price_cents, min_stay ? Number(min_stay) : 1);
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/rates/:rateId/delete', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const r = db.prepare('SELECT unit_id FROM rates WHERE id = ?').get(req.params.rateId);
  if (!r) return res.status(404).send('Rate não encontrada');
  db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
  res.redirect(`/admin/units/${r.unit_id}`);
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
app.get('/admin/bookings', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim(); // '', CONFIRMED, PENDING
  const ym = String(req.query.ym || '').trim();         // YYYY-MM opcional

  const where = [];
  const args = [];

  if (q) {
    where.push(`(b.guest_name LIKE ? OR b.guest_email LIKE ? OR u.name LIKE ? OR p.name LIKE ? OR b.agency LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`b.status = ?`);
    args.push(status);
  }
  if (/^\d{4}-\d{2}$/.test(ym)) {
    const startYM = `${ym}-01`;
    const endYM = dayjs(startYM).endOf('month').add(1, 'day').format('YYYY-MM-DD'); // exclusivo
    where.push(`NOT (b.checkout <= ? OR b.checkin >= ?)`);
    args.push(startYM, endYM);
  }

  const sql = `
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.checkin DESC, b.created_at DESC
      LIMIT 500
  `;
  const rows = db.prepare(sql).all(...args);

  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');

  res.send(layout({
    title: 'Reservas',
    user: req.user,
    activeNav: 'bookings',
    branding: resolveBrandingForRequest(req),
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Reservas</h1>

      <form method="get" class="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <input class="input md:col-span-2" name="q" placeholder="Procurar por hóspede, email, unidade, propriedade" value="${esc(q)}"/>
        <select class="input" name="status">
          <option value="">Todos os estados</option>
          <option value="CONFIRMED" ${status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
          <option value="PENDING" ${status==='PENDING'?'selected':''}>PENDING</option>
        </select>
        <input class="input" type="month" name="ym" value="${/^\d{4}-\d{2}$/.test(ym)?ym:''}"/>
        <button class="btn btn-primary">Filtrar</button>
      </form>

      <div class="card p-0">
        <div class="responsive-table">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Check-in</th><th>Check-out</th><th>Propriedade/Unidade</th><th>Agência</th><th>Hóspede</th><th>Ocup.</th><th>Total</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(b => `
                <tr>
                  <td data-label="Check-in"><span class="table-cell-value">${dayjs(b.checkin).format('DD/MM/YYYY')}</span></td>
                  <td data-label="Check-out"><span class="table-cell-value">${dayjs(b.checkout).format('DD/MM/YYYY')}</span></td>
                  <td data-label="Propriedade/Unidade"><span class="table-cell-value">${esc(b.property_name)} - ${esc(b.unit_name)}</span></td>
                  <td data-label="Agência"><span class="table-cell-value">${esc(b.agency || '') || '—'}</span></td>
                  <td data-label="Hóspede"><span class="table-cell-value">${esc(b.guest_name)}<span class="table-cell-muted">${esc(b.guest_email)}</span></span></td>
                  <td data-label="Ocupação"><span class="table-cell-value">${b.adults}A+${b.children}C</span></td>
                  <td data-label="Total"><span class="table-cell-value">€ ${eur(b.total_cents)}</span></td>
                  <td data-label="Status">
                    <span class="inline-flex items-center text-xs font-semibold rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                      ${b.status}
                    </span>
                  </td>
                  <td data-label="Ações">
                    <div class="table-cell-actions">
                      <a class="underline" href="/admin/bookings/${b.id}">${canEditBooking ? 'Editar' : 'Ver'}</a>
                      ${canCancelBooking ? `
                        <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                          <button class="text-rose-600">Cancelar</button>
                        </form>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${rows.length===0?'<div class="p-4 text-slate-500">Sem resultados.</div>':''}
      </div>
    `
  }));
});

app.get('/admin/bookings/:id', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, u.property_id, p.name as property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');
  const canAddNote = userCan(req.user, 'bookings.notes');
  const bookingNotes = db.prepare(`
    SELECT bn.id, bn.note, bn.created_at, u.username
      FROM booking_notes bn
      JOIN users u ON u.id = bn.user_id
     WHERE bn.booking_id = ?
     ORDER BY bn.created_at DESC
  `).all(b.id).map(n => ({
    ...n,
    created_human: dayjs(n.created_at).format('DD/MM/YYYY HH:mm')
  }));

  const theme = resolveBrandingForRequest(req, { propertyId: b.property_id, propertyName: b.property_name });
  rememberActiveBrandingProperty(res, b.property_id);

  res.send(layout({
    title: `Editar reserva #${b.id}`,
    user: req.user,
    activeNav: 'bookings',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin/bookings">&larr; Reservas</a>
      <h1 class="text-2xl font-semibold mb-4">Editar reserva #${b.id}</h1>

      <div class="card p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div class="text-sm text-slate-500">${esc(b.property_name)}</div>
          <div class="font-semibold mb-3">${esc(b.unit_name)}</div>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Atual: ${dayjs(b.checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
            <li>Ocupação: ${b.adults}A+${b.children}C (cap. ${b.capacity})</li>
            <li>Total atual: € ${eur(b.total_cents)}</li>
          </ul>
          ${b.internal_notes ? `
            <div class="mt-4">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Anotacoes internas</div>
              <div class="text-sm text-slate-700 whitespace-pre-line">${esc(b.internal_notes)}</div>
            </div>
          ` : ''}
        </div>

        <form method="post" action="/admin/bookings/${b.id}/update" class="grid gap-3" id="booking-update-form">
          <fieldset class="grid gap-3" ${canEditBooking ? '' : 'disabled'}>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Check-in</label>
                <input required type="date" name="checkin" class="input" value="${b.checkin}"/>
              </div>
              <div>
                <label class="text-sm">Check-out</label>
                <input required type="date" name="checkout" class="input" value="${b.checkout}"/>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Adultos</label>
                <input required type="number" min="1" name="adults" class="input" value="${b.adults}"/>
              </div>
              <div>
                <label class="text-sm">Crianças</label>
                <input required type="number" min="0" name="children" class="input" value="${b.children}"/>
              </div>
            </div>

            <input class="input" name="guest_name" value="${esc(b.guest_name)}" placeholder="Nome do hóspede" required />
            <input class="input" type="email" name="guest_email" value="${esc(b.guest_email)}" placeholder="Email" required />
            <input class="input" name="guest_phone" value="${esc(b.guest_phone || '')}" placeholder="Telefone" />
            <input class="input" name="guest_nationality" value="${esc(b.guest_nationality || '')}" placeholder="Nacionalidade" />
            <div>
              <label class="text-sm">Agência</label>
              <input class="input" name="agency" value="${esc(b.agency || '')}" placeholder="Ex: BOOKING" />
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Anotações internas</label>
              <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas (apenas equipa)">${esc(b.internal_notes || '')}</textarea>
              <p class="text-xs text-slate-500">Não aparece para o hóspede.</p>
            </div>

            <div>
              <label class="text-sm">Estado</label>
              <select name="status" class="input">
                <option value="CONFIRMED" ${b.status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
                <option value="PENDING" ${b.status==='PENDING'?'selected':''}>PENDING</option>
              </select>
            </div>

            <button class="btn btn-primary justify-self-start">Guardar alterações</button>
          </fieldset>
          ${canEditBooking ? '' : '<p class="text-xs text-slate-500">Sem permissões para editar esta reserva.</p>'}
        </form>
        ${canCancelBooking ? `
          <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');" class="self-end">
            <button class="btn btn-danger mt-2">Cancelar reserva</button>
          </form>
        ` : ''}
        <section class="md:col-span-2 card p-4" id="notes">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">Notas internas</h2>
            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">${bookingNotes.length} nota${bookingNotes.length === 1 ? '' : 's'}</span>
          </div>
          <div class="mt-3 space-y-3">
            ${bookingNotes.length ? bookingNotes.map(n => `
              <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div class="text-xs text-slate-500 mb-1">${esc(n.username)} &middot; ${esc(n.created_human)}</div>
                <div class="text-sm text-slate-700 whitespace-pre-line">${esc(n.note)}</div>
              </article>
            `).join('') : '<p class="text-sm text-slate-500">Sem notas adicionadas pela equipa.</p>'}
          </div>
          ${canAddNote ? `
            <form method="post" action="/admin/bookings/${b.id}/notes" class="mt-4 grid gap-2">
              <label class="text-sm" for="note">Adicionar nova nota</label>
              <textarea class="input" id="note" name="note" rows="3" placeholder="Partilhe contexto para a equipa" required></textarea>
              <button class="btn btn-primary justify-self-start">Gravar nota</button>
            </form>
          ` : '<p class="text-xs text-slate-500 mt-4">Sem permissões para adicionar novas notas.</p>'}
        </section>
      </div>
    `
  }));
});

app.post('/admin/bookings/:id/update', requireLogin, requirePermission('bookings.edit'), (req, res) => {
  const id = req.params.id;
  const b = db.prepare(`
    SELECT b.*, u.capacity, u.base_price_cents, u.name AS unit_name, u.property_id, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?
  `).get(id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const checkin = req.body.checkin;
  const checkout = req.body.checkout;
  const internalNotesRaw = req.body.internal_notes;
  const internal_notes = typeof internalNotesRaw === 'string' ? internalNotesRaw.trim() || null : null;
  const adults = Math.max(1, Number(req.body.adults || 1));
  const children = Math.max(0, Number(req.body.children || 0));
  let status = (req.body.status || 'CONFIRMED').toUpperCase();
  if (!['CONFIRMED','PENDING'].includes(status)) status = 'CONFIRMED';
  const guest_name = req.body.guest_name;
  const guest_email = req.body.guest_email;
  const guest_phone = req.body.guest_phone || null;
  const guest_nationality = req.body.guest_nationality || null;
  const agency = req.body.agency ? String(req.body.agency).trim().toUpperCase() : null;

  if (!dayjs(checkout).isAfter(dayjs(checkin))) return res.status(400).send('checkout deve ser > checkin');
  if (adults + children > b.capacity) return res.status(400).send(`Capacidade excedida (máx ${b.capacity}).`);

  const conflict = db.prepare(`
    SELECT 1 FROM bookings 
     WHERE unit_id = ? 
       AND id <> ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(b.unit_id, id, checkin, checkout);
  if (conflict) return res.status(409).send('Conflito com outra reserva.');

  const q = rateQuote(b.unit_id, checkin, checkout, b.base_price_cents);
  if (q.nights < q.minStayReq) return res.status(400).send(`Estadia mínima: ${q.minStayReq} noites`);

  adminBookingUpdateStmt.run(
    checkin,
    checkout,
    adults,
    children,
    guest_name,
    guest_email,
    guest_phone,
    guest_nationality,
    agency,
    internal_notes,
    status,
    q.total_cents,
    id
  );

  logChange(req.user.id, 'booking', Number(id), 'update',
    {
      checkin: b.checkin,
      checkout: b.checkout,
      adults: b.adults,
      children: b.children,
      status: b.status,
      total_cents: b.total_cents
    },
    { checkin, checkout, adults, children, status, total_cents: q.total_cents }
  );

  const statusChangedToConfirmed = b.status !== 'CONFIRMED' && status === 'CONFIRMED';
  if (statusChangedToConfirmed) {
    const updatedBooking = db
      .prepare(
        `SELECT b.*, u.name AS unit_name, u.property_id, p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.id = ?`
      )
      .get(id);
    if (updatedBooking) {
      const branding = resolveBrandingForRequest(req, {
        propertyId: updatedBooking.property_id,
        propertyName: updatedBooking.property_name
      });
      bookingEmailer
        .sendGuestEmail({ booking: updatedBooking, templateKey: 'booking_confirmed_guest', branding, request: req })
        .catch(err => console.warn('Falha ao enviar email de confirmação:', err.message));
    }
  }

  res.redirect(`/admin/bookings/${id}`);
});

app.post('/admin/bookings/:id/notes', requireLogin, requirePermission('bookings.notes'), (req, res) => {
  const bookingId = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  if (!exists) return res.status(404).send('Reserva não encontrada');
  const noteRaw = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!noteRaw) return res.status(400).send('Nota obrigatória.');
  db.prepare('INSERT INTO booking_notes(booking_id, user_id, note) VALUES (?,?,?)').run(bookingId, req.user.id, noteRaw);
  logActivity(req.user.id, 'booking:note_add', 'booking', bookingId, { snippet: noteRaw.slice(0, 200) });
  res.redirect(`/admin/bookings/${bookingId}#notes`);
});

app.post('/admin/bookings/:id/cancel', requireLogin, requirePermission('bookings.cancel'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).send('Reserva não encontrada');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  logChange(req.user.id, 'booking', Number(id), 'cancel', {
    checkin: existing.checkin,
    checkout: existing.checkout,
    guest_name: existing.guest_name,
    status: existing.status,
    unit_id: existing.unit_id
  }, null);
  const back = req.get('referer') || '/admin/bookings';
  res.redirect(back);
});

// (Opcional) Apagar definitivamente
app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (existing) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    logChange(req.user.id, 'booking', Number(req.params.id), 'delete', {
      checkin: existing.checkin,
      checkout: existing.checkout,
      unit_id: existing.unit_id,
      guest_name: existing.guest_name
    }, null);
  }
  res.redirect('/admin/bookings');
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
        return 'Preferências guardadas. O tema foi atualizado em todo o portal.';
      case 'reset': return 'Tema reposto aos valores padrão.';
      case 'template': return 'Tema personalizado guardado para reutilização futura.';
      case 'applied': return 'Tema personalizado aplicado com sucesso.';
      case 'deleted': return 'Tema personalizado removido.';
      case 'logo_removed': return 'Logotipo removido. Será utilizada a sigla da marca.';
      default: return '';
    }
  })();
  const savedThemes = store.savedThemes || [];
  const propertyLabel = propertyRow ? propertyRow.name : 'tema global';

  res.send(layout({
    title: 'Identidade visual',
    user: req.user,
    activeNav: 'branding',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mt-2">Identidade visual</h1>
      <p class="text-slate-600 mb-4">Personalize cores, logotipo e mensagens para garantir consistência entre frontoffice e backoffice em cada propriedade.</p>

      <form method="get" class="card p-4 mb-4 flex flex-wrap gap-3 items-end max-w-xl">
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Propriedade ativa</span>
          <select class="input" name="property_id" onchange="this.form.submit()">
            <option value="" ${!propertyId ? 'selected' : ''}>Tema global (aplicado por defeito)</option>
            ${properties.map(p => `<option value="${p.id}" ${propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
        <p class="text-xs text-slate-500 max-w-sm">Ao selecionar uma propriedade pode definir um tema próprio. Sem seleção, edita o tema global partilhado.</p>
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
            <p class="text-sm text-slate-500">Definições guardadas são aplicadas imediatamente ao frontoffice e backoffice da seleção atual.</p>
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
          <section class="card p-4 grid gap-3" data-theme-preview>
            <h2 class="text-sm font-semibold text-slate-700">Pré-visualização em tempo real</h2>
            <div class="preview-card" data-preview-root>
              <div class="preview-top">
                <div class="preview-logo" data-preview-logo>
                  ${logoPath ? `<img src="${esc(logoPath)}" alt="${esc(formLogoAlt)}" />` : `<span data-preview-initials>${esc(formInitials || theme.brandInitials)}</span>`}
                </div>
                <div>
                  <div class="preview-brand" data-preview-name>${esc(formBrandName)}</div>
                  <div class="preview-tagline" data-preview-tagline>${esc(formTagline)}</div>
                </div>
              </div>
              <div class="preview-body">
                <p>Botões, formulários e cartões utilizam estas variáveis de cor e raio em todo o portal.</p>
                <div class="preview-actions">
                  <button type="button" class="preview-btn-primary">Reservar</button>
                  <button type="button" class="preview-btn-secondary">Ver unidades</button>
                </div>
              </div>
            </div>
            <ul class="preview-palette">
              <li><span class="swatch" data-preview-swatch="primary"></span> Primária <code data-preview-code="primary">${esc(theme.primaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="secondary"></span> Secundária <code data-preview-code="secondary">${esc(theme.secondaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="highlight"></span> Destaque <code data-preview-code="highlight">${esc(theme.highlightColor)}</code></li>
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
                        <span class="swatch" style="background:var(--saved-primary)"></span>
                        <span class="swatch" style="background:var(--saved-secondary)"></span>
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
        [data-theme-preview] .preview-card{border-radius:var(--brand-radius-lg);border:1px solid var(--brand-surface-border);background:linear-gradient(135deg,var(--brand-primary-soft),#fff);padding:18px;display:grid;gap:16px;}
        [data-theme-preview] .preview-top{display:flex;align-items:center;gap:14px;}
        [data-theme-preview] .preview-logo{width:46px;height:46px;border-radius:var(--brand-radius-sm);background:linear-gradient(130deg,var(--brand-primary),var(--brand-secondary));display:flex;align-items:center;justify-content:center;color:var(--brand-primary-contrast);font-weight:700;overflow:hidden;}
        [data-theme-preview] .preview-logo img{width:100%;height:100%;object-fit:cover;display:block;}
        [data-theme-preview] .preview-brand{font-weight:600;font-size:1rem;color:#1f2937;}
        [data-theme-preview] .preview-tagline{font-size:.8rem;color:var(--brand-muted);}
        [data-theme-preview] .preview-body{display:grid;gap:12px;font-size:.85rem;color:#475569;}
        [data-theme-preview] .preview-actions{display:flex;gap:8px;flex-wrap:wrap;}
        [data-theme-preview] .preview-btn-primary{background:var(--brand-primary);color:var(--brand-primary-contrast);border:none;border-radius:var(--brand-radius-pill);padding:8px 18px;font-weight:600;}
        [data-theme-preview] .preview-btn-secondary{background:var(--brand-secondary);color:var(--brand-primary-contrast);border:none;border-radius:var(--brand-radius-pill);padding:8px 16px;font-weight:600;opacity:.9;}
        [data-theme-preview] .preview-palette{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:.8rem;color:#475569;}
        [data-theme-preview] .preview-palette .swatch{display:inline-block;width:18px;height:18px;border-radius:6px;margin-right:6px;vertical-align:middle;border:1px solid rgba(15,23,42,.12);}
        .saved-theme{border:1px solid var(--brand-surface-border);border-radius:var(--brand-radius-sm);padding:12px;display:grid;gap:8px;}
        .saved-theme-header{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .saved-theme-name{font-size:.9rem;font-weight:600;color:#1f2937;}
        .saved-theme-preview{display:flex;align-items:center;gap:8px;font-size:.75rem;color:#475569;}
        .saved-theme .swatch{display:inline-block;width:18px;height:18px;border-radius:6px;border:1px solid rgba(15,23,42,.12);}
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

            const primaryHover = mix(primary, '#000000', 0.18);
            const primarySoft = mix(primary, '#ffffff', 0.82);
            const surface = mix(primary, '#ffffff', 0.94);
            const surfaceBorder = mix(primary, '#1f2937', 0.12);
            const surfaceRing = mix(primary, '#60a5fa', 0.35);
            const background = mix(primary, '#ffffff', 0.97);
            const muted = mix(primary, '#475569', 0.35);
            const surfaceContrast = contrast(surface);

            const cornerStyle = cornerSelect && cornerSelect.value === 'square' ? 'square' : 'rounded';
            const radius = cornerStyle === 'square' ? '14px' : '24px';
            const radiusSm = cornerStyle === 'square' ? '8px' : '16px';
            const radiusLg = cornerStyle === 'square' ? '24px' : '32px';
            const radiusPill = cornerStyle === 'square' ? '22px' : '999px';

            previewRoot.style.setProperty('--brand-primary', primary);
            previewRoot.style.setProperty('--brand-secondary', secondary);
            previewRoot.style.setProperty('--brand-highlight', highlight);
            previewRoot.style.setProperty('--brand-primary-contrast', contrast(primary));
            previewRoot.style.setProperty('--brand-primary-hover', primaryHover);
            previewRoot.style.setProperty('--brand-primary-soft', primarySoft);
            previewRoot.style.setProperty('--brand-surface', surface);
            previewRoot.style.setProperty('--brand-surface-border', surfaceBorder);
            previewRoot.style.setProperty('--brand-surface-ring', surfaceRing);
            previewRoot.style.setProperty('--brand-surface-contrast', surfaceContrast);
            previewRoot.style.setProperty('--brand-background', background);
            previewRoot.style.setProperty('--brand-muted', muted);
            previewRoot.style.setProperty('--brand-radius', radius);
            previewRoot.style.setProperty('--brand-radius-sm', radiusSm);
            previewRoot.style.setProperty('--brand-radius-lg', radiusLg);
            previewRoot.style.setProperty('--brand-radius-pill', radiusPill);

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
    body: html`
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
    `
  }));
});

// ===================== Utilizadores (admin) =====================
app.get('/admin/utilizadores', requireAdmin, (req,res)=>{
  const users = db.prepare('SELECT id, username, role FROM users ORDER BY username').all().map(u => ({
    ...u,
    role_key: normalizeRole(u.role)
  }));
  const isDevOperator = req.user && req.user.role === MASTER_ROLE;
  const roleOptions = [
    { key: 'rececao', label: ROLE_LABELS.rececao },
    { key: 'gestao', label: ROLE_LABELS.gestao },
    { key: 'direcao', label: ROLE_LABELS.direcao },
    { key: 'limpeza', label: ROLE_LABELS.limpeza }
  ];
  if (isDevOperator) {
    roleOptions.unshift({ key: MASTER_ROLE, label: ROLE_LABELS[MASTER_ROLE] });
  }
  const theme = resolveBrandingForRequest(req);
  res.send(layout({ title:'Utilizadores', user: req.user, activeNav: 'users', branding: theme, body: html`
    <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
    <h1 class="text-2xl font-semibold mb-4">Utilizadores</h1>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section class="card p-4">
        <h2 class="font-semibold mb-3">Criar novo utilizador</h2>
        <form method="post" action="/admin/users/create" class="grid gap-2">
          <input required name="username" class="input" placeholder="Utilizador" />
          <input required type="password" name="password" class="input" placeholder="Password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <select name="role" class="input">
            <option value="rececao">Receção</option>
            <option value="gestao">Gestão</option>
            <option value="direcao">Direção</option>
            <option value="limpeza">Limpeza</option>
          </select>
          <button class="btn btn-primary">Criar</button>
        </form>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Alterar password</h2>
        <form method="post" action="/admin/users/password" class="grid gap-2">
          <label class="text-sm">Selecionar utilizador</label>
          <select required name="user_id" class="input">
            ${users.map(u=>`<option value="${u.id}">${esc(u.username)} (${esc(ROLE_LABELS[u.role_key] || u.role_key)})</option>`).join('')}
          </select>
          <input required type="password" name="new_password" class="input" placeholder="Nova password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <button class="btn btn-primary">Alterar</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">Ao alterar, as sessões desse utilizador são terminadas.</p>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Atualizar privilégios</h2>
        <form method="post" action="/admin/users/role" class="grid gap-2">
          <label class="text-sm" for="user-role-user">Selecionar utilizador</label>
          <select id="user-role-user" required name="user_id" class="input">
            ${users.map(u=>`<option value="${u.id}">${esc(u.username)} (${esc(ROLE_LABELS[u.role_key] || u.role_key)})</option>`).join('')}
          </select>
          <label class="text-sm" for="user-role-role">Novo perfil</label>
          <select id="user-role-role" name="role" class="input">
            ${roleOptions.map(opt => `<option value="${opt.key}">${esc(opt.label)}</option>`).join('')}
          </select>
          <button class="btn btn-primary">Atualizar privilégios</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">As sessões ativas serão terminadas ao atualizar as permissões.</p>
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
              <th class="text-left px-4 py-2">Perfil</th>
              <th class="text-left px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${users.length ? users.map(u => `
              <tr>
                <td class="px-4 py-2" data-label="Utilizador"><span class="table-cell-value">${esc(u.username)}</span></td>
                <td class="px-4 py-2" data-label="Perfil"><span class="table-cell-value">${esc(ROLE_LABELS[u.role_key] || u.role_key)}</span></td>
                <td class="px-4 py-2" data-label="Ações">
                  ${isDevOperator
                    ? `<button type="button" class="btn btn-light btn-xs js-reveal-password" data-user-id="${u.id}" data-username="${esc(u.username)}">Ver password</button>`
                    : '<span class="text-xs text-slate-400">—</span>'}
                </td>
              </tr>
            `).join('') : '<tr><td class="px-4 py-3 text-slate-500" colspan="3">Sem utilizadores registados.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

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
  if (!username || !password || password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).send('Utilizador já existe.');
  const hash = bcrypt.hashSync(password, 10);
  const roleKey = normalizeRole(role);
  const result = db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run(username, hash, roleKey);
  logActivity(req.user.id, 'user:create', 'user', result.lastInsertRowid, { username, role: roleKey });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/password', requireAdmin, (req,res)=>{
  const { user_id, new_password, confirm } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (new_password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).send('Utilizador não encontrado');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user_id);
  revokeUserSessions(user_id);
  logActivity(req.user.id, 'user:password_reset', 'user', Number(user_id), {});
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/role', requireAdmin, (req,res)=>{
  const { user_id, role } = req.body;
  if (!user_id || !role) return res.status(400).send('Dados inválidos');
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(user_id);
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
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, target.id);
  revokeUserSessions(target.id);
  logChange(req.user.id, 'user', Number(target.id), 'role_change', { role: currentRole }, { role: newRole });
  logActivity(req.user.id, 'user:role_change', 'user', Number(target.id), { from: currentRole, to: newRole });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/reveal-password', requireAdmin, (req,res)=>{
  if (!req.user || req.user.role !== MASTER_ROLE) {
    return res.status(403).json({ error: 'Sem permissão para consultar esta informação.' });
  }
  const { user_id, confirm_password } = req.body || {};
  if (!user_id || !confirm_password) {
    return res.status(400).json({ error: 'É necessário indicar o utilizador e confirmar a password.' });
  }
  const self = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!self || !bcrypt.compareSync(confirm_password, self.password_hash)) {
    logActivity(req.user.id, 'user:password_reveal_denied', 'user', Number(user_id), {});
    return res.status(401).json({ error: 'Password inválida.' });
  }
  const target = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(user_id);
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
