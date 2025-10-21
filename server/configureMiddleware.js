const path = require('path');

function configureMiddleware({ app, express, cookieParser, csrfProtection, publicDir, fs }) {
  if (!app) {
    throw new Error('configureMiddleware: app é obrigatório');
  }
  if (!express) {
    throw new Error('configureMiddleware: express é obrigatório');
  }
  if (!cookieParser) {
    throw new Error('configureMiddleware: cookieParser é obrigatório');
  }

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  if (publicDir && fs && typeof fs.existsSync === 'function' && fs.existsSync(publicDir)) {
    app.use('/public', express.static(publicDir, { fallthrough: false }));

    const cssDir = path.join(publicDir, 'css');
    if (fs.existsSync(cssDir)) {
      app.use('/css', express.static(cssDir, { fallthrough: false }));
    }
  }

  const chartJsDir = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist');
  if (fs && typeof fs.existsSync === 'function' && fs.existsSync(chartJsDir)) {
    app.use('/vendor/chartjs', express.static(chartJsDir, { fallthrough: false }));
  }

  if (csrfProtection && typeof csrfProtection.middleware === 'function') {
    app.use(csrfProtection.middleware);
  }
}

module.exports = { configureMiddleware };
