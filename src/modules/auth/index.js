const fs = require('fs');
const path = require('path');
const { setNoIndex } = require('../../middlewares/security');
const { hashRecoveryCode } = require('../../services/twoFactor');

const authViewsPath = path.join(__dirname, '..', '..', 'views', 'auth');
const loginTemplatePath = path.join(authViewsPath, 'login.ejs');
const twoFactorTemplatePath = path.join(authViewsPath, 'twofactor.ejs');
const resetTemplatePath = path.join(authViewsPath, 'reset.ejs');

function compileEjsTemplate(template) {
  if (!template) return null;
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let index = 0;
  let source = "let __output = '';\n";
  source += 'const __append = value => { __output += value == null ? "" : String(value); };\n';
  source += 'with (locals || {}) {\n';
  let match;
  while ((match = matcher.exec(template)) !== null) {
    const text = template.slice(index, match.index);
    if (text) {
      const escapedText = text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      source += `__output += \`${escapedText}\`;\n`;
    }
    const indicator = match[1];
    const code = match[2];
    if (indicator === '=') {
      source += `__append(${code.trim()});\n`;
    } else if (indicator === '-') {
      source += `__output += (${code.trim()}) ?? '';\n`;
    } else {
      source += `${code}\n`;
    }
    index = match.index + match[0].length;
  }
  const tail = template.slice(index);
  if (tail) {
    const escapedTail = tail
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    source += `__output += \`${escapedTail}\`;\n`;
  }
  source += '}\nreturn __output;';
  try {
    // eslint-disable-next-line no-new-func
    return new Function('locals', source);
  } catch (err) {
    return null;
  }
}

function loadTemplateRenderer(templatePath) {
  try {
    const template = fs.readFileSync(templatePath, 'utf8');
    return compileEjsTemplate(template);
  } catch (err) {
    return null;
  }
}

const loginTemplateRenderer = loadTemplateRenderer(loginTemplatePath);
const twoFactorTemplateRenderer = loadTemplateRenderer(twoFactorTemplatePath);
const resetTemplateRenderer = loadTemplateRenderer(resetTemplatePath);

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
      return '/admin/dashboard';
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

  function renderTemplate(renderer, locals, fallback) {
    if (typeof renderer === 'function') {
      try {
        return renderer(locals);
      } catch (err) {
        console.warn('Falha ao renderizar template de autenticação:', err.message);
      }
    }
    if (typeof fallback === 'function') {
      return fallback(locals);
    }
    return typeof fallback === 'string' ? fallback : '';
  }

  function computeBrandingVisuals(branding) {
    const brandName = branding && branding.brandName ? branding.brandName : 'Gestor de Alojamentos';
    const initialsSource = branding && branding.brandInitials ? branding.brandInitials : brandName;
    const initials = initialsSource
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .slice(0, 2)
      .toUpperCase() || 'GA';
    const logoAlt = branding && branding.logoAlt ? branding.logoAlt : `${brandName} · logótipo`;
    const logoPath = branding && branding.logoPath ? branding.logoPath : null;
    const tagline = branding && branding.tagline ? branding.tagline : '';
    return { brandName, initials, logoAlt, logoPath, tagline };
  }

  function resolveTranslator(req, res) {
    if (res && res.locals && typeof res.locals.t === 'function') {
      return res.locals.t;
    }
    if (req && typeof req.t === 'function') {
      return req.t;
    }
    return (key) => key;
  }

  function resolveMessage(message, translator, replacements) {
    if (!message) return '';
    if (typeof translator === 'function') {
      try {
        const translated = translator(message, replacements);
        if (translated && translated !== message) {
          return translated;
        }
      } catch (err) {
        // ignore translation errors and fall back to raw message
      }
    }
    return typeof message === 'string' ? message : '';
  }

  function renderBrandLogoMarkup(branding) {
    const visuals = computeBrandingVisuals(branding);
    if (visuals.logoPath) {
      return `<img src="${esc(visuals.logoPath)}" alt="${esc(visuals.logoAlt)}" class="auth-logo__image" />`;
    }
    return `<span class="auth-logo__initials">${esc(visuals.initials)}</span>`;
  }

  function renderLoginPage(req, res, options = {}) {
    const {
      errorMessage: rawError = '',
      noticeMessage: rawNotice = '',
      username = '',
      next = '',
      statusCode = 200
    } = options;
    ensureNoIndexHeader(res);
    const csrfToken = csrfProtection.ensureToken(req, res);
    const branding = resolveBrandingForRequest(req);
    const translator = resolveTranslator(req, res);
    const nextValue = safeNextRedirect(next) || '';
    const locals = {
      branding,
      csrfToken,
      errorMessage: resolveMessage(rawError, translator),
      noticeMessage: resolveMessage(rawNotice, translator),
      username,
      next: nextValue,
      esc,
      t: translator
    };
    const body = renderTemplate(loginTemplateRenderer, locals, (ctx) => {
      const t = typeof ctx.t === 'function' ? ctx.t : translator;
      const visuals = computeBrandingVisuals(branding);
      const subtitle = visuals.tagline
        ? esc(visuals.tagline)
        : esc(resolveMessage('auth.subtitle', t, { brand: visuals.brandName }));
      const noticeHtml = ctx.noticeMessage
        ? `<div class="auth-alert auth-alert--success" role="status">${esc(ctx.noticeMessage)}</div>`
        : '';
      const errorHtml = ctx.errorMessage
        ? `<div class="auth-alert auth-alert--error" role="alert">${esc(ctx.errorMessage)}</div>`
        : '';
      const nextInput = ctx.next ? `<input type="hidden" name="next" value="${esc(ctx.next)}" />` : '';
      const safeUsername = ctx.username ? esc(ctx.username) : '';
      const welcomeText = esc(resolveMessage('auth.welcome', t));
      const usernameLabel = esc(resolveMessage('auth.usernameLabel', t));
      const passwordLabel = esc(resolveMessage('auth.passwordLabel', t));
      const usernamePlaceholder = esc(resolveMessage('auth.placeholder.username', t));
      const passwordPlaceholder = esc(resolveMessage('auth.placeholder.password', t));
      const signInLabel = esc(resolveMessage('auth.signIn', t));
      const forgotPasswordLabel = esc(resolveMessage('auth.forgotPassword', t));
      return html`
        <div class="auth-wrapper">
          <div class="auth-card card">
            <div class="auth-branding">
              <div class="auth-logo">${renderBrandLogoMarkup(branding)}</div>
              <h1 class="auth-title">${welcomeText}</h1>
              <p class="auth-subtitle">${subtitle}</p>
            </div>
            ${noticeHtml}
            ${errorHtml}
            <form class="auth-form" method="post" action="/login">
              <input type="hidden" name="_csrf" value="${esc(ctx.csrfToken || '')}" />
              ${nextInput}
              <div class="auth-field">
                <label class="auth-label" for="login-username">${usernameLabel}</label>
                <div class="auth-input">
                  <span class="auth-input__icon"><span class="app-icon"><i data-lucide="user"></i></span></span>
                  <input
                    id="login-username"
                    class="auth-input__field"
                    name="username"
                    placeholder="${usernamePlaceholder}"
                    value="${safeUsername}"
                    autocomplete="username"
                    required
                    autofocus
                  />
                </div>
              </div>
              <div class="auth-field">
                <label class="auth-label" for="login-password">${passwordLabel}</label>
                <div class="auth-input">
                  <span class="auth-input__icon"><span class="app-icon"><i data-lucide="lock"></i></span></span>
                  <input
                    id="login-password"
                    type="password"
                    class="auth-input__field"
                    name="password"
                    placeholder="${passwordPlaceholder}"
                    autocomplete="current-password"
                    required
                  />
                </div>
              </div>
              <button class="btn btn-primary auth-submit" type="submit">${signInLabel}</button>
            </form>
            <div class="auth-links">
              <a href="/login/reset">${forgotPasswordLabel}</a>
            </div>
          </div>
        </div>
      `;
    });
    return res
      .status(statusCode)
      .send(
        layout({
          title: resolveMessage('auth.signIn', translator) || 'Login',
          branding,
          pageClass: 'page-auth',
          body
        })
      );
  }

  


  function renderTwoFactorPage(req, res, options = {}) {
    const {
      challenge = null,
      errorMessage: rawError = '',
      noticeMessage: rawNotice = '',
      statusCode = 200
    } = options;
    ensureNoIndexHeader(res);
    const csrfToken = csrfProtection.ensureToken(req, res);
    const branding = resolveBrandingForRequest(req);
    const translator = resolveTranslator(req, res);
    const metadata = challenge && challenge.metadata ? challenge.metadata : {};
    const maskedEmail = metadata.masked_email || maskEmail(metadata.email || '');
    const locals = {
      branding,
      csrfToken,
      errorMessage: resolveMessage(rawError, translator),
      noticeMessage: resolveMessage(rawNotice, translator),
      maskedEmail,
      esc,
      t: translator
    };
    const body = renderTemplate(twoFactorTemplateRenderer, locals, (ctx) => {
      const t = typeof ctx.t === 'function' ? ctx.t : translator;
      const noticeHtml = ctx.noticeMessage
        ? `<div class="auth-alert auth-alert--success" role="status">${esc(ctx.noticeMessage)}</div>`
        : '';
      const errorHtml = ctx.errorMessage
        ? `<div class="auth-alert auth-alert--error" role="alert">${esc(ctx.errorMessage)}</div>`
        : '';
      const maskedDestination = ctx.maskedEmail ? esc(ctx.maskedEmail) : esc(maskedEmail || '');
      const title = esc(resolveMessage('auth.twofactor.title', t));
      const descriptionTemplate = esc(resolveMessage('auth.twofactor.description', t));
      const descriptionHtml = descriptionTemplate.includes('{destination}')
        ? descriptionTemplate.replace('{destination}', `<strong>${maskedDestination}</strong>`)
        : descriptionTemplate;
      const codeLabel = esc(resolveMessage('auth.twofactor.codeLabel', t));
      const codePlaceholder = esc(resolveMessage('auth.placeholder.twoFactor', t));
      const submitLabel = esc(resolveMessage('auth.twofactor.submit', t));
      const resendLabel = esc(resolveMessage('auth.twofactor.resend', t));
      const cancelLabel = esc(resolveMessage('actions.cancel', t));
      return html`
        <div class="auth-wrapper">
          <div class="auth-card card">
            <div class="auth-branding">
              <div class="auth-logo">${renderBrandLogoMarkup(branding)}</div>
              <h1 class="auth-title">${title}</h1>
              <p class="auth-subtitle">${descriptionHtml}</p>
            </div>
            ${noticeHtml}
            ${errorHtml}
            <form class="auth-form" method="post" action="/login/2fa">
              <input type="hidden" name="_csrf" value="${esc(ctx.csrfToken || '')}" />
              <div class="auth-field">
                <label class="auth-label" for="tfa-code">${codeLabel}</label>
                <div class="auth-input">
                  <span class="auth-input__icon"><span class="app-icon"><i data-lucide="shield-check"></i></span></span>
                  <input
                    id="tfa-code"
                    class="auth-input__field"
                    name="code"
                    placeholder="${codePlaceholder}"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    autocomplete="one-time-code"
                    required
                    autofocus
                  />
                </div>
              </div>
              <button class="btn btn-primary auth-submit" type="submit">${submitLabel}</button>
            </form>
            <form class="auth-form auth-form--secondary" method="post" action="/login/2fa/resend">
              <input type="hidden" name="_csrf" value="${esc(ctx.csrfToken || '')}" />
              <button class="btn btn-light auth-submit" type="submit">${resendLabel}</button>
            </form>
            <form class="auth-form auth-form--secondary" method="post" action="/login/2fa/cancel">
              <input type="hidden" name="_csrf" value="${esc(ctx.csrfToken || '')}" />
              <button class="btn btn-light auth-submit" type="submit">${cancelLabel}</button>
            </form>
          </div>
        </div>
      `;
    });
    return res
      .status(statusCode)
      .send(
        layout({
          title: resolveMessage('auth.twofactor.title', translator) || '2FA',
          branding,
          pageClass: 'page-auth',
          body
        })
      );
  }

  

  function renderResetPage(req, res, options = {}) {
    const {
      step = 'request',
      errorMessage: rawError = '',
      noticeMessage: rawNotice = '',
      token = '',
      statusCode = 200
    } = options;
    ensureNoIndexHeader(res);
    const csrfToken = csrfProtection.ensureToken(req, res);
    const branding = resolveBrandingForRequest(req);
    const translator = resolveTranslator(req, res);
    const locals = {
      branding,
      csrfToken,
      errorMessage: resolveMessage(rawError, translator),
      noticeMessage: resolveMessage(rawNotice, translator),
      step,
      token,
      esc,
      t: translator
    };
    const body = renderTemplate(resetTemplateRenderer, locals, (ctx) => {
      const t = typeof ctx.t === 'function' ? ctx.t : translator;
      const subtitle = ctx.step === 'confirm'
        ? esc(resolveMessage('auth.reset.stepPassword', t))
        : esc(resolveMessage('auth.reset.stepEmail', t));
      const noticeHtml = ctx.noticeMessage
        ? `<div class="auth-alert auth-alert--success" role="status">${esc(ctx.noticeMessage)}</div>`
        : '';
      const errorHtml = ctx.errorMessage
        ? `<div class="auth-alert auth-alert--error" role="alert">${esc(ctx.errorMessage)}</div>`
        : '';
      const tokenInput = ctx.step === 'confirm' ? `<input type="hidden" name="token" value="${esc(ctx.token || '')}" />` : '';
      const primaryAction = ctx.step === 'confirm' ? '/login/reset/confirm' : '/login/reset';
      const primaryButtonLabel = ctx.step === 'confirm'
        ? esc(resolveMessage('auth.reset.submitPassword', t))
        : esc(resolveMessage('auth.reset.submitEmail', t));
      const secondaryLinkHref = ctx.step === 'confirm' ? '/login/reset' : '/login';
      const secondaryKey = ctx.step === 'confirm' ? 'auth.reset.requestLink' : 'auth.reset.backToLogin';
      const secondaryLinkLabel = esc(resolveMessage(secondaryKey, t));
      const stepEmailLabel = esc(resolveMessage('auth.reset.stepEmail', t));
      const stepPasswordLabel = esc(resolveMessage('auth.reset.stepPassword', t));
      const emailLabel = esc(resolveMessage('auth.reset.emailLabel', t) || 'Email');
      const emailPlaceholder = esc(resolveMessage('auth.reset.emailPlaceholder', t));
      const newPasswordLabel = esc(resolveMessage('auth.reset.newPassword', t));
      const newPasswordPlaceholder = esc(resolveMessage('auth.reset.newPasswordPlaceholder', t));
      const confirmPasswordLabel = esc(resolveMessage('auth.reset.confirmPassword', t));
      const confirmPasswordPlaceholder = esc(resolveMessage('auth.reset.confirmPasswordPlaceholder', t));
      const firstField = ctx.step === 'confirm'
        ? html`
            <div class="auth-field">
              <label class="auth-label" for="reset-password">${newPasswordLabel}</label>
              <div class="auth-input">
                <span class="auth-input__icon"><span class="app-icon"><i data-lucide="lock"></i></span></span>
                <input
                  id="reset-password"
                  class="auth-input__field"
                  type="password"
                  name="password"
                  placeholder="${newPasswordPlaceholder}"
                  autocomplete="new-password"
                  required
                />
              </div>
            </div>
          `
        : html`
            <div class="auth-field">
              <label class="auth-label" for="reset-email">${emailLabel}</label>
              <div class="auth-input">
                <span class="auth-input__icon"><span class="app-icon"><i data-lucide="mail"></i></span></span>
                <input
                  id="reset-email"
                  class="auth-input__field"
                  type="email"
                  name="email"
                  placeholder="${emailPlaceholder}"
                  autocomplete="email"
                  required
                  autofocus
                />
              </div>
            </div>
          `;
      const secondField = ctx.step === 'confirm'
        ? html`
            <div class="auth-field">
              <label class="auth-label" for="reset-confirm">${confirmPasswordLabel}</label>
              <div class="auth-input">
                <span class="auth-input__icon"><span class="app-icon"><i data-lucide="check-circle"></i></span></span>
                <input
                  id="reset-confirm"
                  class="auth-input__field"
                  type="password"
                  name="confirm"
                  placeholder="${confirmPasswordPlaceholder}"
                  autocomplete="new-password"
                  required
                />
              </div>
            </div>
          `
        : '';
      return html`
        <div class="auth-wrapper">
          <div class="auth-card card">
            <div class="auth-branding">
              <div class="auth-logo">${renderBrandLogoMarkup(branding)}</div>
              <h1 class="auth-title">${esc(resolveMessage('auth.reset.title', t))}</h1>
              <p class="auth-subtitle">${subtitle}</p>
            </div>
            <div class="auth-stepper">
              <div class="auth-step${ctx.step === 'request' ? ' is-active' : ''}">
                <span class="auth-step__number">1</span>
                <span class="auth-step__label">${stepEmailLabel}</span>
              </div>
              <div class="auth-step${ctx.step === 'confirm' ? ' is-active' : ''}">
                <span class="auth-step__number">2</span>
                <span class="auth-step__label">${stepPasswordLabel}</span>
              </div>
            </div>
            ${noticeHtml}
            ${errorHtml}
            <form class="auth-form" method="post" action="${primaryAction}">
              <input type="hidden" name="_csrf" value="${esc(ctx.csrfToken || '')}" />
              ${tokenInput}
              ${firstField}
              ${secondField}
              <button class="btn btn-primary auth-submit" type="submit">${primaryButtonLabel}</button>
            </form>
            <div class="auth-links">
              <a href="${secondaryLinkHref}">${secondaryLinkLabel}</a>
            </div>
          </div>
        </div>
      `;
    });
    const pageTitle = esc(resolveMessage('auth.reset.title', translator));
    return res
      .status(statusCode)
      .send(
        layout({
          title: pageTitle,
          branding,
          pageClass: 'page-auth',
          body
        })
      );
  }

  function renderResetRequestPage(req, res, options = {}) {
    return renderResetPage(req, res, { ...options, step: 'request' });
  }

  function renderResetConfirmPage(req, res, options = {}) {
    return renderResetPage(req, res, { ...options, step: 'confirm' });
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
    const { error, next: nxt, notice } = req.query || {};
    renderLoginPage(req, res, {
      errorMessage: typeof error === 'string' ? error : '',
      noticeMessage: typeof notice === 'string' ? notice : '',
      next: typeof nxt === 'string' ? nxt : ''
    });
  });

  app.post('/login', async (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const { username, password, next: nxt } = req.body || {};
    const safeNext = safeNextRedirect(nxt);
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    const passwordValue = typeof password === 'string' ? password : '';
    const tenantId = req.tenant ? Number(req.tenant.id) || 1 : 1;
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?')
      .get(normalizedUsername, tenantId);
    if (!user || !bcrypt.compareSync(String(passwordValue), user.password_hash)) {
      csrfProtection.rotateToken(req, res);
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.invalidCredentials',
        username: normalizedUsername,
        next: safeNext || '',
        statusCode: 401
      });
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole !== user.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    }

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
        return renderLoginPage(req, res, {
          errorMessage: 'errors.auth.twoFactorSendFailed',
          username: normalizedUsername,
          next: safeNext || '',
          statusCode: 503
        });
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
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.challengeMissing',
        statusCode: 400
      });
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.challengeMissing',
        statusCode: 400
      });
    }
    const challenge = twoFactorService.describeChallenge(challengeToken);
    if (!challenge) {
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.twoFactorExpired',
        statusCode: 400
      });
    }
    if (challenge.expires_at && dayjs && !dayjs().isBefore(dayjs(challenge.expires_at))) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.twoFactorExpired',
        statusCode: 400
      });
    }
    const metadata = challenge.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(challenge.user_id, tenantId);
    if (!user) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.accountNotFound',
        username: metadata.username || '',
        next: metadata.redirect || '',
        statusCode: 404
      });
    }
    const errorMessage = typeof req.query?.error === 'string' ? req.query.error : '';
    const resentNotice = req.query && req.query.resent === '1';
    const noticeMessage = resentNotice
      ? 'auth.twofactor.resentNotice'
      : typeof req.query?.notice === 'string'
      ? req.query.notice
      : '';
    return renderTwoFactorPage(req, res, {
      challenge,
      errorMessage,
      noticeMessage
    });
  });

  app.post('/login/2fa', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    if (!twoFactorService || typeof twoFactorService.verifyChallenge !== 'function') {
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.twoFactorUnavailable',
        statusCode: 503
      });
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.challengeMissing',
        statusCode: 400
      });
    }
    const describedChallenge =
      typeof twoFactorService.describeChallenge === 'function'
        ? twoFactorService.describeChallenge(challengeToken)
        : null;
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return renderTwoFactorPage(req, res, {
        challenge: describedChallenge,
        errorMessage: 'errors.auth.twoFactorMissing',
        statusCode: 400
      });
    }
    const result = twoFactorService.verifyChallenge(challengeToken, code, { window: 2 });
    if (!result.ok) {
      const fatalReasons = ['missing_challenge', 'unknown_challenge', 'expired', 'too_many_attempts', 'already_used'];
      if (fatalReasons.includes(result.reason)) {
        clearTwoFactorCookie(res);
        const failMetadata = result.metadata || (describedChallenge && describedChallenge.metadata) || {};
        return renderLoginPage(req, res, {
          errorMessage: 'errors.auth.twoFactorExpired',
          username: failMetadata.username || '',
          next: failMetadata.redirect || '',
          statusCode: 400
        });
      }
      return renderTwoFactorPage(req, res, {
        challenge: describedChallenge,
        errorMessage: 'errors.auth.twoFactorInvalid',
        statusCode: 400
      });
    }
    const metadata = result.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(result.userId, tenantId);
    if (!user) {
      clearTwoFactorCookie(res);
      return renderLoginPage(req, res, {
        errorMessage: 'errors.auth.accountNotFound',
        statusCode: 404
      });
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
      return res.redirect('/login?error=errors.auth.twoFactorUnavailable');
    }
    const challengeToken = getTwoFactorToken(req);
    if (!challengeToken) {
      return res.redirect('/login');
    }
    const challenge = twoFactorService.describeChallenge(challengeToken);
    if (!challenge) {
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=errors.auth.twoFactorExpired');
    }
    const metadata = challenge.metadata || {};
    const tenantId = metadata.tenant_id ? Number(metadata.tenant_id) || 1 : req.tenant && req.tenant.id ? Number(req.tenant.id) || 1 : 1;
    const user = selectUserByIdStmt.get(challenge.user_id, tenantId);
    if (!user) {
      twoFactorService.revokeChallenge(challengeToken);
      clearTwoFactorCookie(res);
      return res.redirect('/login?error=errors.auth.accountNotFound');
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
      return res.redirect('/login?error=errors.auth.twoFactorResendFailed');
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
    const { error, sent, notice } = req.query || {};
    const noticeMessage = sent === '1'
      ? 'errors.auth.recoveryEmailSent'
      : typeof notice === 'string'
      ? notice
      : '';
    renderResetRequestPage(req, res, {
      errorMessage: typeof error === 'string' ? error : '',
      noticeMessage
    });
  });

  app.post('/login/reset', async (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const email = normalizeEmail(req.body && req.body.email);
    if (!isValidEmail(email)) {
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryEmailRequired',
        statusCode: 400
      });
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
        return renderResetRequestPage(req, res, {
          errorMessage: 'errors.auth.recoverySendFailed',
          statusCode: 503
        });
      }
    }
    csrfProtection.rotateToken(req, res);
    res.redirect('/login/reset?sent=1');
  });

  app.get('/login/reset/confirm', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    cleanupPasswordResetTokens();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = selectResetTokenStmt.get(tokenHash);
    if (!entry) {
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    if (entry.used_at) {
      deleteResetTokenStmt.run(tokenHash);
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    if (entry.expires_at && dayjs && !dayjs().isBefore(dayjs(entry.expires_at))) {
      deleteResetTokenStmt.run(tokenHash);
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    const errorMessage = typeof req.query?.error === 'string' ? req.query.error : '';
    renderResetConfirmPage(req, res, {
      token,
      errorMessage
    });
  });

  app.post('/login/reset/confirm', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    cleanupPasswordResetTokens();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = selectResetTokenStmt.get(tokenHash);
    if (!entry) {
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    if (entry.expires_at && dayjs && !dayjs().isBefore(dayjs(entry.expires_at))) {
      deleteResetTokenStmt.run(tokenHash);
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.recoveryCodeInvalid',
        statusCode: 400
      });
    }
    const tenantId = entry.tenant_id ? Number(entry.tenant_id) || 1 : 1;
    const user = selectUserByIdStmt.get(entry.user_id, tenantId);
    if (!user) {
      deleteResetTokenStmt.run(tokenHash);
      return renderResetRequestPage(req, res, {
        errorMessage: 'errors.auth.accountNotFound',
        statusCode: 404
      });
    }
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const confirm = typeof req.body.confirm === 'string' ? req.body.confirm : '';
    if (!password || password.length < 8) {
      return renderResetConfirmPage(req, res, {
        token,
        errorMessage: 'errors.auth.recoveryPasswordInvalid',
        statusCode: 400
      });
    }
    if (password !== confirm) {
      return renderResetConfirmPage(req, res, {
        token,
        errorMessage: 'errors.auth.recoveryPasswordMismatch',
        statusCode: 400
      });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?').run(hash, user.id, tenantId);
    deleteResetTokenStmt.run(tokenHash);
    revokeUserSessions(user.id, req);
    logActivity(user.id, 'auth:password_reset_confirm', 'user', user.id, {});
    csrfProtection.rotateToken(req, res);
    clearTwoFactorCookie(res);
    res.redirect('/login?notice=errors.auth.recoveryCompleted');
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
