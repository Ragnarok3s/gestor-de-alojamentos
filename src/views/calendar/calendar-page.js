'use strict';

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
  const agency = booking.agency ? `<div class=\"bo-calendar-entry__agency\">${esc(booking.agency)}</div>` : '';
  const unitIdAttr = booking.unit_id != null ? String(booking.unit_id) : '';

  const entryAttributes = [
    `href=\"/admin/bookings/${booking.id}\"`,
    `class=\"bo-calendar-entry${isDraggable ? ' is-draggable' : ''}\"`,
    'data-calendar-entry',
    `data-entry-id=\"${esc(String(booking.id))}\"`,
    `data-unit-id=\"${esc(unitIdAttr)}\"`,
    `data-entry-start=\"${esc(checkinISO)}\"`,
    `data-entry-end=\"${esc(checkoutISO)}\"`,
    `data-entry-nights=\"${esc(String(nights))}\"`,
    `data-entry-status=\"${esc(status)}\"`
  ];
  if (isDraggable) entryAttributes.push('draggable=\"true\"');

  return `
      <a ${entryAttributes.join(' ')}>
        <div class=\"bo-calendar-entry__header\">
          <span class=\"bo-calendar-entry__guest\">${guestName}</span>
          <span class=\"${statusClass}\">${esc(statusLabel)}</span>
        </div>
        <div class=\"bo-calendar-entry__meta\">
          <div class=\"bo-calendar-entry__unit\">${unitName}</div>
          <div class=\"bo-calendar-entry__dates\">${checkinLabel} - ${checkoutLabel}</div>
          <div class=\"bo-calendar-entry__nights\">${nights} noite${nights === 1 ? '' : 's'}</div>
          ${agency}
        </div>
      </a>
    `;
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
    .map(label => `<div class=\"bo-calendar-grid__day\">${label}</div>`)
    .join('');

  const cellsHtml = Array.from({ length: totalCells }, (_, index) => {
    const cellDate = firstCell.add(index, 'day');
    const iso = cellDate.format('YYYY-MM-DD');
    const isCurrentMonth = cellDate.month() === month.month();
    const isToday = iso === todayIso;
    const bookingsForDay = normalized.filter(b => iso >= b.checkinISO && iso < b.checkoutISO);
    const bookingsHtml = bookingsForDay.length
      ? bookingsForDay.map(b => renderReservationCalendarEntry(b, dayjs, esc, canReschedule)).join('')
      : '<div class=\"bo-calendar-empty\">Sem reservas</div>';

    const cellClasses = ['bo-calendar-grid__cell'];
    if (!isCurrentMonth) cellClasses.push('is-out');
    if (isToday) cellClasses.push('is-today');
    if ((index + 1) % 7 === 0) cellClasses.push('is-column-end');

    const cellAttributes = [
      `class=\"${cellClasses.join(' ')}\"`,
      'data-calendar-cell',
      `data-date=\"${esc(iso)}\"`,
      `data-in-month=\"${isCurrentMonth ? '1' : '0'}\"`
    ];

    return `
        <div ${cellAttributes.join(' ')}>
          <div class=\"bo-calendar-day\">${cellDate.format('DD')}</div>
          <div class=\"bo-calendar-cell-body\">
            ${bookingsHtml}
          </div>
        </div>
      `;
  }).join('');

  return `
      <div class=\"bo-calendar-grid-wrapper\">
        <div class=\"bo-calendar-grid-viewport\">
          <div class=\"bo-calendar-grid\">
            ${headerHtml}
            ${cellsHtml}
          </div>
        </div>
      </div>
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
      <div class=\"bo-calendar-mobile__legend\">
        <span class=\"bo-calendar-mobile__legend-item\"><span class=\"bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--confirmed\"></span>Confirmada</span>
        <span class=\"bo-calendar-mobile__legend-item\"><span class=\"bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--pending\"></span>Pendente</span>
        <span class=\"bo-calendar-mobile__legend-item\"><span class=\"bo-calendar-mobile__legend-dot bo-calendar-mobile__legend-dot--blocked\"></span>Bloqueio/Outro</span>
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
            <a href=\"${esc(href)}\" class=\"bo-calendar-mobile__overview-row ${statusClass}\" aria-label=\"${ariaLabel}\">
              <span class=\"bo-calendar-mobile__overview-unit\">${location}</span>
              <span class=\"bo-calendar-mobile__overview-guest\">${guest}</span>
              <span class=\"bo-calendar-mobile__overview-dates\">${meta}</span>
              <span class=\"bo-calendar-mobile__overview-status ${statusClass}\">${statusLabelEsc}</span>
            </a>
          `;
      }).join('')
    : '<div class=\"bo-calendar-mobile__overview-empty\">Sem reservas neste período.</div>';

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
              <a href=\"${esc(href)}\" class=\"bo-calendar-mobile__booking ${statusClass}\" aria-label=\"${ariaLabel}\">
                <div class=\"bo-calendar-mobile__booking-header\">
                  <span class=\"bo-calendar-mobile__guest\">${guest}</span>
                  <span class=\"bo-calendar-mobile__badge ${statusClass}\">${statusLabelEsc}</span>
                </div>
                <div class=\"bo-calendar-mobile__booking-meta\">${meta}</div>
              </a>
            `;
        }).join('')
      : '<div class=\"bo-calendar-mobile__empty\">Sem reservas neste período.</div>';

    return `
        <section class=\"bo-calendar-mobile__unit\" aria-label=\"Reservas da unidade ${esc(unit.name)}\">
          <header class=\"bo-calendar-mobile__unit-header\">
            <h3 class=\"bo-calendar-mobile__unit-name\">${esc(unit.name || `Unidade #${unit.id}`)}</h3>
            ${propertyName ? `<span class=\"bo-calendar-mobile__unit-property\">${propertyName}</span>` : ''}
          </header>
          <div class=\"bo-calendar-mobile__list\">
            ${bookingsHtml}
          </div>
        </section>
      `;
  }).join('');

  return `
      <div class=\"bo-calendar-mobile\" data-calendar-mobile>
        ${legend}
        <section class=\"bo-calendar-mobile__overview\" aria-label=\"Pré-visualização de todas as reservas\">
          <header class=\"bo-calendar-mobile__overview-header\">
            <h3 class=\"bo-calendar-mobile__overview-title\">Resumo de reservas</h3>
            <p class=\"bo-calendar-mobile__overview-hint\">Visão rápida em formato tabela semelhante ao Excel.</p>
          </header>
          <div class=\"bo-calendar-mobile__overview-grid\">
            <div class=\"bo-calendar-mobile__overview-row bo-calendar-mobile__overview-row--head\">
              <span class=\"bo-calendar-mobile__overview-head\">Unidade</span>
              <span class=\"bo-calendar-mobile__overview-head\">Hóspede</span>
              <span class=\"bo-calendar-mobile__overview-head\">Datas</span>
              <span class=\"bo-calendar-mobile__overview-head\">Estado</span>
            </div>
            ${overviewRows}
          </div>
        </section>
        <div class=\"bo-calendar-mobile__preview\">
          ${unitSections}
        </div>
      </div>
    `;
}

function renderCalendarPage({
  html,
  esc,
  dayjs,
  formatMonthYear,
  renderModalShell,
  data,
  featureFlags,
  permissions
}) {
  const {
    month,
    prev,
    next,
    properties,
    propertyMap,
    propertyId,
    units,
    rawFilters,
    startDate,
    endDate,
    selectedUnitId,
    selectedUnit,
    bookings,
    confirmedCount,
    pendingCount,
    totalNights,
    uniqueUnits,
    queryState
  } = data;

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
  const canRescheduleCalendar = !!permissions.canRescheduleCalendar;
  const canExportCalendar = !!permissions.canExportCalendar && !!featureFlags.enableExportShortcuts;

  const startInputValue = startDate.format('YYYY-MM-DD');
  const endInputValue = endDate.format('YYYY-MM-DD');

  const activeYm = month.format('YYYY-MM');
  const safeSelectedUnitName = selectedUnit ? esc(selectedUnit.name) : '';
  const unitCardFetchHref = selectedUnit ? `/calendar/unit/${selectedUnit.id}/card` : '';

  const calendarExportShortcut = canExportCalendar ? '<a class="btn btn-primary" href="/admin/export">Exportar Excel</a>' : '';
  const unitCardButton = featureFlags.enableUnitCardModal
    ? `<button type="button" class="btn btn-light" data-unit-card-trigger data-unit-card-title="Cartão da unidade" data-unit-card-loading="A preparar o cartão da unidade..." ${selectedUnit ? `data-unit-id="${selectedUnit.id}" data-unit-card-name="${safeSelectedUnitName}" data-unit-card-fetch="${esc(unitCardFetchHref)}"` : 'disabled aria-disabled="true" title="Selecione uma unidade nos filtros"'} data-unit-card-ym="${esc(activeYm)}">Cartão da unidade</button>`
    : '';
  const unitCardModalShell = featureFlags.enableUnitCardModal
    ? html`${renderModalShell({
        id: 'unit-card-modal',
        title: 'Cartão da unidade',
        body: '<div class="bo-modal__placeholder">Selecione uma unidade para consultar o cartão.</div>',
        extraRootAttr: 'data-unit-card-modal'
      })}`
    : '';
  const unitCardScriptTag = featureFlags.enableUnitCardModal ? html`<script src="/public/js/card-modal.js"></script>` : '';

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
            <a class="btn btn-light" href="${esc(prevLink)}">&larr; ${formatMonthYear(`${prev}-01`)}</a>
            <div class="bo-calendar-monthlabel">${formatMonthYear(month.format('YYYY-MM-DD'))}</div>
            <a class="btn btn-light" href="${esc(nextLink)}">${formatMonthYear(`${next}-01`)} &rarr;</a>
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

  const dragDropScript = html`<script src="/public/js/calendar/drag-and-drop.js" defer></script>`;

  return {
    body: html`
        <div class="bo-main">
          <header class="bo-header">
            <h1>Mapa de reservas</h1>
            <p>Acompanhe todas as reservas da propriedade num calendário único com filtros rápidos.</p>
          </header>
          ${calendarSummaryCard}
          ${calendarFiltersCard}
          ${calendarBoard}
          ${dragDropScript}
          ${unitCardModalShell}
          ${unitCardScriptTag}
        </div>
      `
  };
}

module.exports = {
  renderCalendarPage,
  normalizeCalendarBookings,
  renderReservationCalendarGrid,
  renderReservationCalendarGridMobile
};
