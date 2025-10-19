// Housekeeping module: manages backoffice cleaning workflows and routes.

function createHousekeepingModule(context = {}) {
  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    formatDateRangeShort,
    capitalizeMonth,
    resolveBrandingForRequest,
    userCan,
    logActivity,
    logChange,
    requireLogin,
    requirePermission,
    isSafeRedirectTarget,
    wantsJson,
    renderBreadcrumbs
  } = context;

  if (!db) throw new Error('registerHousekeeping: db é obrigatório');
  if (!dayjs) throw new Error('registerHousekeeping: dayjs é obrigatório');
  if (!html) throw new Error('registerHousekeeping: html é obrigatório');
  if (!layout) throw new Error('registerHousekeeping: layout é obrigatório');
  if (typeof esc !== 'function') throw new Error('registerHousekeeping: esc é obrigatório');
  if (typeof formatDateRangeShort !== 'function') throw new Error('registerHousekeeping: formatDateRangeShort é obrigatório');
  if (typeof capitalizeMonth !== 'function') throw new Error('registerHousekeeping: capitalizeMonth é obrigatório');
  if (typeof resolveBrandingForRequest !== 'function') throw new Error('registerHousekeeping: resolveBrandingForRequest é obrigatório');
  if (typeof userCan !== 'function') throw new Error('registerHousekeeping: userCan é obrigatório');
  if (typeof logActivity !== 'function') throw new Error('registerHousekeeping: logActivity é obrigatório');
  if (typeof logChange !== 'function') throw new Error('registerHousekeeping: logChange é obrigatório');
  if (typeof requireLogin !== 'function') throw new Error('registerHousekeeping: requireLogin é obrigatório');
  if (typeof requirePermission !== 'function') throw new Error('registerHousekeeping: requirePermission é obrigatório');
  if (typeof isSafeRedirectTarget !== 'function') throw new Error('registerHousekeeping: isSafeRedirectTarget é obrigatório');
  if (typeof wantsJson !== 'function') throw new Error('registerHousekeeping: wantsJson é obrigatório');
  if (typeof renderBreadcrumbs !== 'function') throw new Error('registerHousekeeping: renderBreadcrumbs é obrigatório');

  const HOUSEKEEPING_TASK_TYPES = new Set(['checkout', 'checkin', 'midstay', 'custom']);
  const HOUSEKEEPING_TYPE_LABELS = {
    checkout: 'Limpeza de saída',
    checkin: 'Preparar entrada',
    midstay: 'Arrumação intermédia',
    custom: 'Tarefa de limpeza'
  };
  const HOUSEKEEPING_PRIORITIES = new Set(['alta', 'normal', 'baixa']);
  const HOUSEKEEPING_PRIORITY_ORDER = { alta: 0, normal: 1, baixa: 2 };

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

  function serializeHousekeepingTaskForAudit(task) {
    if (!task) return null;
    return {
      booking_id: task.booking_id || null,
      unit_id: task.unit_id || null,
      property_id: task.property_id || null,
      task_type: task.task_type || null,
      title: task.title || null,
      details: task.details || null,
      due_date: task.due_date || null,
      due_time: task.due_time || null,
      status: task.status || null,
      priority: task.priority || null,
      source: task.source || null,
      started_at: task.started_at || null,
      started_by: task.started_by || null,
      completed_at: task.completed_at || null,
      completed_by: task.completed_by || null
    };
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
    const todayBucket = !isBackofficeVariant && Array.isArray(buckets) ? buckets.find((bucket) => bucket.isToday) : null;
    const bucketsForGrid = isBackofficeVariant || !Array.isArray(buckets) ? buckets : buckets.filter((bucket) => !bucket.isToday);

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
      const buildMetaBadge = (label, value) =>
        html`<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          <span class="font-semibold text-slate-700">${esc(label)}:</span>
          <span class="text-slate-600">${esc(value)}</span>
        </span>`;
      if (showDate && task.effective_date) {
        meta.push(buildMetaBadge('Data', capitalizeMonth(dayjs(task.effective_date).format('D [de] MMMM'))));
      }
      if (task.due_time) {
        meta.push(buildMetaBadge('Hora', task.due_time));
      }
      if (task.source && task.source !== 'manual') {
        meta.push(buildMetaBadge('Origem', 'Automático'));
      }
      if (task.created_by_username) {
        meta.push(buildMetaBadge('Criado por', task.created_by_username));
      }

      const articleBaseClass = isBackofficeVariant
        ? `bo-housekeeping-task${highlight ? ' is-highlighted' : ''}`
        : `rounded-xl border ${highlight ? 'border-rose-200 ring-1 ring-rose-200/60 bg-rose-50/40' : 'border-slate-200 bg-white'} shadow-sm`;
      const headerClass = isBackofficeVariant
        ? 'bo-housekeeping-task__header'
        : 'flex items-start justify-between gap-3';
      const statusWrapperClass = isBackofficeVariant
        ? 'bo-housekeeping-task__status'
        : 'flex flex-col items-end gap-1 text-right';
      const metaClass = isBackofficeVariant
        ? 'bo-housekeeping-task__meta'
        : 'flex flex-wrap gap-2 text-xs text-slate-600';
      const actionsClass = isBackofficeVariant
        ? 'bo-housekeeping-task__actions'
        : 'flex flex-wrap gap-2 pt-2';

      return html`<article class="${articleBaseClass} p-4 shadow-sm space-y-3">
        <div class="${headerClass}">
          <div class="space-y-1">
            <p class="font-semibold text-slate-900">${esc(task.title)}</p>
            <p class="text-sm text-slate-500">${esc(propertyUnitLine)}</p>
          </div>
          <div class="${statusWrapperClass}">
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(task.status)}">${esc(
              statusLabels[task.status] || task.status
            )}</span>
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(task.priority)}">${esc(
              priorityLabels[task.priority] || task.priority
            )}</span>
          </div>
        </div>
        ${task.booking_guest_name ? `<p class="text-sm text-slate-600"><span class="font-medium text-slate-700">Hóspede:</span> ${esc(task.booking_guest_name)}</p>` : ''}
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
        type === 'checkout'
          ? 'bg-rose-50 text-rose-600'
          : type === 'backlog'
          ? 'bg-amber-50 text-amber-600'
          : 'bg-sky-50 text-sky-600';
      const accentBorderClass =
        type === 'checkout'
          ? 'ring-1 ring-rose-200/70'
          : type === 'backlog'
          ? 'ring-1 ring-amber-200/70'
          : 'ring-1 ring-sky-200/70';
      const label = type === 'checkout' ? 'Checkout' : type === 'backlog' ? 'Pendente' : 'Check-in';
      const cardClassName = isBackofficeVariant
        ? `bo-housekeeping-booking bo-housekeeping-booking--${type}`
        : `rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2 ${accentBorderClass}`;
      return html`<article class="${cardClassName}">
        <div class="flex items-center justify-between text-sm font-semibold text-slate-800">
          <span>${esc(booking.property_name || '')} · ${esc(booking.unit_name || '')}</span>
          <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}">${label}</span>
        </div>
        <div class="text-sm text-slate-600">${esc(booking.guest_name || '—')}</div>
        <div class="text-xs text-slate-500">${esc(booking.range_label || '')}</div>
      </article>`;
    };

    const backlogSection = backlogCheckouts.length
      ? isBackofficeVariant
        ? html`<section class="${cardClass} border border-rose-100 bg-rose-50/40 p-4 space-y-3">
            <div>
              <h3 class="text-base font-semibold text-rose-700">Check-outs recentes a aguardar limpeza</h3>
              <p class="text-sm text-rose-600">Garanta a higienização destas unidades para libertar novas entradas.</p>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              ${backlogCheckouts.map((item) => renderBookingCard(item, 'backlog')).join('')}
            </div>
          </section>`
        : html`<section id="backlog-checkouts" class="${cardClass} p-5 space-y-4 border border-rose-200/80 bg-white shadow-sm ring-1 ring-rose-100/60">
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-rose-600">Atenção imediata</p>
              <h3 class="text-lg font-semibold text-slate-900">Check-outs a aguardar limpeza</h3>
              <p class="text-sm text-slate-600">Libertar estas unidades garante disponibilidade para novas reservas.</p>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              ${backlogCheckouts.map((item) => renderBookingCard(item, 'backlog')).join('')}
            </div>
          </section>`
      : '';

    const overdueSection = overdueTasks.length
      ? isBackofficeVariant
        ? html`<section class="${cardClass} border border-rose-100 bg-rose-50/40 p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-semibold text-rose-700">Tarefas de limpeza em atraso</h3>
              <span class="text-sm text-rose-600 font-medium">${overdueTasks.length}</span>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              ${overdueTasks.map((task) => renderTaskCard(task, { highlight: true, showDate: true })).join('')}
            </div>
          </section>`
        : html`<section id="tarefas-em-atraso" class="${cardClass} p-5 space-y-4 border border-rose-200/80 bg-white shadow-sm ring-1 ring-rose-100/60">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-rose-600">Em atraso</p>
                <h3 class="text-lg font-semibold text-slate-900">Tarefas de limpeza pendentes</h3>
              </div>
              <span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">${overdueTasks.length} tarefa${
                overdueTasks.length === 1 ? '' : 's'
              }</span>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              ${overdueTasks.map((task) => renderTaskCard(task, { highlight: true, showDate: true })).join('')}
            </div>
          </section>`
      : '';

    const toolbarSection = isBackofficeVariant
      ? ''
      : html`<section class="${cardClass} p-4 border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              <span class="text-xs uppercase tracking-wide text-slate-500">Legenda</span>
              <span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-rose-600"><span class="h-2 w-2 rounded-full bg-rose-400"></span>Check-out</span>
              <span class="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-sky-600"><span class="h-2 w-2 rounded-full bg-sky-400"></span>Check-in</span>
              <span class="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-amber-600"><span class="h-2 w-2 rounded-full bg-amber-400"></span>Prioridade alta</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <a class="btn btn-light btn-sm" href="#hoje">Ir para hoje</a>
              <a class="btn btn-light btn-sm" href="#agenda-futura">Ver agenda futura</a>
            </div>
          </div>
        </section>`;

    const todaySection = !isBackofficeVariant && todayBucket
      ? html`<section id="hoje" class="${cardClass} p-5 space-y-5 border border-emerald-200/70 bg-white shadow-sm ring-1 ring-emerald-100/60">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-emerald-600">Hoje</p>
              <h3 class="text-xl font-semibold text-slate-900">${esc(todayBucket.displayLabel)}</h3>
              <p class="text-sm text-slate-500">${esc(todayBucket.shortLabel)}</p>
            </div>
            <div class="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
              ${todayBucket.checkouts.length
                ? `<span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-rose-600"><span class="h-2 w-2 rounded-full bg-rose-400"></span>${
                    todayBucket.checkouts.length
                  } saída${todayBucket.checkouts.length === 1 ? '' : 's'}</span>`
                : ''}
              ${todayBucket.checkins.length
                ? `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-emerald-600"><span class="h-2 w-2 rounded-full bg-emerald-400"></span>${
                    todayBucket.checkins.length
                  } entrada${todayBucket.checkins.length === 1 ? '' : 's'}</span>`
                : ''}
              ${todayBucket.tasks.length
                ? `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-600"><span class="h-2 w-2 rounded-full bg-slate-400"></span>${
                    todayBucket.tasks.length
                  } tarefa${todayBucket.tasks.length === 1 ? '' : 's'}</span>`
                : ''}
            </div>
          </header>
          <div class="grid gap-4 lg:grid-cols-2">
            ${todayBucket.checkouts.length
              ? html`<div class="space-y-3">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-rose-600">Saídas de hoje</h4>
                  <div class="space-y-3">
                    ${todayBucket.checkouts.map((booking) => renderBookingCard(booking, 'checkout')).join('')}
                  </div>
                </div>`
              : ''}
            ${todayBucket.checkins.length
              ? html`<div class="space-y-3">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-sky-600">Entradas de hoje</h4>
                  <div class="space-y-3">
                    ${todayBucket.checkins.map((booking) => renderBookingCard(booking, 'checkin')).join('')}
                  </div>
                </div>`
              : ''}
            ${todayBucket.tasks.length
              ? html`<div class="space-y-3 lg:col-span-2">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-600">Tarefas atribuídas</h4>
                  <div class="grid gap-3 md:grid-cols-2">
                    ${todayBucket.tasks.map((task) => renderTaskCard(task)).join('')}
                  </div>
                </div>`
              : '<p class="text-sm text-slate-500">Sem tarefas programadas para hoje.</p>'}
          </div>
        </section>`
      : '';

    const bucketGrid = bucketsForGrid && bucketsForGrid.length
      ? html`<div class="grid gap-6" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
          ${bucketsForGrid
            .map(
              (bucket) => html`<section class="${cardClass} p-4 space-y-4 ${
                  isBackofficeVariant ? '' : 'border border-slate-200 bg-white shadow-sm'
                }">
                <header class="flex items-start justify-between gap-2">
                  <div class="space-y-1">
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
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-rose-600">Saídas</h4>
                        <div class="space-y-3">
                          ${bucket.checkouts.map((booking) => renderBookingCard(booking, 'checkout')).join('')}
                        </div>
                      </div>`
                    : ''}
                  ${bucket.checkins.length
                    ? html`<div class="space-y-2">
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-sky-600">Entradas</h4>
                        <div class="space-y-3">
                          ${bucket.checkins.map((booking) => renderBookingCard(booking, 'checkin')).join('')}
                        </div>
                      </div>`
                    : ''}
                  ${bucket.tasks.length
                    ? html`<div class="space-y-2">
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-600">Tarefas</h4>
                        <div class="space-y-3">
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
      ? isBackofficeVariant
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
        : html`<section id="limpezas-futuras" class="${cardClass} p-5 space-y-4 border border-slate-200 bg-white shadow-sm">
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Planeamento</p>
              <h3 class="text-lg font-semibold text-slate-900">Próximas limpezas</h3>
            </div>
            ${futureGroups
              .map(
                (group) => html`<div class="space-y-3">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">${esc(group.label)}</h4>
                  <div class="grid gap-3 md:grid-cols-2">
                    ${group.tasks.map((task) => renderTaskCard(task, { showDate: true })).join('')}
                  </div>
                </div>`
              )
              .join('')}
          </section>`
      : '';

    const unscheduledSection = unscheduledTasks.length
      ? isBackofficeVariant
        ? html`<section class="${cardClass} p-4 space-y-3">
            <h3 class="text-base font-semibold text-slate-800">Tarefas sem data definida</h3>
            <div class="grid gap-3 md:grid-cols-2">
              ${unscheduledTasks.map((task) => renderTaskCard(task)).join('')}
            </div>
          </section>`
        : html`<section id="tarefas-sem-data" class="${cardClass} p-5 space-y-4 border border-slate-200 bg-white shadow-sm">
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">A programar</p>
              <h3 class="text-lg font-semibold text-slate-900">Tarefas sem data definida</h3>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              ${unscheduledTasks.map((task) => renderTaskCard(task)).join('')}
            </div>
          </section>`
      : '';

    const futureEventsSection = futureCheckins.length || futureCheckouts.length
      ? isBackofficeVariant
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
        : html`<section id="agenda-futura" class="${cardClass} p-5 space-y-4 border border-slate-200 bg-white shadow-sm">
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Reservas</p>
              <h3 class="text-lg font-semibold text-slate-900">Agenda futura</h3>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              ${futureCheckouts.length
                ? html`<div class="space-y-3">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-rose-600">Saídas planeadas</h4>
                    <div class="space-y-3">
                      ${futureCheckouts.map((booking) => renderBookingCard(booking, 'checkout')).join('')}
                    </div>
                  </div>`
                : ''}
              ${futureCheckins.length
                ? html`<div class="space-y-3">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-sky-600">Entradas planeadas</h4>
                    <div class="space-y-3">
                      ${futureCheckins.map((booking) => renderBookingCard(booking, 'checkin')).join('')}
                    </div>
                  </div>`
                : ''}
            </div>
          </section>`
      : '';

    return [toolbarSection, backlogSection, overdueSection, todaySection, bucketGrid, futureSection, unscheduledSection, futureEventsSection]
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

  function register(app) {
    if (!app) throw new Error('registerHousekeeping: app é obrigatório');

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
        <div class="bo-page bo-page--wide">
          <div class="hk-dashboard space-y-8">
            ${renderBreadcrumbs([
              { label: 'Backoffice', href: '/admin' },
              { label: 'Limpezas' }
            ])}
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
      const createdTask = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
      logChange(
        req.user.id,
        'housekeeping_task',
        taskId,
        'create',
        null,
        serializeHousekeepingTaskForAudit(createdTask)
      );
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

  }

  return { register, getHousekeepingTasks, computeHousekeepingBoard };
}

function registerHousekeeping(app, context) {
  const module = createHousekeepingModule(context);
  const { register, getHousekeepingTasks, computeHousekeepingBoard } = module;
  register(app);
  return { getHousekeepingTasks, computeHousekeepingBoard };
}

module.exports = {
  registerHousekeeping,
  createHousekeepingModule
};
