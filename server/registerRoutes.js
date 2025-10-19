function registerRoutes({
  app,
  context,
  routes
}) {
  if (!app) throw new Error('registerRoutes: app é obrigatório');
  if (!context) throw new Error('registerRoutes: context é obrigatório');
  if (!routes) throw new Error('registerRoutes: routes é obrigatório');

  const {
    registerAuthRoutes,
    registerAccountModule,
    registerFrontoffice,
    registerPaymentsModule,
    registerOwnersPortal,
    registerInternalTelemetry,
    registerBackoffice,
    registerTenantAdminModule
  } = routes;

  registerAuthRoutes(app, context);
  registerAccountModule(app, context);
  registerFrontoffice(app, context);
  registerPaymentsModule(app, context);
  registerOwnersPortal(app, context);
  registerInternalTelemetry(app, context);
  registerBackoffice(app, context);
  registerTenantAdminModule(app, context);

  if (process.env.NODE_ENV !== 'production') {
    const { requireAdmin } = context;
    app.get('/_routes', requireAdmin, (req, res) => {
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
  }

  app.use((req, res) => {
    res
      .status(404)
      .send(
        context.layout({
          body: '<h1 class="text-xl font-semibold">404</h1><p>Página não encontrada.</p>'
        })
      );
  });
}

module.exports = { registerRoutes };
