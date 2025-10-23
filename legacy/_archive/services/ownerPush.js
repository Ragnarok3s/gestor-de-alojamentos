function createOwnerPushService({ db, dayjs }) {
  if (!db || !dayjs) throw new Error('Owner push service requires db and dayjs');

  const registerDeviceStmt = db.prepare(
    `INSERT INTO owner_push_devices(user_id, token, platform, label, last_active, created_at)
      VALUES (?,?,?,?,datetime('now'),datetime('now'))
     ON CONFLICT(user_id, token) DO UPDATE SET
       platform = excluded.platform,
       label = COALESCE(excluded.label, owner_push_devices.label),
       last_active = datetime('now')`
  );
  const listDevicesStmt = db.prepare(
    `SELECT id, user_id, token, platform, label, last_active, created_at
       FROM owner_push_devices
      WHERE user_id = ?
      ORDER BY last_active DESC`
  );

  const insertNotificationStmt = db.prepare(
    `INSERT INTO owner_push_notifications(user_id, kind, title, body, payload_json, unique_key, status, created_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))`
  );
  const findNotificationByKeyStmt = db.prepare(
    `SELECT id, status FROM owner_push_notifications WHERE user_id = ? AND unique_key = ? LIMIT 1`
  );
  const updateNotificationStatusStmt = db.prepare(
    `UPDATE owner_push_notifications
        SET status = ?, delivered_at = CASE WHEN ? IS NOT NULL THEN ? ELSE delivered_at END,
            last_attempt_at = datetime('now')
      WHERE id = ? AND user_id = ?`
  );
  const listNotificationsStmt = db.prepare(
    `SELECT id, user_id, kind, title, body, payload_json, unique_key, status, created_at, delivered_at, last_attempt_at
       FROM owner_push_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
  );
  const cleanupNotificationsStmt = db.prepare(
    `DELETE FROM owner_push_notifications WHERE created_at < ?`
  );

  function ensureJson(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (err) {
      return null;
    }
  }

  function registerDevice({ userId, token, platform = null, label = null }) {
    if (!userId || !token) {
      throw new Error('userId e token são obrigatórios para registar dispositivo');
    }
    registerDeviceStmt.run(userId, token, platform || null, label ? String(label).slice(0, 120) : null);
    return { userId, token };
  }

  function listDevices(userId) {
    if (!userId) return [];
    return listDevicesStmt.all(userId);
  }

  function queueNotification({ userId, kind, title, body, payload = null, uniqueKey = null, status = 'pending' }) {
    if (!userId) throw new Error('userId obrigatório');
    if (!kind || !title || !body) throw new Error('Notificação inválida');
    if (uniqueKey) {
      const existing = findNotificationByKeyStmt.get(userId, uniqueKey);
      if (existing) {
        if (existing.status !== status && status === 'pending') {
          updateNotificationStatusStmt.run(status, null, null, existing.id, userId);
        }
        return existing.id;
      }
    }
    const payloadJson = ensureJson(payload);
    const result = insertNotificationStmt.run(userId, kind, title, body, payloadJson, uniqueKey || null, status);
    return result.lastInsertRowid;
  }

  function listNotifications(userId, { limit = 25 } = {}) {
    if (!userId) return [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    return listNotificationsStmt.all(userId, safeLimit).map(row => ({
      ...row,
      payload: row.payload_json ? safeParse(row.payload_json) : null
    }));
  }

  function safeParse(str) {
    try {
      return JSON.parse(str);
    } catch (err) {
      return null;
    }
  }

  function acknowledgeNotifications(userId, ids = []) {
    if (!userId || !Array.isArray(ids) || !ids.length) return 0;
    let updated = 0;
    ids.forEach(id => {
      if (!id) return;
      updateNotificationStatusStmt.run('delivered', dayjs().toISOString(), dayjs().toISOString(), id, userId);
      updated += 1;
    });
    return updated;
  }

  function cleanup({ olderThanDays = 90 } = {}) {
    const cutoff = dayjs().subtract(olderThanDays, 'day').toISOString();
    cleanupNotificationsStmt.run(cutoff);
  }

  function syncOwnerAlerts({
    userId,
    upcomingBookings = [],
    revenueDelta = 0,
    pendingBookings = 0,
    expensesDueSoon = []
  }) {
    if (!userId) return;
    const now = dayjs();
    upcomingBookings
      .filter(booking => booking && booking.id && booking.checkinIso)
      .forEach(booking => {
        const checkin = dayjs(booking.checkinIso);
        if (!checkin.isValid()) return;
        const hoursUntil = checkin.diff(now, 'hour');
        if (hoursUntil < 0 || hoursUntil > 72) return;
        const title = `Check-in em ${booking.propertyName || booking.unitName || 'breve'}`;
        const body = `${booking.guestName || 'Hóspede'} chega ${checkin.format('DD/MM')} para ${booking.nights || 1} noite(s).`;
        queueNotification({
          userId,
          kind: 'checkin',
          title,
          body,
          payload: booking,
          uniqueKey: `checkin:${booking.id}`
        });
      });

    if (Number.isFinite(revenueDelta) && Math.abs(revenueDelta) >= 0.1) {
      const direction = revenueDelta > 0 ? 'up' : 'down';
      const percentage = Math.abs(revenueDelta * 100).toFixed(1);
      const title = direction === 'up' ? 'Receita a subir' : 'Receita em queda';
      const body =
        direction === 'up'
          ? `A receita aumentou ${percentage}% face ao período anterior.`
          : `A receita caiu ${percentage}% face ao período anterior.`;
      queueNotification({
        userId,
        kind: 'revenue_trend',
        title,
        body,
        payload: { revenueDelta },
        uniqueKey: `revenue:${direction}:${percentage}`
      });
    }

    if (pendingBookings > 0) {
      queueNotification({
        userId,
        kind: 'pending',
        title: 'Reservas pendentes',
        body: `${pendingBookings} reserva(s) aguardam confirmação.`,
        payload: { pendingBookings },
        uniqueKey: `pending:${pendingBookings}`
      });
    }

    expensesDueSoon
      .filter(expense => expense && expense.id)
      .forEach(expense => {
        const due = expense.due_date ? dayjs(expense.due_date) : null;
        const dueLabel = due && due.isValid() ? due.format('DD/MM') : 'brevemente';
        queueNotification({
          userId,
          kind: 'expense',
          title: 'Despesa a vencer',
          body: `${expense.description || 'Despesa'} vence ${dueLabel}.`,
          payload: expense,
          uniqueKey: `expense:${expense.id}`
        });
      });
  }

  return {
    registerDevice,
    listDevices,
    queueNotification,
    listNotifications,
    acknowledgeNotifications,
    cleanup,
    syncOwnerAlerts
  };
}

module.exports = {
  createOwnerPushService
};
