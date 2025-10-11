const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const REQUIRED_ENV = ['SEC_USER_EMAIL', 'SEC_USER_PASS', 'SEC_MANAGER_EMAIL', 'SEC_MANAGER_PASS'];

const baseUrl = (() => {
  const raw = process.env.API_BASE || process.env.SEC_BASE_URL || 'https://staging.minha-app.com';
  try {
    const normalized = new URL(raw);
    normalized.pathname = '/';
    return normalized.toString();
  } catch (err) {
    console.warn(`Base URL inválida "${raw}": ${(err && err.message) || err}`);
    return 'https://staging.minha-app.com/';
  }
})();

const credentialsByRole = {
  user: {
    username: process.env.SEC_USER_EMAIL || '',
    password: process.env.SEC_USER_PASS || ''
  },
  manager: {
    username: process.env.SEC_MANAGER_EMAIL || '',
    password: process.env.SEC_MANAGER_PASS || ''
  }
};

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  updateFrom(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const entries = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of entries) {
      if (!header) continue;
      const [pair] = header.split(';');
      if (!pair) continue;
      const [rawName, ...rest] = pair.split('=');
      if (!rawName) continue;
      const name = rawName.trim();
      const value = rest.join('=').trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  has(name) {
    return this.cookies.has(name);
  }
}

function assertCredentials() {
  const missing = REQUIRED_ENV.filter(key => !process.env[key] || !process.env[key].trim());
  if (missing.length) {
    throw new Error(`Variáveis em falta: ${missing.join(', ')}.`);
  }
}

function request(urlString, options, jar) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const headers = Object.assign({ 'User-Agent': 'security-rbac-check/1.0' }, options.headers || {});
    const cookieHeader = jar.header();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let body = options.body;
    if (body && typeof body !== 'string' && !(body instanceof Buffer)) {
      if (body instanceof URLSearchParams) {
        body = body.toString();
      } else {
        body = JSON.stringify(body);
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }
    }

    if (typeof body === 'string') {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const requestOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      rejectUnauthorized: false
    };

    const req = transport.request(requestOptions, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        jar.updateFrom(res.headers['set-cookie']);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: responseBody
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/i);
  if (!match) {
    throw new Error('Não foi possível localizar o token CSRF na página de login.');
  }
  return match[1];
}

async function login(role) {
  const creds = credentialsByRole[role];
  const jar = new CookieJar();
  const loginUrl = new URL('/login', baseUrl).toString();
  const loginPage = await request(loginUrl, { method: 'GET' }, jar);
  if (loginPage.status >= 400) {
    throw new Error(`Falha ao obter página de login (${loginPage.status}).`);
  }
  const csrfToken = extractCsrfToken(loginPage.body);
  const body = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    _csrf: csrfToken
  });
  const response = await request(
    loginUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml'
      },
      body
    },
    jar
  );

  if (response.status >= 400) {
    throw new Error(`Login falhou para ${role} (${response.status}).`);
  }

  const location = response.headers.location;
  if (location) {
    const followUrl = new URL(location, baseUrl).toString();
    await request(followUrl, { method: 'GET' }, jar);
  }

  if (!jar.has('adm')) {
    throw new Error(`Sessão "${role}" não recebeu cookie de autenticação.`);
  }

  return { role, jar };
}

async function discoverAnyUserId(session) {
  const url = new URL('/admin/utilizadores', baseUrl).toString();
  const response = await request(url, { method: 'GET' }, session.jar);
  if (response.status !== 200) {
    return null;
  }
  const match = response.body.match(/name="user_id"\s+value="(\d+)"/);
  return match ? match[1] : null;
}

async function performCheck(check, session) {
  const url = new URL(check.path, baseUrl).toString();
  const headers = Object.assign({ Accept: 'application/json,text/plain;q=0.9' }, check.headers || {});
  const response = await request(
    url,
    {
      method: check.method,
      headers,
      body: check.body
    },
    session.jar
  );

  let notes;
  if (response.status >= 300 && response.status < 400) {
    notes = `Redirected to ${response.headers.location || 'desconhecido'}`;
  } else if (response.status >= 400) {
    const preview = response.body.replace(/\s+/g, ' ').slice(0, 120).trim();
    if (preview) {
      notes = preview;
    }
  }

  return {
    endpoint: check.path,
    role: session.role,
    expected: check.expectedStatus,
    actual: response.status,
    pass: response.status === check.expectedStatus,
    notes
  };
}

function formatResults(results) {
  const lines = [
    '| Endpoint | Role | Expected | Got | Status |',
    '| --- | --- | ---: | ---: | --- |'
  ];
  for (const result of results) {
    const statusLabel = result.pass ? 'PASS' : 'FAIL';
    const noteSuffix = result.notes ? ` — ${result.notes}` : '';
    lines.push(`| ${result.endpoint} | ${result.role} | ${result.expected} | ${result.actual} | ${statusLabel}${noteSuffix} |`);
  }
  return lines.join('\n');
}

async function main() {
  try {
    assertCredentials();
    const sessions = new Map();
    const managerSession = await login('manager');
    sessions.set('manager', managerSession);
    const targetUserId = await discoverAnyUserId(managerSession);
    const userSession = await login('user');
    sessions.set('user', userSession);

    const checks = [
      {
        method: 'GET',
        path: '/admin/api/reviews',
        role: 'user',
        expectedStatus: 403
      },
      {
        method: 'GET',
        path: '/admin/api/reviews',
        role: 'manager',
        expectedStatus: 200
      }
    ];

    if (targetUserId) {
      checks.push({
        method: 'POST',
        path: '/admin/users/role',
        role: 'user',
        expectedStatus: 403,
        body: new URLSearchParams({ user_id: targetUserId, role: 'gestao' })
      });
    }

    const results = [];
    for (const check of checks) {
      const session = sessions.get(check.role);
      if (!session) {
        results.push({
          endpoint: check.path,
          role: check.role,
          expected: check.expectedStatus,
          actual: 0,
          pass: false,
          notes: 'Sessão não inicializada'
        });
        continue;
      }
      try {
        const result = await performCheck(check, session);
        results.push(result);
      } catch (err) {
        results.push({
          endpoint: check.path,
          role: check.role,
          expected: check.expectedStatus,
          actual: 0,
          pass: false,
          notes: (err && err.message) || String(err)
        });
      }
    }

    console.log(formatResults(results));
    if (!results.every(entry => entry.pass)) {
      process.exit(1);
    }
  } catch (err) {
    console.error((err && err.message) || String(err));
    process.exit(1);
  }
}

main();
