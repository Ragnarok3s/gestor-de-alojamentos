module.exports = function registerAuthRoutes(app, context) {
  const {
    layout,
    html,
    esc,
    db,
    bcrypt,
    normalizeRole,
    buildUserContext,
    userCan,
    userHasBackofficeAccess,
    createSession,
    logSessionEvent,
    logActivity,
    getSession,
    destroySession,
    resolveBrandingForRequest,
    isSafeRedirectTarget,
    csrfProtection,
    secureCookies
  } = context;

  app.get('/login', (req, res) => {
    const csrfToken = csrfProtection.ensureToken(req, res);
    const { error, next: nxt } = req.query;
    const safeError = error ? esc(error) : '';
    const safeNext = nxt && isSafeRedirectTarget(nxt) ? esc(nxt) : '';
    const t = typeof req.t === 'function' ? req.t : (key, fallback) => fallback;
    const pageTitle = t('auth.login.title', 'Login');
    const headingLabel = t('auth.login.heading', 'Backoffice login');
    const usernameLabel = t('auth.login.username', 'Username');
    const passwordLabel = t('auth.login.password', 'Password');
    const submitLabel = t('auth.login.submit', 'Sign in');
    const errorLabel = safeError;

    res.send(
      layout({
        title: pageTitle,
        branding: resolveBrandingForRequest(req),
        locale: req.locale,
        t: req.t,
        csrfToken,
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-4">${esc(headingLabel)}</h1>
      ${errorLabel ? `<div class="mb-3 text-sm text-rose-600">${errorLabel}</div>` : ''}
      <form method="post" action="/login" class="grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        ${safeNext ? `<input type="hidden" name="next" value="${safeNext}"/>` : ''}
        <input name="username" class="input" placeholder="${esc(usernameLabel)}" required />
        <input name="password" type="password" class="input" placeholder="${esc(passwordLabel)}" required />
        <button class="btn btn-primary">${esc(submitLabel)}</button>
      </form>
    </div>
        `
      })
    );
  });

  app.post('/login', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const { username, password, next: nxt } = req.body;
    const t = typeof req.t === 'function' ? req.t : (key, fallback) => fallback;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      csrfProtection.rotateToken(req, res);
      const invalidCredentials = encodeURIComponent(t('auth.login.invalidCredentials', 'Credenciais inválidas'));
      return res.redirect(`/login?error=${invalidCredentials}`);
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

    const userContext = buildUserContext({ user_id: user.id, username: user.username, role: normalizedRole });

    const token = createSession(user.id, req);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
    logSessionEvent(user.id, 'login', req);
    logActivity(user.id, 'auth:login', null, null, {});

    csrfProtection.rotateToken(req, res);

    const safeNext = typeof nxt === 'string' && isSafeRedirectTarget(nxt) ? nxt : null;
    const defaultRedirect =
      userHasBackofficeAccess(userContext) && userCan(userContext, 'dashboard.view')
        ? '/admin'
        : userCan(userContext, 'bookings.view')
        ? '/admin/bookings'
        : userCan(userContext, 'housekeeping.view')
        ? '/limpeza/tarefas'
        : userCan(userContext, 'calendar.view')
        ? '/calendar'
        : userCan(userContext, 'owners.portal.view')
        ? '/owners'
        : '/';
    res.redirect(safeNext || defaultRedirect);
  });

  app.post('/logout', (req, res) => {
    const sess = getSession(req.cookies.adm, req);
    if (sess) {
      logSessionEvent(sess.user_id, 'logout', req);
      logActivity(sess.user_id, 'auth:logout', null, null, {});
    }
    destroySession(req.cookies.adm);
    res.clearCookie('adm');
    csrfProtection.rotateToken(req, res);
    res.redirect('/');
  });
};
