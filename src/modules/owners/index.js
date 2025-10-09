const percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 0 });
const integerFormatter = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

module.exports = function registerOwnersPortal(app, context) {
  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    eur,
    requireLogin,
    userCan,
    userHasBackofficeAccess
  } = context;

  function ensureOwnerPortalAccess(req, res, next) {
    if (!req.user) {
      return res.status(401).send('Sessão expirada.');
    }
    if (!userCan(req.user, 'owners.portal.view')) {
      return res.status(403).send('Sem permissão para aceder à área de proprietários.');
    }
    next();
  }

  function formatLocation(row) {
    const parts = [row.locality, row.district].map(value => (value || '').trim()).filter(Boolean);
    return parts.join(' · ');
  }

  function normalizeChannelLabel(rawValue) {
    const value = (rawValue || '').trim();
    if (!value) return 'Direto';
    const lower = value.toLowerCase();
    if (lower === 'booking' || lower === 'booking.com') return 'Booking.com';
    if (lower === 'airbnb') return 'Airbnb';
    if (lower === 'expedia') return 'Expedia';
    if (lower === 'vrbo') return 'Vrbo';
    if (lower === 'i-escape' || lower === 'iescape') return 'i-escape';
    if (lower === 'splendia') return 'Splendia';
    return value
      .split(' ')
      .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ');
  }

  function buildStatusPill(status) {
    const normalized = (status || '').toUpperCase();
    if (normalized === 'CONFIRMED') {
      return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Confirmada</span>';
    }
    if (normalized === 'PENDING') {
      return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Pendente</span>';
    }
    if (normalized === 'CANCELLED') {
      return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">Cancelada</span>';
    }
    return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">${esc(normalized || 'Estado')}</span>`;
  }

  app.get('/owners', requireLogin, ensureOwnerPortalAccess, (req, res) => {
    const viewer = req.user;
    const today = dayjs().startOf('day');
    const last30Start = today.subtract(29, 'day');
    const last30EndExclusive = today.add(1, 'day');
    const monthStart = today.startOf('month');
    const monthEnd = monthStart.add(1, 'month');
    const weekStart = today.startOf('week');
    const weekEnd = weekStart.add(7, 'day');
    const upcomingWindowEnd = today.add(90, 'day');

    const allProperties = userHasBackofficeAccess(viewer)
      ? db.prepare('SELECT id, name, locality, district, address FROM properties ORDER BY name').all()
      : db
          .prepare(
            `SELECT p.id, p.name, p.locality, p.district, p.address
               FROM property_owners po
               JOIN properties p ON p.id = po.property_id
              WHERE po.user_id = ?
              ORDER BY p.name`
          )
          .all(viewer.id);

    const requestedPropertyId = Number.parseInt(req.query.property, 10);
    const hasRequestedProperty = !Number.isNaN(requestedPropertyId) && allProperties.some(p => p.id === requestedPropertyId);
    const activeProperties = hasRequestedProperty ? allProperties.filter(p => p.id === requestedPropertyId) : allProperties;

    const propertySummaries = new Map();
    activeProperties.forEach(property => {
      propertySummaries.set(property.id, {
        id: property.id,
        name: property.name,
        location: formatLocation(property),
        totalUnits: 0,
        totalCapacity: 0,
        availableNights: 0,
        revenue30: 0,
        nights30: 0,
        occupancy30: 0,
        pendingCount: 0,
        confirmedThisMonth: 0,
        weekCheckins: 0,
        upcoming: [],
        channelCounts: new Map()
      });
    });

    const propertyIds = Array.from(propertySummaries.keys());

    let totalRevenue30 = 0;
    let totalNights30 = 0;
    let totalAvailableNights = 0;
    let totalPendingBookings = 0;
    let totalConfirmedThisMonth = 0;
    let totalWeekCheckins = 0;

    const globalUpcoming = [];
    const globalChannelCounts = new Map();

    if (propertyIds.length) {
      const placeholders = propertyIds.map(() => '?').join(',');

      const units = db
        .prepare(`SELECT id, property_id, name, capacity FROM units WHERE property_id IN (${placeholders}) ORDER BY name`)
        .all(...propertyIds);

      units.forEach(unit => {
        const summary = propertySummaries.get(unit.property_id);
        if (!summary) return;
        summary.totalUnits += 1;
        summary.totalCapacity += Number.isFinite(unit.capacity) ? Number(unit.capacity) : 0;
      });

      const bookings = db
        .prepare(
          `SELECT b.id,
                  b.checkin,
                  b.checkout,
                  b.total_cents,
                  b.status,
                  b.guest_name,
                  b.agency,
                  b.source_channel,
                  u.property_id,
                  u.name AS unit_name,
                  p.name AS property_name
             FROM bookings b
             JOIN units u ON u.id = b.unit_id
             JOIN properties p ON p.id = u.property_id
            WHERE u.property_id IN (${placeholders})
              AND b.checkout > ?
            ORDER BY b.checkin ASC`
        )
        .all(...propertyIds, last30Start.format('YYYY-MM-DD'));

      bookings.forEach(booking => {
        const summary = propertySummaries.get(booking.property_id);
        if (!summary) return;

        const status = (booking.status || '').toUpperCase();
        const checkinDate = dayjs(booking.checkin);
        const checkoutDate = dayjs(booking.checkout);
        if (!checkinDate.isValid() || !checkoutDate.isValid()) return;

        const bookingNights = Math.max(1, checkoutDate.diff(checkinDate, 'day'));
        const channelLabel = normalizeChannelLabel(booking.source_channel || booking.agency);

        const overlapsLast30 = checkoutDate.isAfter(last30Start) && checkinDate.isBefore(last30EndExclusive);
        const isConfirmed = status === 'CONFIRMED';
        const isPending = status === 'PENDING';

        if (isPending) {
          summary.pendingCount += 1;
          totalPendingBookings += 1;
        }

        if (isConfirmed && overlapsLast30) {
          summary.revenue30 += Number(booking.total_cents || 0);
          totalRevenue30 += Number(booking.total_cents || 0);

          const overlapStart = dayjs.max(checkinDate, last30Start);
          const overlapEnd = dayjs.min(checkoutDate, last30EndExclusive);
          const overlapNights = Math.max(0, overlapEnd.diff(overlapStart, 'day'));
          summary.nights30 += overlapNights;
          totalNights30 += overlapNights;

          summary.channelCounts.set(channelLabel, (summary.channelCounts.get(channelLabel) || 0) + 1);
          globalChannelCounts.set(channelLabel, (globalChannelCounts.get(channelLabel) || 0) + 1);
        }

        if (isConfirmed && !checkinDate.isBefore(monthStart) && checkinDate.isBefore(monthEnd)) {
          summary.confirmedThisMonth += 1;
          totalConfirmedThisMonth += 1;
        }

        if (isConfirmed && !checkinDate.isBefore(weekStart) && checkinDate.isBefore(weekEnd)) {
          summary.weekCheckins += 1;
          totalWeekCheckins += 1;
        }

        const shouldShowUpcoming = (isConfirmed || isPending) && !checkoutDate.isBefore(today) && checkinDate.isBefore(upcomingWindowEnd);
        if (shouldShowUpcoming) {
          const upcomingItem = {
            id: booking.id,
            propertyId: booking.property_id,
            propertyName: booking.property_name,
            unitName: booking.unit_name,
            guestName: booking.guest_name,
            checkinIso: checkinDate.format('YYYY-MM-DD'),
            checkinLabel: checkinDate.format('DD/MM/YYYY'),
            checkoutLabel: checkoutDate.format('DD/MM/YYYY'),
            nights: bookingNights,
            totalCents: Number(booking.total_cents || 0),
            status,
            channelLabel
          };
          summary.upcoming.push(upcomingItem);
          globalUpcoming.push(upcomingItem);
        }
      });
    }

    const propertyList = activeProperties
      .map(property => {
        const summary = propertySummaries.get(property.id);
        if (!summary) return null;
        summary.availableNights = summary.totalUnits * 30;
        summary.occupancy30 = summary.availableNights ? summary.nights30 / summary.availableNights : 0;
        totalAvailableNights += summary.availableNights;
        summary.upcoming.sort((a, b) => a.checkinIso.localeCompare(b.checkinIso));
        summary.channelList = Array.from(summary.channelCounts.entries()).sort((a, b) => b[1] - a[1]);
        return summary;
      })
      .filter(Boolean);

    const occupancyRate = totalAvailableNights ? totalNights30 / totalAvailableNights : 0;
    const upcomingPreview = globalUpcoming.sort((a, b) => a.checkinIso.localeCompare(b.checkinIso)).slice(0, 10);
    const channelSummary = Array.from(globalChannelCounts.entries()).sort((a, b) => b[1] - a[1]);
    const channelTotalCount = channelSummary.reduce((sum, [, value]) => sum + value, 0);

    const propertyFilterOptions = allProperties
      .map(property => {
        const selected = hasRequestedProperty && property.id === requestedPropertyId;
        return `<option value="${property.id}"${selected ? ' selected' : ''}>${esc(property.name)}</option>`;
      })
      .join('');

    const filterFormHtml =
      allProperties.length > 1
        ? html`
            <form method="get" class="card p-4 flex flex-wrap items-end gap-3">
              <div class="flex-1 min-w-[220px]">
                <label class="block text-sm font-semibold text-slate-600">Propriedade</label>
                <select name="property" class="input mt-1">
                  <option value="">Todas as propriedades</option>
                  ${propertyFilterOptions}
                </select>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-muted" type="submit">Atualizar</button>
                ${hasRequestedProperty ? html`<a class="btn btn-light" href="/owners">Limpar filtro</a>` : ''}
              </div>
            </form>
          `
        : '';

    const summaryCardsHtml = html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="card p-5 flex flex-col gap-2">
          <span class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Receita últimos 30 dias</span>
          <span class="text-3xl font-semibold text-slate-800">€ ${eur(totalRevenue30)}</span>
          <span class="text-xs text-slate-500">Reservas confirmadas com estadia neste período.</span>
        </div>
        <div class="card p-5 flex flex-col gap-2">
          <span class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Noites vendidas (30 dias)</span>
          <span class="text-3xl font-semibold text-slate-800">${integerFormatter.format(totalNights30)}</span>
          <span class="text-xs text-slate-500">Soma das noites ocupadas nas últimas quatro semanas.</span>
        </div>
        <div class="card p-5 flex flex-col gap-2">
          <span class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Taxa de ocupação (30 dias)</span>
          <span class="text-3xl font-semibold text-slate-800">${percentFormatter.format(occupancyRate || 0)}</span>
          <span class="text-xs text-slate-500">Considera ${integerFormatter.format(totalAvailableNights)} noites disponíveis.</span>
        </div>
        <div class="card p-5 flex flex-col gap-2">
          <span class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Check-ins esta semana</span>
          <span class="text-3xl font-semibold text-slate-800">${integerFormatter.format(totalWeekCheckins)}</span>
          <span class="text-xs text-slate-500">Reservas confirmadas com entrada até ${weekEnd.subtract(1, 'day').format('DD/MM')}.</span>
        </div>
      </section>
    `;

    const pendingBannerHtml =
      totalPendingBookings > 0
        ? html`
            <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex flex-col gap-1">
              <strong class="text-amber-900">${integerFormatter.format(totalPendingBookings)} reserva(s) pendente(s)</strong>
              <span>Assim que a equipa confirmar, o hóspede recebe automaticamente um email com a validação final.</span>
            </div>
          `
        : '';

    const propertySectionsHtml = propertyList.length
      ? propertyList
          .map(summary => {
            const occupancyLabel = percentFormatter.format(summary.occupancy30 || 0);
            const revenueLabel = `€ ${eur(summary.revenue30)}`;
            const pendingHtml =
              summary.pendingCount > 0
                ? `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">${summary.pendingCount} pendente(s)</span>`
                : `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">Sem pendentes</span>`;
            const upcomingItems = summary.upcoming.slice(0, 5);
            const upcomingListHtml = upcomingItems.length
              ? upcomingItems
                  .map(item => {
                    return `<li class="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2">
                      <div>
                        <div class="font-semibold text-slate-700">${esc(item.unitName)}</div>
                        <div class="text-xs text-slate-500">${esc(item.guestName || 'Hóspede sem nome')} · ${item.checkinLabel} - ${item.checkoutLabel} (${integerFormatter.format(item.nights)} noite(s))</div>
                      </div>
                      <div class="flex flex-col items-end gap-1">
                        ${buildStatusPill(item.status)}
                        <span class="text-xs text-slate-500">${esc(item.channelLabel)}</span>
                      </div>
                    </li>`;
                  })
                  .join('')
              : '<li class="text-sm text-slate-500">Sem reservas futuras nos próximos 90 dias.</li>';
            const channelListHtml = summary.channelList.length
              ? summary.channelList
                  .map(([label, count]) => {
                    return `<li class="flex items-center justify-between gap-3 text-sm text-slate-600"><span>${esc(label)}</span><span class="font-semibold text-slate-800">${integerFormatter.format(count)}</span></li>`;
                  })
                  .join('')
              : '<li class="text-sm text-slate-500">Sem reservas confirmadas nos últimos 30 dias.</li>';

            return html`
              <section class="card p-6 space-y-5">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 class="text-xl font-semibold text-slate-800">${esc(summary.name)}</h2>
                    ${summary.location ? `<p class="text-sm text-slate-500">${esc(summary.location)}</p>` : ''}
                  </div>
                  <div class="flex flex-wrap gap-2 text-xs text-slate-600">
                    <span class="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 font-semibold">${integerFormatter.format(summary.totalUnits)} unidade(s)</span>
                    <span class="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 font-semibold">Capacidade total: ${integerFormatter.format(summary.totalCapacity)} hóspedes</span>
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="rounded-xl border border-slate-200 p-4">
                    <div class="text-xs text-slate-500 uppercase tracking-wide">Receita 30 dias</div>
                    <div class="text-lg font-semibold text-slate-800">${revenueLabel}</div>
                  </div>
                  <div class="rounded-xl border border-slate-200 p-4">
                    <div class="text-xs text-slate-500 uppercase tracking-wide">Ocupação 30 dias</div>
                    <div class="text-lg font-semibold text-slate-800">${occupancyLabel}</div>
                  </div>
                  <div class="rounded-xl border border-slate-200 p-4">
                    <div class="text-xs text-slate-500 uppercase tracking-wide">Reservas confirmadas (mês)</div>
                    <div class="text-lg font-semibold text-slate-800">${integerFormatter.format(summary.confirmedThisMonth)}</div>
                  </div>
                  <div class="rounded-xl border border-slate-200 p-4 flex flex-col gap-2">
                    <div class="text-xs text-slate-500 uppercase tracking-wide">Estado actual</div>
                    ${pendingHtml}
                  </div>
                </div>
                <div class="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">Próximas reservas</h3>
                    <ul class="grid gap-2">${upcomingListHtml}</ul>
                  </div>
                  <div>
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">Canais (últimos 30 dias)</h3>
                    <ul class="space-y-2">${channelListHtml}</ul>
                  </div>
                </div>
              </section>
            `;
          })
          .join('')
      : html`
          <section class="card p-6 space-y-3 text-slate-600">
            <h2 class="text-lg font-semibold text-slate-800">Sem propriedades atribuídas</h2>
            <p>Para consultar dados operacionais precisa que a direção associe a sua conta às propriedades relevantes.</p>
            <p class="text-sm text-slate-500">Assim que existir pelo menos uma propriedade atribuída, esta área mostra reservas, receita e canais actualizados em tempo real.</p>
          </section>
        `;

    const upcomingTableHtml = upcomingPreview.length
      ? html`
          <section class="card p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold text-slate-800">Próximas chegadas</h2>
                <p class="text-sm text-slate-500">As 10 reservas com entrada mais próxima entre as suas propriedades.</p>
              </div>
              <span class="text-xs font-semibold text-slate-500">Actualizado a ${dayjs().format('DD/MM/YYYY HH:mm')}</span>
            </div>
            <div class="overflow-x-auto -mx-3 sm:mx-0">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Check-in</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Propriedade</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Unidade</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Hóspede</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Noites</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Canal</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Total</th>
                    <th class="px-3 py-2 text-left font-semibold text-slate-600">Estado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${upcomingPreview
                    .map(item => {
                      return `<tr>
                        <td class="px-3 py-2 whitespace-nowrap">${esc(item.checkinLabel)}</td>
                        <td class="px-3 py-2">${esc(item.propertyName)}</td>
                        <td class="px-3 py-2">${esc(item.unitName)}</td>
                        <td class="px-3 py-2">${esc(item.guestName || '—')}</td>
                        <td class="px-3 py-2 text-center">${integerFormatter.format(item.nights)}</td>
                        <td class="px-3 py-2">${esc(item.channelLabel)}</td>
                        <td class="px-3 py-2 whitespace-nowrap">€ ${eur(item.totalCents)}</td>
                        <td class="px-3 py-2 text-right">${buildStatusPill(item.status)}</td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </section>
        `
      : '';

    const channelSummaryHtml = channelSummary.length
      ? html`
          <section class="card p-6 space-y-3">
            <h2 class="text-lg font-semibold text-slate-800">Distribuição por canal (30 dias)</h2>
            <p class="text-sm text-slate-500">Contagem de reservas confirmadas com estadia nas últimas quatro semanas.</p>
            <ul class="space-y-2">
              ${channelSummary
                .map(([label, count]) => {
                  const percentage = channelTotalCount ? count / channelTotalCount : 0;
                  return `<li class="flex items-center justify-between gap-3 text-sm text-slate-600">
                    <span>${esc(label)}</span>
                    <span class="font-semibold text-slate-800">${integerFormatter.format(count)} (${percentFormatter.format(percentage)})</span>
                  </li>`;
                })
                .join('')}
            </ul>
          </section>
        `
      : '';

    const body = html`
      <div class="owners-portal space-y-6">
        <header class="space-y-2">
          <span class="pill-indicator">Área de Proprietários</span>
          <h1 class="text-3xl font-semibold text-slate-800">Resumo de desempenho</h1>
          <p class="text-slate-600 max-w-3xl">Consulte receita recente, reservas futuras e a origem dos seus hóspedes sem precisar de aceder ao backoffice.</p>
        </header>
        ${filterFormHtml}
        ${summaryCardsHtml}
        ${pendingBannerHtml}
        ${propertySectionsHtml}
        ${upcomingTableHtml}
        ${channelSummaryHtml}
      </div>
    `;

    res.send(
      layout({
        title: 'Área de Proprietários',
        user: viewer,
        activeNav: 'owners',
        pageClass: 'page-owners',
        body
      })
    );
  });
};
