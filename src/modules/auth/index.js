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
    secureCookies,
    twoFactorService
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
      logSessionEvent(null, 'login_failed', req, { reason: 'invalid_credentials', username });
      return res.redirect('/login?error=Credenciais inválidas');
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

    const userContext = buildUserContext({ user_id: user.id, username: user.username, role: normalizedRole });

    const safeNext = typeof nxt === 'string' && isSafeRedirectTarget(nxt) ? nxt : null;
    const twoFactorEnabled = twoFactorService && twoFactorService.isEnabled(user.id);

    if (twoFactorEnabled) {
      const challenge = twoFactorService.createChallenge(user.id, req, { username: user.username, next: safeNext });
      logSessionEvent(user.id, 'login_2fa_required', req, { stage: 'challenge', username: user.username });
      csrfProtection.rotateToken(req, res);
      const params = new URLSearchParams({ challenge: challenge.token });
      if (safeNext) params.set('next', safeNext);
      return res.redirect(`/login/2fa?${params.toString()}`);
    }

    const token = createSession(user.id, req);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
    logSessionEvent(user.id, 'login', req, { method: 'password' });
    logActivity(user.id, 'auth:login', null, null, {});

    csrfProtection.rotateToken(req, res);

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

  app.get('/login/2fa', (req, res) => {
    const csrfToken = csrfProtection.ensureToken(req, res);
    const { challenge: challengeToken, error } = req.query || {};
    if (!challengeToken || typeof challengeToken !== 'string') {
      return res.redirect('/login?error=Sessão expirada, faça login novamente.');
    }
    const challenge = twoFactorService ? twoFactorService.describeChallenge(challengeToken) : null;
    if (!challenge) {
      return res.redirect('/login?error=Pedido de validação inválido ou expirado.');
    }
    const userRow = db.prepare('SELECT username FROM users WHERE id = ?').get(challenge.user_id);
    const safeError = error ? esc(String(error)) : '';
    const nextParam = typeof req.query.next === 'string' && isSafeRedirectTarget(req.query.next) ? req.query.next : '';

    res.send(
      layout({
        title: 'Confirmar login',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-4">Confirmação em dois passos</h1>
      <p class="text-sm text-slate-600 mb-4">Introduza o código da sua app de autenticação para aceder.</p>
      ${safeError ? `<div class="mb-3 text-sm text-rose-600">${safeError}</div>` : ''}
      <form method="post" action="/login/2fa" class="grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="challenge" value="${esc(challengeToken)}" />
        ${nextParam ? `<input type="hidden" name="next" value="${esc(nextParam)}" />` : ''}
        <label class="grid gap-1">
          <span class="text-sm text-slate-600">Código de autenticação para ${esc((userRow && userRow.username) || 'a sua conta')}</span>
          <input name="code" class="input" inputmode="numeric" autocomplete="one-time-code" pattern="\d{4,10}" required placeholder="000 000" />
        </label>
        <button class="btn btn-primary">Validar e entrar</button>
      </form>
      <p class="mt-4 text-xs text-slate-500">Pode usar um código de recuperação caso não tenha acesso à app.</p>
    </div>
        `
      })
    );
  });

  app.post('/login/2fa', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const { challenge: challengeToken, code, next: nxt } = req.body || {};
    if (!challengeToken || typeof challengeToken !== 'string') {
      csrfProtection.rotateToken(req, res);
      return res.redirect('/login?error=Pedido inválido.');
    }
    const challengeDetails = twoFactorService ? twoFactorService.describeChallenge(challengeToken) : null;
    if (!challengeDetails) {
      csrfProtection.rotateToken(req, res);
      return res.redirect('/login?error=Pedido expirado, volte a iniciar sessão.');
    }

    const verification = twoFactorService.verifyChallenge(challengeToken, code, { window: 1 });
    if (!verification.ok) {
      csrfProtection.rotateToken(req, res);
      if (challengeDetails && challengeDetails.user_id) {
        logSessionEvent(challengeDetails.user_id, 'login_2fa_failure', req, {
          reason: verification.reason || 'invalid_token'
        });
      }
      const params = new URLSearchParams({ challenge: challengeToken, error: 'Código inválido. Tente novamente.' });
      if (nxt && typeof nxt === 'string' && isSafeRedirectTarget(nxt)) params.set('next', nxt);
      return res.redirect(`/login/2fa?${params.toString()}`);
    }

    const userId = verification.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      csrfProtection.rotateToken(req, res);
      return res.redirect('/login?error=Conta não encontrada.');
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

    const userContext = buildUserContext({ user_id: user.id, username: user.username, role: normalizedRole });
    const token = createSession(user.id, req);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
    logSessionEvent(user.id, 'login', req, { method: 'password+2fa', two_factor: verification.method });
    logActivity(user.id, 'auth:login', null, null, { method: verification.method });

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
