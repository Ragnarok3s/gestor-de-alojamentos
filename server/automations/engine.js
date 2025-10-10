const { randomUUID } = require('node:crypto');

function getByPath(source, path) {
  if (!source || typeof path !== 'string') return undefined;
  return path
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      if (typeof acc !== 'object') return undefined;
      if (Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
      return undefined;
    }, source);
}

function coerceValue(raw) {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const trimmed = String(raw).trim();
  if (trimmed === '') return '';
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed === String(num)) {
    return num;
  }
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  if (trimmed.includes(',') && !trimmed.includes(' ')) {
    return trimmed.split(',').map(part => part.trim()).filter(Boolean);
  }
  return trimmed;
}

function compareValues(leftValue, operator, rightValue) {
  switch (operator) {
    case '=':
    case '==':
      return leftValue === rightValue;
    case '!=':
    case '<>':
      return leftValue !== rightValue;
    case '>':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue > rightValue;
    case '>=':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue >= rightValue;
    case '<':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue < rightValue;
    case '<=':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue <= rightValue;
    case 'in': {
      if (Array.isArray(rightValue)) {
        return rightValue.some(item => item === leftValue);
      }
      if (typeof rightValue === 'string') {
        return rightValue.split(',').map(v => v.trim()).filter(Boolean).includes(String(leftValue));
      }
      return false;
    }
    case 'contains': {
      if (Array.isArray(leftValue)) {
        return leftValue.some(item => item === rightValue);
      }
      if (typeof leftValue === 'string') {
        return leftValue.toLowerCase().includes(String(rightValue || '').toLowerCase());
      }
      return false;
    }
    case 'regex': {
      if (typeof rightValue !== 'string' || !rightValue) return false;
      try {
        const re = new RegExp(rightValue, 'i');
        return re.test(String(leftValue || ''));
      } catch (err) {
        return false;
      }
    }
    default:
      return false;
  }
}

function evaluateConditions(conditions, payload) {
  if (!Array.isArray(conditions) || !conditions.length) return true;

  function evaluateNode(node) {
    if (!node) return true;
    if (Array.isArray(node.any)) {
      return node.any.some(evaluateNode);
    }
    if (Array.isArray(node.all)) {
      return node.all.every(evaluateNode);
    }

    const leftPath = typeof node.left === 'string' ? node.left : '';
    const operator = typeof node.op === 'string' ? node.op.toLowerCase() : '=';
    const rightRaw = node.right;
    const rightValue = coerceValue(rightRaw);
    const leftValueRaw = leftPath ? getByPath(payload, leftPath) : undefined;
    const leftValue = coerceValue(leftValueRaw);

    return compareValues(leftValue, operator, rightValue);
  }

  if (conditions.some(item => typeof item === 'object' && (Array.isArray(item.any) || Array.isArray(item.all)))) {
    return conditions.every(evaluateNode);
  }

  let currentResult = true;
  let currentLogic = 'and';
  conditions.forEach(condition => {
    if (!condition || typeof condition !== 'object') return;
    const logic = typeof condition.logic === 'string' ? condition.logic.toLowerCase() : 'and';
    const leftPath = typeof condition.left === 'string' ? condition.left : '';
    const operator = typeof condition.op === 'string' ? condition.op.toLowerCase() : '=';
    const rightValue = coerceValue(condition.right);
    const leftValue = coerceValue(leftPath ? getByPath(payload, leftPath) : undefined);
    const result = compareValues(leftValue, operator, rightValue);

    if (currentLogic === 'and') {
      currentResult = currentResult && result;
    } else {
      currentResult = currentResult || result;
    }
    currentLogic = logic;
  });
  return currentResult;
}

async function runActions(actions, payload, context) {
  const sequence = Array.isArray(actions) ? actions : [];
  const results = [];
  for (const action of sequence) {
    if (!action || typeof action !== 'object') continue;
    const type = typeof action.type === 'string' ? action.type.trim().toLowerCase() : '';
    if (!type) continue;
    const driver = context.actionDrivers[type];
    if (!driver) {
      results.push({ type, status: 'SKIPPED', error: 'Driver indisponível' });
      continue;
    }
    try {
      const info = await driver(action, payload, context);
      results.push({ type, status: 'SUCCESS', info: info || null });
    } catch (err) {
      results.push({ type, status: 'ERROR', error: err.message || String(err) });
      throw err;
    }
  }
  return results;
}

function createAutomationEngine(options = {}) {
  const {
    db,
    dayjs,
    logActivity = () => {},
    actionDrivers = {},
  } = options;

  if (!db) {
    throw new Error('createAutomationEngine requer ligação à base de dados.');
  }

  const listAutomationsStmt = db.prepare(
    `SELECT id, name, trigger, conditions, actions, is_enabled, created_by FROM automations WHERE trigger = ? AND is_enabled = 1`
  );
  const insertRunStmt = db.prepare(
    `INSERT INTO automation_runs (id, automation_id, trigger_payload, status, result) VALUES (?, ?, ?, ?, ?)`
  );

  async function handleEvent(trigger, payload = {}, extraContext = {}) {
    if (!trigger) return [];
    const automations = listAutomationsStmt.all(trigger);
    if (!automations.length) return [];

    const timestamp = dayjs().toISOString();
    const runs = [];

    for (const automation of automations) {
      const runId = randomUUID();
      let parsedConditions = [];
      let parsedActions = [];
      try {
        parsedConditions = JSON.parse(automation.conditions || '[]');
      } catch (err) {
        parsedConditions = [];
      }
      try {
        parsedActions = JSON.parse(automation.actions || '[]');
      } catch (err) {
        parsedActions = [];
      }

      const payloadWithContext = { ...payload, trigger, automationId: automation.id };
      const shouldRun = evaluateConditions(parsedConditions, payloadWithContext);
      let status = 'SKIPPED';
      let resultData = null;
      if (shouldRun) {
        try {
          const actionResults = await runActions(parsedActions, payloadWithContext, {
            ...options,
            ...extraContext,
            actionDrivers,
            timestamp,
            automation,
            payload: payloadWithContext,
          });
          status = 'SUCCESS';
          resultData = { actions: actionResults };
          logActivity(
            extraContext.userId || automation.created_by || null,
            'automation.run',
            'automation',
            automation.id,
            { trigger, status, actions: actionResults }
          );
        } catch (err) {
          status = 'ERROR';
          resultData = { error: err.message || String(err) };
        }
      }

      insertRunStmt.run(
        runId,
        automation.id,
        JSON.stringify(payloadWithContext),
        status,
        resultData ? JSON.stringify(resultData) : null
      );

      runs.push({
        id: runId,
        automation_id: automation.id,
        status,
        result: resultData,
      });
    }

    return runs;
  }

  return {
    evaluateConditions,
    runActions: (actions, payload, ctx) => runActions(actions, payload, { ...options, ...ctx, actionDrivers }),
    handleEvent,
  };
}

module.exports = { createAutomationEngine, evaluateConditions, runActions };
