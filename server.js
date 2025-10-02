const fs = require('fs');
const https = require('https');
const express = require('express');
const cookieParser = require('cookie-parser');

const { initializeDatabase } = require('./src/db');
const applySecurity = require('./src/middleware/security');
const { createUploadMiddleware } = require('./src/uploads');
const setupRoutes = require('./src/routes');

const app = express();

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});

const db = initializeDatabase();
const { loginLimiter } = applySecurity(app);
const upload = createUploadMiddleware();

setupRoutes(app, { db, upload, loginLimiter });

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
