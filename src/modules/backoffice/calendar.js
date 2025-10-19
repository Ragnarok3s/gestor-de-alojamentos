// Calendar module: handles backoffice reservation calendar routes and availability helpers.
const { ConflictError } = require('../../services/errors');
const { serverRender } = require('../../middlewares/telemetry');

function registerCalendar(app, context) {
  if (!app) throw new Error('registerCalendar: app é obrigatório');
  if (!context) throw new Error('registerCalendar: context é obrigatório');

  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    formatMonthYear,
    resolveBrandingForRequest,
    requireLogin,
    requirePermission,
    userCan,
    rateQuote,
    overbookingGuard,
    otaDispatcher,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    insertBlockStmt,
    deleteLockByBookingStmt,
    logChange,
    overlaps,
    inlineScript,
    renderModalShell,
    isFlagEnabled,
    ensureNoIndex: ensureNoIndexHeader
  } = context;

  if (!inlineScript) throw new Error('registerCalendar: inlineScript é obrigatório');
  if (!renderModalShell) throw new Error('registerCalendar: renderModalShell é obrigatório');
  if (typeof ensureNoIndexHeader !== 'function') throw new Error('registerCalendar: ensureNoIndex é obrigatório');
  if (typeof isFlagEnabled !== 'function') throw new Error('registerCalendar: isFlagEnabled é obrigatório');

  app.get('/calendar', requireLogin, requirePermission('calendar.view'), (req, res) => {
    const ym = req.query.ym; // YYYY-MM
    const base = ym ? dayjs(ym + '-01') : dayjs().startOf('month');
    const month = base.startOf('month');
    const prev = month.subtract(1, 'month').format('YYYY-MM');
    const next = month.add(1, 'month').format('YYYY-MM');
  
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const propertyMap = new Map(properties.map(p => [p.id, p.name]));
    let propertyId = req.query.property ? Number(req.query.property) : (properties[0] ? properties[0].id : null);
    if (Number.isNaN(propertyId)) propertyId = properties[0] ? properties[0].id : null;
  
    ensureNoIndexHeader(res);
  
    const enableUnitCardModal = isFlagEnabled('FEATURE_CALENDAR_UNIT_CARD_MODAL');
    const enableExportShortcuts = isFlagEnabled('FEATURE_NAV_EXPORT_SHORTCUTS');
  
    const units = propertyId
      ? db.prepare('SELECT id, name FROM units WHERE property_id = ? ORDER BY name').all(propertyId)
      : [];
  
    const rawFilters = {
      start: req.query.start && String(req.query.start),
      end: req.query.end && String(req.query.end),
      unit: req.query.unit && String(req.query.unit),
      q: req.query.q && String(req.query.q).trim()
    };
  
    let startDate = rawFilters.start && dayjs(rawFilters.start, 'YYYY-MM-DD', true).isValid()
      ? dayjs(rawFilters.start)
      : month;
    let endDate = rawFilters.end && dayjs(rawFilters.end, 'YYYY-MM-DD', true).isValid()
      ? dayjs(rawFilters.end)
      : month.endOf('month');
  
    if (endDate.isBefore(startDate)) {
      endDate = startDate;
    }
  
    startDate = startDate.startOf('day');
    endDate = endDate.startOf('day');
  
    const startInputValue = startDate.format('YYYY-MM-DD');
    const endInputValue = endDate.format('YYYY-MM-DD');
  
    const endExclusive = endDate.add(1, 'day');
  
    let selectedUnitId = null;
    if (rawFilters.unit) {
      const parsedUnit = Number(rawFilters.unit);
      if (!Number.isNaN(parsedUnit) && units.some(u => u.id === parsedUnit)) {
        selectedUnitId = parsedUnit;
      }
    }
  
    const searchTerm = rawFilters.q ? rawFilters.q.toLowerCase() : '';
  
    const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;
    const safeSelectedUnitName = selectedUnit ? esc(selectedUnit.name) : '';
    const unitCardFetchHref = selectedUnit ? `/calendar/unit/${selectedUnit.id}/card` : '';
  
    let bookings = [];
    if (propertyId) {
      const params = {
        propertyId,
        start: startDate.format('YYYY-MM-DD'),
        end: endExclusive.format('YYYY-MM-DD')
      };
      let where = `u.property_id = @propertyId AND NOT (b.checkout <= @start OR b.checkin >= @end) AND b.status IN ('CONFIRMED','PENDING')`;
      if (selectedUnitId) {
        params.unitId = selectedUnitId;
        where += ' AND b.unit_id = @unitId';
      }
      if (searchTerm) {
        params.search = '%' + searchTerm + '%';
        where += " AND (LOWER(b.guest_name) LIKE @search OR LOWER(IFNULL(b.guest_email, '')) LIKE @search OR LOWER(IFNULL(b.agency, '')) LIKE @search)";
      }
      bookings = db.prepare(`
        SELECT b.*, u.name AS unit_name, p.name AS property_name
          FROM bookings b
          JOIN units u ON u.id = b.unit_id
          JOIN properties p ON p.id = u.property_id
         WHERE ${where}
         ORDER BY b.checkin, b.checkout, b.id
      `).all(params).map(row => ({
        ...row,
        nights: Math.max(1, dayjs(row.checkout).diff(dayjs(row.checkin), 'day')),
        checkin_iso: dayjs(row.checkin).format('YYYY-MM-DD'),
        checkout_iso: dayjs(row.checkout).format('YYYY-MM-DD'),
        checkin_label: dayjs(row.checkin).format('DD/MM'),
        checkout_label: dayjs(row.checkout).format('DD/MM')
      }));
    }
  
    const confirmedCount = bookings.filter(b => (b.status || '').toUpperCase() === 'CONFIRMED').length;
    const pendingCount = bookings.filter(b => (b.status || '').toUpperCase() === 'PENDING').length;
    const totalNights = bookings.reduce((sum, b) => sum + (b.nights || 0), 0);
    const uniqueUnits = new Set(bookings.map(b => b.unit_id)).size;
  
    const activeYm = month.format('YYYY-MM');
    const queryState = {
      ym: activeYm,
      property: propertyId ? String(propertyId) : '',
      unit: selectedUnitId ? String(selectedUnitId) : '',
      q: rawFilters.q || '',
      start: rawFilters.start || '',
      end: rawFilters.end || ''
    };
  
    function buildQuery(overrides) {
      const params = new URLSearchParams();
      if (queryState.property) params.set('property', queryState.property);
      if (queryState.unit) params.set('unit', queryState.unit);
      if (queryState.q) params.set('q', queryState.q);
      if (queryState.start) params.set('start', queryState.start);
      if (queryState.end) params.set('end', queryState.end);
      if (queryState.ym) params.set('ym', queryState.ym);
      if (overrides) {
        Object.keys(overrides).forEach(key => {
          const value = overrides[key];
          if (value === null || value === undefined || value === '') {
            params.delete(key);
          } else {
            params.set(key, value);
          }
        });
      }
      const search = params.toString();
      return search ? `?${search}` : '';
    }
  
    const prevLink = '/calendar' + buildQuery({ ym: prev, start: '', end: '' });
    const nextLink = '/calendar' + buildQuery({ ym: next, start: '', end: '' });
  
    const propertyLabel = propertyId ? propertyMap.get(propertyId) : null;
    const canExportCalendar = enableExportShortcuts && userCan(req.user, 'bookings.export');
    const calendarExportShortcut = canExportCalendar ? '<a class="btn btn-primary" href="/admin/export">Exportar Excel</a>' : '';
    const unitCardButton = enableUnitCardModal
      ? `<button type="button" class="btn btn-light" data-unit-card-trigger data-unit-card-title="Cartão da unidade" data-unit-card-loading="A preparar o cartão da unidade..." ${selectedUnit ? `data-unit-id="${selectedUnit.id}" data-unit-card-name="${safeSelectedUnitName}" data-unit-card-fetch="${esc(unitCardFetchHref)}"` : 'disabled aria-disabled="true" title="Selecione uma unidade nos filtros"'} data-unit-card-ym="${esc(activeYm)}">Cartão da unidade</button>`
      : '';
    const unitCardModalShell = enableUnitCardModal
      ? html`${renderModalShell({
          id: 'unit-card-modal',
          title: 'Cartão da unidade',
          body: '<div class="bo-modal__placeholder">Selecione uma unidade para consultar o cartão.</div>',
          extraRootAttr: 'data-unit-card-modal'
        })}`
      : '';
    const unitCardScriptTag = enableUnitCardModal ? html`<script src="/public/js/card-modal.js"></script>` : '';
    const canRescheduleCalendar = userCan(req.user, 'calendar.reschedule');
  
    const activeFilters = ['start', 'end', 'unit', 'q'].filter(key => rawFilters[key]);
    const filtersHint = activeFilters.length
      ? `${activeFilters.length} filtro${activeFilters.length === 1 ? '' : 's'} ativo${activeFilters.length === 1 ? '' : 's'}`
      : 'Ajuste propriedade, datas e pesquisa';
    const filtersInitiallyOpen = activeFilters.length > 0 || !propertyId || !properties.length;
    const filtersOpenAttr = filtersInitiallyOpen ? ' open' : '';
  
    const calendarSummaryCard = html`
      <section class="bo-card">
        <h2>Resumo das reservas</h2>
        <p class="bo-subtitle">${propertyLabel
          ? `Dados atuais para ${esc(propertyLabel)}.`
          : 'Escolha uma propriedade nos filtros abaixo para ver o mapa completo.'}</p>
        <div class="bo-metrics">
          <div class="bo-metric"><strong>${bookings.length}</strong><span>Reservas no período</span></div>
          <div class="bo-metric"><strong>${confirmedCount}</strong><span>Confirmadas</span></div>
          <div class="bo-metric"><strong>${pendingCount}</strong><span>Pendentes</span></div>
          <div class="bo-metric"><strong>${totalNights}</strong><span>Noites reservadas · ${uniqueUnits} ${uniqueUnits === 1 ? 'unidade' : 'unidades'}</span></div>
        </div>
      </section>`;
  
    const calendarFiltersCard = html`
      <section class="bo-card bo-calendar-filters">
        <details class="bo-calendar-filters__details"${filtersOpenAttr}>
          <summary class="bo-calendar-filters__summary">
            <span class="bo-calendar-filters__summary-label">
              <i aria-hidden="true" data-lucide="sliders"></i>
              <span>Filtros de reservas</span>
            </span>
            <span class="bo-calendar-filters__summary-hint">${esc(filtersHint)}</span>
          </summary>
          <div class="bo-calendar-filters__body">
            <p class="bo-subtitle">Ajuste a propriedade, datas e pesquisa para encontrar reservas específicas.</p>
            <form method="get" class="bo-calendar-filters__form">
              <input type="hidden" name="ym" value="${esc(activeYm)}" />
              <div class="bo-field">
                <label for="calendar-filter-property">Propriedade</label>
                <select id="calendar-filter-property" name="property" class="input" ${properties.length ? '' : 'disabled'}>
                  ${properties.length
                    ? properties
                        .map(p => `<option value="${p.id}" ${p.id === propertyId ? 'selected' : ''}>${esc(p.name)}</option>`)
                        .join('')
                    : '<option value="">Sem propriedades</option>'}
                </select>
                ${properties.length ? '' : '<p class="bo-form-hint">Crie uma propriedade para ativar o mapa.</p>'}
              </div>
              <div class="bo-field">
                <label>Intervalo de datas</label>
                <div class="bo-calendar-date-range">
                  <input type="date" name="start" value="${esc(startInputValue)}" class="input" />
                  <input type="date" name="end" value="${esc(endInputValue)}" class="input" />
                </div>
                <p class="bo-form-hint">Serão apresentadas reservas que ocorram dentro deste período.</p>
              </div>
              <div class="bo-field">
                <label for="calendar-filter-unit">Unidade</label>
                <select id="calendar-filter-unit" name="unit" class="input" ${units.length ? '' : 'disabled'}>
                  <option value="">Todas as unidades</option>
                  ${units.map(u => `<option value="${u.id}" ${selectedUnitId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
                </select>
                ${units.length ? '' : '<p class="bo-form-hint">Sem unidades disponíveis para esta propriedade.</p>'}
              </div>
              <div class="bo-field">
                <label for="calendar-filter-search">Nome do hóspede</label>
                <input
                  id="calendar-filter-search"
                  type="search"
                  name="q"
                  value="${esc(rawFilters.q || '')}"
                  placeholder="Pesquisar por nome, email ou agência"
                  class="input"
                />
              </div>
              <div class="bo-calendar-filters__actions">
                <button type="submit" class="btn btn-primary">Aplicar filtros</button>
                <a class="btn btn-light" href="/calendar">Limpar filtros</a>
              </div>
            </form>
          </div>
        </details>
      </section>`;
  
    const calendarGridHtml = propertyId
      ? bookings.length
        ? html`
            ${renderReservationCalendarGrid({ month, bookings, dayjs, esc, canReschedule: canRescheduleCalendar })}
            ${renderReservationCalendarGridMobile({ month, bookings, units, dayjs, esc })}
          `
        : '<div class="bo-calendar-empty-state">Não foram encontradas reservas para os filtros selecionados.</div>'
      : '<div class="bo-calendar-empty-state">Configure uma propriedade para começar a acompanhar as reservas.</div>';
  
    const calendarBoard = html`
      <section class="bo-card bo-calendar-board" data-calendar-board data-can-reschedule="${canRescheduleCalendar ? '1' : '0'}">
        <div class="bo-calendar-toolbar">
          <div class="bo-calendar-monthnav">
            <a class="btn btn-light" href="${esc(prevLink)}">&larr; ${formatMonthYear(prev + '-01')}</a>
            <div class="bo-calendar-monthlabel">${formatMonthYear(month.format('YYYY-MM-DD'))}</div>
            <a class="btn btn-light" href="${esc(nextLink)}">${formatMonthYear(next + '-01')} &rarr;</a>
          </div>
          <div class="bo-calendar-actions">
            <div class="bo-calendar-legend">
              <span class="bo-calendar-legend__item bo-calendar-legend__item--confirmed"><span class="bo-dot bo-dot--confirmed"></span>Confirmada</span>
              <span class="bo-calendar-legend__item bo-calendar-legend__item--pending"><span class="bo-dot bo-dot--pending"></span>Pendente</span>
            </div>
            ${unitCardButton}
            ${calendarExportShortcut}
          </div>
        </div>
        ${canRescheduleCalendar ? '<p class="bo-calendar-hint">Arraste uma reserva confirmada para reagendar rapidamente.</p>' : ''}
        ${calendarGridHtml}
      </section>`;
  
    const calendarDragScript = html`
      <script>${inlineScript(`
        (function(){
          const board = document.querySelector('[data-calendar-board]');
          if (!board) return;
          if (board.getAttribute('data-can-reschedule') !== '1') return;
          const entries = board.querySelectorAll('[data-calendar-entry]');
          const cells = Array.from(board.querySelectorAll('[data-calendar-cell]'));
          if (!entries.length || !cells.length) return;
          let dragData = null;
  
          function addDays(iso, days) {
            if (!iso) return iso;
            const parts = iso.split('-').map(Number);
            if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
            const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
            date.setUTCDate(date.getUTCDate() + days);
            return date.toISOString().slice(0, 10);
          }
  
          function clearDropTargets() {
            cells.forEach(function(cell){
              cell.classList.remove('is-drop-target');
            });
          }
  
          entries.forEach(function(entry){
            entry.addEventListener('dragstart', function(event){
              if (entry.getAttribute('draggable') !== 'true') return;
              const id = entry.getAttribute('data-entry-id');
              const start = entry.getAttribute('data-entry-start');
              const end = entry.getAttribute('data-entry-end');
              if (!id || !start || !end) return;
              dragData = {
                id: id,
                start: start,
                end: end,
                nights: Number(entry.getAttribute('data-entry-nights') || '1'),
                element: entry
              };
              entry.classList.add('is-dragging');
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                try { event.dataTransfer.setData('text/plain', id); } catch (err) {}
              }
            });
            entry.addEventListener('dragend', function(){
              entry.classList.remove('is-dragging');
              clearDropTargets();
              dragData = null;
            });
          });
  
          cells.forEach(function(cell){
            cell.addEventListener('dragover', function(event){
              if (!dragData) return;
              if (cell.getAttribute('data-in-month') !== '1') return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              cells.forEach(function(other){
                if (other !== cell) other.classList.remove('is-drop-target');
              });
              cell.classList.add('is-drop-target');
            });
            cell.addEventListener('dragleave', function(){
              cell.classList.remove('is-drop-target');
            });
            cell.addEventListener('drop', function(event){
              if (!dragData) return;
              if (cell.getAttribute('data-in-month') !== '1') return;
              event.preventDefault();
              const entry = dragData.element;
              const entryId = dragData.id;
              const originalStart = dragData.start;
              const nights = Number.isFinite(dragData.nights) && dragData.nights > 0 ? dragData.nights : 1;
              const targetDate = cell.getAttribute('data-date');
              clearDropTargets();
              dragData = null;
              if (!entryId || !targetDate || targetDate === originalStart) return;
              if (entry) {
                entry.classList.remove('is-dragging');
                entry.classList.add('is-saving');
              }
              const checkout = addDays(targetDate, nights);
              fetch('/calendar/booking/' + encodeURIComponent(entryId) + '/reschedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkin: targetDate, checkout: checkout })
              })
                .then(function(res){
                  return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado.' }; }).then(function(data){
                    return { res: res, data: data };
                  });
                })
                .then(function(result){
                  const ok = result && result.res && result.res.ok && result.data && result.data.ok;
                  if (ok) {
                    window.location.reload();
                  } else {
                    if (entry) entry.classList.remove('is-saving');
                    const message = result && result.data && result.data.message ? result.data.message : 'Não foi possível reagendar a reserva.';
                    window.alert(message);
                  }
                })
                .catch(function(){
                  if (entry) entry.classList.remove('is-saving');
                  window.alert('Erro de rede ao reagendar a reserva.');
                });
            });
          });
        })();
      `)}</script>
    `;
  
    serverRender('route:/calendar');
    res.send(layout({
      title: 'Mapa de Reservas',
      user: req.user,
      activeNav: 'calendar',
      branding: resolveBrandingForRequest(req),
      pageClass: 'page-backoffice page-calendar',
      body: html`
        <div class="bo-main">
          <header class="bo-header">
            <h1>Mapa de reservas</h1>
            <p>Acompanhe todas as reservas da propriedade num calendário único com filtros rápidos.</p>
          </header>
          ${calendarSummaryCard}
          ${calendarFiltersCard}
          ${calendarBoard}
          ${calendarDragScript}
          ${unitCardModalShell}
          ${unitCardScriptTag}
        </div>
      `
    }));
  });
  
  
  function normalizeCalendarBookings(bookings, dayjs) {
    return bookings.map(booking => ({
      ...booking,
      checkinISO: booking.checkinISO || booking.checkin_iso || dayjs(booking.checkin).format('YYYY-MM-DD'),
      checkoutISO: booking.checkoutISO || booking.checkout_iso || dayjs(booking.checkout).format('YYYY-MM-DD'),
      checkinLabel: booking.checkinLabel || booking.checkin_label || dayjs(booking.checkin).format('DD/MM'),
      checkoutLabel: booking.checkoutLabel || booking.checkout_label || dayjs(booking.checkout).format('DD/MM'),
      nights: booking.nights || Math.max(1, dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day'))
    }));
  }
  
  function renderReservationCalendarGrid({ month, bookings, dayjs, esc, canReschedule }) {
    if (!month) return '';
    const monthStart = month.startOf('month');
    const offset = (monthStart.day() + 6) % 7;
    const firstCell = monthStart.subtract(offset, 'day');
    const totalDays = month.daysInMonth();
    const totalCells = Math.ceil((offset + totalDays) / 7) * 7;
    const todayIso = dayjs().format('YYYY-MM-DD');
  
    const normalized = normalizeCalendarBookings(bookings, dayjs);
  
    const headerHtml = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
      .map(label => `<div class="bo-calendar-grid__day">${label}</div>`)
      .join('');
  
    const cellsHtml = Array.from({ length: totalCells }, (_, index) => {
      const cellDate = firstCell.add(index, 'day');
      const iso = cellDate.format('YYYY-MM-DD');
      const isCurrentMonth = cellDate.month() === month.month();
      const isToday = iso === todayIso;
      const bookingsForDay = normalized.filter(b => iso >= b.checkinISO && iso < b.checkoutISO);
      const bookingsHtml = bookingsForDay.length
        ? bookingsForDay.map(b => renderReservationCalendarEntry(b, dayjs, esc, canReschedule)).join('')
        : '<div class="bo-calendar-empty">Sem reservas</div>';
  
      const cellClasses = ['bo-calendar-grid__cell'];
      if (!isCurrentMonth) cellClasses.push('is-out');
      if (isToday) cellClasses.push('is-today');
      if ((index + 1) % 7 === 0) cellClasses.push('is-column-end');
  
      const cellAttributes = [
        `class="${cellClasses.join(' ')}"`,
        'data-calendar-cell',
        `data-date="${esc(iso)}"`,
        `data-in-month="${isCurrentMonth ? '1' : '0'}"`
      ];
  
      return `
        <div ${cellAttributes.join(' ')}>
          <div class="bo-calendar-day">${cellDate.format('DD')}</div>
          <div class="bo-calendar-cell-body">
            ${bookingsHtml}
          </div>
        </div>
      `;
    }).join('');
  
    return `
      <div class="bo-calendar-grid-wrapper">
        <div class="bo-calendar-grid-viewport">
          <div class="bo-calendar-grid">
            ${headerHtml}
            ${cellsHtml}
          </div>
        </div>
      </div>
    `;
  }
  
  function renderReservationCalendarEntry(booking, dayjs, esc, canReschedule) {
    const status = (booking.status || '').toUpperCase();
    let statusLabel = booking.status || 'Reserva';
    let statusClass = 'bo-calendar-entry__status bo-calendar-entry__status--default';
    if (status === 'CONFIRMED') {
      statusLabel = 'Confirmada';
      statusClass = 'bo-calendar-entry__status bo-calendar-entry__status--confirmed';
    } else if (status === 'PENDING') {
      statusLabel = 'Pendente';
      statusClass = 'bo-calendar-entry__status bo-calendar-entry__status--pending';
    }
  
    const isDraggable = !!canReschedule && status === 'CONFIRMED';
    const checkinISO = booking.checkinISO || dayjs(booking.checkin).format('YYYY-MM-DD');
    const checkoutISO = booking.checkoutISO || dayjs(booking.checkout).format('YYYY-MM-DD');
    const guestName = esc(booking.guest_name || `Reserva #${booking.id}`);
    const unitName = esc([booking.property_name, booking.unit_name].filter(Boolean).join(' · ') || 'Unidade');
    const checkinLabel = esc(booking.checkinLabel || booking.checkin_label || dayjs(booking.checkin).format('DD/MM'));
    const checkoutLabel = esc(booking.checkoutLabel || booking.checkout_label || dayjs(booking.checkout).format('DD/MM'));
    const nights = booking.nights || Math.max(1, dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day'));
    const agency = booking.agency ? `<div class="bo-calendar-entry__agency">${esc(booking.agency)}</div>` : '';
    const unitIdAttr = booking.unit_id != null ? String(booking.unit_id) : '';
  
    const entryAttributes = [
      `href="/admin/bookings/${booking.id}"`,
      `class="bo-calendar-entry${isDraggable ? ' is-draggable' : ''}"`,
      'data-calendar-entry',
      `data-entry-id="${esc(String(booking.id))}"`,
      `data-unit-id="${esc(unitIdAttr)}"`,
      `data-entry-start="${esc(checkinISO)}"`,
      `data-entry-end="${esc(checkoutISO)}"`,
      `data-entry-nights="${esc(String(nights))}"`,
      `data-entry-status="${esc(status)}"`
    ];
    if (isDraggable) entryAttributes.push('draggable="true"');
  
    return `
      <a ${entryAttributes.join(' ')}>
        <div class="bo-calendar-entry__header">
          <span class="bo-calendar-entry__guest">${guestName}</span>
          <span class="${statusClass}">${esc(statusLabel)}</span>
        </div>
        <div class="bo-calendar-entry__meta">
          <div class="bo-calendar-entry__unit">${unitName}</div>
          <div class="bo-calendar-entry__dates">${checkinLabel} - ${checkoutLabel}</div>
          <div class="bo-calendar-entry__nights">${nights} noite${nights === 1 ? '' : 's'}</div>
          ${agency}
        </div>
      </a>
    `;
  }
  
  function renderReservationCalendarGridMobile({ month, bookings, units, dayjs, esc }) {
    if (!month) return '';
  
    const normalized = normalizeCalendarBookings(bookings, dayjs)
      .sort((a, b) => dayjs(a.checkinISO).diff(dayjs(b.checkinISO)) || (a.id || 0) - (b.id || 0));
  
    const unitsMap = new Map((units || []).map(unit => [unit.id, { ...unit }]));
    const grouped = new Map();
  
    normalized.forEach(booking => {
      const unitId = booking.unit_id;
      if (unitId == null) return;
  
      if (!grouped.has(unitId)) {
        grouped.set(unitId, []);
      }
      grouped.get(unitId).push(booking);
  
      if (!unitsMap.has(unitId)) {
        unitsMap.set(unitId, {
          id: unitId,
          name: booking.unit_name || `Unidade #${unitId || booking.id}`,
          property_name: booking.property_name || ''
        });
      } else if (!unitsMap.get(unitId).property_name && booking.property_name) {
        unitsMap.get(unitId).property_name = booking.property_name;
      }
    });
  
    if (!unitsMap.size) return '';
  
    const legend = `
      <div class="bo-calendar-mobile__legend">
        <span class="bo-calendar-mobile__legend-item"><span class="bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--confirmed"></span>Confirmada</span>
        <span class="bo-calendar-mobile__legend-item"><span class="bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--pending"></span>Pendente</span>
        <span class="bo-calendar-mobile__legend-item"><span class="bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--blocked"></span>Bloqueio/Outro</span>
      </div>
    `;
  
    const overviewRows = normalized.length
      ? normalized.map(booking => {
          const status = (booking.status || '').toUpperCase();
          let statusLabel = 'Reserva';
          let statusClass = 'is-blocked';
          if (status === 'CONFIRMED') {
            statusLabel = 'Confirmada';
            statusClass = 'is-confirmed';
          } else if (status === 'PENDING') {
            statusLabel = 'Pendente';
            statusClass = 'is-pending';
          } else if (status === 'BLOCKED') {
            statusLabel = 'Bloqueio';
          }
  
          const guestRaw = booking.guest_name || `Reserva #${booking.id}`;
          const guest = esc(guestRaw);
          const unitNameRaw = booking.unit_name || `Unidade #${booking.unit_id}`;
          const propertyRaw = booking.property_name || '';
          const locationRaw = propertyRaw ? `${unitNameRaw} · ${propertyRaw}` : unitNameRaw;
          const location = esc(locationRaw);
          const href = booking.id ? `/admin/bookings/${booking.id}` : '#';
          const nights = booking.nights || Math.max(1, dayjs(booking.checkoutISO).diff(dayjs(booking.checkinISO), 'day'));
          const metaPartsRaw = [
            `${booking.checkinLabel} - ${booking.checkoutLabel}`,
            `${nights} noite${nights === 1 ? '' : 's'}`
          ];
          if (booking.agency) metaPartsRaw.push(booking.agency);
          const meta = metaPartsRaw.map(part => esc(part)).join(' · ');
          const ariaLabel = esc([
            locationRaw,
            guestRaw,
            ...metaPartsRaw,
            statusLabel
          ].filter(Boolean).join(' · '));
          const statusLabelEsc = esc(statusLabel);
  
          return `
            <a href="${esc(href)}" class="bo-calendar-mobile__overview-row ${statusClass}" aria-label="${ariaLabel}">
              <span class="bo-calendar-mobile__overview-unit">${location}</span>
              <span class="bo-calendar-mobile__overview-guest">${guest}</span>
              <span class="bo-calendar-mobile__overview-dates">${meta}</span>
              <span class="bo-calendar-mobile__overview-status ${statusClass}">${statusLabelEsc}</span>
            </a>
          `;
        }).join('')
      : '<div class="bo-calendar-mobile__overview-empty">Sem reservas neste período.</div>';
  
    const baseUnits = (units || []).map(unit => {
      const enriched = unitsMap.get(unit.id) || {};
      return { ...enriched, ...unit };
    });
    const fallbackUnits = Array.from(unitsMap.values()).filter(unit => !baseUnits.some(existing => existing.id === unit.id));
    const unitsToRender = [...baseUnits, ...fallbackUnits];
  
    const unitSections = unitsToRender.map(unit => {
      const unitBookings = grouped.get(unit.id) || [];
      const propertyNameRaw = unit.property_name || (unitBookings[0] && unitBookings[0].property_name) || '';
      const propertyName = propertyNameRaw ? esc(propertyNameRaw) : '';
  
      const bookingsHtml = unitBookings.length
        ? unitBookings.map(booking => {
            const status = (booking.status || '').toUpperCase();
            let statusLabel = 'Reserva';
            let statusClass = 'is-blocked';
            if (status === 'CONFIRMED') {
              statusLabel = 'Confirmada';
              statusClass = 'is-confirmed';
            } else if (status === 'PENDING') {
              statusLabel = 'Pendente';
              statusClass = 'is-pending';
            } else if (status === 'BLOCKED') {
              statusLabel = 'Bloqueio';
            }
  
            const nights = booking.nights || Math.max(1, dayjs(booking.checkoutISO).diff(dayjs(booking.checkinISO), 'day'));
            const metaPartsRaw = [
              `${booking.checkinLabel} - ${booking.checkoutLabel}`,
              `${nights} noite${nights === 1 ? '' : 's'}`
            ];
            if (booking.agency) metaPartsRaw.push(booking.agency);
            const meta = metaPartsRaw.map(part => esc(part)).join(' · ');
  
            const guestRaw = booking.guest_name || `Reserva #${booking.id}`;
            const guest = esc(guestRaw);
            const href = booking.id ? `/admin/bookings/${booking.id}` : '#';
            const unitNameRaw = booking.unit_name || unit.name || `Unidade #${booking.unit_id || unit.id}`;
            const unitLabelRaw = propertyNameRaw ? `${unitNameRaw} · ${propertyNameRaw}` : unitNameRaw;
            const ariaLabel = esc([
              unitLabelRaw,
              guestRaw,
              ...metaPartsRaw,
              statusLabel
            ].filter(Boolean).join(' · '));
            const statusLabelEsc = esc(statusLabel);
  
            return `
              <a href="${esc(href)}" class="bo-calendar-mobile__booking ${statusClass}" aria-label="${ariaLabel}">
                <div class="bo-calendar-mobile__booking-header">
                  <span class="bo-calendar-mobile__guest">${guest}</span>
                  <span class="bo-calendar-mobile__badge ${statusClass}">${statusLabelEsc}</span>
                </div>
                <div class="bo-calendar-mobile__booking-meta">${meta}</div>
              </a>
            `;
          }).join('')
        : '<div class="bo-calendar-mobile__empty">Sem reservas neste período.</div>';
  
      return `
        <section class="bo-calendar-mobile__unit" aria-label="Reservas da unidade ${esc(unit.name)}">
          <header class="bo-calendar-mobile__unit-header">
            <h3 class="bo-calendar-mobile__unit-name">${esc(unit.name || `Unidade #${unit.id}`)}</h3>
            ${propertyName ? `<span class="bo-calendar-mobile__unit-property">${propertyName}</span>` : ''}
          </header>
          <div class="bo-calendar-mobile__list">
            ${bookingsHtml}
          </div>
        </section>
      `;
    }).join('');
  
    return `
      <div class="bo-calendar-mobile" data-calendar-mobile>
        ${legend}
        <section class="bo-calendar-mobile__overview" aria-label="Pré-visualização de todas as reservas">
          <header class="bo-calendar-mobile__overview-header">
            <h3 class="bo-calendar-mobile__overview-title">Resumo de reservas</h3>
            <p class="bo-calendar-mobile__overview-hint">Visão rápida em formato tabela semelhante ao Excel.</p>
          </header>
          <div class="bo-calendar-mobile__overview-grid">
            <div class="bo-calendar-mobile__overview-row bo-calendar-mobile__overview-row--head">
              <span class="bo-calendar-mobile__overview-head">Unidade</span>
              <span class="bo-calendar-mobile__overview-head">Hóspede</span>
              <span class="bo-calendar-mobile__overview-head">Datas</span>
              <span class="bo-calendar-mobile__overview-head">Estado</span>
            </div>
            ${overviewRows}
          </div>
        </section>
        <div class="bo-calendar-mobile__preview">
          ${unitSections}
        </div>
      </div>
    `;
  }
  
  
  app.get('/calendar/unit/:id/card', requireLogin, requirePermission('calendar.view'), (req, res) => {
    const ym = req.query.ym;
    const month = (ym ? dayjs(ym + '-01') : dayjs().startOf('month')).startOf('month');
    const unit = db.prepare(`
      SELECT u.*, p.name as property_name
        FROM units u JOIN properties p ON p.id = u.property_id
       WHERE u.id = ?
    `).get(req.params.id);
    if (!unit) return res.status(404).send('');
    ensureNoIndexHeader(res);
    res.send(unitCalendarCard(unit, month));
  });
  
  app.post('/calendar/booking/:id/reschedule', requireLogin, requirePermission('calendar.reschedule'), (req, res) => {
    const id = Number(req.params.id);
    const booking = db.prepare(`
      SELECT b.*, u.base_price_cents
        FROM bookings b JOIN units u ON u.id = b.unit_id
       WHERE b.id = ?
    `).get(id);
    if (!booking) return res.status(404).json({ ok: false, message: 'Reserva não encontrada.' });
  
    const checkin = req.body && req.body.checkin;
    const checkout = req.body && req.body.checkout;
    if (!checkin || !checkout) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
    if (!dayjs(checkout).isAfter(dayjs(checkin))) return res.status(400).json({ ok: false, message: 'checkout deve ser > checkin' });
  
    const conflict = db.prepare(`
      SELECT 1 FROM bookings
       WHERE unit_id = ?
         AND id <> ?
         AND status IN ('CONFIRMED','PENDING')
         AND NOT (checkout <= ? OR checkin >= ?)
       LIMIT 1
    `).get(booking.unit_id, booking.id, checkin, checkout);
    if (conflict) return res.status(409).json({ ok: false, message: 'Conflito com outra reserva.' });
  
    const blockConflict = db.prepare(`
      SELECT 1 FROM blocks
       WHERE unit_id = ?
         AND NOT (end_date <= ? OR start_date >= ?)
       LIMIT 1
    `).get(booking.unit_id, checkin, checkout);
    if (blockConflict) return res.status(409).json({ ok: false, message: 'As novas datas estão bloqueadas.' });
  
    const quote = rateQuote(booking.unit_id, checkin, checkout, booking.base_price_cents);
    if (quote.nights < quote.minStayReq)
      return res.status(400).json({ ok: false, message: `Estadia mínima: ${quote.minStayReq} noites.` });
  
    try {
      overbookingGuard.reserveSlot({
        unitId: booking.unit_id,
        from: checkin,
        to: checkout,
        bookingId: booking.id,
        actorId: req.user ? req.user.id : null
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        return res.status(409).json({ ok: false, message: 'Conflito com outra reserva ou bloqueio.' });
      }
      throw err;
    }
  
    rescheduleBookingUpdateStmt.run(checkin, checkout, quote.total_cents, booking.id);
  
    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate({
        unitId: booking.unit_id,
        type: 'booking.reschedule',
        payload: {
          bookingId: booking.id,
          checkin,
          checkout
        }
      });
    }
  
    logChange(req.user.id, 'booking', booking.id, 'reschedule',
      { checkin: booking.checkin, checkout: booking.checkout, total_cents: booking.total_cents },
      { checkin, checkout, total_cents: quote.total_cents }
    );
  
    res.json({ ok: true, message: 'Reserva reagendada.', unit_id: booking.unit_id });
  });
  
  app.post('/calendar/booking/:id/cancel', requireLogin, requirePermission('calendar.cancel'), (req, res) => {
    const id = Number(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ ok: false, message: 'Reserva não encontrada.' });
  
    db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    deleteLockByBookingStmt.run(id);
    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate({
        unitId: booking.unit_id,
        type: 'booking.cancel',
        payload: { bookingId: booking.id }
      });
    }
    logChange(req.user.id, 'booking', id, 'cancel', {
      checkin: booking.checkin,
      checkout: booking.checkout,
      guest_name: booking.guest_name,
      status: booking.status,
      unit_id: booking.unit_id
    }, null);
  
    res.json({ ok: true, message: 'Reserva cancelada.', unit_id: booking.unit_id });
  });
  
  app.post('/calendar/block/:id/reschedule', requireLogin, requirePermission('calendar.block.manage'), (req, res) => {
    const id = Number(req.params.id);
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    if (!block) return res.status(404).json({ ok: false, message: 'Bloqueio não encontrado.' });
  
    const start = req.body && req.body.start_date;
    const end = req.body && req.body.end_date;
    if (!start || !end) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
    if (!dayjs(end).isAfter(dayjs(start))) return res.status(400).json({ ok: false, message: 'end_date deve ser > start_date' });
  
    const bookingConflict = db.prepare(`
      SELECT 1 FROM bookings
       WHERE unit_id = ?
         AND status IN ('CONFIRMED','PENDING')
         AND NOT (checkout <= ? OR checkin >= ?)
       LIMIT 1
    `).get(block.unit_id, start, end);
    if (bookingConflict) return res.status(409).json({ ok: false, message: 'Existem reservas neste período.' });
  
    const blockConflict = db.prepare(`
      SELECT 1 FROM blocks
       WHERE unit_id = ?
         AND id <> ?
         AND NOT (end_date <= ? OR start_date >= ?)
       LIMIT 1
    `).get(block.unit_id, block.id, start, end);
    if (blockConflict) return res.status(409).json({ ok: false, message: 'Conflito com outro bloqueio.' });
  
    rescheduleBlockUpdateStmt.run(start, end, block.id);
  
    logChange(req.user.id, 'block', block.id, 'reschedule',
      { start_date: block.start_date, end_date: block.end_date },
      { start_date: start, end_date: end }
    );
  
    res.json({ ok: true, message: 'Bloqueio atualizado.', unit_id: block.unit_id });
  });
  
  app.post('/calendar/unit/:unitId/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
    const unitId = Number(req.params.unitId);
    const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
    if (!unit) return res.status(404).json({ ok: false, message: 'Unidade não encontrada.' });
  
    const start = req.body && req.body.start_date;
    const end = req.body && req.body.end_date;
    if (!start || !end) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
    if (!dayjs(end).isAfter(dayjs(start))) return res.status(400).json({ ok: false, message: 'end_date deve ser > start_date' });
  
    const bookingConflict = db.prepare(`
      SELECT 1 FROM bookings
       WHERE unit_id = ?
         AND status IN ('CONFIRMED','PENDING')
         AND NOT (checkout <= ? OR checkin >= ?)
       LIMIT 1
    `).get(unitId, start, end);
    if (bookingConflict) return res.status(409).json({ ok: false, message: 'Existem reservas nestas datas.' });
  
    const blockConflict = db.prepare(`
      SELECT 1 FROM blocks
       WHERE unit_id = ?
         AND NOT (end_date <= ? OR start_date >= ?)
       LIMIT 1
    `).get(unitId, start, end);
    if (blockConflict) return res.status(409).json({ ok: false, message: 'Já existe um bloqueio neste período.' });
  
    const inserted = insertBlockStmt.run(unitId, start, end);
  
    logChange(req.user.id, 'block', inserted.lastInsertRowid, 'create', null, { start_date: start, end_date: end, unit_id: unitId });
  
    res.json({ ok: true, message: 'Bloqueio criado.', unit_id: unitId });
  });
  
  app.delete('/calendar/block/:id', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(req.params.id);
    if (!block) return res.status(404).json({ ok: false, message: 'Bloqueio não encontrado.' });
    db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
    logChange(req.user.id, 'block', block.id, 'delete', { start_date: block.start_date, end_date: block.end_date }, null);
    res.json({ ok: true, message: 'Bloqueio removido.', unit_id: block.unit_id });
  });
  
  function unitCalendarCard(u, month) {
    const monthStart = month.startOf('month');
    const daysInMonth = month.daysInMonth();
    const weekdayOfFirst = (monthStart.day() + 6) % 7;
    const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;
  
    const bookingRows = db
      .prepare(
        `SELECT id, checkin as s, checkout as e, guest_name, guest_email, guest_phone, status, adults, children, total_cents, agency
           FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')`
      )
      .all(u.id);
    const unitBlocks = db
      .prepare(
        `SELECT id, start_date, end_date, reason
           FROM unit_blocks
          WHERE unit_id = ?`
      )
      .all(u.id);
    const legacyBlocks = db
      .prepare(
        `SELECT id, start_date, end_date
           FROM blocks
          WHERE unit_id = ?`
      )
      .all(u.id);
  
    const blockEntries = unitBlocks.slice();
    legacyBlocks.forEach(block => {
      const duplicate = unitBlocks.some(
        modern => modern.start_date === block.start_date && modern.end_date === block.end_date
      );
      if (!duplicate) {
        blockEntries.push({ ...block, reason: null, legacy: true });
      }
    });
  
    const rawEntries = bookingRows
      .map(row => ({
        kind: 'BOOKING',
        id: row.id,
        s: row.s,
        e: row.e,
        guest_name: row.guest_name,
        guest_email: row.guest_email,
        guest_phone: row.guest_phone,
        status: row.status,
        adults: row.adults,
        children: row.children,
        total_cents: row.total_cents,
        agency: row.agency,
        label: `${row.guest_name || 'Reserva'} (${row.adults || 0}A+${row.children || 0}C)`
      }))
      .concat(
        blockEntries.map(entry => ({
          kind: 'BLOCK',
          id: entry.id,
          s: entry.start_date,
          e: entry.end_date,
          guest_name: 'Bloqueio',
          guest_email: null,
          guest_phone: null,
          status: 'BLOCK',
          adults: null,
          children: null,
          total_cents: null,
          agency: null,
          reason: entry.reason || null,
          label: 'Bloqueio de datas' + (entry.reason ? ` · ${entry.reason}` : '')
        }))
      );
  
    const bookingIds = rawEntries.filter(row => row.kind === 'BOOKING').map(row => row.id);
    const noteCounts = new Map();
    const noteLatest = new Map();
    if (bookingIds.length) {
      const placeholders = bookingIds.map(() => '?').join(',');
      const countsStmt = db.prepare(`SELECT booking_id, COUNT(*) AS c FROM booking_notes WHERE booking_id IN (${placeholders}) GROUP BY booking_id`);
      countsStmt.all(...bookingIds).forEach(row => noteCounts.set(row.booking_id, row.c));
      const latestStmt = db.prepare(`
        SELECT bn.booking_id, bn.note, bn.created_at, u.username
          FROM booking_notes bn
          JOIN users u ON u.id = bn.user_id
         WHERE bn.booking_id IN (${placeholders})
         ORDER BY bn.booking_id, bn.created_at DESC
      `);
      latestStmt.all(...bookingIds).forEach(row => {
        if (!noteLatest.has(row.booking_id)) {
          noteLatest.set(row.booking_id, {
            note: row.note,
            username: row.username,
            created_at: row.created_at
          });
        }
      });
    }
  
    const entries = rawEntries.map(row => {
      if (row.kind === 'BOOKING') {
        const latest = noteLatest.get(row.id) || null;
        const preview = latest && latest.note ? String(latest.note).slice(0, 180) : '';
        const meta = latest ? `${latest.username} · ${dayjs(latest.created_at).format('DD/MM HH:mm')}` : '';
        return {
          ...row,
          label: `${row.guest_name || 'Reserva'} (${row.adults || 0}A+${row.children || 0}C)`,
          note_count: noteCounts.get(row.id) || 0,
          note_preview: preview,
          note_meta: meta
        };
      }
      return {
        ...row,
        label: row.label || 'Bloqueio de datas',
        note_count: 0,
        note_preview: '',
        note_meta: ''
      };
    });
  
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayIndexInMonth = i - weekdayOfFirst + 1;
      const inMonth = dayIndexInMonth >= 1 && dayIndexInMonth <= daysInMonth;
      const d = monthStart.add(i - weekdayOfFirst, 'day');
  
      const date = d.format('YYYY-MM-DD');
      const nextDate = d.add(1, 'day').format('YYYY-MM-DD');
  
      const hit = entries.find(en => overlaps(en.s, en.e, date, nextDate));
      const classNames = ['calendar-cell'];
      if (!inMonth) {
        classNames.push('bg-slate-100', 'text-slate-400');
      } else if (!hit) {
        classNames.push('bg-emerald-500', 'text-white');
      } else if (hit.status === 'BLOCK') {
        classNames.push('bg-red-600', 'text-white');
      } else if (hit.status === 'PENDING') {
        classNames.push('bg-amber-400', 'text-black');
      } else {
        classNames.push('bg-rose-500', 'text-white');
      }
  
      const dataAttrs = [
        'data-calendar-cell',
        `data-unit="${u.id}"`,
        `data-date="${date}"`,
        `data-in-month="${inMonth ? 1 : 0}"`,
      ];
  
      if (hit) {
        dataAttrs.push(
          `data-entry-id="${hit.id}"`,
          `data-entry-kind="${hit.kind}"`,
          `data-entry-start="${hit.s}"`,
          `data-entry-end="${hit.e}"`,
          `data-entry-status="${hit.status}"`,
          `data-entry-label="${esc(hit.label)}"`
        );
        if (hit.kind === 'BOOKING') {
          dataAttrs.push(
            `data-entry-url="/admin/bookings/${hit.id}"`,
            `data-entry-cancel-url="/calendar/booking/${hit.id}/cancel"`,
            `data-entry-agency="${esc(hit.agency || '')}"`,
            `data-entry-total="${hit.total_cents || 0}"`,
            `data-entry-guest="${esc(hit.guest_name || '')}"`,
            `data-entry-email="${esc(hit.guest_email || '')}"`,
            `data-entry-phone="${esc(hit.guest_phone || '')}"`,
            `data-entry-adults="${hit.adults || 0}"`,
            `data-entry-children="${hit.children || 0}"`,
            `data-entry-note-count="${hit.note_count || 0}"`,
            `data-entry-note-preview="${esc(hit.note_preview || '')}"`,
            `data-entry-note-meta="${esc(hit.note_meta || '')}"`
          );
        }
      }
  
      const title = hit ? ` title="${(hit.label || '').replace(/"/g, "'")}"` : '';
      cells.push(`<div class="${classNames.join(' ')}" ${dataAttrs.join(' ')}${title}>${d.date()}</div>`);
    }
  
    const weekdayHeader = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']
      .map(w => `<div class="text-center text-xs text-slate-500 py-1">${w}</div>`)
      .join('');
    const badgeSummaries = blockEntries.map(block => {
      const startLabel = dayjs(block.start_date).format('DD/MM');
      const endLabel = dayjs(block.end_date).isValid()
        ? dayjs(block.end_date).subtract(1, 'day').format('DD/MM')
        : dayjs(block.end_date).format('DD/MM');
      const reason = block.reason ? ` · ${esc(block.reason)}` : '';
      return `${startLabel}–${endLabel}${reason}`;
    });
    const blockBadge = blockEntries.length
      ? ` <span class="bo-status-badge bo-status-badge--warning" data-block-badge="${u.id}" title="${esc(
          'Bloqueado ' + badgeSummaries.join(', ')
        )}">Bloqueado</span>`
      : ` <span class="bo-status-badge bo-status-badge--warning hidden" data-block-badge="${u.id}" hidden>Bloqueado</span>`;
  
    return `
      <div class="card p-4 calendar-card" data-unit-card="${u.id}" data-unit-name="${esc(u.name)}">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm text-slate-500">${u.property_name}</div>
            <h3 class="text-lg font-semibold">${esc(u.name)}${blockBadge}</h3>
          </div>
          <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${u.id}">Gerir</a>
        </div>
        <div class="calendar-grid mb-1">${weekdayHeader}</div>
        <div class="calendar-grid" data-calendar-unit="${u.id}">${cells.join('')}</div>
      </div>
    `;
  }
  

}

module.exports = { registerCalendar };
