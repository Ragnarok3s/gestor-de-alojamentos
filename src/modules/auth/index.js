const { setNoIndex } = require('../../middlewares/security');
const { hashRecoveryCode } = require('../../services/twoFactor');

module.exports = function registerAuthRoutes(app, context) {
  const {
    layout,
    html,
    esc,
    db,
    crypto,
    dayjs,
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
    revokeUserSessions,
    resolveBrandingForRequest,
    mailer,
    twoFactorService,
    isSafeRedirectTarget,
    csrfProtection,
    secureCookies,
    featureFlags,
    isFeatureEnabled
  } = context;

  function isFlagEnabled(flagName) {
    if (typeof isFeatureEnabled === 'function') {
      return isFeatureEnabled(flagName);
    }
    if (featureFlags && Object.prototype.hasOwnProperty.call(featureFlags, flagName)) {
      return !!featureFlags[flagName];
    }
    return false;
  }

  function ensureNoIndexHeader(res) {
    if (isFlagEnabled('FEATURE_META_NOINDEX_BACKOFFICE')) {
      setNoIndex(res);
    }
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  const TWO_FA_COOKIE = 'tfa';

  function normalizeEmail(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  }

  function isValidEmail(email) {
    if (!email) return false;
    if (email.length > 160) return false;
    return EMAIL_REGEX.test(email);
  }

  function maskEmail(email) {
    if (!email) return '';
    const [local, domain] = String(email).split('@');
    if (!domain) return email;
    if (local.length <= 2) {
      return `${local.charAt(0)}…@${domain}`;
    }
    return `${local.slice(0, 2)}…@${domain}`;
  }

  function computeDefaultRedirect(userContext) {
    if (!userContext) return '/';
    if (userHasBackofficeAccess(userContext) && userCan(userContext, 'dashboard.view')) {
      return '/admin';
    }
    if (userCan(userContext, 'bookings.view')) return '/admin/bookings';
    if (userCan(userContext, 'housekeeping.view')) return '/limpeza/tarefas';
    if (userCan(userContext, 'calendar.view')) return '/calendar';
    if (userCan(userContext, 'owners.portal.view')) return '/owners';
    return '/';
  }

  function safeNextRedirect(target) {
    return typeof target === 'string' && isSafeRedirectTarget(target) ? target : null;
  }

  function setTwoFactorCookie(res, token) {
    res.cookie(TWO_FA_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: 10 * 60 * 1000
    });
  }

  function clearTwoFactorCookie(res) {
    res.clearCookie(TWO_FA_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
  }

  function getTwoFactorToken(req) {
    return req && req.cookies ? req.cookies[TWO_FA_COOKIE] : null;
  }

  const selectUserByIdStmt = db.prepare(
    'SELECT id, username, email, role, password_hash FROM users WHERE id = ? AND tenant_id = ?'
  );
  const selectUserByEmailStmt = db.prepare(
    'SELECT id, username, email, role, password_hash FROM users WHERE email = ? AND tenant_id = ?'
  );
  const deleteResetTokensForUserStmt = db.prepare(
    'DELETE FROM password_reset_tokens WHERE user_id = ? AND tenant_id = ?'
  );
  const insertResetTokenStmt = db.prepare(
    'INSERT INTO password_reset_tokens(token_hash, user_id, tenant_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)'
  );
  const selectResetTokenStmt = db.prepare(
    `SELECT token_hash, user_id, tenant_id, expires_at, used_at, created_at
       FROM password_reset_tokens WHERE token_hash = ?`
  );
  const deleteResetTokenStmt = db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?');
  const cleanupResetTokensStmt = db.prepare(
    "DELETE FROM password_reset_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= datetime('now', '-1 day'))"
  );

  function cleanupPasswordResetTokens() {
    if (!dayjs) return;
    const cutoff = dayjs().subtract(2, 'day').toISOString();
    cleanupResetTokensStmt.run(cutoff);
  }

  function buildBaseUrl(req) {
    const forwarded = req && req.headers ? req.headers['x-forwarded-proto'] : null;
    const protocolHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const protocol = protocolHeader ? String(protocolHeader).split(',')[0].trim() : req.protocol || 'https';
    const host = req && req.get ? req.get('host') : null;
    const hostname = host || (req && req.headers && req.headers.host) || 'localhost';
    return `${protocol}://${hostname}`;
  }

  async function issueTwoFactorEmailChallenge({ user, req, redirect, tenantId }) {
    if (!twoFactorService || typeof twoFactorService.createChallenge !== 'function') {
      throw new Error('Serviço de 2FA indisponível.');
    }
    if (!mailer || typeof mailer.sendMail !== 'function') {
      throw new Error('Serviço de email indisponível.');
    }
    const normalizedEmail = normalizeEmail(user.email);
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Conta sem email válido associado.');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const metadata = {
      delivery: 'email',
      expected_code_hash: hashRecoveryCode(code),
      redirect: redirect || null,
      tenant_id: tenantId,
      username: user.username,
      email: normalizedEmail,
      masked_email: maskEmail(normalizedEmail)
    };
    const challenge = twoFactorService.createChallenge(user.id, req, metadata, { expiresInSeconds: 600 });
    const branding = resolveBrandingForRequest(req) || {};
    const brandName = branding && branding.brandName ? branding.brandName : 'Gestor de Alojamentos';
    const safeBrand = esc(brandName);
    const safeUsername = esc(user.username || 'utilizador');
    const safeCode = esc(code);
    const loginUrl = `${buildBaseUrl(req)}/login/2fa`;
    const htmlBody = `
      <p>Olá <strong>${safeUsername}</strong>,</p>
      <p>Recebemos um pedido de acesso ao backoffice de <strong>${safeBrand}</strong>.</p>
      <p>Introduza o código abaixo para confirmar a autenticação a dois fatores:</p>
      <p style="font-size:20px;font-weight:bold;letter-spacing:4px;margin:16px 0;">${safeCode}</p>
      <p>Este código expira em 10 minutos. Se não reconhece o pedido ignore este email.</p>
      <p><a href="${esc(loginUrl)}">Confirmar autenticação</a></p>
    `;
    const textBody = `Olá ${user.username || 'utilizador'},\n\nRecebemos um pedido de acesso ao backoffice de ${brandName}. Utilize o código ${code} para confirmar a autenticação em dois fatores. O código expira em 10 minutos. Se não reconhece este pedido pode ignorar este email.\n\n${loginUrl}`;
    try {
      await mailer.sendMail({
        to: normalizedEmail,
        subject: `${brandName} · Código de autenticação`,
        text: textBody,
        html: htmlBody
      });
    } catch (err) {
      twoFactorService.revokeChallenge(challenge.token);
      throw err;
    }
    logActivity(user.id, 'auth:2fa_email_sent', 'user', user.id, {
      masked_email: metadata.masked_email,
      tenant_id: tenantId
    });
    return { challenge, maskedEmail: metadata.masked_email, redirect: redirect || null };
  }

  async function sendPasswordResetEmail({ user, token, req }) {
    if (!mailer || typeof mailer.sendMail !== 'function') {
      throw new Error('Serviço de email indisponível.');
    }
    const normalizedEmail = normalizeEmail(user.email);
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Conta sem email válido associado.');
    }
    const branding = resolveBrandingForRequest(req) || {};
    const brandName = branding && branding.brandName ? branding.brandName : 'Gestor de Alojamentos';
    const resetUrl = `${buildBaseUrl(req)}/login/reset/confirm?token=${encodeURIComponent(token)}`;
    const safeBrand = esc(brandName);
    const safeUsername = esc(user.username || 'utilizador');
    const htmlBody = `
      <p>Olá <strong>${safeUsername}</strong>,</p>
      <p>Recebemos um pedido para redefinir a password do backoffice de <strong>${safeBrand}</strong>.</p>
      <p>Clique no botão abaixo ou copie a ligação para definir uma nova password:</p>
      <p><a style="display:inline-block;padding:12px 18px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;" href="${esc(resetUrl)}">Definir nova password</a></p>
      <p>Se o botão não funcionar, utilize esta ligação:<br /><span style="word-break:break-all;">${esc(resetUrl)}</span></p>
      <p>O link é válido por 30 minutos. Ignore este email caso não tenha feito o pedido.</p>
    `;
    const textBody = `Olá ${user.username || 'utilizador'},\n\nRecebemos um pedido para redefinir a password do backoffice de ${brandName}. Utilize a ligação abaixo nas próximas 30 minutos:\n${resetUrl}\n\nSe não fez este pedido pode ignorar esta mensagem.`;
    await mailer.sendMail({
      to: normalizedEmail,
      subject: `${brandName} · Recuperação de password`,
      text: textBody,
      html: htmlBody
    });
    logActivity(user.id, 'auth:password_reset_email', 'user', user.id, {
      masked_email: maskEmail(normalizedEmail)
    });
  }

  app.get('/login', (req, res) => {
    const errorMessage = req.query && req.query.error ? esc(req.query.error) : '';
    const csrfToken = csrfProtection.ensureToken(req, res);
    const { error, next: nxt, notice } = req.query;
    const safeError = error ? esc(error) : '';
    const safeNotice = notice ? esc(notice) : '';
    const safeNext = nxt && isSafeRedirectTarget(nxt) ? esc(nxt) : '';

    ensureNoIndexHeader(res);

    res.send(
      layout({
        title: 'Login',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-4">Login Backoffice</h1>
      ${safeError ? `<div class="mb-3 text-sm text-rose-600">${safeError}</div>` : ''}
      ${safeNotice ? `<div class="mb-3 text-sm text-emerald-600">${safeNotice}</div>` : ''}
      <form method="post" action="/login" class="grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        ${safeNext ? `<input type="hidden" name="next" value="${safeNext}"/>` : ''}
        <input name="username" class="input" placeholder="Utilizador" required />
        <input name="password" type="password" class="input" placeholder="Palavra-passe" required />
        <button class="btn btn-primary">Entrar</button>
      </form>
      <p class="mt-3 text-sm text-center text-slate-600">
        <a class="text-sky-600 hover:underline" href="/login/reset">Esqueci-me da password!</a>
      </p>
    </div>
        `
      })
    );
  });

  app.post('/login', async (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const { username, password, next: nxt } = req.body;
    const tenantId = req.tenant ? Number(req.tenant.id) || 1 : 1;
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?')
      .get(username, tenantId);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      csrfProtection.rotateToken(req, res);
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Credenciais inválidas');
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

    const safeNext = safeNextRedirect(nxt);

    if (twoFactorService && typeof twoFactorService.isEnabled === 'function' && twoFactorService.isEnabled(user.id)) {
      try {
        const { challenge } = await issueTwoFactorEmailChallenge({
          user,
          req,
          redirect: safeNext,
          tenantId
        });
        setTwoFactorCookie(res, challenge.token);
        csrfProtection.rotateToken(req, res);
        return res.redirect('/login/2fa');
      } catch (err) {
        console.warn('Falha ao enviar código 2FA por email:', err.message);
        csrfProtection.rotateToken(req, res);
        clearTwoFactorCookie(res);
        return res.redirect('/login?error=Não foi possível enviar o código 2FA. Contacte o administrador.');
      }
    }

    const userContext = buildUserContext({ user_id: user.id, username: user.username, role: normalizedRole });

    const token = createSession(user.id, req);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
    logSessionEvent(user.id, 'login', req);
    logActivity(user.id, 'auth:login', null, null, {});

    csrfProtection.rotateToken(req, res);
    clearTwoFactorCookie(res);

    const redirectTo = safeNext || computeDefaultRedirect(userContext);
    res.redirect(redirectTo);
  });

  app.get('/login/2fa', (req, res) => {
    if (!twoFactorService || typeof twoFactorService.describeChallenge !== 'function') {
      return res.redirect('/login');
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return res.redirect('/login');
    }
    const challenge = twoFactorService.describeChallenge(challengeToken);
    if (!challenge) {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=O código expirou. Faça login novamente.');
    }
    if (challenge.expires_at && dayjs && !dayjs().isBefore(dayjs(challenge.expires_at))) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=O código expirou. Faça login novamente.');
    }
    const metadata = challenge.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(challenge.user_id, tenantId);
    if (!user) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Conta não encontrada.');
    }
    const maskedEmail = metadata.masked_email || maskEmail(metadata.email || user.email);
    const csrfToken = csrfProtection.ensureToken(req, res);
    const errorMessage = req.query && req.query.error ? esc(req.query.error) : '';
    const resentNotice = req.query && req.query.resent === '1';
    ensureNoIndexHeader(res);
    res.send(
      layout({
        title: 'Confirmar código',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-2">Confirmar código</h1>
      <p class="text-sm text-slate-600">Enviámos um código de verificação para <strong>${esc(maskedEmail || metadata.email || user.email || '')}</strong>.</p>
      ${resentNotice
        ? '<div class="mt-3 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Novo código enviado para o seu email.</div>'
        : ''}
      ${errorMessage ? `<div class="mt-3 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">${errorMessage}</div>` : ''}
      <form method="post" action="/login/2fa" class="mt-4 grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input name="code" class="input" placeholder="Código de 6 dígitos" required autofocus />
        <button class="btn btn-primary">Confirmar</button>
      </form>
      <form method="post" action="/login/2fa/resend" class="mt-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <button class="btn btn-light w-full" type="submit">Reenviar código</button>
      </form>
      <form method="post" action="/login/2fa/cancel" class="mt-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <button class="btn btn-light w-full" type="submit">Cancelar</button>
      </form>
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
    if (!twoFactorService || typeof twoFactorService.verifyChallenge !== 'function') {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Serviço de 2FA indisponível.');
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return res.redirect('/login');
    }
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.redirect('/login/2fa?error=Introduza o código recebido por email.');
    }
    const result = twoFactorService.verifyChallenge(challengeToken, code, { window: 2 });
    if (!result.ok) {
      const fatalReasons = ['missing_challenge', 'unknown_challenge', 'expired', 'too_many_attempts', 'already_used'];
      if (fatalReasons.includes(result.reason)) {
        clearTwoFactorCookie(res);
        return res.redirect('/login?error=O código expirou. Faça login novamente.');
      }
      return res.redirect('/login/2fa?error=Código inválido. Tente novamente.');
    }
    const metadata = result.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(result.userId, tenantId);
    if (!user) {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Conta não encontrada.');
    }
    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }
    const userContext = buildUserContext({ user_id: user.id, username: user.username, role: normalizedRole });
    const token = createSession(user.id, req);
    res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies });
    logSessionEvent(user.id, 'login', req);
    logActivity(user.id, 'auth:login', null, null, { method: '2fa_email' });
    logActivity(user.id, 'auth:2fa_verified', 'user', user.id, { method: result.method || 'email_code' });
    csrfProtection.rotateToken(req, res);
    clearTwoFactorCookie(res);
    const redirectTarget = metadata.redirect && isSafeRedirectTarget(metadata.redirect)
      ? metadata.redirect
      : computeDefaultRedirect(userContext);
    res.redirect(redirectTarget);
  });

  app.post('/login/2fa/resend', async (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    if (!twoFactorService || typeof twoFactorService.describeChallenge !== 'function') {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Serviço de 2FA indisponível.');
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return res.redirect('/login');
    }
    const challenge = twoFactorService.describeChallenge(challengeToken);
    if (!challenge) {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=O código expirou. Faça login novamente.');
    }
    const metadata = challenge.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(challenge.user_id, tenantId);
    if (!user) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=Conta não encontrada.');
    }
    try {
      twoFactorService.revokeChallenge(challengeToken);
      const { challenge: renewed } = await issueTwoFactorEmailChallenge({
        user,
        req,
        redirect: metadata.redirect && isSafeRedirectTarget(metadata.redirect) ? metadata.redirect : null,
        tenantId
      });
      setTwoFactorCookie(res, renewed.token);
      csrfProtection.rotateToken(req, res);
      return res.redirect('/login/2fa?resent=1');
    } catch (err) {
      console.warn('Falha ao reenviar código 2FA por email:', err.message);
      clearTwoFactorCookie(res);
      csrfProtection.rotateToken(req, res);
      return res.redirect('/login?error=Não foi possível reenviar o código.');
    }
  });

  app.post('/login/2fa/cancel', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    if (twoFactorService && typeof twoFactorService.revokeChallenge === 'function') {
      const challengeToken = getTwoFactorToken(req);
      if (challengeToken) {
        twoFactorService.revokeChallenge(challengeToken);
      }
    }
    clearTwoFactorCookie(res);
    csrfProtection.rotateToken(req, res);
    res.redirect('/login');
  });

  app.get('/login/reset', (req, res) => {
    const csrfToken = csrfProtection.ensureToken(req, res);
    const errorMessage = req.query && req.query.error ? esc(req.query.error) : '';
    const sent = req.query && req.query.sent === '1';
    ensureNoIndexHeader(res);
    res.send(
      layout({
        title: 'Recuperar password',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-2">Recuperar password</h1>
      <p class="text-sm text-slate-600">Introduza o email associado à sua conta para receber instruções de redefinição.</p>
      ${sent ? '<div class="mt-3 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Se existir uma conta com esse email enviámos um link de recuperação.</div>' : ''}
      ${errorMessage ? `<div class="mt-3 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">${errorMessage}</div>` : ''}
      <form method="post" action="/login/reset" class="mt-4 grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="email" name="email" class="input" placeholder="Email" required autofocus />
        <button class="btn btn-primary">Enviar instruções</button>
      </form>
      <p class="mt-3 text-sm text-center text-slate-600"><a class="text-sky-600 hover:underline" href="/login">Voltar ao login</a></p>
    </div>
        `
      })
    );
  });

  app.post('/login/reset', async (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const email = normalizeEmail(req.body && req.body.email);
    if (!isValidEmail(email)) {
      return res.redirect('/login/reset?error=Indique um email válido.');
    }
    const tenantId = req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByEmailStmt.get(email, tenantId);
    cleanupPasswordResetTokens();
    if (user) {
      try {
        deleteResetTokensForUserStmt.run(user.id, tenantId);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = dayjs ? dayjs().add(30, 'minute').toISOString() : null;
        const ip = req.ip ? String(req.ip).slice(0, 128) : null;
        const userAgent = req.get ? String(req.get('user-agent') || '').slice(0, 255) : null;
        insertResetTokenStmt.run(tokenHash, user.id, tenantId, expiresAt, ip, userAgent);
        await sendPasswordResetEmail({ user, token, req });
      } catch (err) {
        console.warn('Falha ao enviar email de recuperação:', err.message);
        return res.redirect('/login/reset?error=Não foi possível enviar o email de recuperação.');
      }
    }
    csrfProtection.rotateToken(req, res);
    res.redirect('/login/reset?sent=1');
  });

  app.get('/login/reset/confirm', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    cleanupPasswordResetTokens();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = selectResetTokenStmt.get(tokenHash);
    if (!entry) {
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    if (entry.used_at) {
      deleteResetTokenStmt.run(tokenHash);
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    if (entry.expires_at && dayjs && !dayjs().isBefore(dayjs(entry.expires_at))) {
      deleteResetTokenStmt.run(tokenHash);
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    const csrfToken = csrfProtection.ensureToken(req, res);
    ensureNoIndexHeader(res);
    res.send(
      layout({
        title: 'Definir nova password',
        branding: resolveBrandingForRequest(req),
        body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-2">Definir nova password</h1>
      <p class="text-sm text-slate-600">Introduza a nova password para concluir a recuperação.</p>
      ${errorMessage ? `<div class="mt-3 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">${errorMessage}</div>` : ''}
      <form method="post" action="/login/reset/confirm" class="mt-4 grid gap-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="token" value="${esc(token)}" />
        <input type="password" name="password" class="input" placeholder="Nova password (min 8)" required autofocus />
        <input type="password" name="confirm" class="input" placeholder="Confirmar password" required />
        <button class="btn btn-primary">Guardar password</button>
      </form>
    </div>
        `
      })
    );
  });

  app.post('/login/reset/confirm', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const confirm = typeof req.body.confirm === 'string' ? req.body.confirm : '';
    if (!password || password.length < 8) {
      return res.redirect(`/login/reset/confirm?token=${encodeURIComponent(token)}&error=Password inválida (min 8).`);
    }
    if (password !== confirm) {
      return res.redirect(`/login/reset/confirm?token=${encodeURIComponent(token)}&error=Passwords não coincidem.`);
    }
    cleanupPasswordResetTokens();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = selectResetTokenStmt.get(tokenHash);
    if (!entry) {
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    if (entry.expires_at && dayjs && !dayjs().isBefore(dayjs(entry.expires_at))) {
      deleteResetTokenStmt.run(tokenHash);
      return res.redirect('/login/reset?error=Ligação inválida ou expirada.');
    }
    const tenantId = entry.tenant_id ? Number(entry.tenant_id) || 1 : 1;
    const user = selectUserByIdStmt.get(entry.user_id, tenantId);
    if (!user) {
      deleteResetTokenStmt.run(tokenHash);
      return res.redirect('/login/reset?error=Conta não encontrada.');
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?').run(hash, user.id, tenantId);
    deleteResetTokenStmt.run(tokenHash);
    revokeUserSessions(user.id, req);
    logActivity(user.id, 'auth:password_reset_confirm', 'user', user.id, {});
    csrfProtection.rotateToken(req, res);
    clearTwoFactorCookie(res);
    res.redirect('/login?notice=Password atualizada. Pode iniciar sessão.');
  });

  app.post('/logout', (req, res) => {
    const sess = getSession(req.cookies.adm, req);
    if (sess) {
      logSessionEvent(sess.user_id, 'logout', req);
      logActivity(sess.user_id, 'auth:logout', null, null, {});
    }
    destroySession(req.cookies.adm, req);
    res.clearCookie('adm');
    csrfProtection.rotateToken(req, res);
    res.redirect('/');
  });
};
