const crypto = require('crypto');
const {
  randomBase32,
  generateRecoveryCodes,
  verifyTotp,
  otpauthUrl,
  hashRecoveryCode,
  timingSafeEqual
} = require('./twoFactor');

function createTwoFactorService({ db, dayjs }) {
  if (!db || !dayjs) throw new Error('Two-factor service requires db and dayjs');

  const selectConfigStmt = db.prepare(
    `SELECT user_id, secret, recovery_codes_json, enabled_at, confirmed_at, last_verified_at, enforced
       FROM user_two_factor WHERE user_id = ?`
  );
  const upsertConfigStmt = db.prepare(
    `INSERT INTO user_two_factor(user_id, secret, recovery_codes_json, confirmed_at, last_verified_at, enforced)
      VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       secret = excluded.secret,
       recovery_codes_json = excluded.recovery_codes_json,
       confirmed_at = excluded.confirmed_at,
       last_verified_at = excluded.last_verified_at,
       enforced = excluded.enforced,
       enabled_at = COALESCE(user_two_factor.enabled_at, excluded.confirmed_at, datetime('now'))`
  );
  const updateRecoveryStmt = db.prepare(
    `UPDATE user_two_factor
        SET recovery_codes_json = ?, last_verified_at = COALESCE(last_verified_at, datetime('now'))
      WHERE user_id = ?`
  );
  const updateLastVerifiedStmt = db.prepare(
    `UPDATE user_two_factor SET last_verified_at = datetime('now') WHERE user_id = ?`
  );
  const deleteConfigStmt = db.prepare('DELETE FROM user_two_factor WHERE user_id = ?');

  const insertSetupStmt = db.prepare(
    `INSERT INTO user_two_factor_setup(user_id, secret, recovery_codes_json, created_at)
      VALUES (?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, recovery_codes_json = excluded.recovery_codes_json, created_at = datetime('now')`
  );
  const selectSetupStmt = db.prepare(
    'SELECT user_id, secret, recovery_codes_json, created_at FROM user_two_factor_setup WHERE user_id = ?'
  );
  const deleteSetupStmt = db.prepare('DELETE FROM user_two_factor_setup WHERE user_id = ?');

  const insertChallengeStmt = db.prepare(
    `INSERT INTO two_factor_challenges(token_hash, user_id, expires_at, ip, user_agent, metadata_json)
      VALUES (?,?,?,?,?,?)`
  );
  const selectChallengeStmt = db.prepare(
    `SELECT token_hash, user_id, created_at, expires_at, attempts, ip, user_agent, metadata_json, used_at, last_attempt_at
       FROM two_factor_challenges WHERE token_hash = ?`
  );
  const touchChallengeStmt = db.prepare(
    `UPDATE two_factor_challenges
        SET attempts = attempts + 1,
            last_attempt_at = datetime('now'),
            metadata_json = ?
      WHERE token_hash = ?`
  );
  const consumeChallengeStmt = db.prepare(
    `UPDATE two_factor_challenges
        SET used_at = datetime('now'),
            last_attempt_at = datetime('now'),
            metadata_json = ?
      WHERE token_hash = ?`
  );
  const deleteChallengeStmt = db.prepare('DELETE FROM two_factor_challenges WHERE token_hash = ?');
  const deleteChallengesForUserStmt = db.prepare('DELETE FROM two_factor_challenges WHERE user_id = ?');
  const cleanupChallengesStmt = db.prepare('DELETE FROM two_factor_challenges WHERE expires_at <= ?');

  function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
  }

  function parseRecoveryJson(json) {
    if (!json) return [];
    try {
      const value = JSON.parse(json);
      if (!Array.isArray(value)) return [];
      return value
        .map(entry => {
          if (!entry) return null;
          if (typeof entry === 'string') {
            return { hash: entry, used_at: null };
          }
          const hash = entry.hash || entry.code || entry.value;
          if (!hash) return null;
          return { hash, used_at: entry.used_at || entry.usedAt || null };
        })
        .filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function serializeRecovery(list) {
    return JSON.stringify(list.map(item => ({ hash: item.hash, used_at: item.used_at || null })));
  }

  function getConfig(userId) {
    if (!userId) return null;
    const row = selectConfigStmt.get(userId);
    if (!row) return null;
    return {
      user_id: row.user_id,
      secret: row.secret,
      enabled_at: row.enabled_at,
      confirmed_at: row.confirmed_at,
      last_verified_at: row.last_verified_at,
      enforced: !!row.enforced,
      recovery_codes: parseRecoveryJson(row.recovery_codes_json)
    };
  }

  function isEnabled(userId) {
    return !!getConfig(userId);
  }

  function maskRecoveryCodes(list) {
    return list.map(item => {
      const hash = item.hash || '';
      return {
        fingerprint: hash.slice(0, 4).toUpperCase(),
        used_at: item.used_at || null
      };
    });
  }

  function startEnrollment(userId, { issuer, label, recoveryCount = 8 } = {}) {
    if (!userId) throw new Error('userId obrigatório para iniciar 2FA');
    const secret = randomBase32(32);
    const recoveryCodes = generateRecoveryCodes(recoveryCount);
    insertSetupStmt.run(userId, secret, JSON.stringify(recoveryCodes));
    return {
      userId,
      secret,
      recoveryCodes,
      otpauthUrl: otpauthUrl({ secret, issuer, label })
    };
  }

  function getEnrollment(userId, { issuer, label } = {}) {
    if (!userId) return null;
    const row = selectSetupStmt.get(userId);
    if (!row) return null;
    const secret = row.secret;
    let recoveryCodes;
    try {
      const parsed = JSON.parse(row.recovery_codes_json || '[]');
      recoveryCodes = Array.isArray(parsed) ? parsed.map(code => String(code)) : [];
    } catch (err) {
      recoveryCodes = [];
    }
    return {
      userId,
      secret,
      recoveryCodes,
      created_at: row.created_at,
      otpauthUrl: otpauthUrl({ secret, issuer, label })
    };
  }

  function cancelEnrollment(userId) {
    if (!userId) return;
    deleteSetupStmt.run(userId);
  }

  function confirmEnrollment(userId, token, { issuer, label, window = 1 } = {}) {
    if (!userId) return { ok: false, reason: 'missing_user' };
    const setup = getEnrollment(userId, { issuer, label });
    if (!setup) return { ok: false, reason: 'setup_missing' };
    const verification = verifyTotp(setup.secret, token, { window });
    if (!verification.valid) {
      return { ok: false, reason: 'invalid_token' };
    }
    const hashedCodes = setup.recoveryCodes.map(code => ({ hash: hashRecoveryCode(code), used_at: null }));
    const nowIso = dayjs().toISOString();
    upsertConfigStmt.run(userId, setup.secret, serializeRecovery(hashedCodes), nowIso, nowIso, 0);
    deleteSetupStmt.run(userId);
    deleteChallengesForUserStmt.run(userId);
    return { ok: true, recoveryCodes: setup.recoveryCodes, confirmedAt: nowIso };
  }

  function disable(userId) {
    if (!userId) return;
    deleteConfigStmt.run(userId);
    deleteSetupStmt.run(userId);
    deleteChallengesForUserStmt.run(userId);
  }

  function markRecoveryCodeUsed(userId, hash) {
    const config = getConfig(userId);
    if (!config) return false;
    const updated = config.recovery_codes.map(entry => {
      if (!entry || !entry.hash) return entry;
      if (timingSafeEqual(entry.hash, hash)) {
        if (entry.used_at) return entry;
        return { hash: entry.hash, used_at: dayjs().toISOString() };
      }
      return entry;
    });
    updateRecoveryStmt.run(serializeRecovery(updated), userId);
    return true;
  }

  function verifyUserToken(userId, token, { window = 1 } = {}) {
    const config = getConfig(userId);
    if (!config) {
      return { ok: false, reason: 'not_enabled' };
    }
    const totpResult = verifyTotp(config.secret, token, { window });
    if (totpResult.valid) {
      updateLastVerifiedStmt.run(userId);
      return { ok: true, method: 'totp', delta: totpResult.delta };
    }
    const normalized = String(token || '').trim().replace(/\s+/g, '').toLowerCase();
    if (!normalized) {
      return { ok: false, reason: 'invalid_token' };
    }
    const hashed = hashRecoveryCode(normalized);
    const match = config.recovery_codes.find(entry => entry && !entry.used_at && timingSafeEqual(entry.hash, hashed));
    if (match) {
      markRecoveryCodeUsed(userId, hashed);
      return { ok: true, method: 'recovery' };
    }
    return { ok: false, reason: 'invalid_token' };
  }

  function pruneChallenges() {
    const cutoff = dayjs().subtract(2, 'day').toISOString();
    cleanupChallengesStmt.run(cutoff);
  }

  function createChallenge(userId, req, metadata = {}, { expiresInSeconds = 600 } = {}) {
    if (!userId) throw new Error('userId é obrigatório para desafios 2FA');
    pruneChallenges();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = dayjs().add(expiresInSeconds, 'second').toISOString();
    const ip = req && req.ip ? String(req.ip).slice(0, 128) : null;
    const userAgent = req && req.get ? String(req.get('user-agent') || '').slice(0, 255) : null;
    const payload = metadata ? JSON.stringify(metadata) : null;
    insertChallengeStmt.run(tokenHash, userId, expiresAt, ip, userAgent, payload);
    return { token, tokenHash, expiresAt };
  }

  function describeChallenge(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = selectChallengeStmt.get(tokenHash);
    if (!row) return null;
    return { ...row };
  }

  function verifyChallenge(token, code, { window = 1 } = {}) {
    if (!token) {
      return { ok: false, reason: 'missing_challenge' };
    }
    const tokenHash = hashToken(token);
    const row = selectChallengeStmt.get(tokenHash);
    if (!row) {
      return { ok: false, reason: 'unknown_challenge' };
    }
    if (row.used_at) {
      deleteChallengeStmt.run(tokenHash);
      return { ok: false, reason: 'already_used' };
    }
    const now = dayjs();
    if (!now.isBefore(dayjs(row.expires_at))) {
      deleteChallengeStmt.run(tokenHash);
      return { ok: false, reason: 'expired' };
    }
    const attempts = Number(row.attempts || 0);
    if (attempts >= 8) {
      deleteChallengeStmt.run(tokenHash);
      return { ok: false, reason: 'too_many_attempts' };
    }
    const verification = verifyUserToken(row.user_id, code, { window });
    if (!verification.ok) {
      const meta = mergeChallengeMetadata(row.metadata_json, {
        last_failure: dayjs().toISOString(),
        reason: verification.reason || 'invalid'
      });
      touchChallengeStmt.run(meta, tokenHash);
      return { ok: false, reason: verification.reason || 'invalid_token', attempts: attempts + 1 };
    }
    const meta = mergeChallengeMetadata(row.metadata_json, {
      last_success: dayjs().toISOString(),
      method: verification.method
    });
    consumeChallengeStmt.run(meta, tokenHash);
    deleteChallengeStmt.run(tokenHash);
    return { ok: true, userId: row.user_id, method: verification.method };
  }

  function mergeChallengeMetadata(json, updates = {}) {
    let base = {};
    if (json) {
      try {
        base = JSON.parse(json) || {};
      } catch (err) {
        base = {};
      }
    }
    return JSON.stringify({ ...base, ...updates });
  }

  function regenerateRecoveryCodes(userId, { count = 8 } = {}) {
    if (!userId) return { ok: false, reason: 'missing_user' };
    const config = getConfig(userId);
    if (!config) return { ok: false, reason: 'not_enabled' };
    const codes = generateRecoveryCodes(count);
    const hashed = codes.map(code => ({ hash: hashRecoveryCode(code), used_at: null }));
    updateRecoveryStmt.run(serializeRecovery(hashed), userId);
    return { ok: true, codes };
  }

  return {
    getConfig,
    isEnabled,
    maskRecoveryCodes,
    startEnrollment,
    getEnrollment,
    cancelEnrollment,
    confirmEnrollment,
    disable,
    verifyUserToken,
    createChallenge,
    describeChallenge,
    verifyChallenge,
    regenerateRecoveryCodes,
    pruneChallenges
  };
}

module.exports = {
  createTwoFactorService
};
