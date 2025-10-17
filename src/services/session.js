const crypto = require('crypto');

function createSessionService({ db, dayjs }) {
  if (!db || !dayjs) throw new Error('Session service requires db and dayjs');

  const insertSessionStmt = db.prepare(
    "INSERT INTO sessions(token, token_hash, user_id, tenant_id, expires_at, ip, user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))"
  );
  const deleteByUserStmt = db.prepare('DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?');
  const deleteByTokenStmt = db.prepare('DELETE FROM sessions WHERE (token = ? OR token_hash = ?) AND tenant_id = ?');
  const selectByHashStmt = db.prepare(
    `SELECT s.token, s.token_hash, s.user_id, s.tenant_id, s.expires_at, s.ip, s.user_agent, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE (s.token = ? OR s.token_hash = ?) AND s.tenant_id = ?`
  );
  const selectByPlainStmt = db.prepare(
    `SELECT s.rowid as rowid, s.token, s.token_hash, s.user_id, s.tenant_id, s.expires_at, s.ip, s.user_agent, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.tenant_id = ?`
  );
  const migrateLegacyStmt = db.prepare(
    "UPDATE sessions SET token = ?, token_hash = ?, ip = COALESCE(ip, ?), user_agent = COALESCE(user_agent, ?), last_seen_at = datetime('now') WHERE rowid = ?"
  );
  const updateLastSeenStmt = db.prepare(
    "UPDATE sessions SET last_seen_at = datetime('now'), ip = COALESCE(?, ip), user_agent = COALESCE(?, user_agent) WHERE token = ? AND tenant_id = ?"
  );

  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  function truncateUserAgent(ua) {
    if (!ua) return null;
    return String(ua).slice(0, 255);
  }

  function normalizeIp(ip) {
    if (!ip) return null;
    return String(ip).slice(0, 128);
  }

  function resolveTenantId(tenantId) {
    const numeric = Number(tenantId);
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
    return 1;
  }

  function issueSession(userId, req, { days = 7, tenantId = 1 } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expires = dayjs().add(days, 'day').toISOString();
    const ip = normalizeIp(req && req.ip);
    const userAgent = truncateUserAgent(req && req.get ? req.get('user-agent') : null);
    const effectiveTenantId = resolveTenantId(tenantId);

    const create = () => {
      deleteByUserStmt.run(userId, effectiveTenantId);
      insertSessionStmt.run(tokenHash, tokenHash, userId, effectiveTenantId, expires, ip, userAgent);
    };

    const trx = db.transaction(create);
    trx();

    return { token, tokenHash, expiresAt: expires };
  }

  function revokeUserSessions(userId, { tenantId = 1 } = {}) {
    deleteByUserStmt.run(userId, resolveTenantId(tenantId));
  }

  function destroySession(token, { tenantId = 1 } = {}) {
    if (!token) return;
    const hashed = hashToken(String(token));
    const effectiveTenantId = resolveTenantId(tenantId);
    deleteByTokenStmt.run(hashed, hashed, effectiveTenantId);
    // Legacy sessions with raw token column
    deleteByTokenStmt.run(token, token, effectiveTenantId);
  }

  function tokensMatch(expected, provided) {
    try {
      const exp = Buffer.from(expected, 'hex');
      const got = Buffer.from(provided, 'hex');
      return exp.length === got.length && crypto.timingSafeEqual(exp, got);
    } catch (_) {
      return false;
    }
  }

  function getSession(token, req, { tenantId = 1 } = {}) {
    if (!token) return null;
    const rawToken = String(token);
    const hashed = hashToken(rawToken);
    const effectiveTenantId = resolveTenantId(tenantId);

    let row = selectByHashStmt.get(hashed, hashed, effectiveTenantId);
    let migratedRowId = null;

    if (!row) {
      const legacyRow = selectByPlainStmt.get(rawToken, effectiveTenantId);
      if (legacyRow) {
        migratedRowId = legacyRow.rowid;
        row = legacyRow;
      }
    }

    if (!row) return null;

    if (!dayjs().isBefore(dayjs(row.expires_at))) {
      deleteByTokenStmt.run(row.token || hashed, row.token_hash || hashed);
      return null;
    }

    const requestIp = normalizeIp(req && req.ip);
    const requestAgent = truncateUserAgent(req && req.get ? req.get('user-agent') : null);

    if (row.ip && requestIp && row.ip !== requestIp) {
      return null;
    }
    if (row.user_agent && requestAgent && row.user_agent !== requestAgent) {
      return null;
    }

    if (migratedRowId) {
      migrateLegacyStmt.run(hashed, hashed, requestIp, requestAgent, migratedRowId);
    } else {
      updateLastSeenStmt.run(requestIp, requestAgent, row.token || hashed, effectiveTenantId);
    }

    return {
      tokenHash: row.token_hash || hashed,
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      username: row.username,
      role: row.role,
      expires_at: row.expires_at,
      ip: row.ip,
      user_agent: row.user_agent,
    };
  }

  return {
    issueSession,
    getSession,
    destroySession,
    revokeUserSessions,
    hashToken,
    tokensMatch,
  };
}

module.exports = {
  createSessionService,
};

