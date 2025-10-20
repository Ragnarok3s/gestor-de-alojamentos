function createTenantResolver({ tenantService }) {
  if (!tenantService || typeof tenantService.resolveTenant !== 'function') {
    throw new Error('createTenantResolver: tenantService inválido');
  }

  function resolveTenantDomain(req) {
    if (!req || !req.headers) return null;
    const headerOverride =
      req.headers['x-tenant-domain'] || req.headers['x-tenant'] || req.headers['x-tenant-host'];
    if (headerOverride) {
      return String(headerOverride).trim().toLowerCase();
    }
    const hostHeader = req.headers.host || '';
    if (hostHeader) {
      return String(hostHeader).split(':')[0].trim().toLowerCase();
    }
    if (typeof req.hostname === 'string' && req.hostname) {
      return req.hostname.trim().toLowerCase();
    }
    return null;
  }

  function resolveTenantForRequest(req) {
    const domain = resolveTenantDomain(req);
    const tenant = tenantService.resolveTenant(domain);
    return tenant || tenantService.getDefaultTenant();
  }

  function tenantMiddleware(req, res, next) {
    const tenant = resolveTenantForRequest(req);
    req.tenant = tenant;
    if (res && res.locals) {
      res.locals.tenant = tenant;
    }
    next();
  }

  return { resolveTenantDomain, resolveTenantForRequest, tenantMiddleware };
}

module.exports = { createTenantResolver };
