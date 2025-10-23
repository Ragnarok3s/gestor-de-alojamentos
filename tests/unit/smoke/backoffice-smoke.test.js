const crypto = require('node:crypto');

const TEST_USER_AGENT = 'smoke-test-agent';

function bootstrapServer() {
  process.env.NODE_ENV = 'test';
  process.env.SKIP_SERVER_START = '1';
  process.env.DATABASE_PATH = ':memory:';
  const serverPath = require.resolve('../../../server');
  delete require.cache[serverPath];
  delete require.cache[require.resolve('../../../config/featureFlags.js')];
  return require(serverPath);
}

function createAuthenticatedSession(app, role = 'direcao') {
  const username = `user_${Math.random().toString(16).slice(2)}`;
  const insertUser = app.db.prepare('INSERT INTO users(username, email, password_hash, role) VALUES (?,?,?,?)');
  const userId = insertUser.run(username, `${username}@example.com`, 'hash', role).lastInsertRowid;
  const token = crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  app.db
    .prepare(
      "INSERT INTO sessions(token, token_hash, user_id, expires_at, ip, user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?, ?,datetime('now'),datetime('now'))"
    )
    .run(tokenHash, tokenHash, userId, expiresAt, '::ffff:127.0.0.1', TEST_USER_AGENT);
  return `adm=${token}`;
}

async function performRequest(app, path, { cookie, followRedirect = true } = {}) {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: {
      Cookie: cookie,
      'User-Agent': TEST_USER_AGENT
    },
    redirect: followRedirect ? 'follow' : 'manual'
  });
  let text = '';
  if (response.headers.get('content-type')?.includes('text/html')) {
    text = await response.text();
  }
  server.close();
  return { response, text };
}

describe('Backoffice smoke tests', () => {
  let app;

  beforeEach(() => {
    app = bootstrapServer();
  });

  afterEach(() => {
    if (app && app.db) {
      app.db.close();
    }
    app = null;
    delete process.env.SKIP_SERVER_START;
    delete process.env.DATABASE_PATH;
  });

  it('renders the dashboard page without crashing', async () => {
    const cookie = createAuthenticatedSession(app);
    const { response, text } = await performRequest(app, '/admin/dashboard', { cookie });
    expect(response.status).toBe(200);
    expect(text).toContain('page-dashboard');
    expect(text.includes('Dashboard')).toBe(true);
    expect(text).toContain('href="/admin/bookings"');
  });

  it('renders the bookings list with an authenticated session', async () => {
    const cookie = createAuthenticatedSession(app);
    const { response, text } = await performRequest(app, '/admin/bookings', { cookie });
    expect(response.status).toBe(200);
    expect(text).toContain('page-bookings');
    expect(text.includes('Reservas')).toBe(true);
    expect(text).toContain('href="/calendar"');
  });

  it('redirects /admin to the dashboard entry point', async () => {
    const cookie = createAuthenticatedSession(app);
    const { response } = await performRequest(app, '/admin', { cookie, followRedirect: false });
    expect(response.status >= 300).toBe(true);
    expect(response.status < 400).toBe(true);
    expect(response.headers.get('location')).toBe('/admin/dashboard');
  });

  it('permite navegar do dashboard para o calendário através das reservas', async () => {
    const cookie = createAuthenticatedSession(app);

    const dashboard = await performRequest(app, '/admin/dashboard', { cookie });
    expect(dashboard.response.status).toBe(200);
    expect(dashboard.text).toContain('href="/admin/bookings"');

    const bookings = await performRequest(app, '/admin/bookings', { cookie });
    expect(bookings.response.status).toBe(200);
    expect(bookings.text).toContain('href="/calendar"');

    const calendar = await performRequest(app, '/calendar', { cookie });
    expect(calendar.response.status).toBe(200);
    expect(calendar.text).toContain('bo-calendar');
  });
});
