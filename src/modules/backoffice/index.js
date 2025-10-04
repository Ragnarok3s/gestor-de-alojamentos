module.exports = function registerBackoffice(app, context) {
  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    eur,
    bcrypt,
    fs,
    fsp,
    path,
    sharp,
    upload,
    uploadBrandingAsset,
    paths,
    getSession,
    createSession,
    destroySession,
    normalizeRole,
    buildUserContext,
    userCan,
    logActivity,
    logChange,
    logSessionEvent,
    ensureAutomationFresh,
    automationCache,
    automationSeverityStyle,
    formatDateRangeShort,
    capitalizeMonth,
    safeJsonParse,
    wantsJson,
    parseOperationalFilters,
    computeOperationalDashboard,
    ensureDir,
    rememberActiveBrandingProperty,
    resolveBrandingForRequest,
    parseFeaturesStored,
    parseFeaturesInput,
    featuresToTextarea,
    featureChipsHtml,
    titleizeWords,
    deriveUnitType,
    dateRangeNights,
    requireLogin,
    requirePermission,
    requireAnyPermission,
    requireAdmin,
    overlaps,
    unitAvailable,
    rateQuote,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    ALL_PERMISSIONS,
    MASTER_ROLE,
    FEATURE_ICON_KEYS,
    UNIT_TYPE_ICON_HINTS,
    runAutomationSweep,
    readAutomationState,
    writeAutomationState,
    AUTO_CHAIN_THRESHOLD,
    AUTO_CHAIN_CLEANUP_NIGHTS,
    HOT_DEMAND_THRESHOLD,
    formatJsonSnippet,
    parsePropertyId,
    slugify
  } = context;

  const { UPLOAD_ROOT, UPLOAD_UNITS, UPLOAD_BRANDING } = paths || {};

  // ===================== Backoffice (protegido) =====================
app.get('/admin', requireLogin, requirePermission('dashboard.view'), (req, res) => {
  const props = db.prepare('SELECT * FROM properties ORDER BY name').all();
  const unitsRaw = db.prepare(
    `SELECT u.*, p.name as property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name`
  ).all();
  const units = unitsRaw.map(u => ({ ...u, unit_type: deriveUnitType(u) }));
  const recentBookings = db.prepare(
    `SELECT b.*, u.name as unit_name, p.name as property_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
       JOIN properties p ON p.id = u.property_id
      ORDER BY b.created_at DESC
      LIMIT 12`
  ).all();

  const automationData = ensureAutomationFresh(5) || automationCache;
  const automationMetrics = automationData.metrics || {};
  const automationNotifications = automationData.notifications || [];
  const automationSuggestions = automationData.tariffSuggestions || [];
  const automationBlocks = automationData.generatedBlocks || [];
  const automationDaily = (automationData.summaries && automationData.summaries.daily) || [];
  const automationWeekly = (automationData.summaries && automationData.summaries.weekly) || [];
  const automationLastRun = automationData.lastRun ? dayjs(automationData.lastRun).format('DD/MM HH:mm') : '—';
  const automationRevenue7 = automationData.revenue ? automationData.revenue.next7 || 0 : 0;
  const totalUnitsCount = automationMetrics.totalUnits || units.length || 0;

  const unitTypeOptions = Array.from(new Set(units.map(u => u.unit_type).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'pt', { sensitivity: 'base' })
  );
  const monthOptions = [];
  const monthBase = dayjs().startOf('month');
  for (let i = 0; i < 12; i++) {
    const m = monthBase.subtract(i, 'month');
    monthOptions.push({ value: m.format('YYYY-MM'), label: capitalizeMonth(m.format('MMMM YYYY')) });
  }
  const defaultMonthValue = monthOptions.length ? monthOptions[0].value : dayjs().format('YYYY-MM');
  const operationalDefault = computeOperationalDashboard({ month: defaultMonthValue });
  const operationalConfig = {
    filters: {
      months: monthOptions,
      properties: props.map(p => ({ id: p.id, name: p.name })),
      unitTypes: unitTypeOptions
    },
    defaults: {
      month: operationalDefault.month,
      propertyId: operationalDefault.filters.propertyId ? String(operationalDefault.filters.propertyId) : '',
      unitType: operationalDefault.filters.unitType || ''
    },
    initialData: operationalDefault
  };
  const operationalConfigJson = esc(JSON.stringify(operationalConfig));

  const notificationsHtml = automationNotifications.length
    ? `<ul class="space-y-3">${automationNotifications.map(n => {
        const styles = automationSeverityStyle(n.severity);
        const ts = n.created_at ? dayjs(n.created_at).format('DD/MM HH:mm') : automationLastRun;
        return `
          <li class="border-l-4 pl-3 ${styles.border} bg-white/40 rounded-sm">
            <div class="text-[11px] text-slate-400">${esc(ts)}</div>
            <div class="text-sm font-semibold text-slate-800">${esc(n.title || '')}</div>
            <div class="text-sm text-slate-600">${esc(n.message || '')}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Sem alertas no momento.</p>';

  const suggestionsHtml = automationSuggestions.length
    ? `<ul class="space-y-2">${automationSuggestions.map(s => {
        const occPct = Math.round((s.occupancyRate || 0) * 100);
        const pendLabel = s.pendingCount ? ` <span class=\"text-xs text-slate-500\">(+${s.pendingCount} pend)</span>` : '';
        return `
          <li class="border rounded-lg p-3 bg-slate-50">
            <div class="flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>${dayjs(s.date).format('DD/MM')}</span>
              <span>${occPct}% ocup.</span>
            </div>
            <div class="text-sm text-slate-600">Sugerir +${s.suggestedIncreasePct}% no preço base · ${s.confirmedCount}/${totalUnitsCount} confirmadas${pendLabel}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Sem datas de alta procura.</p>';

  const blockEventsHtml = automationBlocks.length
    ? `<ul class="space-y-2">${automationBlocks.slice(-6).reverse().map(evt => {
        const label = evt.type === 'minstay' ? 'Estadia mínima' : 'Sequência cheia';
        const extra = evt.extra_nights ? ` · +${evt.extra_nights} noite(s)` : '';
        return `
          <li class="border rounded-lg p-3 bg-white/40">
            <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(label)}</div>
            <div class="text-sm font-semibold text-slate-800">${esc(evt.property_name)} · ${esc(evt.unit_name)}</div>
            <div class="text-sm text-slate-600">${esc(formatDateRangeShort(evt.start, evt.end))}${extra}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Nenhum bloqueio automático recente.</p>';

  const dailyRows = automationDaily.length
    ? automationDaily.map(d => {
        const occPct = Math.round((d.occupancyRate || 0) * 100);
        const arrLabel = d.arrivalsPending ? `${d.arrivalsConfirmed} <span class=\"text-xs text-slate-500\">(+${d.arrivalsPending} pend)</span>` : String(d.arrivalsConfirmed);
        const depLabel = d.departuresPending ? `${d.departuresConfirmed} <span class=\"text-xs text-slate-500\">(+${d.departuresPending} pend)</span>` : String(d.departuresConfirmed);
        const pendingBadge = d.pendingCount ? `<span class=\"text-xs text-slate-500 ml-1\">(+${d.pendingCount} pend)</span>` : '';
        return `
          <tr class="border-t">
            <td class="py-2 text-sm">${dayjs(d.date).format('DD/MM')}</td>
            <td class="py-2 text-sm">${occPct}%</td>
            <td class="py-2 text-sm">${d.confirmedCount}${pendingBadge}</td>
            <td class="py-2 text-sm">${arrLabel}</td>
            <td class="py-2 text-sm">${depLabel}</td>
          </tr>`;
      }).join('')
    : '<tr><td class="py-2 text-sm text-slate-500" colspan="5">Sem dados para o período.</td></tr>';

  const weeklyRows = automationWeekly.length
    ? automationWeekly.map(w => {
        const occPct = Math.round((w.occupancyRate || 0) * 100);
        const pending = w.pendingNights ? ` <span class=\"text-xs text-slate-500\">(+${w.pendingNights} pend)</span>` : '';
        const endLabel = dayjs(w.end).subtract(1, 'day').format('DD/MM');
        return `
          <tr class="border-t">
            <td class="py-2 text-sm">${dayjs(w.start).format('DD/MM')} → ${endLabel}</td>
            <td class="py-2 text-sm">${occPct}%</td>
            <td class="py-2 text-sm">${w.confirmedNights}${pending}</td>
          </tr>`;
      }).join('')
    : '<tr><td class="py-2 text-sm text-slate-500" colspan="3">Sem dados agregados.</td></tr>';

  const onboardingCard = html`
      <section class="onboarding-card mb-6">
        <h2 class="text-lg font-semibold text-slate-800 mb-2">Guia rápido para começar</h2>
        <p class="text-sm text-slate-600 mb-4">Três ações asseguram que a equipa trabalha com uma experiência consistente e profissional.</p>
        <ol class="onboarding-steps">
          <li>
            <strong>Personalize a identidade.</strong>
            <p>Ajuste cores e carregue o logotipo em <a class="underline" href="/admin/identidade-visual">Identidade visual</a> para refletir a marca em todo o portal.</p>
          </li>
          <li>
            <strong>Complete propriedades e unidades.</strong>
            <p>Revise descrições, fotos e tarifas para que cada reserva tenha contexto completo.</p>
          </li>
          <li>
            <strong>Defina a equipa.</strong>
            <p>Convide utilizadores e atribua permissões em <a class="underline" href="/admin/utilizadores">Utilizadores</a>, garantindo que cada perfil vê apenas o necessário.</p>
          </li>
        </ol>
      </section>
  `;

  const automationCard = html`
      <section class="card p-4 mb-6 space-y-6">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-800">Dashboard operacional</h2>
            <p class="text-sm text-slate-600">Transforma os dados de ocupação em decisões imediatas.</p>
            <div class="text-xs text-slate-400 mt-1">Última análise automática: ${automationLastRun}</div>
          </div>
          <form id="operational-filters" class="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full md:w-auto">
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Período</span>
              <select name="month" id="operational-filter-month" class="input">
                ${monthOptions.map(opt => `<option value="${opt.value}"${opt.value === operationalDefault.month ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Propriedade</span>
              <select name="property_id" id="operational-filter-property" class="input">
                <option value="">Todas</option>
                ${props.map(p => {
                  const selected = operationalDefault.filters.propertyId === p.id ? ' selected' : '';
                  return `<option value="${p.id}"${selected}>${esc(p.name)}</option>`;
                }).join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Tipo de unidade</span>
              <select name="unit_type" id="operational-filter-type" class="input">
                <option value="">Todos</option>
                ${unitTypeOptions.map(type => {
                  const selected = operationalDefault.filters.unitType === type ? ' selected' : '';
                  return `<option value="${esc(type)}"${selected}>${esc(type)}</option>`;
                }).join('')}
              </select>
            </label>
          </form>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3" id="operational-metrics">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Ocupação atual</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-occupancy">—</div>
            <div class="text-xs text-slate-500">Noites ocupadas vs. disponíveis no período selecionado.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Receita total</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-revenue">—</div>
            <div class="text-xs text-slate-500">Receita proporcional das reservas confirmadas.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Média de noites</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-average">—</div>
            <div class="text-xs text-slate-500">Duração média das reservas incluídas.</div>
          </div>
          <div class="md:col-span-3 text-xs text-slate-500" id="operational-context">
            <span id="operational-period-label">—</span>
            <span id="operational-filters-label" class="ml-1"></span>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Top unidades por ocupação</h3>
                <a id="operational-export" class="btn btn-light border border-slate-200 text-sm" href="#" download>Exportar CSV</a>
              </div>
              <div id="top-units-wrapper" class="space-y-3">
                <p class="text-sm text-slate-500" id="top-units-empty">Sem dados para os filtros atuais.</p>
                <ol id="top-units-list" class="space-y-3 hidden"></ol>
              </div>
              <p class="text-xs text-slate-500 mt-3" id="operational-summary">—</p>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo diário (próximos 7 dias)</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Dia</th><th>Ocup.</th><th>Reservas</th><th>Check-in</th><th>Check-out</th>
                    </tr>
                  </thead>
                  <tbody>${dailyRows}</tbody>
                </table>
              </div>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo semanal</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[320px] text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Semana</th><th>Ocup.</th><th>Noites confirmadas</th>
                    </tr>
                  </thead>
                  <tbody>${weeklyRows}</tbody>
                </table>
              </div>
            </section>
          </div>

          <div class="space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Alertas operacionais</h3>
              ${notificationsHtml}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Sugestões de tarifa</h3>
              ${suggestionsHtml}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Bloqueios automáticos</h3>
              ${blockEventsHtml}
            </section>
          </div>
        </div>
      </section>
      <script type="application/json" id="operational-dashboard-data">${operationalConfigJson}</script>
      <script>
        document.addEventListener('DOMContentLoaded', function () {
          const configEl = document.getElementById('operational-dashboard-data');
          if (!configEl) return;
          let config;
          try {
            config = JSON.parse(configEl.textContent);
          } catch (err) {
            console.error('Dashboard operacional: configuração inválida', err);
            return;
          }
          const form = document.getElementById('operational-filters');
          if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); });
          const monthSelect = document.getElementById('operational-filter-month');
          const propertySelect = document.getElementById('operational-filter-property');
          const typeSelect = document.getElementById('operational-filter-type');
          const occupancyEl = document.getElementById('operational-occupancy');
          const revenueEl = document.getElementById('operational-revenue');
          const averageEl = document.getElementById('operational-average');
          const periodLabelEl = document.getElementById('operational-period-label');
          const filtersLabelEl = document.getElementById('operational-filters-label');
          const summaryEl = document.getElementById('operational-summary');
          const listEl = document.getElementById('top-units-list');
          const emptyEl = document.getElementById('top-units-empty');
          const wrapperEl = document.getElementById('top-units-wrapper');
          const exportBtn = document.getElementById('operational-export');
          const currencyFormatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
          const percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 });
          const nightsFormatter = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          const dateFormatter = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit' });
          let pendingController = null;

          function escHtml(value) {
            return String(value ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }

          function slug(value) {
            return String(value || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/gi, '-')
              .replace(/^-+|-+$/g, '')
              .toLowerCase();
          }

          function formatRange(range) {
            if (!range || !range.start || !range.end) return '';
            const startDate = new Date(range.start + 'T00:00:00');
            const endDate = new Date(range.end + 'T00:00:00');
            endDate.setDate(endDate.getDate() - 1);
            return dateFormatter.format(startDate) + ' → ' + dateFormatter.format(endDate);
          }

          function describeFilters(data) {
            if (!data || !data.filters) return '';
            const labels = [];
            if (data.filters.propertyLabel) labels.push(data.filters.propertyLabel);
            if (data.filters.unitType) labels.push(data.filters.unitType);
            return labels.join(' · ');
          }

          function renderTopUnits(units, totalNights) {
            if (!Array.isArray(units) || !units.length) return '';
            const nightsLabel = Math.max(1, Number(totalNights) || 0);
            return units.map((unit, index) => {
              const occPct = percentFormatter.format(unit.occupancyRate || 0);
              const revenueLabel = currencyFormatter.format((unit.revenueCents || 0) / 100);
              const bookingsText = unit.bookingsCount === 1 ? '1 reserva' : (unit.bookingsCount || 0) + ' reservas';
              const nightsText = (unit.occupiedNights || 0) + ' / ' + nightsLabel + ' noites';
              const typeLabel = unit.unitType ? ' · ' + unit.unitType : '';
              return '<li class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">' +
                '<div>' +
                  '<div class="text-sm font-semibold text-slate-800">' + escHtml((index + 1) + '. ' + unit.propertyName + ' · ' + unit.unitName) + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(bookingsText + ' · ' + nightsText + typeLabel) + '</div>' +
                '</div>' +
                '<div class="text-right space-y-1">' +
                  '<div class="text-sm font-semibold text-slate-900">' + occPct + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(revenueLabel) + '</div>' +
                '</div>' +
              '</li>';
            }).join('');
          }

          function buildExportUrl(data) {
            const params = new URLSearchParams();
            const monthVal = data && data.month ? data.month : (monthSelect ? monthSelect.value : '');
            if (monthVal) params.set('month', monthVal);
            if (data && data.filters) {
              if (data.filters.propertyId) params.set('property_id', data.filters.propertyId);
              if (data.filters.unitType) params.set('unit_type', data.filters.unitType);
            }
            return '/admin/automation/export.csv?' + params.toString();
          }

          function buildExportFilename(data) {
            const parts = ['dashboard', data.month || ''];
            if (data.filters) {
              if (data.filters.propertyLabel) {
                parts.push('prop-' + slug(data.filters.propertyLabel));
              } else if (data.filters.propertyId) {
                parts.push('prop-' + data.filters.propertyId);
              }
              if (data.filters.unitType) {
                parts.push('tipo-' + slug(data.filters.unitType));
              }
            }
            return parts.filter(Boolean).join('_') + '.csv';
          }

          function setLoading(state) {
            if (!wrapperEl) return;
            wrapperEl.classList.toggle('opacity-50', state);
          }

          function applyData(data) {
            if (!data) return;
            setLoading(false);
            const summary = data.summary || {};
            if (summary.availableNights > 0) {
              occupancyEl.textContent = percentFormatter.format(summary.occupancyRate || 0);
            } else {
              occupancyEl.textContent = '—';
            }
            revenueEl.textContent = currencyFormatter.format((summary.revenueCents || 0) / 100);
            averageEl.textContent = summary.bookingsCount ? (nightsFormatter.format(summary.averageNights || 0) + ' noites') : '—';
            periodLabelEl.textContent = data.monthLabel + ' · ' + formatRange(data.range);
            const filtersDesc = describeFilters(data);
            filtersLabelEl.textContent = filtersDesc ? 'Filtros: ' + filtersDesc : '';
            const summaryParts = [];
            const bookingsCount = summary.bookingsCount || 0;
            summaryParts.push(bookingsCount === 1 ? '1 reserva confirmada' : bookingsCount + ' reservas confirmadas');
            if (summary.availableNights > 0) {
              summaryParts.push((summary.occupiedNights || 0) + '/' + summary.availableNights + ' noites ocupadas');
            } else {
              summaryParts.push('Sem unidades para o filtro selecionado');
            }
            if (filtersDesc) summaryParts.push(filtersDesc);
            summaryEl.textContent = summaryParts.join(' · ');

            const topUnitsHtml = renderTopUnits(data.topUnits || [], data.range ? data.range.nights : 0);
            if (topUnitsHtml) {
              listEl.innerHTML = topUnitsHtml;
              listEl.classList.remove('hidden');
              emptyEl.classList.add('hidden');
            } else {
              listEl.innerHTML = '';
              listEl.classList.add('hidden');
              emptyEl.classList.remove('hidden');
            }

            if (monthSelect && data.month) monthSelect.value = data.month;
            if (propertySelect) propertySelect.value = data.filters && data.filters.propertyId ? String(data.filters.propertyId) : '';
            if (typeSelect) typeSelect.value = data.filters && data.filters.unitType ? data.filters.unitType : '';

            if (exportBtn) {
              exportBtn.href = buildExportUrl(data);
              exportBtn.setAttribute('download', buildExportFilename(data));
            }
          }

          function requestData() {
            if (!monthSelect) return;
            const params = new URLSearchParams();
            if (monthSelect.value) params.set('month', monthSelect.value);
            if (propertySelect && propertySelect.value) params.set('property_id', propertySelect.value);
            if (typeSelect && typeSelect.value) params.set('unit_type', typeSelect.value);
            setLoading(true);
            if (pendingController) pendingController.abort();
            pendingController = new AbortController();
            fetch('/admin/automation/operational.json?' + params.toString(), { signal: pendingController.signal })
              .then(resp => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
              })
              .then(data => applyData(data))
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.error('Dashboard operacional: falha ao carregar métricas', err);
                  setLoading(false);
                }
              })
              .finally(() => {
                if (pendingController && pendingController.signal.aborted) return;
                pendingController = null;
              });
          }

          if (config && config.defaults) {
            if (monthSelect && config.defaults.month) monthSelect.value = config.defaults.month;
            if (propertySelect) propertySelect.value = config.defaults.propertyId || '';
            if (typeSelect) typeSelect.value = config.defaults.unitType || '';
          }
          if (config && config.initialData) {
            applyData(config.initialData);
          }
          [monthSelect, propertySelect, typeSelect].forEach(select => {
            if (!select) return;
            select.addEventListener('change', requestData);
          });
          configEl.textContent = '';
        });
      </script>
  `;

  res.send(layout({
    title: 'Backoffice',
    user: req.user,
    activeNav: 'backoffice',
    branding: resolveBrandingForRequest(req),
    body: html`
      <h1 class="text-2xl font-semibold mb-6">Backoffice</h1>

      ${onboardingCard}

      ${automationCard}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section class="card p-4">
          <h2 class="font-semibold mb-3">Propriedades</h2>
          <ul class="space-y-2 mb-3">
            ${props.map(p => `
              <li class="flex items-center justify-between">
                <span>${esc(p.name)}</span>
                <a class="text-slate-600 hover:text-slate-900 underline" href="/admin/properties/${p.id}">Abrir</a>
              </li>`).join('')}
          </ul>
          <form method="post" action="/admin/properties/create" class="grid gap-2">
            <input required name="name" class="input" placeholder="Nome"/>
            <input name="location" class="input" placeholder="Localização"/>
            <textarea name="description" class="input" placeholder="Descrição"></textarea>
            <button class="btn btn-primary">Adicionar Propriedade</button>
          </form>
        </section>

        <section class="card p-4 md:col-span-2">
          <h2 class="font-semibold mb-3">Unidades</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th>Propriedade</th><th>Unidade</th><th>Cap.</th><th>Base €/noite</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${units.map(u => `
                  <tr class="border-t">
                    <td>${esc(u.property_name)}</td>
                    <td>${esc(u.name)}</td>
                    <td>${u.capacity}</td>
                    <td>${eur(u.base_price_cents)}</td>
                    <td><a class="text-slate-600 hover:text-slate-900 underline" href="/admin/units/${u.id}">Gerir</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <hr class="my-4"/>
          <form method="post" action="/admin/units/create" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2">
            <select required name="property_id" class="input md:col-span-2">
              ${props.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            </select>
            <input required name="name" class="input md:col-span-2" placeholder="Nome da unidade"/>
            <input required type="number" min="1" name="capacity" class="input" placeholder="Capacidade"/>
            <input required type="number" step="0.01" min="0" name="base_price_eur" class="input" placeholder="Preço base €/noite"/>
            <textarea name="features_raw" class="input md:col-span-6" rows="4" placeholder="Características (uma por linha). Ex: 
bed|3 camas
wifi
kitchen|Kitchenette"></textarea>
            <div class="text-xs text-slate-500 md:col-span-6">
              Ícones Lucide disponíveis: ${FEATURE_ICON_KEYS.join(', ')}. Usa <code>icon|texto</code> ou só o ícone.
            </div>
            <div class="md:col-span-6">
              <button class="btn btn-primary">Adicionar Unidade</button>
            </div>
          </form>
        </section>
      </div>

      <section class="card p-4 mt-6">
        <h2 class="font-semibold mb-3">Reservas recentes</h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[980px] text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Quando</th><th>Propriedade / Unidade</th><th>Hóspede</th><th>Contacto</th><th>Ocupação</th><th>Datas</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recentBookings.map(b => `
                <tr class="border-t" title="${esc(b.guest_name||'')}">
                  <td>${dayjs(b.created_at).format('DD/MM HH:mm')}</td>
                  <td>${esc(b.property_name)} · ${esc(b.unit_name)}</td>
                  <td>${esc(b.guest_name)}</td>
                  <td>${esc(b.guest_phone||'-')} · ${esc(b.guest_email)}</td>
                  <td>${b.adults}A+${b.children}C</td>
                  <td>${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}</td>
                  <td>€ ${eur(b.total_cents)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `
  }));
});

app.get('/admin/automation/operational.json', requireLogin, requirePermission('automation.view'), (req, res) => {
  const data = computeOperationalDashboard(req.query || {});
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(data));
});

app.get('/admin/automation/export.csv', requireLogin, requirePermission('automation.export'), (req, res) => {
  const filters = parseOperationalFilters(req.query || {});
  const operational = computeOperationalDashboard(filters);
  const automationData = ensureAutomationFresh(5) || automationCache;
  const daily = (automationData.summaries && automationData.summaries.daily) || [];
  const weekly = (automationData.summaries && automationData.summaries.weekly) || [];

  const rows = [];
  rows.push(['Secção', 'Referência', 'Valor']);
  const rangeEnd = dayjs(operational.range.end).subtract(1, 'day');
  const rangeLabel = `${operational.range.start} → ${rangeEnd.isValid() ? rangeEnd.format('YYYY-MM-DD') : operational.range.end}`;
  rows.push(['Filtro', 'Período', `${operational.monthLabel} (${rangeLabel})`]);
  if (operational.filters.propertyLabel) {
    rows.push(['Filtro', 'Propriedade', operational.filters.propertyLabel]);
  }
  if (operational.filters.unitType) {
    rows.push(['Filtro', 'Tipo de unidade', operational.filters.unitType]);
  }
  rows.push(['Métrica', 'Unidades analisadas', operational.summary.totalUnits]);
  rows.push([
    'Métrica',
    'Ocupação período (%)',
    Math.round((operational.summary.occupancyRate || 0) * 100)
  ]);
  rows.push(['Métrica', 'Reservas confirmadas', operational.summary.bookingsCount]);
  rows.push([
    'Métrica',
    'Noites ocupadas',
    operational.summary.availableNights
      ? `${operational.summary.occupiedNights}/${operational.summary.availableNights}`
      : 'Sem unidades'
  ]);
  rows.push([
    'Métrica',
    'Média noites/reserva',
    operational.summary.bookingsCount ? operational.summary.averageNights.toFixed(2) : '0.00'
  ]);
  rows.push(['Financeiro', 'Receita período (€)', eur(operational.summary.revenueCents || 0)]);
  if (operational.topUnits.length) {
    operational.topUnits.forEach((unit, idx) => {
      rows.push([
        'Top unidades',
        `${idx + 1}. ${unit.propertyName} · ${unit.unitName}`,
        `${Math.round((unit.occupancyRate || 0) * 100)}% · ${unit.bookingsCount} reservas · € ${eur(unit.revenueCents || 0)}`
      ]);
    });
  } else {
    rows.push(['Top unidades', '—', 'Sem dados para os filtros selecionados.']);
  }

  rows.push(['', '', '']);
  rows.push([
    'Execução',
    'Última automação',
    automationData.lastRun ? dayjs(automationData.lastRun).format('YYYY-MM-DD HH:mm') : '-'
  ]);
  rows.push(['Receita', 'Próximos 7 dias (€)', eur(automationData.revenue ? automationData.revenue.next7 || 0 : 0)]);
  rows.push(['Receita', 'Próximos 30 dias (€)', eur(automationData.revenue ? automationData.revenue.next30 || 0 : 0)]);
  rows.push(['Métrica', 'Check-ins 48h', (automationData.metrics && automationData.metrics.checkins48h) || 0]);
  rows.push(['Métrica', 'Estadias longas', (automationData.metrics && automationData.metrics.longStays) || 0]);
  rows.push([
    'Métrica',
    'Ocupação hoje (%)',
    Math.round(((automationData.metrics && automationData.metrics.occupancyToday) || 0) * 100)
  ]);

  daily.forEach(d => {
    rows.push([
      'Resumo diário',
      `${dayjs(d.date).format('YYYY-MM-DD')}`,
      `${Math.round((d.occupancyRate || 0) * 100)}% · ${d.confirmedCount} confirmadas`
    ]);
  });

  weekly.forEach(w => {
    const endLabel = dayjs(w.end).subtract(1, 'day').format('YYYY-MM-DD');
    rows.push([
      'Resumo semanal',
      `${dayjs(w.start).format('YYYY-MM-DD')} → ${endLabel}`,
      `${Math.round((w.occupancyRate || 0) * 100)}% · ${w.confirmedNights} noites`
    ]);
  });

  const csv = rows
    .map(cols => cols.map(col => `"${String(col ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const filenameParts = [
    'dashboard',
    operational.month || dayjs().format('YYYY-MM')
  ];
  if (operational.filters.propertyLabel) {
    filenameParts.push(`prop-${slugify(operational.filters.propertyLabel)}`);
  } else if (operational.filters.propertyId) {
    filenameParts.push(`prop-${operational.filters.propertyId}`);
  }
  if (operational.filters.unitType) {
    filenameParts.push(`tipo-${slugify(operational.filters.unitType)}`);
  }
  const filenameBase = filenameParts.filter(Boolean).join('_') || 'dashboard';
  const filename = `${filenameBase}.csv`;

  logActivity(req.user.id, 'export:automation_csv', null, null, filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csv);
});

app.post('/admin/properties/create', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const { name, location, description } = req.body;
  db.prepare('INSERT INTO properties(name, location, description) VALUES (?, ?, ?)').run(name, location, description);
  res.redirect('/admin');
});

app.post('/admin/properties/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const id = req.params.id;
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
  if (!property) return res.status(404).send('Propriedade não encontrada');
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  res.redirect('/admin');
});

app.get('/admin/properties/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Propriedade não encontrada');

  const units = db.prepare('SELECT * FROM units WHERE property_id = ? ORDER BY name').all(p.id);
  const bookings = db.prepare(
    `SELECT b.*, u.name as unit_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
      WHERE u.property_id = ?
      ORDER BY b.checkin`
  ).all(p.id);

  const theme = resolveBrandingForRequest(req, { propertyId: p.id, propertyName: p.name });
  rememberActiveBrandingProperty(res, p.id);

  res.send(layout({
    title: p.name,
    user: req.user,
    activeNav: 'backoffice',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">${esc(p.name)}</h1>
          <p class="text-slate-600 mt-1">${esc(p.location||'')}</p>
        </div>
        <form method="post" action="/admin/properties/${p.id}/delete" class="shrink-0" onsubmit="return confirm('Tem a certeza que quer eliminar esta propriedade? Isto remove unidades e reservas associadas.');">
          <button type="submit" class="text-rose-600 hover:text-rose-800 underline">Eliminar propriedade</button>
        </form>
      </div>
      <h2 class="font-semibold mb-2">Unidades</h2>
      <ul class="mb-6">
        ${units.map(u => `<li><a class="text-slate-700 underline" href="/admin/units/${u.id}">${esc(u.name)}</a> (cap ${u.capacity})</li>`).join('')}
      </ul>

      <h2 class="font-semibold mb-2">Reservas</h2>
      <ul class="space-y-1">
        ${bookings.length ? bookings.map(b => `
          <li>${esc(b.unit_name)}: ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')} · ${esc(b.guest_name)} (${b.adults}A+${b.children}C)</li>
        `).join('') : '<em>Sem reservas</em>'}
      </ul>
    `
  }));
});

app.post('/admin/units/create', requireLogin, requirePermission('properties.manage'), (req, res) => {
  let { property_id, name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  db.prepare('INSERT INTO units(property_id, name, capacity, base_price_cents, features) VALUES (?, ?, ?, ?, ?)')
    .run(property_id, name, Number(capacity), cents, JSON.stringify(features));
  res.redirect('/admin');
});

app.get('/admin/units/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const u = db.prepare(
    `SELECT u.*, p.name as property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.id = ?`
  ).get(req.params.id);
  if (!u) return res.status(404).send('Unidade não encontrada');

  const unitFeatures = parseFeaturesStored(u.features);
  const unitFeaturesTextarea = esc(featuresToTextarea(unitFeatures));
  const unitFeaturesPreview = featureChipsHtml(unitFeatures, {
    className: 'flex flex-wrap gap-2 text-xs text-slate-600 mb-3',
    badgeClass: 'inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2 py-1 rounded-full',
    iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
  });
  const bookings = db.prepare('SELECT * FROM bookings WHERE unit_id = ? ORDER BY checkin').all(u.id);
  const blocks = db.prepare('SELECT * FROM blocks WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const rates = db.prepare('SELECT * FROM rates WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const images = db.prepare(
    'SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id'
  ).all(u.id);

  const theme = resolveBrandingForRequest(req, { propertyId: u.property_id, propertyName: u.property_name });
  rememberActiveBrandingProperty(res, u.property_id);

  res.send(layout({
    title: `${esc(u.property_name)} – ${esc(u.name)}`,
    user: req.user,
    activeNav: 'backoffice',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mb-4">${esc(u.property_name)} - ${esc(u.name)}</h1>
      ${unitFeaturesPreview}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section class="card p-4 md:col-span-2">
          <h2 class="font-semibold mb-3">Reservas</h2>
          <ul class="space-y-1 mb-4">
            ${bookings.length ? bookings.map(b => `
              <li class="flex items-center justify-between gap-3" title="${esc(b.guest_name||'')}">
                <div>
                  ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}
                  - <strong>${esc(b.guest_name)}</strong> ${b.agency ? `[${esc(b.agency)}]` : ''} (${b.adults}A+${b.children}C)
                  <span class="text-slate-500">(&euro; ${eur(b.total_cents)})</span>
                  <span class="ml-2 text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                    ${b.status}
                  </span>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <a class="text-slate-600 hover:text-slate-900 underline" href="/admin/bookings/${b.id}">Editar</a>
                  <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                    <button class="text-rose-600">Cancelar</button>
                  </form>
                </div>
              </li>
            `).join('') : '<em>Sem reservas</em>'}
          </ul>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form method="post" action="/admin/units/${u.id}/block" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Bloquear datas</div>
              <div class="flex gap-2">
                <input required type="date" name="start_date" class="input"/>
                <input required type="date" name="end_date" class="input"/>
              </div>
              <button class="btn btn-primary">Bloquear</button>
            </form>

            <form method="post" action="/admin/units/${u.id}/rates/create" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Adicionar rate</div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">De</label>
                  <input required type="date" name="start_date" class="input"/>
                </div>
                <div>
                  <label class="text-sm">Até</label>
                  <input required type="date" name="end_date" class="input"/>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">€/noite</label>
                  <input required type="number" step="0.01" min="0" name="price_eur" class="input" placeholder="Preço €/noite"/>
                </div>
                <div>
                  <label class="text-sm">Mín. noites</label>
                  <input type="number" min="1" name="min_stay" class="input" placeholder="Mínimo de noites"/>
                </div>
              </div>
              <button class="btn btn-primary">Guardar rate</button>
            </form>
          </div>

          ${blocks.length ? `
            <div class="mt-6">
              <h3 class="font-semibold mb-2">Bloqueios ativos</h3>
              <ul class="space-y-2">
                ${blocks.map(block => `
                  <li class="flex items-center justify-between text-sm">
                    <span>${dayjs(block.start_date).format('DD/MM/YYYY')} &rarr; ${dayjs(block.end_date).format('DD/MM/YYYY')}</span>
                    <form method="post" action="/admin/blocks/${block.id}/delete" onsubmit="return confirm('Desbloquear estas datas?');">
                      <button class="text-rose-600">Desbloquear</button>
                    </form>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </section>

        <section class="card p-4">
          <h2 class="font-semibold mb-3">Editar Unidade</h2>
          <form method="post" action="/admin/units/${u.id}/update" class="grid gap-2">
            <label class="text-sm">Nome</label>
            <input name="name" class="input" value="${esc(u.name)}"/>

            <label class="text-sm">Capacidade</label>
            <input type="number" min="1" name="capacity" class="input" value="${u.capacity}"/>

            <label class="text-sm">Preço base €/noite</label>
            <input type="number" step="0.01" name="base_price_eur" class="input" value="${eur(u.base_price_cents)}"/>

            <label class="text-sm">Características</label>
            <textarea name="features_raw" rows="6" class="input">${unitFeaturesTextarea}</textarea>
            <div class="text-xs text-slate-500">Uma por linha no formato <code>icon|texto</code> ou apenas o ícone. Ícones: ${FEATURE_ICON_KEYS.join(', ')}.</div>

            <button class="btn btn-primary">Guardar</button>
          </form>

          <h2 class="font-semibold mt-6 mb-2">Rates</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th>De</th><th>Até</th><th>€/noite (weekday)</th><th>€/noite (weekend)</th><th>Mín</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${rates.map(r => `
                  <tr class="border-t">
                    <td>${dayjs(r.start_date).format('DD/MM/YYYY')}</td>
                    <td>${dayjs(r.end_date).format('DD/MM/YYYY')}</td>
                    <td>€ ${eur(r.weekday_price_cents)}</td>
                    <td>€ ${eur(r.weekend_price_cents)}</td>
                    <td>${r.min_stay || 1}</td>
                    <td>
                      <form method="post" action="/admin/rates/${r.id}/delete" onsubmit="return confirm('Apagar rate?');">
                        <button class="text-rose-600">Apagar</button>
                      </form>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <h2 class="font-semibold mt-6 mb-2">Galeria</h2>
          <form method="post" action="/admin/units/${u.id}/images" enctype="multipart/form-data" class="grid gap-2 bg-slate-50 p-3 rounded">
            <input type="hidden" name="unit_id" value="${u.id}"/>
            <input type="file" name="images" class="input" accept="image/*" multiple required />
            <div class="text-xs text-slate-500">As imagens são comprimidas e redimensionadas automaticamente para otimizar o carregamento.</div>
            <button class="btn btn-primary">Carregar imagens</button>
          </form>
          <div class="mt-4 space-y-3" data-gallery-manager data-unit-id="${u.id}">
            <div class="gallery-flash" data-gallery-flash hidden></div>
            <div class="gallery-grid ${images.length ? '' : 'hidden'}" data-gallery-list>
              ${images.map(img => `
                <article class="gallery-tile${img.is_primary ? ' is-primary' : ''}" data-gallery-tile data-image-id="${img.id}" draggable="true" tabindex="0">
                  <span class="gallery-tile__badge">Principal</span>
                  <img src="/uploads/units/${u.id}/${encodeURIComponent(img.file)}" alt="${esc(img.alt||'')}" loading="lazy" class="gallery-tile__img"/>
                  <div class="gallery-tile__overlay">
                    <div class="gallery-tile__hint">Arraste para reordenar</div>
                    <div class="gallery-tile__meta">
                      <span>${dayjs(img.created_at).format('DD/MM/YYYY')}</span>
                    </div>
                    <div class="gallery-tile__actions">
                      <button type="button" class="btn btn-light" data-gallery-action="primary" ${img.is_primary ? 'disabled' : ''}>${img.is_primary ? 'Em destaque' : 'Tornar destaque'}</button>
                      <button type="button" class="btn btn-danger" data-gallery-action="delete">Remover</button>
                    </div>
                  </div>
                </article>
              `).join('')}
            </div>
            <div class="gallery-empty ${images.length ? 'hidden' : ''}" data-gallery-empty>
              <p class="text-sm text-slate-500">Ainda não existem imagens carregadas para esta unidade.</p>
            </div>
          </div>
        </section>
      </div>

      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const manager = document.querySelector('[data-gallery-manager]');
          if (!manager) return;
          const list = manager.querySelector('[data-gallery-list]');
          const emptyState = manager.querySelector('[data-gallery-empty]');
          const flash = manager.querySelector('[data-gallery-flash]');
          const unitId = manager.getAttribute('data-unit-id');
          let flashTimer = null;
          let dragItem = null;
          let lastOrderKey = list
            ? JSON.stringify(Array.from(list.querySelectorAll('[data-gallery-tile]')).map(el => el.dataset.imageId))
            : '[]';

          function showFlash(message, variant) {
            if (!flash) return;
            flash.textContent = message;
            flash.setAttribute('data-variant', variant || 'info');
            flash.hidden = false;
            if (flashTimer) window.clearTimeout(flashTimer);
            flashTimer = window.setTimeout(() => { flash.hidden = true; }, 2600);
          }

          function syncEmpty() {
            if (!list || !emptyState) return;
            const isEmpty = list.querySelectorAll('[data-gallery-tile]').length === 0;
            list.classList.toggle('hidden', isEmpty);
            emptyState.classList.toggle('hidden', !isEmpty);
          }

          function refreshOrderKey() {
            if (!list) {
              lastOrderKey = '[]';
              return lastOrderKey;
            }
            lastOrderKey = JSON.stringify(Array.from(list.querySelectorAll('[data-gallery-tile]')).map(el => el.dataset.imageId));
            return lastOrderKey;
          }

          function updatePrimary(id) {
            if (!list) return;
            const tiles = list.querySelectorAll('[data-gallery-tile]');
            tiles.forEach(tile => {
              const btn = tile.querySelector('[data-gallery-action="primary"]');
              const isPrimary = tile.dataset.imageId === String(id);
              tile.classList.toggle('is-primary', isPrimary);
              if (btn) {
                btn.disabled = isPrimary;
                btn.textContent = isPrimary ? 'Em destaque' : 'Tornar destaque';
              }
            });
          }

          function request(url, options) {
            const baseHeaders = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
            const merged = Object.assign({}, options || {});
            merged.headers = Object.assign({}, baseHeaders, merged.headers || {});
            return fetch(url, merged).then(resp => {
              if (!resp.ok) {
                return resp.json().catch(() => ({})).then(data => {
                  const message = data && data.message ? data.message : 'Ocorreu um erro inesperado.';
                  throw new Error(message);
                });
              }
              return resp.json().catch(() => ({}));
            });
          }

          function persistOrder() {
            if (!list) return;
            const tiles = Array.from(list.querySelectorAll('[data-gallery-tile]'));
            if (!tiles.length) {
              refreshOrderKey();
              return;
            }
            const payload = tiles.map((tile, index) => ({ id: Number(tile.dataset.imageId), position: index + 1 }));
            const key = JSON.stringify(payload.map(item => item.id));
            if (key === lastOrderKey) return;
            lastOrderKey = key;
            request('/admin/units/' + unitId + '/images/reorder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: payload })
            })
              .then(data => {
                refreshOrderKey();
                showFlash(data && data.message ? data.message : 'Ordem atualizada.', 'success');
                if (data && data.primaryId) updatePrimary(data.primaryId);
              })
              .catch(err => {
                refreshOrderKey();
                showFlash(err.message || 'Não foi possível atualizar a ordem.', 'danger');
              });
          }

          if (list) {
            list.addEventListener('dragstart', event => {
              const tile = event.target.closest('[data-gallery-tile]');
              if (!tile) return;
              dragItem = tile;
              tile.classList.add('dragging');
              event.dataTransfer.effectAllowed = 'move';
              try { event.dataTransfer.setData('text/plain', tile.dataset.imageId); } catch (_) {}
            });

            list.addEventListener('dragover', event => {
              if (!dragItem) return;
              event.preventDefault();
              const target = event.target.closest('[data-gallery-tile]');
              if (!target || target === dragItem) return;
              const rect = target.getBoundingClientRect();
              const after = (event.clientY - rect.top) > rect.height / 2 || (event.clientX - rect.left) > rect.width / 2;
              if (after) {
                target.after(dragItem);
              } else {
                target.before(dragItem);
              }
            });

            list.addEventListener('drop', event => {
              if (!dragItem) return;
              event.preventDefault();
            });

            list.addEventListener('dragend', () => {
              if (!dragItem) return;
              dragItem.classList.remove('dragging');
              dragItem = null;
              syncEmpty();
              persistOrder();
            });
          }

          manager.addEventListener('click', event => {
            const actionBtn = event.target.closest('[data-gallery-action]');
            if (!actionBtn) return;
            const tile = actionBtn.closest('[data-gallery-tile]');
            if (!tile) return;
            const imageId = tile.dataset.imageId;
            const action = actionBtn.getAttribute('data-gallery-action');
            if (action === 'delete') {
              if (!window.confirm('Remover esta imagem da galeria?')) return;
              actionBtn.disabled = true;
              request('/admin/images/' + imageId + '/delete', { method: 'POST' })
                .then(data => {
                  tile.remove();
                  syncEmpty();
                  refreshOrderKey();
                  showFlash(data && data.message ? data.message : 'Imagem removida.', 'info');
                  if (data && data.primaryId) updatePrimary(data.primaryId);
                })
                .catch(err => {
                  actionBtn.disabled = false;
                  showFlash(err.message || 'Não foi possível remover a imagem.', 'danger');
                });
            } else if (action === 'primary') {
              actionBtn.disabled = true;
              request('/admin/images/' + imageId + '/primary', { method: 'POST' })
                .then(data => {
                  updatePrimary(imageId);
                  showFlash(data && data.message ? data.message : 'Imagem definida como destaque.', 'success');
                })
                .catch(err => {
                  actionBtn.disabled = false;
                  showFlash(err.message || 'Não foi possível atualizar a imagem.', 'danger');
                });
            }
          });

          syncEmpty();
        });
      </script>
    `
  }));
});

app.post('/admin/units/:id/update', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const { name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  db.prepare('UPDATE units SET name = ?, capacity = ?, base_price_cents = ?, features = ? WHERE id = ?')
    .run(name, Number(capacity), cents, JSON.stringify(features), req.params.id);
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/units/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

app.post('/admin/units/:id/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
  const { start_date, end_date } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');

  const conflicts = db.prepare(
    `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
      AND NOT (checkout <= ? OR checkin >= ?)`
  ).all(req.params.id, start_date, end_date);
  if (conflicts.length)
    return res.status(409).send('As datas incluem reservas existentes');

  const inserted = insertBlockStmt.run(req.params.id, start_date, end_date);
  logChange(req.user.id, 'block', inserted.lastInsertRowid, 'create', null, { start_date, end_date, unit_id: Number(req.params.id) });
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/blocks/:blockId/delete', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
  const block = db.prepare('SELECT unit_id, start_date, end_date FROM blocks WHERE id = ?').get(req.params.blockId);
  if (!block) return res.status(404).send('Bloqueio não encontrado');
  db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.blockId);
  logChange(req.user.id, 'block', Number(req.params.blockId), 'delete', {
    unit_id: block.unit_id,
    start_date: block.start_date,
    end_date: block.end_date
  }, null);
  res.redirect(`/admin/units/${block.unit_id}`);
});

app.post('/admin/units/:id/rates/create', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const { start_date, end_date, price_eur, min_stay } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');
  const price_cents = Math.round(parseFloat(String(price_eur || '0').replace(',', '.')) * 100);
  if (!(price_cents >= 0)) return res.status(400).send('Preço inválido');
  db.prepare(
    'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
  ).run(req.params.id, start_date, end_date, price_cents, price_cents, min_stay ? Number(min_stay) : 1);
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/rates/:rateId/delete', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const r = db.prepare('SELECT unit_id FROM rates WHERE id = ?').get(req.params.rateId);
  if (!r) return res.status(404).send('Rate não encontrada');
  db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
  res.redirect(`/admin/units/${r.unit_id}`);
});

// Imagens
app.post('/admin/units/:id/images', requireLogin, requirePermission('gallery.manage'), upload.array('images', 24), async (req, res) => {
  const unitId = Number(req.params.id);
  const files = req.files || [];
  if (!files.length) {
    if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Nenhum ficheiro recebido.' });
    return res.redirect(`/admin/units/${unitId}`);
  }

  const insert = db.prepare('INSERT INTO unit_images(unit_id,file,alt,position) VALUES (?,?,?,?)');
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) as p FROM unit_images WHERE unit_id = ?').get(unitId).p;
  const existingPrimary = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);
  const insertedIds = [];

  try {
    for (const file of files) {
      const filePath = path.join(UPLOAD_UNITS, String(unitId), file.filename);
      await compressImage(filePath);
      const inserted = insert.run(unitId, file.filename, null, ++pos);
      insertedIds.push(inserted.lastInsertRowid);
    }

    if (!existingPrimary && insertedIds.length) {
      const primaryId = insertedIds[0];
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        primaryId,
        unitId
      );
    }

    if (wantsJson(req)) {
      const rows = db
        .prepare('SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id')
        .all(unitId);
      return res.json({ ok: true, images: rows, primaryId: rows.find(img => img.is_primary)?.id || null });
    }

    res.redirect(`/admin/units/${unitId}`);
  } catch (err) {
    console.error('Falha ao processar upload de imagens', err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: 'Não foi possível guardar as imagens. Tente novamente.' });
    }
    res.status(500).send('Não foi possível guardar as imagens.');
  }
});

app.post('/admin/images/:imageId/delete', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  const filePath = path.join(UPLOAD_UNITS, String(img.unit_id), img.file);
  db.prepare('DELETE FROM unit_images WHERE id = ?').run(img.id);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) { console.warn('Não foi possível remover ficheiro físico', err.message); }
  }

  let nextPrimaryId = null;
  if (img.is_primary) {
    const fallback = db
      .prepare(
        'SELECT id FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 1'
      )
      .get(img.unit_id);
    if (fallback) {
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        fallback.id,
        img.unit_id
      );
      nextPrimaryId = fallback.id;
    }
  }

  if (wantsJson(req)) {
    return res.json({ ok: true, message: 'Imagem removida.', primaryId: nextPrimaryId });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/images/:imageId/primary', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
    img.id,
    img.unit_id
  );

  if (wantsJson(req)) {
    return res.json({ ok: true, primaryId: img.id, message: 'Imagem definida como destaque.' });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/units/:id/images/reorder', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const unitId = Number(req.params.id);
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const ids = order
    .map(item => ({ id: Number(item.id), position: Number(item.position) }))
    .filter(item => item.id && item.position);

  if (!ids.length) {
    return res.json({ ok: true, message: 'Nada para atualizar.', primaryId: null });
  }

  const existingIds = new Set(
    db
      .prepare('SELECT id FROM unit_images WHERE unit_id = ?')
      .all(unitId)
      .map(row => row.id)
  );

  const updates = ids.filter(item => existingIds.has(item.id));
  const updateStmt = db.prepare('UPDATE unit_images SET position = ? WHERE id = ? AND unit_id = ?');
  const runUpdates = db.transaction(items => {
    items.forEach(item => {
      updateStmt.run(item.position, item.id, unitId);
    });
  });

  runUpdates(updates);

  const primaryRow = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);

  res.json({ ok: true, message: 'Ordem atualizada.', primaryId: primaryRow ? primaryRow.id : null });
});

// ===================== Booking Management (Admin) =====================
app.get('/admin/bookings', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim(); // '', CONFIRMED, PENDING
  const ym = String(req.query.ym || '').trim();         // YYYY-MM opcional

  const where = [];
  const args = [];

  if (q) {
    where.push(`(b.guest_name LIKE ? OR b.guest_email LIKE ? OR u.name LIKE ? OR p.name LIKE ? OR b.agency LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`b.status = ?`);
    args.push(status);
  }
  if (/^\d{4}-\d{2}$/.test(ym)) {
    const startYM = `${ym}-01`;
    const endYM = dayjs(startYM).endOf('month').add(1, 'day').format('YYYY-MM-DD'); // exclusivo
    where.push(`NOT (b.checkout <= ? OR b.checkin >= ?)`);
    args.push(startYM, endYM);
  }

  const sql = `
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.checkin DESC, b.created_at DESC
      LIMIT 500
  `;
  const rows = db.prepare(sql).all(...args);

  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');

  res.send(layout({
    title: 'Reservas',
    user: req.user,
    activeNav: 'bookings',
    branding: resolveBrandingForRequest(req),
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Reservas</h1>

      <form method="get" class="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <input class="input md:col-span-2" name="q" placeholder="Procurar por hóspede, email, unidade, propriedade" value="${esc(q)}"/>
        <select class="input" name="status">
          <option value="">Todos os estados</option>
          <option value="CONFIRMED" ${status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
          <option value="PENDING" ${status==='PENDING'?'selected':''}>PENDING</option>
        </select>
        <input class="input" type="month" name="ym" value="${/^\d{4}-\d{2}$/.test(ym)?ym:''}"/>
        <button class="btn btn-primary">Filtrar</button>
      </form>

      <div class="card p-0 overflow-x-auto">
        <table class="w-full min-w-[980px] text-sm">
          <thead>
            <tr class="text-left text-slate-500">
              <th>Check-in</th><th>Check-out</th><th>Propriedade/Unidade</th><th>Agência</th><th>Hóspede</th><th>Ocup.</th><th>Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(b => `
              <tr class="border-t">
                <td>${dayjs(b.checkin).format('DD/MM/YYYY')}</td>
                <td>${dayjs(b.checkout).format('DD/MM/YYYY')}</td>
                <td>${esc(b.property_name)} - ${esc(b.unit_name)}</td>
                <td>${esc(b.agency || '')}</td>
                <td>${esc(b.guest_name)} <span class="text-slate-500">(${esc(b.guest_email)})</span></td>
                <td>${b.adults}A+${b.children}C</td>
                <td>€ ${eur(b.total_cents)}</td>
                <td>
                  <span class="text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                    ${b.status}
                  </span>
                </td>
                <td class="whitespace-nowrap">
                  <a class="underline" href="/admin/bookings/${b.id}">${canEditBooking ? 'Editar' : 'Ver'}</a>
                  ${canCancelBooking ? `
                    <form method="post" action="/admin/bookings/${b.id}/cancel" style="display:inline" onsubmit="return confirm('Cancelar esta reserva?');">
                      <button class="text-rose-600 ml-2">Cancelar</button>
                    </form>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length===0?'<div class="p-4 text-slate-500">Sem resultados.</div>':''}
      </div>
    `
  }));
});

app.get('/admin/bookings/:id', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, u.property_id, p.name as property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');
  const canAddNote = userCan(req.user, 'bookings.notes');
  const bookingNotes = db.prepare(`
    SELECT bn.id, bn.note, bn.created_at, u.username
      FROM booking_notes bn
      JOIN users u ON u.id = bn.user_id
     WHERE bn.booking_id = ?
     ORDER BY bn.created_at DESC
  `).all(b.id).map(n => ({
    ...n,
    created_human: dayjs(n.created_at).format('DD/MM/YYYY HH:mm')
  }));

  const theme = resolveBrandingForRequest(req, { propertyId: b.property_id, propertyName: b.property_name });
  rememberActiveBrandingProperty(res, b.property_id);

  res.send(layout({
    title: `Editar reserva #${b.id}`,
    user: req.user,
    activeNav: 'bookings',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin/bookings">&larr; Reservas</a>
      <h1 class="text-2xl font-semibold mb-4">Editar reserva #${b.id}</h1>

      <div class="card p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div class="text-sm text-slate-500">${esc(b.property_name)}</div>
          <div class="font-semibold mb-3">${esc(b.unit_name)}</div>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Atual: ${dayjs(b.checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
            <li>Ocupação: ${b.adults}A+${b.children}C (cap. ${b.capacity})</li>
            <li>Total atual: € ${eur(b.total_cents)}</li>
          </ul>
          ${b.internal_notes ? `
            <div class="mt-4">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Anotacoes internas</div>
              <div class="text-sm text-slate-700 whitespace-pre-line">${esc(b.internal_notes)}</div>
            </div>
          ` : ''}
        </div>

        <form method="post" action="/admin/bookings/${b.id}/update" class="grid gap-3" id="booking-update-form">
          <fieldset class="grid gap-3" ${canEditBooking ? '' : 'disabled'}>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Check-in</label>
                <input required type="date" name="checkin" class="input" value="${b.checkin}"/>
              </div>
              <div>
                <label class="text-sm">Check-out</label>
                <input required type="date" name="checkout" class="input" value="${b.checkout}"/>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Adultos</label>
                <input required type="number" min="1" name="adults" class="input" value="${b.adults}"/>
              </div>
              <div>
                <label class="text-sm">Crianças</label>
                <input required type="number" min="0" name="children" class="input" value="${b.children}"/>
              </div>
            </div>

            <input class="input" name="guest_name" value="${esc(b.guest_name)}" placeholder="Nome do hóspede" required />
            <input class="input" type="email" name="guest_email" value="${esc(b.guest_email)}" placeholder="Email" required />
            <input class="input" name="guest_phone" value="${esc(b.guest_phone || '')}" placeholder="Telefone" />
            <input class="input" name="guest_nationality" value="${esc(b.guest_nationality || '')}" placeholder="Nacionalidade" />
            <div>
              <label class="text-sm">Agência</label>
              <input class="input" name="agency" value="${esc(b.agency || '')}" placeholder="Ex: BOOKING" />
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Anotações internas</label>
              <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas (apenas equipa)">${esc(b.internal_notes || '')}</textarea>
              <p class="text-xs text-slate-500">Não aparece para o hóspede.</p>
            </div>

            <div>
              <label class="text-sm">Estado</label>
              <select name="status" class="input">
                <option value="CONFIRMED" ${b.status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
                <option value="PENDING" ${b.status==='PENDING'?'selected':''}>PENDING</option>
              </select>
            </div>

            <button class="btn btn-primary justify-self-start">Guardar alterações</button>
          </fieldset>
          ${canEditBooking ? '' : '<p class="text-xs text-slate-500">Sem permissões para editar esta reserva.</p>'}
        </form>
        ${canCancelBooking ? `
          <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');" class="self-end">
            <button class="btn btn-danger mt-2">Cancelar reserva</button>
          </form>
        ` : ''}
        <section class="md:col-span-2 card p-4" id="notes">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">Notas internas</h2>
            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">${bookingNotes.length} nota${bookingNotes.length === 1 ? '' : 's'}</span>
          </div>
          <div class="mt-3 space-y-3">
            ${bookingNotes.length ? bookingNotes.map(n => `
              <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div class="text-xs text-slate-500 mb-1">${esc(n.username)} &middot; ${esc(n.created_human)}</div>
                <div class="text-sm text-slate-700 whitespace-pre-line">${esc(n.note)}</div>
              </article>
            `).join('') : '<p class="text-sm text-slate-500">Sem notas adicionadas pela equipa.</p>'}
          </div>
          ${canAddNote ? `
            <form method="post" action="/admin/bookings/${b.id}/notes" class="mt-4 grid gap-2">
              <label class="text-sm" for="note">Adicionar nova nota</label>
              <textarea class="input" id="note" name="note" rows="3" placeholder="Partilhe contexto para a equipa" required></textarea>
              <button class="btn btn-primary justify-self-start">Gravar nota</button>
            </form>
          ` : '<p class="text-xs text-slate-500 mt-4">Sem permissões para adicionar novas notas.</p>'}
        </section>
      </div>
    `
  }));
});

app.post('/admin/bookings/:id/update', requireLogin, requirePermission('bookings.edit'), (req, res) => {
  const id = req.params.id;
  const b = db.prepare(`
    SELECT b.*, u.capacity, u.base_price_cents
      FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.id = ?
  `).get(id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const checkin = req.body.checkin;
  const checkout = req.body.checkout;
  const internalNotesRaw = req.body.internal_notes;
  const internal_notes = typeof internalNotesRaw === 'string' ? internalNotesRaw.trim() || null : null;
  const adults = Math.max(1, Number(req.body.adults || 1));
  const children = Math.max(0, Number(req.body.children || 0));
  let status = (req.body.status || 'CONFIRMED').toUpperCase();
  if (!['CONFIRMED','PENDING'].includes(status)) status = 'CONFIRMED';
  const guest_name = req.body.guest_name;
  const guest_email = req.body.guest_email;
  const guest_phone = req.body.guest_phone || null;
  const guest_nationality = req.body.guest_nationality || null;
  const agency = req.body.agency ? String(req.body.agency).trim().toUpperCase() : null;

  if (!dayjs(checkout).isAfter(dayjs(checkin))) return res.status(400).send('checkout deve ser > checkin');
  if (adults + children > b.capacity) return res.status(400).send(`Capacidade excedida (máx ${b.capacity}).`);

  const conflict = db.prepare(`
    SELECT 1 FROM bookings 
     WHERE unit_id = ? 
       AND id <> ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(b.unit_id, id, checkin, checkout);
  if (conflict) return res.status(409).send('Conflito com outra reserva.');

  const q = rateQuote(b.unit_id, checkin, checkout, b.base_price_cents);
  if (q.nights < q.minStayReq) return res.status(400).send(`Estadia mínima: ${q.minStayReq} noites`);

  adminBookingUpdateStmt.run(
    checkin,
    checkout,
    adults,
    children,
    guest_name,
    guest_email,
    guest_phone,
    guest_nationality,
    agency,
    internal_notes,
    status,
    q.total_cents,
    id
  );

  logChange(req.user.id, 'booking', Number(id), 'update',
    {
      checkin: b.checkin,
      checkout: b.checkout,
      adults: b.adults,
      children: b.children,
      status: b.status,
      total_cents: b.total_cents
    },
    { checkin, checkout, adults, children, status, total_cents: q.total_cents }
  );

  res.redirect(`/admin/bookings/${id}`);
});

app.post('/admin/bookings/:id/notes', requireLogin, requirePermission('bookings.notes'), (req, res) => {
  const bookingId = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  if (!exists) return res.status(404).send('Reserva não encontrada');
  const noteRaw = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!noteRaw) return res.status(400).send('Nota obrigatória.');
  db.prepare('INSERT INTO booking_notes(booking_id, user_id, note) VALUES (?,?,?)').run(bookingId, req.user.id, noteRaw);
  logActivity(req.user.id, 'booking:note_add', 'booking', bookingId, { snippet: noteRaw.slice(0, 200) });
  res.redirect(`/admin/bookings/${bookingId}#notes`);
});

app.post('/admin/bookings/:id/cancel', requireLogin, requirePermission('bookings.cancel'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).send('Reserva não encontrada');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  logChange(req.user.id, 'booking', Number(id), 'cancel', {
    checkin: existing.checkin,
    checkout: existing.checkout,
    guest_name: existing.guest_name,
    status: existing.status,
    unit_id: existing.unit_id
  }, null);
  const back = req.get('referer') || '/admin/bookings';
  res.redirect(back);
});

// (Opcional) Apagar definitivamente
app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (existing) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    logChange(req.user.id, 'booking', Number(req.params.id), 'delete', {
      checkin: existing.checkin,
      checkout: existing.checkout,
      unit_id: existing.unit_id,
      guest_name: existing.guest_name
    }, null);
  }
  res.redirect('/admin/bookings');
});


app.get('/admin/identidade-visual', requireAdmin, (req, res) => {
  const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
  const propertyQuery = parsePropertyId(req.query ? (req.query.property_id ?? req.query.propertyId ?? null) : null);
  const propertyId = propertyQuery || null;
  const propertyRow = propertyId ? properties.find(p => p.id === propertyId) || null : null;
  const theme = resolveBrandingForRequest(req, { propertyId, propertyName: propertyRow ? propertyRow.name : null });
  if (propertyQuery !== null) rememberActiveBrandingProperty(res, propertyId);

  const globalThemeRaw = brandingStore.global || {};
  const propertyThemeRaw = propertyId ? (brandingStore.properties[propertyId] || {}) : {};
  const formMode = propertyThemeRaw.mode || globalThemeRaw.mode || 'quick';
  const formCorner = propertyThemeRaw.cornerStyle || globalThemeRaw.cornerStyle || 'rounded';
  const formBrandName = propertyThemeRaw.brandName ?? globalThemeRaw.brandName ?? theme.brandName;
  const formInitials = propertyThemeRaw.brandInitials ?? globalThemeRaw.brandInitials ?? '';
  const formTagline = propertyThemeRaw.tagline ?? globalThemeRaw.tagline ?? '';
  const formPrimary = propertyThemeRaw.primaryColor ?? globalThemeRaw.primaryColor ?? theme.primaryColor;
  const formSecondary = propertyThemeRaw.secondaryColor ?? globalThemeRaw.secondaryColor ?? theme.secondaryColor;
  const formHighlight = propertyThemeRaw.highlightColor ?? globalThemeRaw.highlightColor ?? theme.highlightColor;
  const formLogoAlt = propertyThemeRaw.logoAlt ?? globalThemeRaw.logoAlt ?? theme.logoAlt;
  const logoPath = theme.logoPath;
  const successKey = typeof req.query.success === 'string' ? req.query.success : '';
  const errorMessage = typeof req.query.error === 'string' ? req.query.error : '';
  const successMessage = (() => {
    switch (successKey) {
      case 'saved':
      case '1':
        return 'Preferências guardadas. O tema foi atualizado em todo o portal.';
      case 'reset': return 'Tema reposto aos valores padrão.';
      case 'template': return 'Tema personalizado guardado para reutilização futura.';
      case 'applied': return 'Tema personalizado aplicado com sucesso.';
      case 'deleted': return 'Tema personalizado removido.';
      case 'logo_removed': return 'Logotipo removido. Será utilizada a sigla da marca.';
      default: return '';
    }
  })();
  const savedThemes = brandingStore.savedThemes || [];
  const propertyLabel = propertyRow ? propertyRow.name : 'tema global';

  res.send(layout({
    title: 'Identidade visual',
    user: req.user,
    activeNav: 'branding',
    branding: theme,
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mt-2">Identidade visual</h1>
      <p class="text-slate-600 mb-4">Personalize cores, logotipo e mensagens para garantir consistência entre frontoffice e backoffice em cada propriedade.</p>

      <form method="get" class="card p-4 mb-4 flex flex-wrap gap-3 items-end max-w-xl">
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Propriedade ativa</span>
          <select class="input" name="property_id" onchange="this.form.submit()">
            <option value="" ${!propertyId ? 'selected' : ''}>Tema global (aplicado por defeito)</option>
            ${properties.map(p => `<option value="${p.id}" ${propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
        <p class="text-xs text-slate-500 max-w-sm">Ao selecionar uma propriedade pode definir um tema próprio. Sem seleção, edita o tema global partilhado.</p>
      </form>

      ${successMessage ? `
        <div class="inline-feedback mb-4" data-variant="success">
          <span class="inline-feedback-icon">✓</span>
          <div>${esc(successMessage)}</div>
        </div>
      ` : ''}
      ${errorMessage ? `
        <div class="inline-feedback mb-4" data-variant="danger">
          <span class="inline-feedback-icon">!</span>
          <div>${esc(errorMessage)}</div>
        </div>
      ` : ''}

      <div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <form method="post" action="/admin/identidade-visual" enctype="multipart/form-data" class="card p-4 grid gap-4">
          <input type="hidden" name="property_id" value="${propertyId || ''}" />
          <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold text-slate-800">Configurar ${esc(propertyLabel)}</h2>
            <p class="text-sm text-slate-500">Definições guardadas são aplicadas imediatamente ao frontoffice e backoffice da seleção atual.</p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="grid gap-2 text-sm text-slate-600">
              <span>Nome da marca</span>
              <input class="input" name="brand_name" value="${esc(formBrandName)}" maxlength="80" required />
            </label>
            <label class="grid gap-2 text-sm text-slate-600">
              <span>Sigla do logotipo</span>
              <input class="input" name="brand_initials" value="${esc(formInitials)}" maxlength="3" placeholder="Ex: GA" />
              <span class="text-xs text-slate-500">Utilizada quando não existe imagem carregada.</span>
            </label>
          </div>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Slogan / mensagem de apoio</span>
            <input class="input" name="tagline" value="${esc(formTagline)}" maxlength="140" placeholder="Ex: Reservas com confiança" />
            <span class="text-xs text-slate-500">Deixe em branco para usar o texto padrão.</span>
          </label>

          <fieldset class="grid gap-3">
            <legend class="text-sm font-semibold text-slate-600">Paleta de cores</legend>
            <div class="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="mode" value="quick" ${formMode !== 'manual' ? 'checked' : ''} data-mode-toggle />
                Modo rápido (gerar automaticamente tons derivados)
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="mode" value="manual" ${formMode === 'manual' ? 'checked' : ''} data-mode-toggle />
                Avançado (definir todas as cores manualmente)
              </label>
            </div>
            <div class="grid gap-4 md:grid-cols-3">
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor primária</span>
                <input class="input" type="color" name="primary_color" value="${esc(formPrimary)}" data-theme-input />
              </label>
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor secundária</span>
                <input class="input" type="color" name="secondary_color" value="${esc(formSecondary)}" data-theme-input data-manual-color ${formMode === 'manual' ? '' : 'disabled'} />
              </label>
              <label class="grid gap-2 text-sm text-slate-600">
                <span>Cor de destaque</span>
                <input class="input" type="color" name="highlight_color" value="${esc(formHighlight)}" data-theme-input data-manual-color ${formMode === 'manual' ? '' : 'disabled'} />
              </label>
            </div>
          </fieldset>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Estilo dos cantos</span>
            <select class="input" name="corner_style" data-theme-input>
              <option value="rounded" ${formCorner !== 'square' ? 'selected' : ''}>Arredondados suaves</option>
              <option value="square" ${formCorner === 'square' ? 'selected' : ''}>Retos geométricos</option>
            </select>
          </label>

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Logotipo (PNG, JPG, WEBP ou SVG &middot; até 3 MB)</span>
            <input class="input" type="file" name="logo_file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
            ${logoPath ? `<span class="text-xs text-slate-500">Logotipo atual: <a class="underline" href="${esc(logoPath)}" target="_blank" rel="noopener">ver imagem</a></span>` : '<span class="text-xs text-slate-500">Sem imagem carregada — será usada a sigla.</span>'}
          </label>

          ${logoPath ? `
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-muted" name="action" value="remove_logo" onclick="return confirm('Remover o logotipo atual e utilizar a sigla?');">Remover logotipo</button>
            </div>
          ` : ''}

          <label class="grid gap-2 text-sm text-slate-600">
            <span>Texto alternativo do logotipo</span>
            <input class="input" name="logo_alt" value="${esc(formLogoAlt)}" maxlength="140" placeholder="Descrição para leitores de ecrã" />
            <span class="text-xs text-slate-500">Deixe em branco para utilizar automaticamente o nome da marca.</span>
          </label>

          <div class="flex flex-wrap gap-3">
            <button class="btn btn-primary" name="action" value="save">Guardar alterações</button>
            <button class="btn btn-muted" name="action" value="reset" onclick="return confirm('Repor o tema para os valores padrão?');">Repor padrão</button>
          </div>

          <div class="border-t border-slate-200 pt-4 grid gap-3">
            <h3 class="text-sm font-semibold text-slate-700">Guardar como tema reutilizável</h3>
            <p class="text-xs text-slate-500">Crie um tema nomeado para aplicar rapidamente noutras propriedades.</p>
            <label class="grid gap-1 text-sm text-slate-600 max-w-sm">
              <span>Nome do tema</span>
              <input class="input" name="theme_name" maxlength="80" placeholder="Ex: Azul praia" />
            </label>
            <button class="btn btn-light w-fit" name="action" value="save_template">Guardar como tema personalizado</button>
          </div>
        </form>

        <aside class="grid gap-4">
          <section class="card p-4 grid gap-3" data-theme-preview>
            <h2 class="text-sm font-semibold text-slate-700">Pré-visualização em tempo real</h2>
            <div class="preview-card" data-preview-root>
              <div class="preview-top">
                <div class="preview-logo" data-preview-logo>
                  ${logoPath ? `<img src="${esc(logoPath)}" alt="${esc(formLogoAlt)}" />` : `<span data-preview-initials>${esc(formInitials || theme.brandInitials)}</span>`}
                </div>
                <div>
                  <div class="preview-brand" data-preview-name>${esc(formBrandName)}</div>
                  <div class="preview-tagline" data-preview-tagline>${esc(formTagline)}</div>
                </div>
              </div>
              <div class="preview-body">
                <p>Botões, formulários e cartões utilizam estas variáveis de cor e raio em todo o portal.</p>
                <div class="preview-actions">
                  <button type="button" class="preview-btn-primary">Reservar</button>
                  <button type="button" class="preview-btn-secondary">Ver unidades</button>
                </div>
              </div>
            </div>
            <ul class="preview-palette">
              <li><span class="swatch" data-preview-swatch="primary"></span> Primária <code data-preview-code="primary">${esc(theme.primaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="secondary"></span> Secundária <code data-preview-code="secondary">${esc(theme.secondaryColor)}</code></li>
              <li><span class="swatch" data-preview-swatch="highlight"></span> Destaque <code data-preview-code="highlight">${esc(theme.highlightColor)}</code></li>
            </ul>
          </section>

          <section class="card p-4 grid gap-3">
            <h2 class="text-sm font-semibold text-slate-700">Temas personalizados</h2>
            ${savedThemes.length ? `
              <ul class="grid gap-3">
                ${savedThemes.map(entry => {
                  const sample = computeBrandingTheme({ ...entry.theme }, {});
                  return `
                    <li class="saved-theme" style="--saved-primary:${sample.primaryColor};--saved-secondary:${sample.secondaryColor}">
                      <div class="saved-theme-header">
                        <span class="saved-theme-name">${esc(entry.name)}</span>
                        <form method="post" action="/admin/identidade-visual" class="flex gap-2">
                          <input type="hidden" name="property_id" value="${propertyId || ''}" />
                          <input type="hidden" name="template_id" value="${esc(entry.id)}" />
                          <button class="btn btn-primary btn-xs" name="action" value="apply_template">Aplicar</button>
                          <button class="btn btn-muted btn-xs" name="action" value="delete_template" onclick="return confirm('Remover este tema personalizado?');">Remover</button>
                        </form>
                      </div>
                      <div class="saved-theme-preview">
                        <span class="swatch" style="background:var(--saved-primary)"></span>
                        <span class="swatch" style="background:var(--saved-secondary)"></span>
                        <span class="text-xs text-slate-500">${esc(sample.brandName)}</span>
                      </div>
                    </li>
                  `;
                }).join('')}
              </ul>
            ` : `<p class="text-sm text-slate-500">Ainda não existem temas guardados. Crie um acima para reutilizar noutros alojamentos.</p>`}
          </section>
        </aside>
      </div>

      <style>
        [data-theme-preview] .preview-card{border-radius:var(--brand-radius-lg);border:1px solid var(--brand-surface-border);background:linear-gradient(135deg,var(--brand-primary-soft),#fff);padding:18px;display:grid;gap:16px;}
        [data-theme-preview] .preview-top{display:flex;align-items:center;gap:14px;}
        [data-theme-preview] .preview-logo{width:46px;height:46px;border-radius:var(--brand-radius-sm);background:linear-gradient(130deg,var(--brand-primary),var(--brand-secondary));display:flex;align-items:center;justify-content:center;color:var(--brand-primary-contrast);font-weight:700;overflow:hidden;}
        [data-theme-preview] .preview-logo img{width:100%;height:100%;object-fit:cover;display:block;}
        [data-theme-preview] .preview-brand{font-weight:600;font-size:1rem;color:#1f2937;}
        [data-theme-preview] .preview-tagline{font-size:.8rem;color:var(--brand-muted);}
        [data-theme-preview] .preview-body{display:grid;gap:12px;font-size:.85rem;color:#475569;}
        [data-theme-preview] .preview-actions{display:flex;gap:8px;flex-wrap:wrap;}
        [data-theme-preview] .preview-btn-primary{background:var(--brand-primary);color:var(--brand-primary-contrast);border:none;border-radius:var(--brand-radius-pill);padding:8px 18px;font-weight:600;}
        [data-theme-preview] .preview-btn-secondary{background:var(--brand-secondary);color:var(--brand-primary-contrast);border:none;border-radius:var(--brand-radius-pill);padding:8px 16px;font-weight:600;opacity:.9;}
        [data-theme-preview] .preview-palette{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:.8rem;color:#475569;}
        [data-theme-preview] .preview-palette .swatch{display:inline-block;width:18px;height:18px;border-radius:6px;margin-right:6px;vertical-align:middle;border:1px solid rgba(15,23,42,.12);}
        .saved-theme{border:1px solid var(--brand-surface-border);border-radius:var(--brand-radius-sm);padding:12px;display:grid;gap:8px;}
        .saved-theme-header{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .saved-theme-name{font-size:.9rem;font-weight:600;color:#1f2937;}
        .saved-theme-preview{display:flex;align-items:center;gap:8px;font-size:.75rem;color:#475569;}
        .saved-theme .swatch{display:inline-block;width:18px;height:18px;border-radius:6px;border:1px solid rgba(15,23,42,.12);}
        .btn.btn-xs{padding:4px 10px;font-size:.75rem;border-radius:999px;}
      </style>

      <script>
        (function(){
          const root = document.querySelector('[data-theme-preview]');
          if (!root) return;
          const modeToggles = Array.from(document.querySelectorAll('[data-mode-toggle]'));
          const manualInputs = Array.from(document.querySelectorAll('[data-manual-color]'));
          const previewRoot = root.querySelector('[data-preview-root]');
          const previewName = root.querySelector('[data-preview-name]');
          const previewTagline = root.querySelector('[data-preview-tagline]');
          const previewInitials = root.querySelector('[data-preview-initials]');
          const swatches = {
            primary: root.querySelector('[data-preview-swatch="primary"]'),
            secondary: root.querySelector('[data-preview-swatch="secondary"]'),
            highlight: root.querySelector('[data-preview-swatch="highlight"]')
          };
          const codes = {
            primary: root.querySelector('[data-preview-code="primary"]'),
            secondary: root.querySelector('[data-preview-code="secondary"]'),
            highlight: root.querySelector('[data-preview-code="highlight"]')
          };

          function hexToRgb(hex){
            const clean = String(hex || '').replace('#','');
            if (clean.length !== 6) return null;
            return { r: parseInt(clean.slice(0,2),16), g: parseInt(clean.slice(2,4),16), b: parseInt(clean.slice(4,6),16) };
          }
          function rgbToHex(rgb){
            const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0');
            return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
          }
          function mix(aHex, bHex, ratio){
            const a = hexToRgb(aHex); const b = hexToRgb(bHex);
            if (!a || !b) return aHex;
            const t = Math.max(0, Math.min(1, ratio));
            return rgbToHex({ r: a.r * (1-t) + b.r * t, g: a.g * (1-t) + b.g * t, b: a.b * (1-t) + b.b * t });
          }
          function contrast(hex){
            const rgb = hexToRgb(hex);
            if (!rgb) return '#ffffff';
            const luminance = (0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b)/255;
            return luminance > 0.6 ? '#0f172a' : '#ffffff';
          }

          function currentMode(){
            const active = modeToggles.find(r => r.checked);
            return active && active.value === 'manual' ? 'manual' : 'quick';
          }

          function applyManualState(){
            const manual = currentMode() === 'manual';
            manualInputs.forEach(input => {
              input.disabled = !manual;
              input.closest('label')?.classList.toggle('opacity-60', !manual);
            });
          }

          function updatePreview(){
            const mode = currentMode();
            const primaryInput = document.querySelector('input[name="primary_color"]');
            const secondaryInput = document.querySelector('input[name="secondary_color"]');
            const highlightInput = document.querySelector('input[name="highlight_color"]');
            const nameInput = document.querySelector('input[name="brand_name"]');
            const taglineInput = document.querySelector('input[name="tagline"]');
            const initialsInput = document.querySelector('input[name="brand_initials"]');
            const cornerSelect = document.querySelector('select[name="corner_style"]');

            const primary = primaryInput ? primaryInput.value : '#2563eb';
            let secondary = secondaryInput ? secondaryInput.value : '#1d4ed8';
            let highlight = highlightInput ? highlightInput.value : '#f97316';
            if (mode !== 'manual') {
              secondary = mix(primary, '#1f2937', 0.18);
              highlight = mix(primary, '#f97316', 0.35);
            }

            const primaryHover = mix(primary, '#000000', 0.18);
            const primarySoft = mix(primary, '#ffffff', 0.82);
            const surface = mix(primary, '#ffffff', 0.94);
            const surfaceBorder = mix(primary, '#1f2937', 0.12);
            const surfaceRing = mix(primary, '#60a5fa', 0.35);
            const background = mix(primary, '#ffffff', 0.97);
            const muted = mix(primary, '#475569', 0.35);
            const surfaceContrast = contrast(surface);

            const cornerStyle = cornerSelect && cornerSelect.value === 'square' ? 'square' : 'rounded';
            const radius = cornerStyle === 'square' ? '14px' : '24px';
            const radiusSm = cornerStyle === 'square' ? '8px' : '16px';
            const radiusLg = cornerStyle === 'square' ? '24px' : '32px';
            const radiusPill = cornerStyle === 'square' ? '22px' : '999px';

            previewRoot.style.setProperty('--brand-primary', primary);
            previewRoot.style.setProperty('--brand-secondary', secondary);
            previewRoot.style.setProperty('--brand-highlight', highlight);
            previewRoot.style.setProperty('--brand-primary-contrast', contrast(primary));
            previewRoot.style.setProperty('--brand-primary-hover', primaryHover);
            previewRoot.style.setProperty('--brand-primary-soft', primarySoft);
            previewRoot.style.setProperty('--brand-surface', surface);
            previewRoot.style.setProperty('--brand-surface-border', surfaceBorder);
            previewRoot.style.setProperty('--brand-surface-ring', surfaceRing);
            previewRoot.style.setProperty('--brand-surface-contrast', surfaceContrast);
            previewRoot.style.setProperty('--brand-background', background);
            previewRoot.style.setProperty('--brand-muted', muted);
            previewRoot.style.setProperty('--brand-radius', radius);
            previewRoot.style.setProperty('--brand-radius-sm', radiusSm);
            previewRoot.style.setProperty('--brand-radius-lg', radiusLg);
            previewRoot.style.setProperty('--brand-radius-pill', radiusPill);

            if (swatches.primary) swatches.primary.style.background = primary;
            if (swatches.secondary) swatches.secondary.style.background = secondary;
            if (swatches.highlight) swatches.highlight.style.background = highlight;
            if (codes.primary) codes.primary.textContent = primary;
            if (codes.secondary) codes.secondary.textContent = secondary;
            if (codes.highlight) codes.highlight.textContent = highlight;

            if (previewName && nameInput) previewName.textContent = nameInput.value || '${esc(theme.brandName)}';
            if (previewTagline && taglineInput) previewTagline.textContent = taglineInput.value;
            if (previewInitials && initialsInput) previewInitials.textContent = initialsInput.value || '${esc(theme.brandInitials)}';
          }

          modeToggles.forEach(el => el.addEventListener('change', () => { applyManualState(); updatePreview(); }));
          ['input','change'].forEach(evt => {
            document.querySelectorAll('[data-theme-input]').forEach(input => input.addEventListener(evt, updatePreview));
          });

          applyManualState();
          updatePreview();
        })();
      </script>
    `
  }));
});

app.post('/admin/identidade-visual', requireAdmin, (req, res) => {
  uploadBrandingAsset.single('logo_file')(req, res, async (err) => {
    const propertyId = parsePropertyId((req.body ? req.body.property_id : null));
    const baseRedirect = propertyId ? `/admin/identidade-visual?property_id=${propertyId}` : '/admin/identidade-visual';
    const redirectWith = (key, value) => `${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}${key}=${value}`;
    const cleanupUpload = async () => { if (req.file) await fsp.unlink(req.file.path).catch(() => {}); };

    if (err) {
      console.error('Identidade visual: erro no upload', err.message);
      await cleanupUpload();
      return res.redirect(redirectWith('error', encodeURIComponent('Falha ao carregar o logotipo: ' + err.message)));
    }

    const actionRaw = typeof (req.body && req.body.action) === 'string' ? req.body.action.toLowerCase() : 'save';
    const action = ['save','reset','save_template','apply_template','delete_template','remove_logo'].includes(actionRaw) ? actionRaw : 'save';
    const store = cloneBrandingStoreState();
    const previousScope = propertyId ? (brandingStore.properties[propertyId] || {}) : (brandingStore.global || {});
    let previousLogo = previousScope.logoFile || null;

    try {
      if (action === 'reset') {
        const previous = propertyId ? store.properties[propertyId] || {} : store.global || {};
        const oldLogo = previous.logoFile || null;
        if (propertyId) {
          delete store.properties[propertyId];
        } else {
          store.global = {};
        }
        persistBrandingStore(store);
        if (oldLogo) await removeBrandingLogo(oldLogo);
        await cleanupUpload();
        rememberActiveBrandingProperty(res, propertyId);
        return res.redirect(redirectWith('success', 'reset'));
      }

      if (action === 'apply_template') {
        const templateId = String((req.body && req.body.template_id) || '').trim();
        const template = store.savedThemes.find(entry => entry.id === templateId);
        if (!template) {
          await cleanupUpload();
          return res.redirect(redirectWith('error', encodeURIComponent('Tema personalizado não encontrado.')));
        }
        const appliedTheme = sanitizeBrandingTheme({ ...template.theme });
        if (propertyId) store.properties[propertyId] = appliedTheme; else store.global = appliedTheme;
        persistBrandingStore(store);
        if (propertyId) rememberActiveBrandingProperty(res, propertyId);
        await cleanupUpload();
        const oldLogo = propertyId ? (brandingStore.properties[propertyId]?.logoFile || null) : (brandingStore.global.logoFile || null);
        if (oldLogo && (!appliedTheme.logoFile || appliedTheme.logoFile !== oldLogo)) await removeBrandingLogo(oldLogo);
        return res.redirect(redirectWith('success', 'applied'));
      }

      if (action === 'delete_template') {
        const templateId = String((req.body && req.body.template_id) || '').trim();
        const originalLength = store.savedThemes.length;
        store.savedThemes = store.savedThemes.filter(entry => entry.id !== templateId);
        persistBrandingStore(store);
        await cleanupUpload();
        if (originalLength === store.savedThemes.length) {
          return res.redirect(redirectWith('error', encodeURIComponent('Tema personalizado não encontrado.')));
        }
        return res.redirect(redirectWith('success', 'deleted'));
      }

      if (action === 'remove_logo') {
        const target = propertyId ? { ...(store.properties[propertyId] || {}) } : { ...store.global };
        const oldLogo = target.logoFile || null;
        delete target.logoFile;
        delete target.logoAlt;
        target.logoHidden = true;
        if (propertyId) {
          if (Object.keys(target).length) {
            store.properties[propertyId] = target;
          } else {
            delete store.properties[propertyId];
          }
        } else {
          store.global = target;
        }
        persistBrandingStore(store);
        await cleanupUpload();
        rememberActiveBrandingProperty(res, propertyId);
        if (oldLogo) await removeBrandingLogo(oldLogo);
        return res.redirect(redirectWith('success', 'logo_removed'));
      }

      const submission = extractBrandingSubmission((req.body || {}));
      const updates = submission.updates;
      const clears = submission.clears;
      const mode = submission.mode;
      const existingTheme = propertyId ? { ...(store.properties[propertyId] || {}) } : { ...store.global };

      if (req.file) {
        updates.logoFile = req.file.filename;
        clears.add('logoHidden');
      }

      clears.forEach(field => { delete existingTheme[field]; });
      Object.assign(existingTheme, updates);
      if (mode !== 'manual') {
        delete existingTheme.secondaryColor;
        delete existingTheme.highlightColor;
      }

      if (req.file) {
        await compressImage(req.file.path).catch(() => {});
      }

      if (action === 'save_template') {
        const templateName = String((req.body && req.body.theme_name) || '').trim();
        if (!templateName) {
          await cleanupUpload();
          return res.redirect(redirectWith('error', encodeURIComponent('Indique o nome para o tema personalizado.')));
        }
        const savedTheme = sanitizeBrandingTheme({ ...existingTheme });
        store.savedThemes.push({ id: crypto.randomBytes(6).toString('hex'), name: templateName.slice(0, 80), theme: savedTheme });
      }

      if (propertyId) {
        store.properties[propertyId] = existingTheme;
      } else {
        store.global = existingTheme;
      }

      persistBrandingStore(store);
      if (previousLogo && previousLogo !== existingTheme.logoFile) await removeBrandingLogo(previousLogo);
      rememberActiveBrandingProperty(res, propertyId);
      const successKey = action === 'save_template' ? 'template' : 'saved';
      return res.redirect(redirectWith('success', successKey));
    } catch (saveErr) {
      console.error('Identidade visual: falha ao guardar', saveErr);
      await cleanupUpload();
      return res.redirect(redirectWith('error', encodeURIComponent('Não foi possível guardar as alterações.')));
    }
  });
});
app.get('/admin/auditoria', requireLogin, requireAnyPermission(['audit.view', 'logs.view']), (req, res) => {
  const entityRaw = typeof req.query.entity === 'string' ? req.query.entity.trim().toLowerCase() : '';
  const idRaw = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const canViewAudit = userCan(req.user, 'audit.view');
  const canViewLogs = userCan(req.user, 'logs.view');

  let changeLogs = [];
  if (canViewAudit) {
    const filters = [];
    const params = [];
    if (entityRaw) { filters.push('cl.entity_type = ?'); params.push(entityRaw); }
    const idNumber = Number(idRaw);
    if (idRaw && !Number.isNaN(idNumber)) { filters.push('cl.entity_id = ?'); params.push(idNumber); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    changeLogs = db.prepare(`
      SELECT cl.*, u.username
        FROM change_logs cl
        JOIN users u ON u.id = cl.actor_id
       ${where}
       ORDER BY cl.created_at DESC
       LIMIT 200
    `).all(...params);
  }

  const sessionLogs = canViewLogs
    ? db.prepare(`
        SELECT sl.*, u.username
          FROM session_logs sl
          LEFT JOIN users u ON u.id = sl.user_id
         ORDER BY sl.created_at DESC
         LIMIT 120
      `).all()
    : [];

  const activityLogs = canViewLogs
    ? db.prepare(`
        SELECT al.*, u.username
          FROM activity_logs al
          LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT 200
      `).all()
    : [];

  const theme = resolveBrandingForRequest(req);

  res.send(layout({
    title: 'Auditoria',
    user: req.user,
    activeNav: 'audit',
    branding: theme,
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Auditoria e registos internos</h1>
      ${canViewAudit ? `
        <form class="card p-4 mb-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get" action="/admin/auditoria">
          <div class="grid gap-1">
            <label class="text-sm text-slate-600">Entidade</label>
            <select class="input" name="entity">
              <option value="" ${!entityRaw ? 'selected' : ''}>Todas</option>
              <option value="booking" ${entityRaw === 'booking' ? 'selected' : ''}>Reservas</option>
              <option value="block" ${entityRaw === 'block' ? 'selected' : ''}>Bloqueios</option>
            </select>
          </div>
          <div class="grid gap-1">
            <label class="text-sm text-slate-600">ID</label>
            <input class="input" name="id" value="${esc(idRaw)}" placeholder="Opcional" />
          </div>
          <div class="self-end">
            <button class="btn btn-primary w-full">Filtrar</button>
          </div>
        </form>

        <div class="space-y-4">
          ${changeLogs.length ? changeLogs.map(log => html`
            <article class="card p-4 grid gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm text-slate-600">${dayjs(log.created_at).format('DD/MM/YYYY HH:mm')}</div>
                <div class="text-xs uppercase tracking-wide text-slate-500">${esc(log.action)}</div>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span class="pill-indicator">${esc(log.entity_type)} #${log.entity_id}</span>
                <span class="text-slate-500">por ${esc(log.username)}</span>
              </div>
              <div class="bg-slate-50 rounded-lg p-3 overflow-x-auto">${renderAuditDiff(log.before_json, log.after_json)}</div>
            </article>
          `).join('') : `<div class="text-sm text-slate-500">Sem registos para os filtros selecionados.</div>`}
        </div>
      ` : `<div class="card p-4 text-sm text-slate-500">Sem permissões para consultar o histórico de alterações.</div>`}

      ${canViewLogs ? `
        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Logs de sessão</h2>
            <span class="text-xs text-slate-500">Últimos ${sessionLogs.length} registos</span>
          </div>
          <div class="card p-0 overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="text-left px-4 py-2">Quando</th>
                  <th class="text-left px-4 py-2">Utilizador</th>
                  <th class="text-left px-4 py-2">Ação</th>
                  <th class="text-left px-4 py-2">IP</th>
                  <th class="text-left px-4 py-2">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                ${sessionLogs.length ? sessionLogs.map(row => `
                  <tr class="border-t">
                    <td class="px-4 py-2 text-slate-600">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</td>
                    <td class="px-4 py-2">${esc(row.username || '—')}</td>
                    <td class="px-4 py-2">${esc(row.action)}</td>
                    <td class="px-4 py-2">${esc(row.ip || '')}</td>
                    <td class="px-4 py-2 text-slate-500">${esc((row.user_agent || '').slice(0, 120))}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="px-4 py-3 text-slate-500">Sem atividade de sessão registada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>

        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Atividade da aplicação</h2>
            <span class="text-xs text-slate-500">Últimos ${activityLogs.length} eventos</span>
          </div>
          <div class="card p-0 overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="text-left px-4 py-2">Quando</th>
                  <th class="text-left px-4 py-2">Utilizador</th>
                  <th class="text-left px-4 py-2">Ação</th>
                  <th class="text-left px-4 py-2">Entidade</th>
                  <th class="text-left px-4 py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                ${activityLogs.length ? activityLogs.map(row => `
                  <tr class="border-t align-top">
                    <td class="px-4 py-2 text-slate-600">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</td>
                    <td class="px-4 py-2">${esc(row.username || '—')}</td>
                    <td class="px-4 py-2">${esc(row.action)}</td>
                    <td class="px-4 py-2">${row.entity_type ? esc(row.entity_type) + (row.entity_id ? ' #' + row.entity_id : '') : '—'}</td>
                    <td class="px-4 py-2">${formatJsonSnippet(row.meta_json)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="px-4 py-3 text-slate-500">Sem atividade registada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      ` : ''}
    `
  }));
});

// ===================== Utilizadores (admin) =====================
app.get('/admin/utilizadores', requireAdmin, (req,res)=>{
  const users = db.prepare('SELECT id, username, role FROM users ORDER BY username').all().map(u => ({
    ...u,
    role_key: normalizeRole(u.role)
  }));
  const theme = resolveBrandingForRequest(req);
  res.send(layout({ title:'Utilizadores', user: req.user, activeNav: 'users', branding: theme, body: html`
    <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
    <h1 class="text-2xl font-semibold mb-4">Utilizadores</h1>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section class="card p-4">
        <h2 class="font-semibold mb-3">Criar novo utilizador</h2>
        <form method="post" action="/admin/users/create" class="grid gap-2">
          <input required name="username" class="input" placeholder="Utilizador" />
          <input required type="password" name="password" class="input" placeholder="Password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <select name="role" class="input">
            <option value="rececao">Receção</option>
            <option value="gestao">Gestão</option>
            <option value="direcao">Direção</option>
          </select>
          <button class="btn btn-primary">Criar</button>
        </form>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Alterar password</h2>
        <form method="post" action="/admin/users/password" class="grid gap-2">
          <label class="text-sm">Selecionar utilizador</label>
          <select required name="user_id" class="input">
            ${users.map(u=>`<option value="${u.id}">${esc(u.username)} (${esc(ROLE_LABELS[u.role_key] || u.role_key)})</option>`).join('')}
          </select>
          <input required type="password" name="new_password" class="input" placeholder="Nova password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <button class="btn btn-primary">Alterar</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">Ao alterar, as sessões desse utilizador são terminadas.</p>
      </section>
    </div>
  `}));
});

app.post('/admin/users/create', requireAdmin, (req,res)=>{
  const { username, password, confirm, role } = req.body;
  if (!username || !password || password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).send('Utilizador já existe.');
  const hash = bcrypt.hashSync(password, 10);
  const roleKey = normalizeRole(role);
  const result = db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run(username, hash, roleKey);
  logActivity(req.user.id, 'user:create', 'user', result.lastInsertRowid, { username, role: roleKey });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/password', requireAdmin, (req,res)=>{
  const { user_id, new_password, confirm } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (new_password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).send('Utilizador não encontrado');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
  logActivity(req.user.id, 'user:password_reset', 'user', Number(user_id), {});
  res.redirect('/admin/utilizadores');
});
};
