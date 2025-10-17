function parseBranding(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

function normalizeDomain(domain) {
  if (typeof domain !== 'string') return null;
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

function mapTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    branding: parseBranding(row.branding_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createTenantService({ db }) {
  if (!db) {
    throw new Error('Tenant service requires a database instance');
  }

  const listStmt = db.prepare(
    'SELECT id, name, domain, branding_json, created_at, updated_at FROM tenants ORDER BY id'
  );
  const selectByIdStmt = db.prepare(
    'SELECT id, name, domain, branding_json, created_at, updated_at FROM tenants WHERE id = ?'
  );
  const selectByDomainStmt = db.prepare(
    'SELECT id, name, domain, branding_json, created_at, updated_at FROM tenants WHERE domain = ? COLLATE NOCASE'
  );
  const selectDefaultStmt = db.prepare(
    'SELECT id, name, domain, branding_json, created_at, updated_at FROM tenants ORDER BY id ASC LIMIT 1'
  );
  const insertStmt = db.prepare(
    "INSERT INTO tenants(name, domain, branding_json) VALUES (?, ?, ?)"
  );
  const updateStmtBase = 'UPDATE tenants SET ';
  const deleteStmt = db.prepare('DELETE FROM tenants WHERE id = ?');

  function assertDomainAvailable(domain, excludeId = null) {
    const existing = selectByDomainStmt.get(domain);
    if (!existing) return;
    if (excludeId && existing.id === excludeId) return;
    throw new Error('Domínio já atribuído a outro tenant');
  }

  function listTenants() {
    return listStmt.all().map(mapTenant);
  }

  function getTenantById(id) {
    if (!id) return null;
    return mapTenant(selectByIdStmt.get(id));
  }

  function getDefaultTenant() {
    return mapTenant(selectDefaultStmt.get());
  }

  function resolveTenant(domain) {
    const normalized = normalizeDomain(domain);
    if (normalized) {
      const row = selectByDomainStmt.get(normalized);
      if (row) return mapTenant(row);
    }
    return getDefaultTenant();
  }

  function createTenant({ name, domain, branding = null } = {}) {
    const normalizedName = normalizeName(name);
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedName) {
      throw new Error('Nome do tenant é obrigatório');
    }
    if (!normalizedDomain) {
      throw new Error('Domínio do tenant é obrigatório');
    }
    assertDomainAvailable(normalizedDomain);
    const brandingJson = branding ? JSON.stringify(branding) : null;
    const result = insertStmt.run(normalizedName, normalizedDomain, brandingJson);
    return getTenantById(result.lastInsertRowid);
  }

  function updateTenant(id, updates = {}) {
    const tenantId = Number(id);
    if (!tenantId) {
      throw new Error('Tenant inválido');
    }
    const assignments = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const normalizedName = normalizeName(updates.name);
      if (!normalizedName) {
        throw new Error('Nome do tenant é obrigatório');
      }
      assignments.push('name = ?');
      params.push(normalizedName);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'domain')) {
      const normalizedDomain = normalizeDomain(updates.domain);
      if (!normalizedDomain) {
        throw new Error('Domínio do tenant é obrigatório');
      }
      assertDomainAvailable(normalizedDomain, tenantId);
      assignments.push('domain = ?');
      params.push(normalizedDomain);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'branding')) {
      const brandingJson = updates.branding ? JSON.stringify(updates.branding) : null;
      assignments.push('branding_json = ?');
      params.push(brandingJson);
    }

    if (!assignments.length) {
      return getTenantById(tenantId);
    }

    assignments.push("updated_at = datetime('now')");
    const stmt = db.prepare(`${updateStmtBase}${assignments.join(', ')} WHERE id = ?`);
    params.push(tenantId);
    const result = stmt.run(...params);
    if (!result.changes) {
      throw new Error('Tenant não encontrado');
    }
    return getTenantById(tenantId);
  }

  function deleteTenant(id) {
    const tenantId = Number(id);
    if (!tenantId) {
      throw new Error('Tenant inválido');
    }
    const defaultTenant = getDefaultTenant();
    if (defaultTenant && defaultTenant.id === tenantId) {
      throw new Error('Não é possível remover o tenant padrão');
    }
    const result = deleteStmt.run(tenantId);
    if (!result.changes) {
      throw new Error('Tenant não encontrado');
    }
    return true;
  }

  return {
    listTenants,
    getTenantById,
    getDefaultTenant,
    resolveTenant,
    createTenant,
    updateTenant,
    deleteTenant,
  };
}

module.exports = {
  createTenantService,
};
