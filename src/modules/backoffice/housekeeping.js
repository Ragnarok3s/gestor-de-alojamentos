// Housekeeping module: manages backoffice cleaning workflows and routes.
const fs = require('fs');
const path = require('path');

const housekeepingBoardTemplatePath = path.join(
  __dirname,
  '..',
  '..',
  'views',
  'backoffice',
  'housekeeping.ejs'
);

let housekeepingBoardTemplateRenderer = null;

function compileEjsTemplate(template) {
  if (!template) return null;
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let index = 0;
  let source = "let __output = '';\n";
  source += 'const __append = value => { __output += value == null ? "" : String(value); };\n';
  source += 'with (locals || {}) {\n';
  let match;
  while ((match = matcher.exec(template)) !== null) {
    const text = template.slice(index, match.index);
    if (text) {
      const escapedText = text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      source += `__output += \`${escapedText}\`;\n`;
    }
    const indicator = match[1];
    const code = match[2];
    if (indicator === '=') {
      source += `__append(${code.trim()});\n`;
    } else if (indicator === '-') {
      source += `__output += (${code.trim()}) ?? '';\n`;
    } else {
      source += `${code}\n`;
    }
    index = match.index + match[0].length;
  }
  const tail = template.slice(index);
  if (tail) {
    const escapedTail = tail
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    source += `__output += \`${escapedTail}\`;\n`;
  }
  source += '}\nreturn __output;';
  try {
    // eslint-disable-next-line no-new-func
    return new Function('locals', source);
  } catch (err) {
    return null;
  }
}

try {
  const housekeepingBoardTemplate = fs.readFileSync(housekeepingBoardTemplatePath, 'utf8');
  housekeepingBoardTemplateRenderer = compileEjsTemplate(housekeepingBoardTemplate);
} catch (err) {
  housekeepingBoardTemplateRenderer = null;
}

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
    res.locals.activeNav = '/admin/limpeza';
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
      const tasks = getHousekeepingTasks({ includeCompleted: true, limit: 200 });
      const todo = tasks.filter(task => task.status !== 'in_progress' && task.status !== 'completed');
      const inProgress = tasks.filter(task => task.status === 'in_progress');
      const done = tasks.filter(task => task.status === 'completed');

      const units = db
        .prepare(
          `SELECT u.id, u.name, p.name AS property_name
             FROM units u
             JOIN properties p ON p.id = u.property_id
            ORDER BY p.name, u.name`
        )
        .all();

      const formatDate = value => (value ? dayjs(value).format('DD/MM/YYYY') : 'Sem data');
      const resolveResponsible = task => {
        if (task.completed_by_username) return task.completed_by_username;
        if (task.started_by_username) return task.started_by_username;
        if (task.created_by_username) return task.created_by_username;
        return '—';
      };

      let bodyContent = null;
      if (housekeepingBoardTemplateRenderer) {
        try {
          bodyContent = housekeepingBoardTemplateRenderer({
            todo,
            inProgress,
            done,
            units,
            formatDate,
            resolveResponsible,
            statusEndpoint: '/admin/housekeeping',
            createTaskAction: '/admin/limpeza/tarefas',
            esc
          });
        } catch (err) {
          bodyContent = null;
        }
      }

      if (!bodyContent) {
        bodyContent = html`
          <div class="bo-page">
            <h1 class="text-2xl font-semibold mb-4">Gestão de limpezas</h1>
            <p class="text-sm text-slate-600">Não foi possível carregar o quadro Kanban de housekeeping.</p>
          </div>
        `;
      }

      res.locals.activeNav = '/admin/limpeza';
      res.send(
        layout({
          title: 'Gestão de limpezas',
          user: req.user,
          activeNav: 'housekeeping',
          branding: resolveBrandingForRequest(req),
          pageClass: 'page-backoffice page-housekeeping',
          body: bodyContent
        })
      );
    });

    app.post(
      '/admin/housekeeping/:id/status',
      requireLogin,
      requirePermission('housekeeping.manage'),
      (req, res) => {
        const taskId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(taskId) || taskId <= 0) {
          const message = 'Tarefa inválida';
          if (wantsJson(req)) return res.status(400).json({ ok: false, message });
          return res.status(400).send(message);
        }

        const statusRaw =
          req.body && typeof req.body.status === 'string' ? req.body.status.trim().toLowerCase() : '';
        const allowedStatuses = new Set(['pending', 'in_progress', 'completed']);
        if (!allowedStatuses.has(statusRaw)) {
          const message = 'Estado inválido';
          if (wantsJson(req)) return res.status(400).json({ ok: false, message });
          return res.status(400).send(message);
        }

        const task = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);
        if (!task) {
          const message = 'Tarefa não encontrada';
          if (wantsJson(req)) return res.status(404).json({ ok: false, message });
          return res.status(404).send(message);
        }

        const now = dayjs().toISOString();
        let updateSql = '';
        let params = [];

        if (statusRaw === 'pending') {
          updateSql = `UPDATE housekeeping_tasks
              SET status = 'pending',
                  started_at = NULL,
                  started_by = NULL,
                  completed_at = NULL,
                  completed_by = NULL
            WHERE id = ?`;
          params = [taskId];
        } else if (statusRaw === 'in_progress') {
          updateSql = `UPDATE housekeeping_tasks
              SET status = 'in_progress',
                  started_at = COALESCE(started_at, ?),
                  started_by = COALESCE(started_by, ?),
                  completed_at = NULL,
                  completed_by = NULL
            WHERE id = ?`;
          params = [now, req.user.id, taskId];
        } else {
          updateSql = `UPDATE housekeeping_tasks
              SET status = 'completed',
                  started_at = COALESCE(started_at, ?),
                  started_by = COALESCE(started_by, ?),
                  completed_at = ?,
                  completed_by = ?
            WHERE id = ?`;
          params = [now, req.user.id, now, req.user.id, taskId];
        }

        db.prepare(updateSql).run(...params);
        const afterTask = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(taskId);

        logChange(
          req.user.id,
          'housekeeping_task',
          taskId,
          'status',
          serializeHousekeepingTaskForAudit(task),
          serializeHousekeepingTaskForAudit(afterTask)
        );
        logActivity(req.user.id, 'housekeeping:status_change', 'housekeeping_task', taskId, {
          from: task.status,
          to: statusRaw
        });

        if (wantsJson(req)) {
          return res.json({ ok: true, status: afterTask.status });
        }

        res.redirect(resolveHousekeepingRedirect(req, '/admin/limpeza'));
      }
    );

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
