module.exports = async function createHousekeepingTask(action = {}, payload = {}, context = {}) {
  const { db } = context;
  if (!db) throw new Error('Base de dados indisponível para criar tarefas de limpeza.');

  const unitId = action.unit_id || payload.unit_id || (payload.unit && payload.unit.id);
  const propertyId = action.property_id || payload.property_id || (payload.property && payload.property.id);
  const title = typeof action.title === 'string' && action.title.trim().length
    ? action.title.trim()
    : 'Tarefa automática';
  const taskType = typeof action.task_type === 'string' ? action.task_type.trim() : 'custom';
  const priority = typeof action.priority === 'string' ? action.priority.trim().toLowerCase() : 'normal';
  const dueDate = action.due_date || payload.due_date || payload.checkin || null;
  const dueTime = action.due_time || null;
  const details = typeof action.details === 'string' ? action.details.trim() : '';

  const insertStmt = db.prepare(
    `INSERT INTO housekeeping_tasks (booking_id, unit_id, property_id, task_type, title, details, due_date, due_time, priority, source, created_by)
     VALUES (@booking_id, @unit_id, @property_id, @task_type, @title, @details, @due_date, @due_time, @priority, 'automation', @created_by)`
  );

  const result = insertStmt.run({
    booking_id: action.booking_id || payload.booking_id || null,
    unit_id: unitId || null,
    property_id: propertyId || null,
    task_type: taskType || 'custom',
    title,
    details,
    due_date: dueDate || null,
    due_time: dueTime || null,
    priority: priority || 'normal',
    created_by: context.userId || null,
  });

  return { task_id: result.lastInsertRowid, title, priority, due_date: dueDate };
};
