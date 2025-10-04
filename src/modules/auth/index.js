module.exports = function registerAuthRoutes(app, context) {
  const {
    layout,
    html,
    esc,
    db,
    bcrypt,
    normalizeRole,
    createSession,
    logSessionEvent,
    logActivity,
    getSession,
    destroySession,
    resolveBrandingForRequest,
    isSafeRedirectTarget
  } = context;

  app.get('/login', (req, res) => {
    const { error, next: nxt } = req.query;
    const safeError = error ? esc(error) : '';
    const safeNext = nxt && isSafeRedirectTarget(nxt) ? esc(nxt) : '';

    res.send(
      layout({
        title: 'Login',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-4">Login Backoffice</h1>
      ${safeError ? `<div class="mb-3 text-sm text-rose-600">${safeError}</div>` : ''}
      <form method="post" action="/login" class="grid gap-3">
        ${safeNext ? `<input type="hidden" name="next" value="${safeNext}"/>` : ''}
        <input name="username" class="input" placeholder="Utilizador" required />
        <input name="password" type="password" class="input" placeholder="Palavra-passe" required />
        <button class="btn btn-primary">Entrar</button>
      </form>
    </div>
        `
      })
    );
  });

  app.post('/login', (req, res) => {
    const { username, password, next: nxt } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.redirect('/login?error=Credenciais inválidas');
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

    const token = createSession(user.id);
    const secure =
      !!process.env.FORCE_SECURE_COOKIE || (!!process.env.SSL_KEY_PATH && !!process.env.SSL_CERT_PATH);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure });
    logSessionEvent(user.id, 'login', req);
    logActivity(user.id, 'auth:login', null, null, {});

    const safeNext = typeof nxt === 'string' && isSafeRedirectTarget(nxt) ? nxt : null;
    res.redirect(safeNext || '/admin');
  });

  app.post('/logout', (req, res) => {
    const sess = getSession(req.cookies.adm);
    if (sess) {
      logSessionEvent(sess.user_id, 'logout', req);
      logActivity(sess.user_id, 'auth:logout', null, null, {});
    }
    destroySession(req.cookies.adm);
    res.clearCookie('adm');
    res.redirect('/');
  });
};
