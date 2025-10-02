const { getSession } = require('../services/session');

function buildSessionUser(session) {
  return session ? { id: session.user_id, username: session.username, role: session.role } : undefined;
}

function requireLogin(db) {
  return (req, res, next) => {
    const session = getSession(db, req.cookies.adm);
    if (!session) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    req.user = buildSessionUser(session);
    next();
  };
}

function requireAdmin(db) {
  return (req, res, next) => {
    const session = getSession(db, req.cookies.adm);
    if (!session) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    if (session.role !== 'admin') {
      return res.status(403).send('Sem permissão');
    }
    req.user = buildSessionUser(session);
    next();
  };
}

function resolveUser(db, req) {
  const session = getSession(db, req.cookies.adm);
  return buildSessionUser(session);
}

module.exports = {
  requireLogin,
  requireAdmin,
  resolveUser,
};
