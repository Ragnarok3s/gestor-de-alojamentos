const { ValidationError } = require('../../services/errors');

function normalizeUnitSelection(units, requestedId) {
  if (!Array.isArray(units) || !units.length) return null;
  const numericId = Number(requestedId);
  if (Number.isInteger(numericId)) {
    const found = units.find(item => Number(item.id) === numericId);
    if (found) return found;
  }
  return units[0];
}

function formatUnitLabel(unit) {
  if (!unit) return '';
  const propertyName = unit.propertyName || unit.property_name;
  if (propertyName) {
    return `${propertyName} · ${unit.name}`;
  }
  return unit.name;
}

module.exports = function registerContentCenter(app, context) {
  const {
    db,
    html,
    layout,
    esc,
    channelContentService,
    channelIntegrations,
    rememberActiveBrandingProperty,
    resolveBrandingForRequest,
    requireLogin,
    requireBackofficeAccess,
    logActivity,
    logChange
  } = context;

  if (!channelContentService) {
    return;
  }

  const listUnitsStmt = db.prepare(
    `SELECT u.id,
            u.name,
            u.property_id,
            u.tenant_id,
            p.name AS property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.tenant_id = ?
      ORDER BY p.name, u.name`
  );

  const tenantChannelList = () => {
    if (!channelIntegrations || typeof channelIntegrations.listIntegrations !== 'function') {
      return [];
    }
    return channelIntegrations.listIntegrations().map(item => ({ key: item.key, name: item.name }));
  };

  app.get(
    '/admin/content-center',
    requireLogin,
    requireBackofficeAccess,
    (req, res) => {
      const tenantId = req.tenant && req.tenant.id ? req.tenant.id : 1;
      const units = listUnitsStmt.all(tenantId).map(row => ({
        id: row.id,
        name: row.name,
        propertyId: row.property_id,
        propertyName: row.property_name,
        tenantId: row.tenant_id
      }));

      const activeUnit = normalizeUnitSelection(units, req.query.unit || req.query.unitId || req.query.id);

      if (!activeUnit) {
        const body = html`
          <div class="bo-page">
            <section class="bg-white shadow-sm rounded-2xl p-8">
              <h1 class="text-2xl font-semibold text-slate-900 mb-2">Centro de Conteúdos</h1>
              <p class="text-slate-600">Ainda não existem unidades configuradas para este tenant. Crie uma unidade para começar a gerir conteúdos.</p>
            </section>
          </div>
        `;
        return res.send(
          layout({
            title: 'Centro de Conteúdos',
            user: req.user,
            activeNav: 'backoffice',
            branding: resolveBrandingForRequest(req),
            pageClass: 'page-backoffice page-content-center',
            body
          })
        );
      }

      rememberActiveBrandingProperty(res, activeUnit.propertyId);
      const branding = resolveBrandingForRequest(req, {
        propertyId: activeUnit.propertyId,
        propertyName: activeUnit.propertyName
      });

      const contentRecord = channelContentService.getUnitContent(activeUnit.id, { tenantId });
      const versions = channelContentService.listVersions(activeUnit.id, { tenantId, limit: 12 });
      const channels = tenantChannelList();

      const payload = {
        tenantId,
        unit: activeUnit,
        units,
        content: contentRecord.content,
        version: contentRecord.version,
        status: contentRecord.status,
        lastPublishedChannels: contentRecord.lastPublishedChannels || [],
        publishedAt: contentRecord.publishedAt || null,
        channels,
        versions,
        actor: req.user && req.user.username ? req.user.username : null
      };

      const pageBody = html`
        <div class="bo-page bo-page--wide">
          <div class="space-y-10 py-10">
            <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <h1 class="text-3xl font-semibold text-slate-900">Centro de Conteúdos</h1>
              <p class="text-slate-600 mt-2 max-w-2xl">
                Centralize descrições, destaques, políticas e galerias de cada unidade antes de publicar rapidamente nas OTAs conectadas.
              </p>
            </div>
            <div class="w-full lg:w-80">
              <label class="block text-sm font-medium text-slate-700 mb-1" for="content-center-unit-select">Unidade</label>
              <select id="content-center-unit-select" class="bo-input w-full" data-unit-select>
                ${units
                  .map(unit => {
                    const selected = Number(unit.id) === Number(activeUnit.id) ? 'selected' : '';
                    return `<option value="${esc(unit.id)}" ${selected}>${esc(formatUnitLabel(unit))}</option>`;
                  })
                  .join('')}
              </select>
            </div>
          </div>

            <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
            <form class="bg-white shadow-sm rounded-2xl p-6 space-y-6" data-content-form>
              <div class="grid md:grid-cols-2 gap-5">
                <div>
                  <label class="bo-label" for="content-title">Título</label>
                  <input id="content-title" name="title" class="bo-input w-full" maxlength="120" />
                </div>
                <div>
                  <label class="bo-label" for="content-subtitle">Subtítulo</label>
                  <input id="content-subtitle" name="subtitle" class="bo-input w-full" maxlength="160" />
                </div>
              </div>

              <div>
                <label class="bo-label" for="content-description">Descrição</label>
                <textarea id="content-description" name="description" class="bo-textarea h-40"></textarea>
              </div>

              <div class="grid md:grid-cols-2 gap-5">
                <div>
                  <label class="bo-label" for="content-highlights">Destaques (um por linha)</label>
                  <textarea id="content-highlights" class="bo-textarea h-32" data-array-field="highlights"></textarea>
                </div>
                <div>
                  <label class="bo-label" for="content-amenities">Amenidades (uma por linha)</label>
                  <textarea id="content-amenities" class="bo-textarea h-32" data-array-field="amenities"></textarea>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between gap-4 mb-3">
                  <h2 class="text-lg font-semibold text-slate-900">Galeria de fotos</h2>
                  <button type="button" class="bo-button bo-button--ghost" data-add-photo>Adicionar foto</button>
                </div>
                <div class="space-y-4" data-photos-list></div>
              </div>

              <div>
                <div class="flex items-center justify-between gap-4 mb-3">
                  <h2 class="text-lg font-semibold text-slate-900">Políticas</h2>
                  <button type="button" class="bo-button bo-button--ghost" data-add-policy>Adicionar política</button>
                </div>
                <div class="space-y-4" data-policies-list></div>
              </div>

              <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div class="text-sm text-slate-600">
                  <div>Status atual: <span data-status>${esc(contentRecord.status || 'draft')}</span></div>
                  <div>Versão: <span data-version>${esc(String(contentRecord.version || 0))}</span></div>
                </div>
                <div class="flex flex-wrap gap-3">
                  <button type="submit" class="bo-button bo-button--primary" data-save-button>Guardar rascunho</button>
                </div>
              </div>
              <div class="text-sm" data-feedback></div>
            </form>

            <aside class="bg-white shadow-sm rounded-2xl p-6 space-y-6">
              <div>
                <h2 class="text-lg font-semibold text-slate-900 mb-3">Publicar conteúdo</h2>
                <p class="text-sm text-slate-600 mb-4">Escolha onde atualizar o anúncio com o conteúdo mais recente.</p>
                <div class="flex flex-col gap-2" data-publish-actions>
                  ${channels
                    .map(channel => {
                      return `<button type="button" class="bo-button bo-button--secondary" data-publish="${esc(channel.key)}">Publicar em ${esc(channel.name)}</button>`;
                    })
                    .join('')}
                  <button type="button" class="bo-button bo-button--primary" data-publish="all">Publicar em todos</button>
                </div>
                <div class="mt-3 text-xs text-slate-500" data-last-published></div>
              </div>

              <div>
                <h2 class="text-lg font-semibold text-slate-900 mb-3">Histórico de versões</h2>
                <ul class="space-y-2" data-version-list></ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
        <script type="application/json" id="content-center-data">${esc(JSON.stringify(payload))}</script>
        <script>
          (function() {
            const dataEl = document.getElementById('content-center-data');
            if (!dataEl) return;
            let state;
            try {
              state = JSON.parse(dataEl.textContent || '{}');
            } catch (_) {
              state = {};
            }
            const form = document.querySelector('[data-content-form]');
            const unitSelect = document.querySelector('[data-unit-select]');
            const statusEl = document.querySelector('[data-status]');
            const versionEl = document.querySelector('[data-version]');
            const feedbackEl = document.querySelector('[data-feedback]');
            const photosList = document.querySelector('[data-photos-list]');
            const policiesList = document.querySelector('[data-policies-list]');
            const addPhotoBtn = document.querySelector('[data-add-photo]');
            const addPolicyBtn = document.querySelector('[data-add-policy]');
            const publishButtons = document.querySelectorAll('[data-publish]');
            const saveButton = document.querySelector('[data-save-button]');
            const versionList = document.querySelector('[data-version-list]');
            const lastPublishedEl = document.querySelector('[data-last-published]');

            function formatDate(value) {
              if (!value) return '';
              try {
                return new Date(value).toLocaleString('pt-PT');
              } catch (_) {
                return value;
              }
            }

            function updateLastPublished() {
              if (!lastPublishedEl) return;
              const channels = Array.isArray(state.lastPublishedChannels) ? state.lastPublishedChannels : [];
              if (!channels.length) {
                lastPublishedEl.textContent = 'Sem publicações anteriores.';
                return;
              }
              const label = channels.join(', ');
              const timestamp = state.publishedAt ? formatDate(state.publishedAt) : '—';
              lastPublishedEl.textContent = 'Última publicação (' + label + ') em ' + timestamp;
            }

            function getCsrfToken() {
              const match = document.cookie
                .split(';')
                .map(part => part.trim())
                .find(part => part.startsWith('csrf_token='));
              if (!match) return '';
              return decodeURIComponent(match.split('=')[1] || '');
            }

            function setFeedback(message, variant) {
              if (!feedbackEl) return;
              feedbackEl.textContent = message || '';
              feedbackEl.dataset.variant = variant || '';
            }

            function escapeHtml(value) {
              const span = document.createElement('span');
              span.textContent = value || '';
              return span.innerHTML;
            }

            function ensureVersionsArray() {
              if (!Array.isArray(state.versions)) {
                state.versions = [];
              }
            }

            function renderVersions() {
              ensureVersionsArray();
              if (!versionList) return;
              if (!state.versions.length) {
                versionList.innerHTML = '<li class="text-sm text-slate-500">Sem histórico disponível.</li>';
                return;
              }
              versionList.innerHTML = state.versions
                .map(entry => {
                  const badge = entry.isCurrent
                    ? '<span class="ml-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Atual</span>'
                    : '';
                  const timestamp = entry.savedAt ? formatDate(entry.savedAt) : '—';
                  const actor = entry.savedBy ? ' · ' + escapeHtml(entry.savedBy) : '';
                  const actionButton = entry.isCurrent
                    ? ''
                    : '<button type="button" class="bo-button bo-button--ghost bo-button--sm" data-rollback="' +
                      escapeHtml(String(entry.version)) +
                      '">Repor</button>';
                  return (
                    '<li class="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2">' +
                    '<div>' +
                    '<div class="text-sm font-medium text-slate-800">Versão ' +
                    escapeHtml(String(entry.version)) +
                    badge +
                    '</div>' +
                    '<div class="text-xs text-slate-500">' +
                    escapeHtml(timestamp) +
                    actor +
                    '</div>' +
                    '</div>' +
                    actionButton +
                    '</li>'
                  );
                })
                .join('');
            }

            function updateVersionsAfterSave(newVersion, previousVersion) {
              ensureVersionsArray();
              const nowIso = new Date().toISOString();
              const actor = state.actor || '';
              const map = new Map();
              state.versions
                .filter(entry => !entry.isCurrent)
                .forEach(entry => {
                  map.set(entry.version, { ...entry, isCurrent: false });
                });
              if (previousVersion && previousVersion > 0 && previousVersion !== newVersion) {
                const existing = map.get(previousVersion);
                map.set(previousVersion, {
                  version: previousVersion,
                  savedAt: existing && existing.savedAt ? existing.savedAt : nowIso,
                  savedBy: existing && existing.savedBy ? existing.savedBy : actor,
                  isCurrent: false
                });
              }
              state.versions = [
                { version: newVersion, savedAt: nowIso, savedBy: actor, isCurrent: true },
                ...Array.from(map.values()).filter(entry => entry.version !== newVersion).sort((a, b) => b.version - a.version)
              ];
              renderVersions();
            }

            function updateVersionsAfterRollback(newVersion, previousVersion) {
              ensureVersionsArray();
              const nowIso = new Date().toISOString();
              const actor = state.actor || '';
              const map = new Map();
              state.versions.forEach(entry => {
                map.set(entry.version, { ...entry, isCurrent: false });
              });
              if (previousVersion && previousVersion > 0) {
                const existing = map.get(previousVersion);
                map.set(previousVersion, {
                  version: previousVersion,
                  savedAt: existing && existing.savedAt ? existing.savedAt : nowIso,
                  savedBy: existing && existing.savedBy ? existing.savedBy : actor,
                  isCurrent: false
                });
              }
              map.delete(newVersion);
              state.versions = [
                { version: newVersion, savedAt: nowIso, savedBy: actor, isCurrent: true },
                ...Array.from(map.values()).filter(entry => entry.version !== newVersion).sort((a, b) => b.version - a.version)
              ];
              renderVersions();
            }

            function createPhotoRow(photo) {
              const wrapper = document.createElement('div');
              wrapper.className = 'border border-slate-200 rounded-xl p-4 space-y-3';
              wrapper.dataset.photoRow = '1';
              const photoUrl = photo.url ? escapeHtml(photo.url) : '';
              const photoCaption = photo.caption ? escapeHtml(photo.caption) : '';
              const isPrimary = photo.isPrimary ? 'checked' : '';
              wrapper.innerHTML = [
                '<div class="grid md:grid-cols-[2fr,1fr] gap-3">',
                '  <div>',
                '    <label class="bo-label">URL</label>',
                '    <input type="url" class="bo-input w-full" data-photo-url value="' + photoUrl + '" />',
                '  </div>',
                '  <div>',
                '    <label class="bo-label">Legenda</label>',
                '    <input type="text" class="bo-input w-full" data-photo-caption value="' + photoCaption + '" />',
                '  </div>',
                '</div>',
                '<div class="flex items-center justify-between">',
                '  <label class="inline-flex items-center gap-2 text-sm text-slate-600">',
                '    <input type="radio" name="primary-photo" ' + isPrimary + ' /> Foto principal',
                '  </label>',
                '  <button type="button" class="bo-button bo-button--ghost bo-button--sm" data-remove-photo>Remover</button>',
                '</div>'
              ].join('');
              const removeBtn = wrapper.querySelector('[data-remove-photo]');
              const primaryInput = wrapper.querySelector('input[type="radio"]');
              if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                  wrapper.remove();
                  ensurePrimaryPhoto();
                });
              }
              if (primaryInput) {
                primaryInput.addEventListener('change', () => {
                  document.querySelectorAll('[data-photo-row] input[type="radio"]').forEach(input => {
                    if (input !== primaryInput) input.checked = false;
                  });
                });
              }
              return wrapper;
            }

            function ensurePrimaryPhoto() {
              const radios = Array.from(document.querySelectorAll('[data-photo-row] input[type="radio"]'));
              if (!radios.some(input => input.checked) && radios.length) {
                radios[0].checked = true;
              }
            }

            function createPolicyRow(policy) {
              const wrapper = document.createElement('div');
              wrapper.className = 'border border-slate-200 rounded-xl p-4 space-y-3';
              wrapper.dataset.policyRow = '1';
              const policyKey = policy.key ? escapeHtml(policy.key) : '';
              const policyTitle = policy.title ? escapeHtml(policy.title) : '';
              const policyText = policy.description ? escapeHtml(policy.description) : '';
              wrapper.innerHTML = [
                '<div class="grid md:grid-cols-2 gap-3">',
                '  <div>',
                '    <label class="bo-label">Identificador</label>',
                '    <input type="text" class="bo-input w-full" data-policy-key value="' + policyKey + '" />',
                '  </div>',
                '  <div>',
                '    <label class="bo-label">Título</label>',
                '    <input type="text" class="bo-input w-full" data-policy-title value="' + policyTitle + '" />',
                '  </div>',
                '</div>',
                '<div>',
                '  <label class="bo-label">Descrição</label>',
                '  <textarea class="bo-textarea h-24" data-policy-text>' + policyText + '</textarea>',
                '</div>',
                '<div class="flex justify-end">',
                '  <button type="button" class="bo-button bo-button--ghost bo-button--sm" data-remove-policy>Remover</button>',
                '</div>'
              ].join('');
              const removeBtn = wrapper.querySelector('[data-remove-policy]');
              if (removeBtn) {
                removeBtn.addEventListener('click', () => wrapper.remove());
              }
              return wrapper;
            }

            function hydrateForm() {
              if (!state || !state.content) return;
              const { content } = state;
              const title = document.getElementById('content-title');
              const subtitle = document.getElementById('content-subtitle');
              const description = document.getElementById('content-description');
              const highlights = document.getElementById('content-highlights');
              const amenities = document.getElementById('content-amenities');
              if (title) title.value = content.title || '';
              if (subtitle) subtitle.value = content.subtitle || '';
              if (description) description.value = content.description || '';
              if (highlights) highlights.value = Array.isArray(content.highlights) ? content.highlights.join('\n') : '';
              if (amenities) amenities.value = Array.isArray(content.amenities) ? content.amenities.join('\n') : '';
              if (photosList) {
                photosList.innerHTML = '';
                (Array.isArray(content.photos) ? content.photos : []).forEach(photo => {
                  photosList.appendChild(createPhotoRow(photo));
                });
                if (!(Array.isArray(content.photos) && content.photos.length)) {
                  photosList.appendChild(createPhotoRow({}));
                }
                ensurePrimaryPhoto();
              }
              if (policiesList) {
                policiesList.innerHTML = '';
                (Array.isArray(content.policies) ? content.policies : []).forEach(policy => {
                  policiesList.appendChild(createPolicyRow(policy));
                });
              }
              if (statusEl) statusEl.textContent = state.status || 'draft';
              if (versionEl) versionEl.textContent = String(state.version || 0);
              updateLastPublished();
            }

            function collectArrayFromTextarea(id) {
              const el = document.getElementById(id);
              if (!el) return [];
              return el.value
                .split(/\n+/)
                .map(item => item.trim())
                .filter(Boolean);
            }

            function collectPhotos() {
              return Array.from(document.querySelectorAll('[data-photo-row]')).map((row, index) => {
                const url = row.querySelector('[data-photo-url]');
                const caption = row.querySelector('[data-photo-caption]');
                const primary = row.querySelector('input[type="radio"]');
                return {
                  url: url ? url.value.trim() : '',
                  caption: caption ? caption.value.trim() : '',
                  isPrimary: primary ? (primary.checked ? 1 : 0) : index === 0,
                  sortOrder: index
                };
              }).filter(photo => photo.url);
            }

            function collectPolicies() {
              return Array.from(document.querySelectorAll('[data-policy-row]')).map((row, index) => {
                const keyInput = row.querySelector('[data-policy-key]');
                const titleInput = row.querySelector('[data-policy-title]');
                const textInput = row.querySelector('[data-policy-text]');
                const key = keyInput ? keyInput.value.trim() : '';
                const title = titleInput ? titleInput.value.trim() : '';
                const description = textInput ? textInput.value.trim() : '';
                if (!title && !description) {
                  return null;
                }
                return {
                  key: key || 'policy_' + (index + 1),
                  title: title || 'Política ' + (index + 1),
                  description,
                  sortOrder: index
                };
              }).filter(Boolean);
            }

            async function saveDraft() {
              if (!state || !state.unit) return;
              setFeedback('A guardar alterações…', 'info');
              saveButton && (saveButton.disabled = true);
              const previousVersion = Number(state.version || 0);
              const payload = {
                title: document.getElementById('content-title')?.value || '',
                subtitle: document.getElementById('content-subtitle')?.value || '',
                description: document.getElementById('content-description')?.value || '',
                highlights: collectArrayFromTextarea('content-highlights'),
                amenities: collectArrayFromTextarea('content-amenities'),
                photos: collectPhotos(),
                policies: collectPolicies()
              };
              try {
                const response = await fetch('/admin/content/' + state.unit.id, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken()
                  },
                  body: JSON.stringify(payload)
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(json && json.error ? json.error : 'Falha ao guardar rascunho.');
                }
                state.version = json.version;
                state.status = json.status;
                state.content = payload;
                if (versionEl) versionEl.textContent = String(json.version || state.version || 0);
                if (statusEl) statusEl.textContent = json.status || 'draft';
                updateVersionsAfterSave(Number(json.version || state.version || 0), previousVersion);
                setFeedback('Rascunho guardado com sucesso.', 'success');
              } catch (err) {
                setFeedback(err.message || 'Não foi possível guardar o rascunho.', 'error');
              } finally {
                saveButton && (saveButton.disabled = false);
              }
            }

            async function publishContent(target) {
              if (!state || !state.unit) return;
              const params = new URLSearchParams();
              if (target === 'all') {
                params.set('channels', '*');
              } else if (typeof target === 'string' && target) {
                params.set('channels', target);
              }
              setFeedback('A publicar conteúdo…', 'info');
              publishButtons.forEach(btn => (btn.disabled = true));
              try {
                const response = await fetch('/admin/content/' + state.unit.id + '/publish?' + params.toString(), {
                  method: 'POST',
                  headers: {
                    'x-csrf-token': getCsrfToken()
                  }
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(json && json.error ? json.error : 'Falha ao publicar conteúdo.');
                }
                state.status = json.status || 'published';
                state.lastPublishedChannels = json.channels || [];
                state.publishedAt = json.publishedAt || null;
                if (statusEl) statusEl.textContent = state.status;
                updateLastPublished();
                setFeedback('Conteúdo enviado para sincronização.', 'success');
              } catch (err) {
                setFeedback(err.message || 'Não foi possível publicar o conteúdo.', 'error');
              } finally {
                publishButtons.forEach(btn => (btn.disabled = false));
              }
            }

            async function rollbackVersion(targetVersion) {
              if (!state || !state.unit) return;
              const version = Number(targetVersion);
              if (!Number.isInteger(version) || version <= 0) return;
              setFeedback('A restaurar versão selecionada…', 'info');
              const previousVersion = Number(state.version || 0);
              try {
                const response = await fetch('/admin/content/' + state.unit.id + '/rollback', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken()
                  },
                  body: JSON.stringify({ version })
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(json && json.error ? json.error : 'Falha ao restaurar versão.');
                }
                state.version = json.version;
                state.status = json.status || 'draft';
                state.content = json.content || state.content;
                if (statusEl) statusEl.textContent = state.status;
                if (versionEl) versionEl.textContent = String(state.version || 0);
                updateVersionsAfterRollback(Number(state.version || 0), previousVersion);
                hydrateForm();
                setFeedback('Versão restaurada com sucesso.', 'success');
              } catch (err) {
                setFeedback(err.message || 'Não foi possível restaurar a versão selecionada.', 'error');
              }
            }

            if (form) {
              form.addEventListener('submit', event => {
                event.preventDefault();
                saveDraft();
              });
            }

            if (unitSelect) {
              unitSelect.addEventListener('change', () => {
                const nextUnit = unitSelect.value;
                const url = new URL(window.location.href);
                url.searchParams.set('unit', nextUnit);
                window.location.assign(url.toString());
              });
            }

            if (addPhotoBtn) {
              addPhotoBtn.addEventListener('click', () => {
                const row = createPhotoRow({});
                photosList && photosList.appendChild(row);
                ensurePrimaryPhoto();
              });
            }

            if (addPolicyBtn) {
              addPolicyBtn.addEventListener('click', () => {
                const row = createPolicyRow({});
                policiesList && policiesList.appendChild(row);
              });
            }

            publishButtons.forEach(btn => {
              btn.addEventListener('click', () => publishContent(btn.dataset.publish));
            });

            if (versionList) {
              versionList.addEventListener('click', event => {
                const target = event.target;
                if (target && target.matches('[data-rollback]')) {
                  const version = target.getAttribute('data-rollback');
                  rollbackVersion(version);
                }
              });
            }

            ensureVersionsArray();
            renderVersions();
            hydrateForm();
          })();
        </script>
      `;

      res.send(
        layout({
          title: 'Centro de Conteúdos',
          user: req.user,
          activeNav: 'backoffice',
          branding,
          pageClass: 'page-backoffice page-content-center',
          body: pageBody
        })
      );
    }
  );

  app.put('/admin/content/:unitId', requireLogin, requireBackofficeAccess, (req, res) => {
    const unitId = Number(req.params.unitId);
    if (!Number.isInteger(unitId) || unitId <= 0) {
      return res.status(400).json({ error: 'Unidade inválida.' });
    }
    const tenantId = req.tenant && req.tenant.id ? req.tenant.id : 1;
    try {
      const result = channelContentService.saveDraft(unitId, req.body || {}, {
        tenantId,
        userId: req.user && req.user.id ? req.user.id : null
      });
      logActivity(
        req.user && req.user.id ? req.user.id : null,
        'unit_content:save',
        'unit',
        unitId,
        { version: result.version }
      );
      if (result.previousContent) {
        logChange(
          req.user && req.user.id ? req.user.id : null,
          'unit_content',
          unitId,
          'update',
          result.previousContent,
          result.content
        );
      } else {
        logChange(
          req.user && req.user.id ? req.user.id : null,
          'unit_content',
          unitId,
          'create',
          null,
          result.content
        );
      }
      res.json({ ok: true, version: result.version, status: result.status });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error('Falha ao guardar conteúdo da unidade:', err);
      res.status(500).json({ error: 'Não foi possível guardar o conteúdo.' });
    }
  });

  app.post('/admin/content/:unitId/publish', requireLogin, requireBackofficeAccess, (req, res) => {
    const unitId = Number(req.params.unitId);
    if (!Number.isInteger(unitId) || unitId <= 0) {
      return res.status(400).json({ error: 'Unidade inválida.' });
    }
    const tenantId = req.tenant && req.tenant.id ? req.tenant.id : 1;
    const channelsParam = req.query.channels;
    let channels = [];
    if (channelsParam === '*' || channelsParam === 'all') {
      channels = [];
    } else if (typeof channelsParam === 'string' && channelsParam.trim()) {
      channels = channelsParam.split(',').map(value => value.trim()).filter(Boolean);
    }
    try {
      const result = channelContentService.publishUnitContent(unitId, {
        tenantId,
        userId: req.user && req.user.id ? req.user.id : null,
        channels
      });
      logActivity(
        req.user && req.user.id ? req.user.id : null,
        'unit_content:publish',
        'unit',
        unitId,
        { version: result.version, channels: result.channels }
      );
      res.json({
        ok: true,
        version: result.version,
        status: result.status,
        channels: result.channels,
        publishedAt: result.publishedAt
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error('Falha ao publicar conteúdo da unidade:', err);
      res.status(500).json({ error: 'Não foi possível publicar o conteúdo.' });
    }
  });

  app.post('/admin/content/:unitId/rollback', requireLogin, requireBackofficeAccess, (req, res) => {
    const unitId = Number(req.params.unitId);
    if (!Number.isInteger(unitId) || unitId <= 0) {
      return res.status(400).json({ error: 'Unidade inválida.' });
    }
    const tenantId = req.tenant && req.tenant.id ? req.tenant.id : 1;
    const targetVersion = req.body && req.body.version;
    const before = channelContentService.getUnitContent(unitId, { tenantId });
    try {
      const result = channelContentService.rollbackUnitContent(unitId, targetVersion, {
        tenantId,
        userId: req.user && req.user.id ? req.user.id : null
      });
      logActivity(
        req.user && req.user.id ? req.user.id : null,
        'unit_content:rollback',
        'unit',
        unitId,
        { from: before.version, to: result.version, restoredFrom: result.restoredFrom }
      );
      logChange(
        req.user && req.user.id ? req.user.id : null,
        'unit_content',
        unitId,
        'rollback',
        before.content,
        result.content
      );
      res.json({
        ok: true,
        version: result.version,
        status: result.status,
        restoredFrom: result.restoredFrom,
        content: result.content
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error('Falha ao restaurar versão do conteúdo:', err);
      res.status(500).json({ error: 'Não foi possível restaurar a versão selecionada.' });
    }
  });
};
