const request = require('supertest');
const path = require('path');

const { createApp } = require('../src/app/createApp');
const { loadConfig } = require('../src/config');

describe('createApp factory', () => {
  test('supports injecting custom services and routes', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SKIP_SERVER_START: '1',
      DATABASE_PATH: path.join(__dirname, '..', 'reports', 'test-app.db')
    });

    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const mockServices = {
      context: {
        layout: ({ body }) => `<!doctype html><body>${body}</body>`,
        logger: mockLogger,
        requireAdmin: (req, res, next) => next()
      },
      tenantService: {
        resolveTenant: () => ({ id: 1, name: 'Mock Tenant' }),
        getDefaultTenant: () => ({ id: 1, name: 'Mock Tenant' })
      },
      requireScope: () => (req, res, next) => next(),
      buildUserContext: () => ({}),
      guestPortalService: {},
      db: { close: () => {} },
      appMiddleware: [],
      appRoutes: [
        {
          method: 'get',
          path: '/healthz',
          handler: (req, res) => res.json({ ok: true })
        }
      ],
      shutdown: jest.fn()
    };

    const routes = {
      registerAuthRoutes: app => {
        app.get('/custom', (req, res) => res.send('custom-route'));
      },
      registerAccountModule: () => {},
      registerFrontoffice: () => {},
      registerPaymentsModule: () => {},
      registerOwnersPortal: () => {},
      registerInternalTelemetry: () => {},
      registerBackoffice: () => {},
      registerTenantAdminModule: () => {}
    };

    const app = createApp({ config, logger: mockLogger, services: mockServices, routes });

    const healthResponse = await request(app).get('/healthz');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toEqual({ ok: true });

    const customResponse = await request(app).get('/custom');
    expect(customResponse.status).toBe(200);
    expect(customResponse.text).toContain('custom-route');

    const notFound = await request(app).get('/missing');
    expect(notFound.status).toBe(404);
    expect(notFound.text).toContain('404');
  });
});
