const { setNoIndex } = require('../../middlewares/security');
const { serverRender } = require('../../middlewares/telemetry');

module.exports = function registerAccountModule(app, context) {
  const {
    layout,
    html,
    esc,
    db,
    dayjs,
    requireLogin,
    csrfProtection,
    resolveBrandingForRequest,
    logActivity,
    logSessionEvent,
    twoFactorService,
    featureFlags,
    isFeatureEnabled
  } = context;

  if (!twoFactorService) {
    return;
  }

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

  const TWO_FACTOR_BACKOFF_WINDOWS = [5, 10, 20];
  const TWO_FACTOR_BACKOFF_THRESHOLD = 5;
  const twoFactorBackoff = new Map();

  function isTwoFactorBackoffEnabled() {
    return isFlagEnabled('FEATURE_BACKOFF_2FA');
  }

  function getBackoffKey(userId) {
    return String(userId);
  }

  function getBackoffEntry(userId) {
    const key = getBackoffKey(userId);
    const entry = twoFactorBackoff.get(key);
    if (!entry) {
      return null;
    }
    if (entry.lockUntil && entry.lockUntil <= Date.now()) {
      entry.lockUntil = 0;
      entry.attempts = entry.attempts || 0;
      twoFactorBackoff.set(key, entry);
    }
    return entry;
  }

  function clearBackoff(userId) {
    twoFactorBackoff.delete(getBackoffKey(userId));
  }

  function getActiveLock(userId) {
    if (!isTwoFactorBackoffEnabled()) {
      return null;
    }
    const entry = getBackoffEntry(userId);
    if (entry && entry.lockUntil && entry.lockUntil > Date.now()) {
      return { lockUntil: entry.lockUntil, level: entry.level || 0 };
    }
    return null;
  }

  function registerTwoFactorFailure(userId) {
    if (!isTwoFactorBackoffEnabled()) {
      return null;
    }
    const now = Date.now();
    const key = getBackoffKey(userId);
    const current = getBackoffEntry(userId) || { attempts: 0, lockUntil: 0, level: 0 };

    if (current.lockUntil && current.lockUntil > now) {
      return { locked: true, lockUntil: current.lockUntil, attemptsRemaining: 0, level: current.level || 0 };
    }

    current.attempts = (current.attempts || 0) + 1;

    if (current.attempts >= TWO_FACTOR_BACKOFF_THRESHOLD) {
      const levelIndex = Math.min(current.level || 0, TWO_FACTOR_BACKOFF_WINDOWS.length - 1);
      const durationMinutes = TWO_FACTOR_BACKOFF_WINDOWS[levelIndex];
      current.lockUntil = now + durationMinutes * 60_000;
      current.level = Math.min((current.level || 0) + 1, TWO_FACTOR_BACKOFF_WINDOWS.length - 1);
      current.attempts = 0;
      twoFactorBackoff.set(key, current);
      return { locked: true, lockUntil: current.lockUntil, attemptsRemaining: 0, level: current.level };
    }

    twoFactorBackoff.set(key, current);
    return {
      locked: false,
      lockUntil: 0,
      attemptsRemaining: Math.max(TWO_FACTOR_BACKOFF_THRESHOLD - current.attempts, 0),
      level: current.level || 0
    };
  }

  function formatLockDuration(lockUntil) {
    const remainingMs = Math.max(lockUntil - Date.now(), 0);
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }

  function buildBackoffErrorMessage(state, fallbackMessage) {
    if (!state) {
      return fallbackMessage;
    }
    if (state.locked && state.lockUntil) {
      return `Demasiadas tentativas falhadas. Aguarde ${formatLockDuration(state.lockUntil)} antes de tentar novamente.`;
    }
    if (typeof state.attemptsRemaining === 'number' && state.attemptsRemaining > 0 && state.attemptsRemaining <= 2) {
      const attemptsLabel = state.attemptsRemaining === 1 ? '1 tentativa' : `${state.attemptsRemaining} tentativas`;
      return `${fallbackMessage} Restam ${attemptsLabel} antes de bloqueio temporário.`;
    }
    return fallbackMessage;
  }

  function loadSecurityData(userId, options = {}) {
    const issuer = 'Gestor de Alojamentos';
    const label = `${options.username || ''}`.trim() || undefined;
    const setup = twoFactorService.getEnrollment(userId, { issuer, label });
    const config = twoFactorService.getConfig(userId);
    const sessionLogs = db
      .prepare(
        `SELECT id, action, ip, user_agent, metadata_json, created_at
           FROM session_logs
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 50`
      )
      .all(userId)
      .map(entry => ({
        ...entry,
        created_at_label: dayjs(entry.created_at).format('DD/MM/YYYY HH:mm'),
        metadata: parseJson(entry.metadata_json)
      }));

    return { setup, config, sessionLogs };
  }

  function parseJson(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch (err) {
      return null;
    }
  }

  function renderSecurityPage(req, res, options = {}) {
    ensureNoIndexHeader(res);
    const viewer = req.user;
    const csrfToken = csrfProtection.ensureToken(req, res);
    const data = loadSecurityData(viewer.id, { username: viewer.username });
    const { setup, config, sessionLogs } = data;
    const freshRecoveryCodes = options.freshRecoveryCodes || null;
    const successMessage = options.successMessage || null;
    const errorMessage = options.errorMessage || null;
    const pendingCodes = setup ? setup.recoveryCodes : null;
    const maskedCodes = config ? twoFactorService.maskRecoveryCodes(config.recovery_codes) : [];
    const lastVerifiedLabel = config && config.last_verified_at ? dayjs(config.last_verified_at).format('DD/MM/YYYY HH:mm') : null;
    const enabledAtLabel = config && config.enabled_at ? dayjs(config.enabled_at).format('DD/MM/YYYY HH:mm') : null;

    const pageStyles = html`
      <style>
        .page-account-security .bo-alert{border-radius:16px;padding:12px 16px;font-size:.9rem;font-weight:500;}
        .page-account-security .bo-alert--success{background:#ecfdf5;color:#047857;border:1px solid rgba(16,185,129,.25);}
        .page-account-security .bo-alert--error{background:#fef2f2;color:#b91c1c;border:1px solid rgba(248,113,113,.35);}
      </style>
    `;

    const body = html`
      ${pageStyles}
      <div class="bo-main max-w-4xl mx-auto">
        <div class="r-scope">
          <div class="r-container">
            <header class="bo-header">
          <span class="pill-indicator">Conta</span>
          <h1>Segurança e Acessos</h1>
          <p class="text-slate-600">Proteja a sua conta com autenticação a dois fatores e consulte o histórico de acessos.</p>
        </header>

            ${successMessage ? `<div class="bo-alert bo-alert--success">${esc(successMessage)}</div>` : ''}
            ${errorMessage ? `<div class="bo-alert bo-alert--error">${esc(errorMessage)}</div>` : ''}

            <section class=\"bo-card r-card grid gap-4">
          <div class="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h2 class="text-lg font-semibold">Autenticação de dois fatores</h2>
              <p class="text-sm text-slate-600">Adiciona uma camada extra ao pedir um código temporário em cada acesso.</p>
            </div>
            <span class="pill-indicator ${config ? 'pill-indicator--success' : 'pill-indicator--warning'}">
              ${config ? 'Ativa' : 'Desativada'}
            </span>
          </div>

          ${setup
            ? html`
                <article class="rounded-lg border border-amber-200 bg-amber-50 p-4 grid gap-3">
                  <h3 class="font-semibold text-amber-800">Configuração pendente</h3>
                  <p class="text-sm text-amber-700">
                    Digitalize o código QR ou introduza o código secreto na sua aplicação (Google Authenticator, 1Password, etc.).
                    Depois confirme com um código válido para concluir.
                  </p>
                  <div class="grid gap-2 text-sm">
                    <div>
                      <span class="font-semibold text-amber-800">Código secreto:</span>
                      <code class="inline-block bg-white border border-amber-200 px-2 py-1 rounded">${esc(setup.secret)}</code>
                    </div>
                    <div>
                      <span class="font-semibold text-amber-800">Link direto:</span>
                      <a class="text-amber-700 underline" href="${esc(setup.otpauthUrl)}">${esc(setup.otpauthUrl)}</a>
                    </div>
                  </div>
                  ${Array.isArray(pendingCodes) && pendingCodes.length
                    ? html`<div>
                        <h4 class="font-semibold text-amber-800 mb-1">Códigos de recuperação (guarde em local seguro)</h4>
                        <pre class="bg-white border border-amber-200 rounded p-3 text-sm leading-6">${pendingCodes
                          .map(code => esc(code))
                          .join('\n')}</pre>
                      </div>`
                    : ''}
                  <form method="post" action="/account/seguranca/2fa/confirmar" class="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                    <input type="hidden" name="_csrf" value="${csrfToken}" />
                    <label class="grid gap-1 text-sm">
                      <span>Código de 6 dígitos</span>
                      <input class="input" name="token" required pattern="\d{4,10}" inputmode="numeric" autocomplete="one-time-code" />
                    </label>
                    <button class="btn btn-primary">Confirmar 2FA</button>
                  </form>
                  <form method="post" action="/account/seguranca/2fa/cancelar" class="mt-2">
                    <input type="hidden" name="_csrf" value="${csrfToken}" />
                    <button class="btn btn-light" type="submit">Cancelar configuração</button>
                  </form>
                </article>
              `
            : config
            ? html`
                <article class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 grid gap-3">
                  <div>
                    <h3 class="font-semibold text-emerald-800">2FA ativa</h3>
                    <p class="text-sm text-emerald-700">
                      Ativada em ${enabledAtLabel || 'data desconhecida'}${lastVerifiedLabel
                        ? ` · último acesso confirmado ${lastVerifiedLabel}`
                        : ''}.
                    </p>
                  </div>
                  ${maskedCodes.length
                    ? html`<div>
                        <h4 class="font-semibold text-emerald-800 mb-1">Códigos de recuperação disponíveis</h4>
                        <ul class="grid gap-1 text-sm text-emerald-700">
                          ${maskedCodes
                            .map(code => `<li>${esc(code.fingerprint)} · ${code.used_at ? 'Usado' : 'Disponível'}</li>`)
                            .join('')}
                        </ul>
                        <p class="text-xs text-emerald-700 mt-2">Regenerar códigos invalida os anteriores.</p>
                      </div>`
                    : ''}
                  <form method="post" action="/account/seguranca/2fa/regenerar" class="grid gap-2 md:grid-cols-[auto_auto] md:items-center">
                    <input type="hidden" name="_csrf" value="${csrfToken}" />
                    <button class="btn btn-secondary" type="submit">Regenerar códigos de recuperação</button>
                  </form>
                  <form method="post" action="/account/seguranca/2fa/desativar" class="mt-2">
                    <input type="hidden" name="_csrf" value="${csrfToken}" />
                    <button class="btn btn-light" type="submit">Desativar 2FA</button>
                  </form>
                </article>
              `
            : html`
                <form method="post" action="/account/seguranca/2fa/iniciar" class="rounded-lg border border-slate-200 bg-white p-4 grid gap-2">
                  <input type="hidden" name="_csrf" value="${csrfToken}" />
                  <p class="text-sm text-slate-600">Ative a verificação em dois passos para impedir acessos não autorizados mesmo com a password.</p>
                  <button class="btn btn-primary w-full md:w-auto">Ativar 2FA</button>
                </form>
              `}

          ${freshRecoveryCodes && freshRecoveryCodes.length
            ? html`<article class="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <h3 class="font-semibold text-indigo-800 mb-2">Novos códigos de recuperação</h3>
                <p class="text-sm text-indigo-700 mb-2">Guarde estes códigos num local seguro. Cada código só pode ser usado uma vez.</p>
                <pre class="bg-white border border-indigo-200 rounded p-3 text-sm leading-6">${freshRecoveryCodes
                  .map(code => esc(code))
                  .join('\n')}</pre>
              </article>`
            : ''}
            </section>

            <section class=\"bo-card r-card mt-6">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h2 class="text-lg font-semibold">Últimos acessos</h2>
              <p class="text-sm text-slate-600">Histórico dos 50 eventos mais recentes associados à sua conta.</p>
            </div>
            <a class="btn btn-light" href="/account/seguranca/logs.csv">Exportar CSV</a>
          </div>
          <div class="responsive-table r-table-wrap">
            <table class="w-full text-sm">
              <thead>
                <tr>
                  <th class="text-left px-4 py-2">Quando</th>
                  <th class="text-left px-4 py-2">Evento</th>
                  <th class="text-left px-4 py-2">IP</th>
                  <th class="text-left px-4 py-2">User-Agent</th>
                  <th class="text-left px-4 py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                ${sessionLogs.length
                  ? sessionLogs
                      .map(
                        row => html`<tr>
                            <td class="px-4 py-2 text-slate-600">${esc(row.created_at_label)}</td>
                            <td class="px-4 py-2">${esc(row.action)}</td>
                            <td class="px-4 py-2">${row.ip ? esc(row.ip) : '—'}</td>
                            <td class="px-4 py-2 text-slate-500">${esc((row.user_agent || '').slice(0, 120))}</td>
                            <td class="px-4 py-2 text-xs text-slate-500">${formatMetadata(row.metadata)}</td>
                          </tr>`
                      )
                      .join('')
                  : '<tr><td class="px-4 py-3 text-slate-500" colspan="5">Sem registos recentes.</td></tr>'}
              </tbody>
            </table>
          </div>
            </section>
          </div>
        </div>
      </div>
    `;

    serverRender('route:/account/seguranca');
    res.send(
      layout({
        title: 'Segurança da Conta',
        user: viewer,
        activeNav: null,
        branding: resolveBrandingForRequest(req),
        body,
        pageClass: 'page-backoffice page-account-security'
      })
    );
  }

  function formatMetadata(meta) {
    if (!meta) return '—';
    if (typeof meta === 'string') return esc(meta);
    try {
      return esc(JSON.stringify(meta));
    } catch (err) {
      return '—';
    }
  }

  app.get(['/account/seguranca', '/account/security'], requireLogin, (req, res) => {
    if (req.path === '/account/security' && isFlagEnabled('FEATURE_ALIAS_ACCOUNT_SECURITY_REDIRECT')) {
      return res.redirect(302, '/account/seguranca');
    }
    renderSecurityPage(req, res);
  });

  app.post('/account/seguranca/2fa/iniciar', requireLogin, (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const viewer = req.user;
    if (twoFactorService.getConfig(viewer.id)) {
      csrfProtection.rotateToken(req, res);
      return renderSecurityPage(req, res, { errorMessage: 'A autenticação já se encontra ativa.' });
    }
    twoFactorService.startEnrollment(viewer.id, {
      issuer: 'Gestor de Alojamentos',
      label: `${viewer.username}@Gestor`
    });
    clearBackoff(viewer.id);
    logActivity(viewer.id, 'user:2fa_setup_start', 'user', viewer.id, {});
    csrfProtection.rotateToken(req, res);
    renderSecurityPage(req, res, {
      successMessage: 'Gerámos o código secreto e os códigos de recuperação. Confirme abaixo para concluir.'
    });
  });

  app.post('/account/seguranca/2fa/cancelar', requireLogin, (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const viewer = req.user;
    twoFactorService.cancelEnrollment(viewer.id);
    clearBackoff(viewer.id);
    logActivity(viewer.id, 'user:2fa_setup_cancel', 'user', viewer.id, {});
    csrfProtection.rotateToken(req, res);
    renderSecurityPage(req, res, { successMessage: 'Configuração cancelada.' });
  });

  app.post('/account/seguranca/2fa/confirmar', requireLogin, (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const viewer = req.user;
    const activeLock = getActiveLock(viewer.id);
    if (activeLock) {
      csrfProtection.rotateToken(req, res);
      logSessionEvent(viewer.id, 'account_2fa_confirm_rate_limited', req, {
        lock_expires_at: new Date(activeLock.lockUntil).toISOString()
      });
      return renderSecurityPage(req, res, {
        errorMessage: `Demasiadas tentativas falhadas. Aguarde ${formatLockDuration(activeLock.lockUntil)} antes de tentar novamente.`
      });
    }
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      csrfProtection.rotateToken(req, res);
      return renderSecurityPage(req, res, { errorMessage: 'Indique o código temporário para confirmar.' });
    }
    const result = twoFactorService.confirmEnrollment(viewer.id, token, {
      issuer: 'Gestor de Alojamentos',
      label: `${viewer.username}@Gestor`
    });
    csrfProtection.rotateToken(req, res);
    if (!result.ok) {
      const backoffState = registerTwoFactorFailure(viewer.id);
      logSessionEvent(viewer.id, 'account_2fa_confirm_failed', req, { reason: result.reason || 'invalid' });
      const errorMessage = buildBackoffErrorMessage(backoffState, 'Código inválido. Tente novamente.');
      return renderSecurityPage(req, res, { errorMessage });
    }
    clearBackoff(viewer.id);
    logActivity(viewer.id, 'user:2fa_enabled', 'user', viewer.id, {});
    logSessionEvent(viewer.id, 'account_2fa_enabled', req, {});
    renderSecurityPage(req, res, {
      successMessage: 'Autenticação em dois fatores concluída com sucesso. Guarde os códigos apresentados.',
      freshRecoveryCodes: result.recoveryCodes || []
    });
  });

  app.post('/account/seguranca/2fa/desativar', requireLogin, (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const viewer = req.user;
    twoFactorService.disable(viewer.id);
    clearBackoff(viewer.id);
    logActivity(viewer.id, 'user:2fa_disabled', 'user', viewer.id, {});
    logSessionEvent(viewer.id, 'account_2fa_disabled', req, {});
    csrfProtection.rotateToken(req, res);
    renderSecurityPage(req, res, { successMessage: 'Autenticação a dois fatores desativada.' });
  });

  app.post('/account/seguranca/2fa/regenerar', requireLogin, (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      csrfProtection.rotateToken(req, res);
      return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
    }
    const viewer = req.user;
    const result = twoFactorService.regenerateRecoveryCodes(viewer.id);
    csrfProtection.rotateToken(req, res);
    if (!result.ok) {
      return renderSecurityPage(req, res, { errorMessage: 'Não foi possível regenerar os códigos. Confirme se o 2FA está ativo.' });
    }
    logActivity(viewer.id, 'user:2fa_codes_regenerated', 'user', viewer.id, {});
    logSessionEvent(viewer.id, 'account_2fa_codes_regenerated', req, {});
    renderSecurityPage(req, res, {
      successMessage: 'Novos códigos de recuperação gerados com sucesso.',
      freshRecoveryCodes: result.codes
    });
  });

  app.get('/account/seguranca/logs.csv', requireLogin, (req, res) => {
    const viewer = req.user;
    const rows = db
      .prepare(
        `SELECT action, ip, user_agent, metadata_json, created_at
           FROM session_logs
          WHERE user_id = ?
          ORDER BY created_at DESC`
      )
      .all(viewer.id);
    const header = ['"quando"', '"acao"', '"ip"', '"user_agent"', '"detalhes"'];
    const csvLines = rows.map(row => {
      const meta = parseJson(row.metadata_json);
      const metaStr = meta ? JSON.stringify(meta) : '';
      return [row.created_at, row.action, row.ip || '', row.user_agent || '', metaStr]
        .map(value => '"' + String(value || '').replace(/"/g, '""') + '"')
        .join(',');
    });
    res.type('text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="logs_acesso.csv"');
    res.send([header.join(','), ...csvLines].join('\n'));
  });
};
