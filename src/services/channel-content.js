const { ValidationError } = require('./errors');

const DEFAULT_CONTENT = {
  title: '',
  subtitle: '',
  description: '',
  highlights: [],
  amenities: [],
  photos: [],
  policies: []
};

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function safeJsonParse(payload, fallback) {
  if (!payload) return fallback;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => normalizeString(item))
    .filter(Boolean);
}

function normalizePhotos(rawPhotos) {
  if (!Array.isArray(rawPhotos)) return [];
  const photos = [];
  rawPhotos.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const url = normalizeString(item.url || item.href || item.src);
    if (!url) return;
    photos.push({
      url,
      caption: normalizeString(item.caption || item.title),
      isPrimary: item.isPrimary ? 1 : 0,
      sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index
    });
  });
  if (!photos.length) return [];
  photos.sort((a, b) => a.sortOrder - b.sortOrder);
  let primaryMarked = photos.some(p => p.isPrimary);
  return photos.map((photo, index) => ({
    url: photo.url,
    caption: photo.caption,
    isPrimary: photo.isPrimary && primaryMarked ? 1 : 0,
    sortOrder: index
  })).map((photo, index) => {
    if (!primaryMarked && index === 0) {
      return { ...photo, isPrimary: 1, sortOrder: index };
    }
    return { ...photo, sortOrder: index };
  });
}

function normalizePolicies(rawPolicies) {
  if (!Array.isArray(rawPolicies)) return [];
  const policies = [];
  rawPolicies.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const title = normalizeString(item.title || item.name);
    const description = normalizeString(item.description || item.body || item.text);
    const key = normalizeString(item.key || item.slug || `policy_${index + 1}`);
    if (!title && !description) return;
    policies.push({
      key: key || `policy_${index + 1}`,
      title: title || `Política ${index + 1}`,
      description,
      sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index
    });
  });
  policies.sort((a, b) => a.sortOrder - b.sortOrder);
  return policies.map((policy, index) => ({
    key: policy.key || `policy_${index + 1}`,
    title: policy.title,
    description: policy.description,
    sortOrder: index
  }));
}

function normalizeContent(payload = {}) {
  const source = typeof payload === 'object' && payload !== null && payload.content
    ? payload.content
    : payload;
  const title = normalizeString(source.title);
  const subtitle = normalizeString(source.subtitle);
  const description = normalizeString(source.description);
  const highlights = normalizeList(source.highlights || source.highlight_list);
  const amenities = normalizeList(source.amenities || source.amenities_list);
  const photos = normalizePhotos(source.photos || source.images);
  const policies = normalizePolicies(source.policies);

  return {
    title,
    subtitle,
    description,
    highlights,
    amenities,
    photos,
    policies
  };
}

function mapContentForChannel(channelKey, content) {
  const normalized = normalizeContent(content);
  const photos = normalized.photos.map((photo, index) => ({
    url: photo.url,
    caption: photo.caption || normalized.title,
    primary: photo.isPrimary ? true : index === 0,
    order: index + 1
  }));
  const policies = normalized.policies.map(policy => ({
    title: policy.title,
    description: policy.description
  }));
  const common = {
    title: normalized.title,
    subtitle: normalized.subtitle,
    description: normalized.description,
    highlights: normalized.highlights,
    amenities: normalized.amenities,
    photos,
    policies
  };

  switch (channelKey) {
    case 'airbnb':
      return {
        listingName: normalized.title,
        summary: normalized.subtitle || normalized.description.slice(0, 180),
        description: normalized.description,
        highlights: normalized.highlights,
        amenities: normalized.amenities,
        photos,
        houseRules: policies.map(p => p.description)
      };
    case 'booking':
    case 'booking_com':
      return {
        roomName: normalized.title,
        shortDescription: normalized.subtitle || normalized.description.slice(0, 250),
        longDescription: normalized.description,
        highlights: normalized.highlights,
        amenities: normalized.amenities,
        photos,
        policies
      };
    case 'expedia':
      return {
        headline: normalized.title,
        teaser: normalized.subtitle || normalized.highlights.slice(0, 2).join(', '),
        description: normalized.description,
        amenities: normalized.amenities,
        photos,
        policies
      };
    default:
      return common;
  }
}

function createChannelContentService({ db, dayjs, channelIntegrations = null, otaDispatcher = null } = {}) {
  if (!db) {
    throw new Error('createChannelContentService requer acesso à base de dados.');
  }
  const nowIso = () => (dayjs ? dayjs().toISOString() : new Date().toISOString());

  const selectUnitStmt = db.prepare('SELECT id, property_id, tenant_id FROM units WHERE id = ?');
  const selectContentStmt = db.prepare(
    `SELECT uc.*, u.username AS updated_by_username
       FROM unit_content uc
       LEFT JOIN users u ON u.id = uc.updated_by
      WHERE uc.unit_id = ?
        AND uc.tenant_id = ?
      LIMIT 1`
  );
  const insertContentStmt = db.prepare(
    `INSERT INTO unit_content(
        unit_id,
        tenant_id,
        content_json,
        version,
        status,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))`
  );
  const updateContentStmt = db.prepare(
    `UPDATE unit_content
        SET content_json = ?,
            version = ?,
            status = ?,
            updated_by = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );
  const updatePublishStmt = db.prepare(
    `UPDATE unit_content
        SET status = 'published',
            published_at = datetime('now'),
            published_version = ?,
            last_published_channels = ?,
            updated_by = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );
  const deletePoliciesStmt = db.prepare('DELETE FROM unit_policies WHERE unit_id = ? AND tenant_id = ?');
  const insertPolicyStmt = db.prepare(
    `INSERT INTO unit_policies(
        unit_id,
        tenant_id,
        policy_key,
        title,
        description,
        sort_order,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  );
  const insertVersionStmt = db.prepare(
    `INSERT OR IGNORE INTO unit_content_versions(
        unit_content_id,
        version,
        content_json,
        created_at,
        created_by,
        restored_from_version
      )
      VALUES (?, ?, ?, datetime('now'), ?, ?)`
  );
  const selectVersionStmt = db.prepare(
    `SELECT v.*, u.username
       FROM unit_content_versions v
       LEFT JOIN unit_content uc ON uc.id = v.unit_content_id
       LEFT JOIN users u ON u.id = v.created_by
      WHERE uc.unit_id = ?
        AND uc.tenant_id = ?
        AND v.version = ?
      LIMIT 1`
  );
  const listVersionsStmt = db.prepare(
    `SELECT v.version, v.created_at, v.created_by, u.username
       FROM unit_content_versions v
       JOIN unit_content uc ON uc.id = v.unit_content_id
       LEFT JOIN users u ON u.id = v.created_by
      WHERE uc.unit_id = ?
        AND uc.tenant_id = ?
      ORDER BY v.version DESC
      LIMIT ?`
  );
  const insertQueueStmt = db.prepare(
    `INSERT INTO channel_sync_queue(
        unit_id,
        type,
        payload,
        status,
        created_at,
        updated_at
      )
      VALUES (?, 'CONTENT_UPDATE', ?, 'pending', datetime('now'), datetime('now'))`
  );

  function ensureUnit(unitId, tenantId) {
    const unit = selectUnitStmt.get(unitId);
    if (!unit) {
      throw new ValidationError('A unidade selecionada não existe.');
    }
    const unitTenantId = Number(unit.tenant_id || 0) || 1;
    if (tenantId && Number(tenantId) !== Number(unitTenantId)) {
      throw new ValidationError('Não tem acesso a esta unidade.');
    }
    return unit;
  }

  function loadContent(unitId, tenantId) {
    const row = selectContentStmt.get(unitId, tenantId);
    if (!row) {
      return null;
    }
    const parsed = safeJsonParse(row.content_json, DEFAULT_CONTENT);
    return {
      id: row.id,
      unitId,
      tenantId,
      content: normalizeContent(parsed),
      rawContent: parsed,
      version: Number(row.version) || 1,
      status: row.status || 'draft',
      updatedAt: row.updated_at || null,
      updatedBy: row.updated_by || null,
      updatedByName: row.updated_by_username || null,
      publishedAt: row.published_at || null,
      publishedVersion: row.published_version || null,
      lastPublishedChannels: safeJsonParse(row.last_published_channels, [])
    };
  }

  function replacePolicies(unitId, tenantId, policies, userId) {
    deletePoliciesStmt.run(unitId, tenantId);
    policies.forEach(policy => {
      insertPolicyStmt.run(
        unitId,
        tenantId,
        policy.key,
        policy.title,
        policy.description,
        policy.sortOrder || 0,
        userId || null
      );
    });
  }

  function enqueueUpdate(unitId, payload) {
    const updateEntry = {
      unitId,
      type: 'CONTENT_UPDATE',
      payload
    };
    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate(updateEntry);
      return;
    }
    const now = nowIso();
    const serialized = {
      unitId,
      updates: [
        {
          type: 'CONTENT_UPDATE',
          payload,
          receivedAt: now
        }
      ],
      enqueuedAt: now
    };
    insertQueueStmt.run(unitId, JSON.stringify(serialized));
  }

  function saveDraft(unitId, payload, { tenantId = null, userId = null } = {}) {
    const unit = ensureUnit(unitId, tenantId);
    const content = normalizeContent(payload);
    const now = nowIso();

    const result = db.transaction(() => {
      const current = loadContent(unit.id, tenantId || unit.tenant_id || 1);
      let nextVersion = 1;
      let contentId = null;
      let previousContent = null;
      if (current && current.id) {
        previousContent = current.content;
        insertVersionStmt.run(
          current.id,
          current.version,
          JSON.stringify(current.rawContent || current.content),
          current.updatedBy || null,
          null
        );
        nextVersion = current.version + 1;
        updateContentStmt.run(
          JSON.stringify(content),
          nextVersion,
          'draft',
          userId || null,
          current.id
        );
        contentId = current.id;
      } else {
        const insert = insertContentStmt.run(
          unit.id,
          tenantId || unit.tenant_id || 1,
          JSON.stringify(content),
          1,
          userId || null
        );
        nextVersion = 1;
        contentId = insert.lastInsertRowid;
      }
      replacePolicies(unit.id, tenantId || unit.tenant_id || 1, content.policies, userId);
      return { contentId, nextVersion, previousContent };
    })();

    return {
      unitId: unit.id,
      tenantId: tenantId || unit.tenant_id || 1,
      version: result.nextVersion,
      status: 'draft',
      savedAt: now,
      content,
      previousContent: result.previousContent
    };
  }

  function publishUnitContent(unitId, { tenantId = null, userId = null, channels = [] } = {}) {
    const unit = ensureUnit(unitId, tenantId);
    const record = loadContent(unit.id, tenantId || unit.tenant_id || 1);
    if (!record) {
      throw new ValidationError('Ainda não existe conteúdo para esta unidade.');
    }
    const normalizedChannels = Array.isArray(channels)
      ? Array.from(new Set(channels.map(ch => normalizeString(ch).toLowerCase()).filter(Boolean)))
      : [];
    let targetChannels = normalizedChannels;
    if (!targetChannels.length && channelIntegrations && typeof channelIntegrations.listIntegrations === 'function') {
      targetChannels = channelIntegrations.listIntegrations().map(item => item.key);
    }
    if (!targetChannels.length) {
      throw new ValidationError('Selecione pelo menos um canal para publicar.');
    }

    const channelPayloads = {};
    targetChannels.forEach(channelKey => {
      channelPayloads[channelKey] = mapContentForChannel(channelKey, record.content);
    });

    const publishPayload = {
      channels: targetChannels,
      version: record.version,
      content: record.content,
      channelPayloads,
      publishedAt: nowIso()
    };

    enqueueUpdate(unit.id, publishPayload);

    updatePublishStmt.run(
      record.version,
      JSON.stringify(targetChannels),
      userId || null,
      record.id
    );

    return {
      unitId: unit.id,
      tenantId: tenantId || unit.tenant_id || 1,
      version: record.version,
      status: 'published',
      channels: targetChannels,
      content: record.content,
      publishedAt: publishPayload.publishedAt
    };
  }

  function rollbackUnitContent(unitId, targetVersion, { tenantId = null, userId = null } = {}) {
    const unit = ensureUnit(unitId, tenantId);
    const versionNumber = Number(targetVersion);
    if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
      throw new ValidationError('Versão inválida para rollback.');
    }
    const current = loadContent(unit.id, tenantId || unit.tenant_id || 1);
    if (!current) {
      throw new ValidationError('Ainda não existe conteúdo para esta unidade.');
    }
    if (versionNumber === current.version) {
      return {
        unitId: unit.id,
        version: current.version,
        status: current.status,
        restoredFrom: versionNumber,
        content: current.content
      };
    }

    const target = selectVersionStmt.get(unit.id, tenantId || unit.tenant_id || 1, versionNumber);
    if (!target || !target.content_json) {
      throw new ValidationError('Versão solicitada não encontrada.');
    }
    const restoredContent = normalizeContent(safeJsonParse(target.content_json, DEFAULT_CONTENT));

    const result = db.transaction(() => {
      const latest = loadContent(unit.id, tenantId || unit.tenant_id || 1);
      if (!latest) {
        throw new ValidationError('Conteúdo não encontrado.');
      }
      insertVersionStmt.run(
        latest.id,
        latest.version,
        JSON.stringify(latest.rawContent || latest.content),
        latest.updatedBy || null,
        null
      );
      const nextVersion = latest.version + 1;
      updateContentStmt.run(
        JSON.stringify(restoredContent),
        nextVersion,
        'draft',
        userId || null,
        latest.id
      );
      replacePolicies(unit.id, tenantId || unit.tenant_id || 1, restoredContent.policies, userId);
      return nextVersion;
    })();

    return {
      unitId: unit.id,
      version: result,
      status: 'draft',
      restoredFrom: versionNumber,
      content: restoredContent
    };
  }

  function listVersions(unitId, { tenantId = null, limit = 10 } = {}) {
    const unit = ensureUnit(unitId, tenantId);
    const current = loadContent(unit.id, tenantId || unit.tenant_id || 1);
    const rows = listVersionsStmt.all(unit.id, tenantId || unit.tenant_id || 1, Math.max(1, limit));
    const versions = [];
    if (current) {
      versions.push({
        version: current.version,
        savedAt: current.updatedAt,
        savedBy: current.updatedByName,
        isCurrent: true
      });
    }
    rows.forEach(row => {
      if (current && row.version === current.version) return;
      versions.push({
        version: row.version,
        savedAt: row.created_at,
        savedBy: row.username || null,
        isCurrent: false
      });
    });
    return versions;
  }

  function getUnitContent(unitId, { tenantId = null } = {}) {
    ensureUnit(unitId, tenantId);
    const record = loadContent(unitId, tenantId);
    if (!record) {
      return {
        unitId,
        tenantId,
        version: 0,
        status: 'draft',
        content: { ...DEFAULT_CONTENT }
      };
    }
    return record;
  }

  return {
    DEFAULT_CONTENT,
    normalizeContent,
    getUnitContent,
    saveDraft,
    publishUnitContent,
    rollbackUnitContent,
    listVersions,
    mapContentForChannel
  };
}

module.exports = {
  DEFAULT_CONTENT,
  normalizeContent,
  mapContentForChannel,
  createChannelContentService
};
