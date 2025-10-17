const express = require('express');

module.exports = function registerTenantAdminModule(app, context) {
  const { tenantService, requireDev } = context || {};
  if (!app || !tenantService) {
    return;
  }

  const router = express.Router();
  router.use(requireDev || ((req, res, next) => next()));

  function safeJsonParse(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  router.get('/', (req, res) => {
    const tenants = tenantService.listTenants();
    res.json({ tenants });
  });

  router.post('/', (req, res) => {
    try {
      const { name, domain, branding } = req.body || {};
      const tenant = tenantService.createTenant({
        name,
        domain,
        branding: safeJsonParse(branding) ?? branding,
      });
      res.status(201).json({ tenant });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Não foi possível criar tenant' });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
        payload.name = req.body.name;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'domain')) {
        payload.domain = req.body.domain;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'branding')) {
        payload.branding = safeJsonParse(req.body.branding) ?? req.body.branding;
      }
      const tenant = tenantService.updateTenant(id, payload);
      res.json({ tenant });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Não foi possível atualizar tenant' });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      tenantService.deleteTenant(req.params.id);
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: err.message || 'Não foi possível remover tenant' });
    }
  });

  router.get('/:id', (req, res) => {
    const tenant = tenantService.getTenantById(Number(req.params.id));
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    res.json({ tenant });
  });

  app.use('/admin/tenants', router);
};
