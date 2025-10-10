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
    userHasBackofficeAccess,
    resolveBrandingForRequest
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
      return '<span class="owners-status owners-status--confirmed">Confirmada</span>';
    }
    if (normalized === 'PENDING') {
      return '<span class="owners-status owners-status--pending">Pendente</span>';
    }
    if (normalized === 'CANCELLED') {
      return '<span class="owners-status owners-status--cancelled">Cancelada</span>';
    }
    return `<span class="owners-status owners-status--default">${esc(normalized || 'Estado')}</span>`;
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
            <form method="get" class="bo-card owners-filter">
              <div class="form-field owners-filter__field">
                <span class="form-label">Propriedade</span>
                <select name="property" class="input">
                  <option value="">Todas as propriedades</option>
                  ${propertyFilterOptions}
                </select>
              </div>
              <div class="owners-filter__actions">
                <button class="btn btn-primary" type="submit">Atualizar</button>
                ${hasRequestedProperty ? html`<a class="btn btn-light" href="/owners">Limpar filtro</a>` : ''}
              </div>
            </form>
          `
        : '';

    const summaryCardsHtml = html`
      <section class="bo-card owners-summary">
        <div class="bo-metrics">
          <article class="bo-metric">
            <span class="owners-metric-label">Receita últimos 30 dias</span>
            <strong>€ ${eur(totalRevenue30)}</strong>
            <p class="owners-metric-hint">Reservas confirmadas com estadia neste período.</p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Noites vendidas (30 dias)</span>
            <strong>${integerFormatter.format(totalNights30)}</strong>
            <p class="owners-metric-hint">Soma das noites ocupadas nas últimas quatro semanas.</p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Taxa de ocupação (30 dias)</span>
            <strong>${percentFormatter.format(occupancyRate || 0)}</strong>
            <p class="owners-metric-hint">Considera ${integerFormatter.format(totalAvailableNights)} noites disponíveis.</p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Check-ins esta semana</span>
            <strong>${integerFormatter.format(totalWeekCheckins)}</strong>
            <p class="owners-metric-hint">Reservas confirmadas com entrada até ${weekEnd.subtract(1, 'day').format('DD/MM')}.</p>
          </article>
        </div>
      </section>
    `;

    const pendingBannerHtml =
      totalPendingBookings > 0
        ? html`
            <section class="bo-card owners-alert">
              <h2>Reservas pendentes</h2>
              <p><strong>${integerFormatter.format(totalPendingBookings)}</strong> reserva(s) a aguardar confirmação.</p>
              <p>Assim que a equipa confirmar, o hóspede recebe automaticamente um email com a validação final.</p>
            </section>
          `
        : '';

    const propertySectionsHtml = propertyList.length
      ? propertyList
          .map(summary => {
            const occupancyLabel = percentFormatter.format(summary.occupancy30 || 0);
            const revenueLabel = `€ ${eur(summary.revenue30)}`;
            const pendingHtml =
              summary.pendingCount > 0
                ? `<span class="owners-status owners-status--pending">${summary.pendingCount} pendente(s)</span>`
                : '<span class="owners-status owners-status--confirmed">Sem pendentes</span>';
            const upcomingItems = summary.upcoming.slice(0, 5);
            const upcomingListHtml = upcomingItems.length
              ? upcomingItems
                  .map(item => {
                    return `<li class="owners-list-item">
                      <div class="owners-list-item__header">
                        <div class="owners-list-item__guest">${esc(item.guestName || 'Hóspede sem nome')}</div>
                        ${buildStatusPill(item.status)}
                      </div>
                      <div class="owners-list-item__meta">${esc(item.unitName)} · ${item.checkinLabel} - ${item.checkoutLabel} (${integerFormatter.format(item.nights)} noite(s))</div>
                      <div class="owners-list-item__meta">Canal: ${esc(item.channelLabel)}</div>
                    </li>`;
                  })
                  .join('')
              : '<li class="owners-list-empty">Sem reservas futuras nos próximos 90 dias.</li>';
            const channelListHtml = summary.channelList.length
              ? summary.channelList
                  .map(([label, count]) => {
                    return `<li><span>${esc(label)}</span><strong>${integerFormatter.format(count)}</strong></li>`;
                  })
                  .join('')
              : '<li class="owners-list-empty">Sem reservas confirmadas nos últimos 30 dias.</li>';

            return html`
              <section class="bo-card owners-property">
                <div class="owners-property__header">
                  <div>
                    <h2>${esc(summary.name)}</h2>
                    ${summary.location ? `<p class="bo-subtitle">${esc(summary.location)}</p>` : ''}
                  </div>
                  <div class="owners-property__meta">
                    <span>${integerFormatter.format(summary.totalUnits)} unidade(s)</span>
                    <span>Capacidade total: ${integerFormatter.format(summary.totalCapacity)} hóspedes</span>
                  </div>
                </div>
                <div class="owners-property__stats">
                  <div class="owners-property__stat">
                    <span>Receita 30 dias</span>
                    <strong>${revenueLabel}</strong>
                  </div>
                  <div class="owners-property__stat">
                    <span>Ocupação 30 dias</span>
                    <strong>${occupancyLabel}</strong>
                    <small>${integerFormatter.format(summary.availableNights)} noites disponíveis</small>
                  </div>
                  <div class="owners-property__stat">
                    <span>Reservas confirmadas (mês)</span>
                    <strong>${integerFormatter.format(summary.confirmedThisMonth)}</strong>
                  </div>
                  <div class="owners-property__stat">
                    <span>Estado actual</span>
                    ${pendingHtml}
                  </div>
                </div>
                <div class="owners-property__content">
                  <div>
                    <h3 class="bo-section-title">Próximas reservas</h3>
                    <ul class="owners-list">${upcomingListHtml}</ul>
                  </div>
                  <div>
                    <h3 class="bo-section-title">Canais (últimos 30 dias)</h3>
                    <ul class="owners-channels">${channelListHtml}</ul>
                  </div>
                </div>
              </section>
            `;
          })
          .join('')
      : html`
          <section class="bo-card owners-empty">
            <h2>Sem propriedades atribuídas</h2>
            <p class="bo-subtitle">Para consultar dados operacionais precisa que a direção associe a sua conta às propriedades relevantes.</p>
            <p>Assim que existir pelo menos uma propriedade atribuída, esta área mostra reservas, receita e canais actualizados em tempo real.</p>
          </section>
        `;

    const upcomingTableHtml = upcomingPreview.length
      ? html`
          <section class="bo-card owners-upcoming">
            <h2>Próximas chegadas</h2>
            <p class="bo-subtitle">As 10 reservas com entrada mais próxima entre as suas propriedades.</p>
            <div class="owners-table">
              <table>
                <thead>
                  <tr>
                    <th>Check-in</th>
                    <th>Propriedade</th>
                    <th>Unidade</th>
                    <th>Hóspede</th>
                    <th>Noites</th>
                    <th>Canal</th>
                    <th>Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${upcomingPreview
                    .map(item => {
                      return `<tr>
                        <td>${esc(item.checkinLabel)}</td>
                        <td>${esc(item.propertyName)}</td>
                        <td>${esc(item.unitName)}</td>
                        <td>${esc(item.guestName || '—')}</td>
                        <td>${integerFormatter.format(item.nights)}</td>
                        <td>${esc(item.channelLabel)}</td>
                        <td>€ ${eur(item.totalCents)}</td>
                        <td>${buildStatusPill(item.status)}</td>
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
          <section class="bo-card owners-channel-card">
            <h2>Distribuição por canal (30 dias)</h2>
            <p class="bo-subtitle">Contagem de reservas confirmadas com estadia nas últimas quatro semanas.</p>
            <ul>
              ${channelSummary
                .map(([label, count]) => {
                  const percentage = channelTotalCount ? count / channelTotalCount : 0;
                  return `<li><span>${esc(label)}</span><span>${integerFormatter.format(count)} (${percentFormatter.format(percentage)})</span></li>`;
                })
                .join('')}
            </ul>
          </section>
        `
      : '';

    const pageStyles = html`
      <style>
        .page-backoffice.page-owners .owners-main{display:grid;gap:24px;}
        .page-backoffice.page-owners .owners-filter{display:grid;gap:18px;align-items:end;}
        @media (min-width:720px){.page-backoffice.page-owners .owners-filter{grid-template-columns:minmax(0,1fr) auto;}}
        .page-backoffice.page-owners .owners-filter__actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end;}
        .page-backoffice.page-owners .owners-metric-label{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-metric-hint{margin:6px 0 0;font-size:.8rem;color:#b45309;}
        .page-backoffice.page-owners .owners-alert{background:#fff7ed;border:1px solid #fcd34d;box-shadow:0 14px 28px rgba(251,191,36,.22);display:grid;gap:6px;}
        .page-backoffice.page-owners .owners-alert h2{margin:0;font-size:1rem;color:#92400e;}
        .page-backoffice.page-owners .owners-alert p{margin:0;font-size:.85rem;color:#b45309;}
        .page-backoffice.page-owners .owners-property{display:grid;gap:18px;}
        .page-backoffice.page-owners .owners-property__header{display:grid;gap:8px;}
        @media (min-width:640px){.page-backoffice.page-owners .owners-property__header{grid-template-columns:minmax(0,1fr) auto;align-items:flex-start;}}
        .page-backoffice.page-owners .owners-property__meta{display:flex;flex-wrap:wrap;gap:10px;font-size:.75rem;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-property__stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));}
        .page-backoffice.page-owners .owners-property__stat{border-radius:18px;border:1px solid rgba(249,115,22,.18);background:#fff7ed;padding:14px;display:grid;gap:4px;align-content:start;}
        .page-backoffice.page-owners .owners-property__stat span{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:#b45309;}
        .page-backoffice.page-owners .owners-property__stat strong{font-size:1.2rem;color:#9a3412;}
        .page-backoffice.page-owners .owners-property__stat small{font-size:.75rem;color:#b45309;opacity:.85;}
        .page-backoffice.page-owners .owners-property__content{display:grid;gap:18px;}
        @media (min-width:960px){.page-backoffice.page-owners .owners-property__content{grid-template-columns:repeat(2,minmax(0,1fr));}}
        .page-backoffice.page-owners .owners-list{margin:0;padding:0;list-style:none;display:grid;gap:12px;}
        .page-backoffice.page-owners .owners-list-item{border-radius:18px;border:1px solid rgba(148,163,184,.28);background:#fff;box-shadow:0 12px 26px rgba(15,23,42,.08);padding:14px 16px;display:grid;gap:6px;}
        .page-backoffice.page-owners .owners-list-item__header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:flex-start;}
        .page-backoffice.page-owners .owners-list-item__guest{font-weight:600;color:#1f2937;}
        .page-backoffice.page-owners .owners-list-item__meta{font-size:.78rem;color:#475569;}
        .page-backoffice.page-owners .owners-list-empty{font-size:.85rem;color:#64748b;}
        .page-backoffice.page-owners .owners-channels{margin:0;padding:0;list-style:none;display:grid;gap:10px;}
        .page-backoffice.page-owners .owners-channels li{display:flex;justify-content:space-between;gap:12px;font-size:.85rem;color:#334155;}
        .page-backoffice.page-owners .owners-channels li strong{color:#9a3412;}
        .page-backoffice.page-owners .owners-status{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
        .page-backoffice.page-owners .owners-status--confirmed{background:rgba(16,185,129,.18);color:#047857;}
        .page-backoffice.page-owners .owners-status--pending{background:rgba(250,204,21,.24);color:#92400e;}
        .page-backoffice.page-owners .owners-status--cancelled{background:rgba(248,113,113,.22);color:#b91c1c;}
        .page-backoffice.page-owners .owners-status--default{background:rgba(148,163,184,.22);color:#334155;}
        .page-backoffice.page-owners .owners-table{overflow:auto;}
        .page-backoffice.page-owners .owners-table table{width:100%;border-collapse:collapse;min-width:720px;}
        .page-backoffice.page-owners .owners-table th{background:#fff7ed;text-transform:uppercase;font-size:.7rem;letter-spacing:.08em;color:#b45309;padding:12px;text-align:left;}
        .page-backoffice.page-owners .owners-table td{padding:12px;border-bottom:1px solid rgba(148,163,184,.25);font-size:.85rem;color:#334155;}
        .page-backoffice.page-owners .owners-table tbody tr:nth-child(even){background:rgba(254,243,199,.35);}
        .page-backoffice.page-owners .owners-empty{display:grid;gap:8px;color:#b45309;}
        .page-backoffice.page-owners .owners-channel-card ul{margin:0;padding:0;list-style:none;display:grid;gap:10px;}
        .page-backoffice.page-owners .owners-channel-card li{display:flex;justify-content:space-between;gap:12px;font-size:.85rem;color:#334155;}
        .page-backoffice.page-owners .owners-channel-card li span:last-child{font-weight:600;color:#9a3412;}
        .page-backoffice.page-owners .bo-section-title{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:#b45309;margin:0 0 8px;font-weight:700;}
      </style>
    `;

    const body = html`
      ${pageStyles}
      <div class="bo-main owners-main">
        <header class="bo-header">
          <span class="pill-indicator">Área de Proprietários</span>
          <h1>Resumo de desempenho</h1>
          <p>Consulte receita recente, reservas futuras e a origem dos seus hóspedes sem precisar de aceder ao backoffice.</p>
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
        branding: resolveBrandingForRequest(req),
        locale: req.locale,
        t: req.t,
        csrfToken: res.locals.csrfToken,
        pageClass: 'page-backoffice page-owners',
        body
      })
    );
  });
};
