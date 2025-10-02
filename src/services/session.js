const crypto = require('crypto');
const dayjs = require('../config/dayjs');

function createSession(db, userId, days = 7) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = dayjs().add(days, 'day').toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return token;
}

function getSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      'SELECT s.token, s.expires_at, u.id as user_id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    )
    .get(token);
  if (!row) return null;
  if (!dayjs().isBefore(dayjs(row.expires_at))) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function destroySession(db, token) {
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

module.exports = {
  createSession,
  getSession,
  destroySession,
};
