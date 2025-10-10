module.exports = async function logActivityAction(action = {}, payload = {}, context = {}) {
  const { logActivity = () => {} } = context;
  const actionName = typeof action.action === 'string' ? action.action.trim() : 'automation.log';
  const entityType = typeof action.entity_type === 'string' ? action.entity_type.trim() : 'automation';
  const entityId = action.entity_id || payload.automationId || null;
  const meta = action.meta && typeof action.meta === 'object' ? action.meta : {};
  const metaPayload = { ...meta, payloadSummary: action.include_payload ? payload : undefined };

  logActivity(context.userId || null, actionName, entityType, entityId, metaPayload);
  return { action: actionName, entity: entityType };
};
