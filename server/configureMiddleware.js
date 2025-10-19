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
  }

  if (csrfProtection && typeof csrfProtection.middleware === 'function') {
    app.use(csrfProtection.middleware);
  }
}

module.exports = { configureMiddleware };
