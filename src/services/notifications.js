function normalizeSeverity(severityRaw = '') {
  const value = typeof severityRaw === 'string' ? severityRaw.trim().toLowerCase() : '';
  if (value === 'danger' || value === 'critical' || value === 'error') return 'danger';
  if (value === 'warning' || value === 'warn') return 'warning';
  if (value === 'success' || value === 'ok') return 'success';
  return '';
}

function parseDate(dayjs, value) {
  if (!value) return null;
  try {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  } catch (err) {
    return null;
  }
}

function buildUserNotifications(options = {}) {
  const {
    user,
    db,
    dayjs,
    userCan,
    ensureAutomationFresh,
    automationCache,
    automationData,
    pendingLimit = 10,
    automationMaxAgeMinutes = 5
  } = options;

  if (!user || typeof userCan !== 'function' || !db || !dayjs) {
    return [];
  }

  const canViewBookings = userCan(user, 'bookings.view');
  const canViewAutomation = userCan(user, 'automation.view');
  const canManageAutomation = userCan(user, 'automation.export');
  const canSeeHousekeeping = userCan(user, 'housekeeping.view') || userCan(user, 'housekeeping.manage');

  const notifications = [];

  if (canViewBookings) {
    try {
      const pendingRows = db
        .prepare(
          `SELECT b.id, b.guest_name, b.created_at, u.name AS unit_name, p.name AS property_name
             FROM bookings b
             JOIN units u ON u.id = b.unit_id
             JOIN properties p ON p.id = u.property_id
            WHERE b.status = 'PENDING'
            ORDER BY b.created_at DESC
            LIMIT ?`
        )
        .all(Math.max(1, pendingLimit));

      pendingRows.forEach(row => {
        const createdAt = parseDate(dayjs, row.created_at);
        const meta = createdAt ? createdAt.format('DD/MM HH:mm') : '';
        notifications.push({
          title: 'Reserva pendente',
          message: `${row.guest_name || 'Sem hóspede'} · ${row.property_name} · ${row.unit_name}`,
          meta,
          severity: 'warning',
          href: canViewBookings ? `/admin/bookings/${row.id}` : undefined,
          _createdAt: createdAt ? createdAt.valueOf() : 0
        });
      });
    } catch (err) {
      console.warn('Falha ao carregar reservas pendentes para notificações:', err.message);
    }
  }

  let automationPayload = automationData;
  if (!automationPayload && typeof ensureAutomationFresh === 'function') {
    try {
      automationPayload = ensureAutomationFresh(automationMaxAgeMinutes);
    } catch (err) {
      console.warn('Falha ao atualizar automação para notificações:', err.message);
      automationPayload = null;
    }
  }
  if (!automationPayload && automationCache) {
    automationPayload = automationCache;
  }

  const automationNotifications = automationPayload && Array.isArray(automationPayload.notifications)
    ? automationPayload.notifications
    : [];
  const automationLastRun = automationPayload && automationPayload.lastRun ? automationPayload.lastRun : null;

  automationNotifications.forEach(item => {
    if (!item) return;
    const typeRaw = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    const titleRaw = typeof item.title === 'string' ? item.title.toLowerCase() : '';

    const isHousekeeping =
      typeRaw.includes('housekeep') ||
      typeRaw.includes('clean') ||
      titleRaw.includes('housekeep') ||
      titleRaw.includes('limpez');
    const isBookingRelated =
      typeRaw.includes('booking') ||
      typeRaw.includes('checkin') ||
      typeRaw.includes('cancel') ||
      typeRaw.includes('overlap') ||
      typeRaw.includes('long-stay') ||
      typeof item.booking_id === 'number' ||
      typeof item.bookingId === 'number';
    const isAutomation = typeRaw.includes('auto') || typeRaw.includes('automation');

    let allowed = false;
    if (isHousekeeping) {
      allowed = canSeeHousekeeping;
    } else if (isBookingRelated) {
      allowed = canViewBookings;
    } else if (isAutomation) {
      allowed = canViewAutomation || canManageAutomation || canViewBookings;
    } else {
      allowed = canViewAutomation || canManageAutomation || canViewBookings || canSeeHousekeeping;
    }

    if (!allowed) return;

    const createdAt = parseDate(dayjs, item.created_at) || parseDate(dayjs, automationLastRun);
    const meta = createdAt ? createdAt.format('DD/MM HH:mm') : '';
    const severity = normalizeSeverity(item.severity);

    let href = '';
    if (typeof item.href === 'string' && item.href.trim()) {
      href = item.href.trim();
    } else if (isHousekeeping && canSeeHousekeeping) {
      href = '/limpeza/tarefas';
    } else if (isBookingRelated && canViewBookings) {
      const bookingId = item.booking_id || item.bookingId;
      if (bookingId) {
        href = `/admin/bookings/${bookingId}`;
      }
    }

    notifications.push({
      title: item.title || 'Alerta operacional',
      message: item.message || '',
      meta,
      severity,
      href: href || undefined,
      _createdAt: createdAt ? createdAt.valueOf() : 0
    });
  });

  const unique = [];
  const seen = new Set();
  notifications.forEach(n => {
    const key = `${n.title}|${n.message}|${n.meta}|${n.href || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(n);
  });

  unique.sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));

  return unique
    .map(n => {
      const { _createdAt, ...rest } = n;
      return rest;
    })
    .slice(0, 12);
}

module.exports = { buildUserNotifications };
