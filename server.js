const express = require('express');
const cookieParser = require('cookie-parser');
const https = require('https');
const fs = require('fs');

const { createContext } = require('./src/context');
const registerFrontoffice = require('./src/frontoffice');
const registerBackoffice = require('./src/backoffice');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});

const context = createContext();
app.use('/uploads', express.static(context.paths.UPLOAD_ROOT, { fallthrough: false }));

registerFrontoffice(app, context);
registerBackoffice(app, context);

// ===================== Debug Rotas + 404 =====================
app.get('/_routes', (req, res) => {
  const router = app._router;
  if (!router || !router.stack) return res.type('text/plain').send('(router não inicializado)');
  const lines = [];
  router.stack.forEach(mw => {
    if (mw.route && mw.route.path) {
      const methods = Object.keys(mw.route.methods).map(m => m.toUpperCase()).join(',');
      lines.push(`${methods} ${mw.route.path}`);
    } else if (mw.name === 'router' && mw.handle && mw.handle.stack) {
      mw.handle.stack.forEach(r => {
        const rt = r.route;
        if (rt && rt.path) {
          const methods = Object.keys(rt.methods).map(m => m.toUpperCase()).join(',');
          lines.push(`${methods} ${rt.path}`);
        }
      });
    }
  });
  res.type('text/plain').send(lines.sort().join('\n') || '(sem rotas)');
});

app.use((req, res) => {
  res.status(404).send(context.layout({ body: '<h1 class="text-xl font-semibold">404</h1><p>Página não encontrada.</p>' }));
});

// ===================== START SERVER =====================
if (!global.__SERVER_STARTED__) {
  const PORT = process.env.PORT || 3000;
  const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
  const SSL_CERT_PATH = process.env.SSL_CERT_PATH;

  if (SSL_KEY_PATH && SSL_CERT_PATH && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
    const options = { key: fs.readFileSync(SSL_KEY_PATH), cert: fs.readFileSync(SSL_CERT_PATH) };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`Booking Engine (HTTPS) https://localhost:${PORT}`);
    });
  } else {
    app.listen(PORT, () => console.log(`Booking Engine (HTTP) http://localhost:${PORT}`));
  }
  global.__SERVER_STARTED__ = true;
}

module.exports = app;
