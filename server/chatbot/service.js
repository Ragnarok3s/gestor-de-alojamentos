const { randomUUID } = require('node:crypto');

function createChatbotService({ db }) {
  if (!db) {
    throw new Error('createChatbotService requer acesso à base de dados.');
  }

  const insertSessionStmt = db.prepare(
    `INSERT INTO chatbot_sessions (id, started_at, last_activity_at, state, property_id)
     VALUES (@id, datetime('now'), datetime('now'), @state, @property_id)`
  );
  const updateSessionStmt = db.prepare(
    `UPDATE chatbot_sessions SET last_activity_at = datetime('now'), state = @state WHERE id = @id`
  );
  const selectSessionStmt = db.prepare(`SELECT * FROM chatbot_sessions WHERE id = ?`);
  const deleteOldSessionsStmt = db.prepare(
    `DELETE FROM chatbot_sessions WHERE last_activity_at < datetime('now', '-48 hours')`
  );
  const insertMessageStmt = db.prepare(
    `INSERT INTO chatbot_messages (id, session_id, role, content)
     VALUES (@id, @session_id, @role, @content)`
  );
  const selectMessagesStmt = db.prepare(
    `SELECT role, content, created_at FROM chatbot_messages WHERE session_id = ? ORDER BY created_at ASC`
  );

  function expireOldSessions() {
    deleteOldSessionsStmt.run();
  }

  function createSession(initialState = {}, propertyId = null) {
    const id = randomUUID();
    const stateJson = JSON.stringify(initialState || {});
    insertSessionStmt.run({ id, state: stateJson, property_id: propertyId });
    return { id, state: initialState, property_id: propertyId };
  }

  function getSession(sessionId) {
    if (!sessionId) return null;
    const row = selectSessionStmt.get(sessionId);
    if (!row) return null;
    let state = {};
    try {
      state = row.state ? JSON.parse(row.state) : {};
    } catch (err) {
      state = {};
    }
    return { ...row, state };
  }

  function saveSessionState(sessionId, state) {
    updateSessionStmt.run({ id: sessionId, state: JSON.stringify(state || {}) });
  }

  function recordMessage(sessionId, role, content) {
    insertMessageStmt.run({
      id: randomUUID(),
      session_id: sessionId,
      role,
      content: String(content || ''),
    });
  }

  function listMessages(sessionId) {
    return selectMessagesStmt.all(sessionId);
  }

  return {
    expireOldSessions,
    createSession,
    getSession,
    saveSessionState,
    recordMessage,
    listMessages,
  };
}

module.exports = { createChatbotService };
