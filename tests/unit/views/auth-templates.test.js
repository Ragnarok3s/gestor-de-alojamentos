const fs = require('fs');
const path = require('path');
const { renderView, clearRendererCache } = require('../../../src/lib/viewRenderer');

const esc = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const branding = {
  brandName: 'Gestor de Alojamentos',
  logoAlt: 'Gestor de Alojamentos · logótipo',
  brandInitials: 'GA'
};

const translator = (key) => key;

function expectMatchesSnapshot(name, actual) {
  const snapshotsDir = path.join(__dirname, '__snapshots__');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
  const snapshotPath = path.join(snapshotsDir, `${name}.html`);
  if (!fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, actual, 'utf8');
    throw new Error(`Snapshot criado para ${name}. Volte a executar os testes.`);
  }
  const expected = fs.readFileSync(snapshotPath, 'utf8');
  expect(actual).toBe(expected);
}

describe('Auth EJS templates', () => {
  afterEach(() => {
    clearRendererCache();
  });

  it('renders login page with defaults', async () => {
    const html = await renderView('auth/login.ejs', {
      branding,
      esc,
      t: translator,
      csrfToken: 'token-123'
    });
    expectMatchesSnapshot('login-default', html);
  });

  it('renders two factor page with messages', async () => {
    const html = await renderView('auth/twofactor.ejs', {
      branding,
      esc,
      t: translator,
      csrfToken: 'token-456',
      noticeMessage: 'Tudo certo',
      errorMessage: 'Código inválido',
      description: 'Envio para <strong>masked@example.com</strong>'
    });
    expectMatchesSnapshot('twofactor-with-messages', html);
  });

  it('renders reset page request step', async () => {
    const html = await renderView('auth/reset.ejs', {
      branding,
      esc,
      t: translator,
      csrfToken: 'token-req',
      noticeMessage: 'Verifique o seu email',
      errorMessage: '',
      step: 'request'
    });
    expectMatchesSnapshot('reset-request-step', html);
  });

  it('renders reset page confirm step', async () => {
    const html = await renderView('auth/reset.ejs', {
      branding,
      esc,
      t: translator,
      csrfToken: 'token-conf',
      noticeMessage: '',
      errorMessage: 'Password inválida',
      step: 'confirm',
      token: 'abc123'
    });
    expectMatchesSnapshot('reset-confirm-step', html);
  });
});
