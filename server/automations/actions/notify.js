const { randomUUID } = require('node:crypto');

module.exports = async function notifyAction(action = {}, payload = {}, context = {}) {
  const { db, dayjs, logActivity = () => {} } = context;
  if (!db) throw new Error('Base de dados indisponível para notificações.');

  const title = typeof action.title === 'string' && action.title.trim().length
    ? action.title.trim()
    : 'Alerta automático';
  const message = typeof action.message === 'string' ? action.message.trim() : '';
  const severity = typeof action.severity === 'string' ? action.severity.trim().toLowerCase() : 'info';
  const notificationId = randomUUID();

  const insertStmt = db.prepare(
    `INSERT INTO automation_runs (id, automation_id, trigger_payload, status, result, created_at)
     VALUES (?, ?, ?, 'SUCCESS', ?, ?)`
  );

  const now = dayjs ? dayjs().toISOString() : new Date().toISOString();
  insertStmt.run(
    notificationId,
    action.automation_id || payload.automationId || 'automation',
    JSON.stringify({ title, message, severity }),
    JSON.stringify({ notify: { title, message, severity } }),
    now
  );

  logActivity(context.userId || null, 'automation.notify', 'automation', payload.automationId || null, {
    title,
    message,
    severity,
  });

  return { title, message, severity };
};
