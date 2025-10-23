const { createTheme: createColorTheme, defaultTheme: defaultColorTheme } = require('../../theme/colors');

module.exports = function registerThemeSettings(app, context) {
  if (!app) throw new Error('registerThemeSettings: app é obrigatório');
  if (!context) throw new Error('registerThemeSettings: context é obrigatório');

  const {
    layout,
    html,
    esc,
    requireAdmin,
    resolveBrandingForRequest
  } = context;

  if (typeof layout !== 'function') {
    throw new Error('registerThemeSettings: layout inválido');
  }

  app.get('/admin/settings/theme', requireAdmin, (req, res) => {
    const branding = resolveBrandingForRequest ? resolveBrandingForRequest(req) : null;
    const paletteOverrides = branding && branding.palette ? branding.palette : {};
    const activeTheme = createColorTheme(paletteOverrides);
    const previewStyle = [
      `--preview-primary:${activeTheme.primary}`,
      `--preview-primary-contrast:${activeTheme.textOnPrimary || '#ffffff'}`,
      `--preview-surface:${activeTheme.surface || defaultColorTheme.surface}`,
      `--preview-surface-border:${branding && branding.surfaceBorder ? branding.surfaceBorder : '#e2e8f0'}`,
      `--preview-text:${activeTheme.textPrimary || '#2B2B2B'}`
    ].join(';');

    const body = html`
      <div class="bo-page bo-page--wide" data-theme-settings>
        <header class="bo-header">
          <h1>Personalização de tema</h1>
          <p>Actualize a paleta de cores base da aplicação e veja o resultado em tempo real.</p>
        </header>
        <section class="card theme-settings" data-theme-settings-panel>
          <div class="theme-settings__preview" style="${esc(previewStyle)}" data-theme-preview>
            <div class="theme-settings__brand">Gestor de Alojamentos</div>
            <div class="theme-settings__primary">Ação principal</div>
            <div class="theme-settings__surface">Blocos e cartões utilizam esta cor de superfície.</div>
          </div>
          <form class="theme-settings__form" data-theme-settings-form>
            <fieldset>
              <legend>Paleta principal</legend>
              <label>
                <span>Cor primária</span>
                <input type="color" name="primary" value="${esc(activeTheme.primary)}" data-theme-input="primary" />
                <small>Botões e elementos de destaque.</small>
              </label>
              <label>
                <span>Cor primária (hover)</span>
                <input type="color" name="primaryDark" value="${esc(activeTheme.primaryDark || defaultColorTheme.primaryDark)}" data-theme-input="primaryDark" />
                <small>Estados activos e interacções.</small>
              </label>
              <label>
                <span>Cor de acento</span>
                <input type="color" name="accent" value="${esc(activeTheme.accent || defaultColorTheme.accent)}" data-theme-input="accent" />
                <small>Alertas e indicadores secundários.</small>
              </label>
              <label>
                <span>Cor de acento escura</span>
                <input type="color" name="accentDark" value="${esc(activeTheme.accentDark || defaultColorTheme.accentDark)}" data-theme-input="accentDark" />
                <small>Sombreamento, gráficos e estados de aviso.</small>
              </label>
            </fieldset>
            <fieldset>
              <legend>Fundos e texto</legend>
              <label>
                <span>Cor de fundo</span>
                <input type="color" name="background" value="${esc(activeTheme.background || defaultColorTheme.background)}" data-theme-input="background" />
              </label>
              <label>
                <span>Cor de superfície</span>
                <input type="color" name="surface" value="${esc(activeTheme.surface || defaultColorTheme.surface)}" data-theme-input="surface" />
              </label>
              <label>
                <span>Texto principal</span>
                <input type="color" name="textPrimary" value="${esc(activeTheme.textPrimary || defaultColorTheme.textPrimary)}" data-theme-input="textPrimary" />
              </label>
              <label>
                <span>Texto sobre elementos destacados</span>
                <input type="color" name="textOnPrimary" value="${esc(activeTheme.textOnPrimary || '#ffffff')}" data-theme-input="textOnPrimary" />
              </label>
              <label>
                <span>Texto sobre fundos</span>
                <input type="color" name="textOnBackground" value="${esc(activeTheme.textOnBackground || defaultColorTheme.textOnBackground)}" data-theme-input="textOnBackground" />
              </label>
            </fieldset>
            <div class="theme-settings__actions">
              <button type="button" class="bo-button bo-button--secondary" data-theme-reset>Repor padrão</button>
              <button type="button" class="bo-button bo-button--primary" data-theme-apply>Aplicar tema</button>
            </div>
          </form>
        </section>
      </div>
    `;

    res.send(
      layout({
        title: 'Tema personalizado',
        user: req.user,
        activeNav: '/admin/settings/theme',
        branding,
        pageClass: 'page-backoffice page-theme-settings',
        body
      })
    );
  });
};
