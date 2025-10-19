function startServer({ app, fs, https }) {
  if (global.__SERVER_STARTED__ || process.env.SKIP_SERVER_START === '1') {
    return;
  }

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

module.exports = { startServer };
