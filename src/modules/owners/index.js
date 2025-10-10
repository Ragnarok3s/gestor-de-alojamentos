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
    csrfProtection,
    logActivity,
    logSessionEvent,
    ownerPushService
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

  const ENTRY_TYPE_LABELS = {
    expense: 'Despesa',
    invoice: 'Receita',
    adjustment: 'Ajuste'
  };

  const ownerPropertyAccessStmt = db.prepare(
    'SELECT 1 FROM property_owners WHERE property_id = ? AND user_id = ? LIMIT 1'
  );
  const findPropertyStmt = db.prepare('SELECT id, name FROM properties WHERE id = ? LIMIT 1');
  const findUnitStmt = db.prepare('SELECT id, property_id, name FROM units WHERE id = ? LIMIT 1');
  const findFinancialEntryStmt = db.prepare('SELECT * FROM owner_financial_entries WHERE id = ? LIMIT 1');
  const insertFinancialEntryStmt = db.prepare(
    `INSERT INTO owner_financial_entries
       (user_id, property_id, unit_id, entry_type, category, description, document_number, amount_cents, currency, issue_date, due_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?)`
  );
  const updateFinancialEntryStmt = db.prepare(
    `UPDATE owner_financial_entries
        SET status = ?,
            due_date = ?,
            updated_at = datetime('now')
      WHERE id = ?`
  );
  const deleteFinancialEntryStmt = db.prepare('DELETE FROM owner_financial_entries WHERE id = ?');

  function normalizePropertyId(rawValue) {
    if (!rawValue && rawValue !== 0) return null;
    const value = Number.parseInt(rawValue, 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function normalizeUnitId(rawValue) {
    if (!rawValue && rawValue !== 0) return null;
    const value = Number.parseInt(rawValue, 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function canManageProperty(user, propertyId) {
    if (!propertyId) return true;
    if (userHasBackofficeAccess(user)) return true;
    try {
      return !!ownerPropertyAccessStmt.get(propertyId, user.id);
    } catch (err) {
      console.warn('Falha ao validar acesso à propriedade:', err.message);
      return false;
    }
  }

  function normalizeDate(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    const parsed = dayjs(trimmed);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
  }

  function parseAmountCents(rawValue) {
    const amount = Number.parseFloat(typeof rawValue === 'string' ? rawValue.replace(',', '.') : rawValue);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100);
  }

  function safeRedirect(value) {
    const redirect = typeof value === 'string' ? value.trim() : '';
    if (redirect.startsWith('/owners')) return redirect;
    return '/owners';
  }

  function redirectWithMessage(res, url, param, message) {
    const safeUrl = safeRedirect(url);
    if (!message) {
      res.redirect(safeUrl);
      return;
    }
    const separator = safeUrl.includes('?') ? '&' : '?';
    res.redirect(`${safeUrl}${separator}${encodeURIComponent(param)}=${encodeURIComponent(message)}`);
  }

  function serializeDashboardData(data) {
    const {
      viewer,
      propertyList,
      channelSummary,
      financialEntries,
      globalUpcoming,
      ...rest
    } = data;
    const safeViewer = viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          email: viewer.email,
          role: viewer.role
        }
      : null;
    const serializedProperties = propertyList.map(summary => ({
      id: summary.id,
      name: summary.name,
      location: summary.location,
      totalUnits: summary.totalUnits,
      totalCapacity: summary.totalCapacity,
      availableNights30: summary.availableNights30,
      availableNights90: summary.availableNights90,
      revenue30: summary.revenue30,
      prevRevenue30: summary.prevRevenue30,
      nights30: summary.nights30,
      prevNights30: summary.prevNights30,
      futureRevenue90: summary.futureRevenue90,
      futureNights90: summary.futureNights90,
      occupancy30: summary.occupancy30,
      pendingCount: summary.pendingCount,
      confirmedThisMonth: summary.confirmedThisMonth,
      weekCheckins: summary.weekCheckins,
      upcoming: summary.upcoming,
      channelList: summary.channelList,
      unitSummaries: summary.unitSummaries,
      expensesCents: summary.expensesCents,
      invoicesCents: summary.invoicesCents,
      netProfitCents: summary.netProfitCents
    }));

    return {
      ...rest,
      viewer: safeViewer,
      propertyList: serializedProperties,
      channelSummary,
      financialEntries,
      globalUpcoming
    };
  }

  function computeOwnerDashboardData(viewer, query = {}) {
    const today = dayjs().startOf('day');
    const last30Start = today.subtract(29, 'day');
    const last30EndExclusive = today.add(1, 'day');
    const prev30End = last30Start;
    const prev30Start = last30Start.subtract(30, 'day');
    const futureEnd = today.add(90, 'day');

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

    const requestedPropertyId = Number.parseInt(query.property, 10);
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
        availableNights30: 0,
        availableNights90: 0,
        revenue30: 0,
        prevRevenue30: 0,
        nights30: 0,
        prevNights30: 0,
        futureRevenue90: 0,
        futureNights90: 0,
        occupancy30: 0,
        pendingCount: 0,
        confirmedThisMonth: 0,
        weekCheckins: 0,
        upcoming: [],
        channelCounts: new Map(),
        unitSummaries: [],
        expensesCents: 0,
        invoicesCents: 0,
        netProfitCents: 0
      });
    });

    const propertyIds = Array.from(propertySummaries.keys());
    const unitSummaryMap = new Map();

    let totalRevenue30 = 0;
    let totalPrevRevenue30 = 0;
    let totalNights30 = 0;
    let totalPrevNights30 = 0;
    let totalAvailableNights30 = 0;
    let totalAvailableNights90 = 0;
    let totalPendingBookings = 0;
    let totalConfirmedThisMonth = 0;
    let totalWeekCheckins = 0;
    let totalFutureRevenue90 = 0;
    let totalFutureNights90 = 0;
    let totalExpensesCents = 0;
    let totalInvoicesCents = 0;

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
        const unitSummary = {
          id: unit.id,
          name: unit.name,
          capacity: Number.isFinite(unit.capacity) ? Number(unit.capacity) : 0,
          revenue30: 0,
          prevRevenue30: 0,
          futureRevenue90: 0,
          nights30: 0,
          prevNights30: 0,
          futureNights90: 0,
          expenseCents: 0,
          invoiceCents: 0,
          netProfitCents: 0
        };
        summary.unitSummaries.push(unitSummary);
        unitSummaryMap.set(unit.id, unitSummary);
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
                  u.id AS unit_id,
                  u.name AS unit_name,
                  p.name AS property_name
             FROM bookings b
             JOIN units u ON u.id = b.unit_id
             JOIN properties p ON p.id = u.property_id
            WHERE u.property_id IN (${placeholders})
              AND b.checkout > ?
            ORDER BY b.checkin ASC`
        )
        .all(...propertyIds, prev30Start.format('YYYY-MM-DD'));

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
        const overlapsPrev30 = checkoutDate.isAfter(prev30Start) && checkinDate.isBefore(prev30End);
        const overlapsFuture90 = checkinDate.isBefore(futureEnd) && checkoutDate.isAfter(today);
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

          const unitSummary = unitSummaryMap.get(booking.unit_id);
          if (unitSummary) {
            unitSummary.revenue30 += Number(booking.total_cents || 0);
            unitSummary.nights30 += overlapNights;
          }
        }

        if (isConfirmed && overlapsPrev30) {
          summary.prevRevenue30 += Number(booking.total_cents || 0);
          totalPrevRevenue30 += Number(booking.total_cents || 0);

          const overlapStart = dayjs.max(checkinDate, prev30Start);
          const overlapEnd = dayjs.min(checkoutDate, prev30End);
          const overlapNights = Math.max(0, overlapEnd.diff(overlapStart, 'day'));
          summary.prevNights30 += overlapNights;
          totalPrevNights30 += overlapNights;

          const unitSummary = unitSummaryMap.get(booking.unit_id);
          if (unitSummary) {
            unitSummary.prevRevenue30 += Number(booking.total_cents || 0);
            unitSummary.prevNights30 += overlapNights;
          }
        }

        if (isConfirmed && overlapsFuture90) {
          summary.futureRevenue90 += Number(booking.total_cents || 0);
          totalFutureRevenue90 += Number(booking.total_cents || 0);
          const overlapStart = dayjs.max(checkinDate, today);
          const overlapEnd = dayjs.min(checkoutDate, futureEnd);
          const overlapNights = Math.max(0, overlapEnd.diff(overlapStart, 'day'));
          summary.futureNights90 += overlapNights;
          totalFutureNights90 += overlapNights;

          const unitSummary = unitSummaryMap.get(booking.unit_id);
          if (unitSummary) {
            unitSummary.futureRevenue90 += Number(booking.total_cents || 0);
            unitSummary.futureNights90 += overlapNights;
          }
        }

        if (isConfirmed && !checkinDate.isBefore(today.startOf('month')) && checkinDate.isBefore(today.startOf('month').add(1, 'month'))) {
          summary.confirmedThisMonth += 1;
          totalConfirmedThisMonth += 1;
        }

        if (isConfirmed && !checkinDate.isBefore(today.startOf('week')) && checkinDate.isBefore(today.startOf('week').add(7, 'day'))) {
          summary.weekCheckins += 1;
          totalWeekCheckins += 1;
        }

        const shouldShowUpcoming = (isConfirmed || isPending) && !checkoutDate.isBefore(today) && checkinDate.isBefore(futureEnd);
        if (shouldShowUpcoming) {
          const upcomingItem = {
            id: booking.id,
            propertyId: booking.property_id,
            propertyName: booking.property_name,
            unitId: booking.unit_id,
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

    const propertyList = Array.from(propertySummaries.values()).map(summary => {
      summary.availableNights30 = summary.totalUnits * 30;
      summary.availableNights90 = summary.totalUnits * 90;
      totalAvailableNights30 += Math.max(0, summary.availableNights30);
      totalAvailableNights90 += Math.max(0, summary.availableNights90);
      summary.occupancy30 = summary.availableNights30 ? summary.nights30 / summary.availableNights30 : 0;
      summary.upcoming.sort((a, b) => a.checkinIso.localeCompare(b.checkinIso));
      summary.channelList = Array.from(summary.channelCounts.entries()).sort((a, b) => b[1] - a[1]);
      delete summary.channelCounts;
      return summary;
    });

    const occupancyRate = totalAvailableNights30 ? totalNights30 / totalAvailableNights30 : 0;
    const futureOccupancyRate = totalAvailableNights90 ? totalFutureNights90 / totalAvailableNights90 : 0;
    const upcomingPreview = globalUpcoming.sort((a, b) => a.checkinIso.localeCompare(b.checkinIso)).slice(0, 10);
    const channelSummary = Array.from(globalChannelCounts.entries()).sort((a, b) => b[1] - a[1]);
    const channelTotalCount = channelSummary.reduce((sum, [, value]) => sum + value, 0);

    const financialEntries = [];
    const expensesDueSoon = [];

    if (propertyIds.length || userHasBackofficeAccess(viewer)) {
      const baseConditions = [];
      const params = [];

      if (!userHasBackofficeAccess(viewer)) {
        baseConditions.push('(ofe.user_id = ? OR ofe.user_id IS NULL)');
        params.push(viewer.id);
      }

      if (propertyIds.length) {
        const placeholders = propertyIds.map(() => '?').join(',');
        baseConditions.push(`(ofe.property_id IN (${placeholders}) OR ofe.property_id IS NULL)`);
        params.push(...propertyIds);
      }

      const where = baseConditions.length ? `WHERE ${baseConditions.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT ofe.*, u.name AS unit_name, p.name AS property_name
             FROM owner_financial_entries ofe
             LEFT JOIN units u ON u.id = ofe.unit_id
             LEFT JOIN properties p ON p.id = ofe.property_id
            ${where}
            ORDER BY COALESCE(ofe.issue_date, ofe.created_at) DESC, ofe.created_at DESC`
        )
        .all(...params);

      rows.forEach(entry => {
        const amountCents = Number(entry.amount_cents || 0);
        const type = (entry.entry_type || '').toLowerCase();
        const propertySummary = propertySummaries.get(entry.property_id);
        const unitSummary = unitSummaryMap.get(entry.unit_id);
        const normalizedStatus = (entry.status || '').toLowerCase();

        if (type === 'expense') {
          totalExpensesCents += amountCents;
          if (propertySummary) propertySummary.expensesCents += amountCents;
          if (unitSummary) unitSummary.expenseCents += amountCents;
        } else {
          totalInvoicesCents += amountCents;
          if (propertySummary) propertySummary.invoicesCents += amountCents;
          if (unitSummary) unitSummary.invoiceCents += amountCents;
        }

        const dueDate = entry.due_date ? dayjs(entry.due_date) : null;
        if (type === 'expense' && dueDate && dueDate.isValid()) {
          if (!dueDate.isBefore(today) && dueDate.diff(today, 'day') <= 7 && normalizedStatus !== 'paid') {
            expensesDueSoon.push({
              id: entry.id,
              description: entry.description || '',
              due_date: entry.due_date,
              amount_cents: amountCents,
              property_id: entry.property_id,
              property_name: entry.property_name || ''
            });
          }
        }

        financialEntries.push({
          id: entry.id,
          entry_type: entry.entry_type,
          amount_cents: amountCents,
          currency: entry.currency || 'EUR',
          description: entry.description || '',
          category: entry.category || '',
          issue_date: entry.issue_date || null,
          due_date: entry.due_date || null,
          status: entry.status || '',
          document_number: entry.document_number || '',
          notes: entry.notes || '',
          property_id: entry.property_id,
          property_name: entry.property_name || '',
          unit_id: entry.unit_id,
          unit_name: entry.unit_name || '',
          created_at: entry.created_at
        });
      });
    }

    propertyList.forEach(summary => {
      summary.netProfitCents = summary.revenue30 + summary.invoicesCents - summary.expensesCents;
      summary.unitSummaries.forEach(unit => {
        unit.netProfitCents = unit.revenue30 + unit.invoiceCents - unit.expenseCents;
      });
      summary.unitSummaries.sort((a, b) => b.netProfitCents - a.netProfitCents);
    });

    const revenueDelta = totalPrevRevenue30 ? (totalRevenue30 - totalPrevRevenue30) / totalPrevRevenue30 : null;

    if (ownerPushService && typeof ownerPushService.syncOwnerAlerts === 'function') {
      ownerPushService.syncOwnerAlerts({
        userId: viewer.id,
        upcomingBookings: globalUpcoming,
        revenueDelta: revenueDelta || 0,
        pendingBookings: totalPendingBookings,
        expensesDueSoon
      });
    }

    return {
      viewer,
      requestedPropertyId,
      hasRequestedProperty,
      allProperties,
      activeProperties,
      propertyList,
      totals: {
        totalRevenue30,
        totalPrevRevenue30,
        totalNights30,
        totalPrevNights30,
        totalAvailableNights30,
        totalAvailableNights90,
        totalFutureRevenue90,
        totalFutureNights90,
        occupancyRate,
        futureOccupancyRate,
        totalPendingBookings,
        totalConfirmedThisMonth,
        totalWeekCheckins,
        totalExpensesCents,
        totalInvoicesCents,
        netProfitCents: totalRevenue30 + totalInvoicesCents - totalExpensesCents,
        revenueDelta
      },
      upcomingPreview,
      channelSummary,
      channelTotalCount,
      financialEntries,
      expensesDueSoon,
      globalUpcoming,
      simulation: {
        availableNights90: totalAvailableNights90,
        futureRevenue90: totalFutureRevenue90,
        futureNights90: totalFutureNights90,
        futureOccupancyRate,
        revenue30: totalRevenue30,
        prevRevenue30: totalPrevRevenue30,
        nights30: totalNights30,
        occupancyRate
      }
    };
  }

  app.get('/owners', requireLogin, ensureOwnerPortalAccess, csrfProtection.middleware, (req, res) => {
    const viewer = req.user;
    const redirectPath = req.originalUrl && req.originalUrl.startsWith('/owners') ? req.originalUrl : '/owners';
    const dashboard = computeOwnerDashboardData(viewer, req.query);
    const {
      allProperties,
      activeProperties,
      hasRequestedProperty,
      requestedPropertyId,
      propertyList,
      totals,
      upcomingPreview,
      channelSummary,
      channelTotalCount,
      financialEntries,
      expensesDueSoon,
      simulation
    } = dashboard;

    const csrfToken = req.csrfToken();
    const financeError = typeof req.query.finance_error === 'string' ? req.query.finance_error : '';
    const financeNotice = typeof req.query.finance_notice === 'string' ? req.query.finance_notice : '';

    const totalRevenue30 = totals.totalRevenue30 || 0;
    const totalPrevRevenue30 = totals.totalPrevRevenue30 || 0;
    const totalNights30 = totals.totalNights30 || 0;
    const totalAvailableNights30 = totals.totalAvailableNights30 || 0;
    const occupancyRate = totals.occupancyRate || 0;
    const futureOccupancyRate = simulation.futureOccupancyRate || 0;
    const totalFutureRevenue90 = totals.totalFutureRevenue90 || 0;
    const totalFutureNights90 = totals.totalFutureNights90 || 0;
    const totalPendingBookings = totals.totalPendingBookings || 0;
    const totalWeekCheckins = totals.totalWeekCheckins || 0;
    const totalExpensesCents = totals.totalExpensesCents || 0;
    const totalInvoicesCents = totals.totalInvoicesCents || 0;
    const netProfitCents = totals.netProfitCents || 0;
    const revenueDelta = totals.revenueDelta;

    const averageNightlyRateEuros = totalNights30 ? totalRevenue30 / totalNights30 / 100 : 0;
    const futureAverageRateEuros = simulation.futureNights90
      ? simulation.futureRevenue90 / simulation.futureNights90 / 100
      : averageNightlyRateEuros;

    const occupancyQuery = Number.parseFloat(req.query.sim_occupancy);
    const rateQuery = Number.parseFloat(req.query.sim_rate);
    const fallbackOccupancyPercent = Math.round((futureOccupancyRate || occupancyRate || 0) * 1000) / 10;
    const occupancyPercent = Number.isFinite(occupancyQuery)
      ? Math.max(0, Math.min(100, occupancyQuery))
      : fallbackOccupancyPercent;
    const occupancyRatio = Math.max(0, Math.min(1, occupancyPercent / 100));
    const nightlyRateEuros = Number.isFinite(rateQuery) && rateQuery > 0 ? rateQuery : futureAverageRateEuros || averageNightlyRateEuros || 0;
    const projectedNights = Math.round((simulation.availableNights90 || 0) * occupancyRatio);
    const projectedRevenueCents = Math.round((simulation.availableNights90 || 0) * occupancyRatio * nightlyRateEuros * 100);
    const revenueComparisonCents = simulation.futureRevenue90 ? projectedRevenueCents - simulation.futureRevenue90 : null;

    const revenueDeltaBadge =
      revenueDelta == null
        ? html`<span class="owners-delta owners-delta--neutral">Sem histórico</span>`
        : html`<span class="owners-delta ${revenueDelta >= 0 ? 'owners-delta--up' : 'owners-delta--down'}">${
            revenueDelta >= 0 ? '+' : ''
          }${(revenueDelta * 100).toFixed(1)}%</span>`;

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
        <div class="owners-summary__grid">
          <article class="bo-metric">
            <span class="owners-metric-label">Receita últimos 30 dias</span>
            <strong>€ ${eur(totalRevenue30)}</strong>
            <p class="owners-metric-hint">
              ${
                totalPrevRevenue30
                  ? html`Período anterior: € ${eur(totalPrevRevenue30)} ${revenueDeltaBadge}`
                  : 'Sem período comparável disponível.'
              }
            </p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Lucro líquido (30 dias)</span>
            <strong>€ ${eur(netProfitCents)}</strong>
            <p class="owners-metric-hint">Receita + faturação extra - despesas registadas.</p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Taxa de ocupação (30 dias)</span>
            <strong>${percentFormatter.format(occupancyRate || 0)}</strong>
            <p class="owners-metric-hint">
              ${integerFormatter.format(totalNights30)} noites vendidas de ${integerFormatter.format(totalAvailableNights30)} disponíveis.
            </p>
          </article>
          <article class="bo-metric">
            <span class="owners-metric-label">Receita futura (90 dias)</span>
            <strong>€ ${eur(totalFutureRevenue90)}</strong>
            <p class="owners-metric-hint">
              ${integerFormatter.format(totalFutureNights90)} noites confirmadas · ${percentFormatter.format(futureOccupancyRate || 0)} ocupação prevista.
            </p>
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

    const expensesDueSoonHtml =
      expensesDueSoon.length
        ? html`
            <section class="bo-card owners-alert owners-alert--expenses">
              <h2>Despesas a vencer</h2>
              <ul class="owners-alert__list">
                ${expensesDueSoon
                  .map(expense => {
                    const dueLabel = expense.due_date ? dayjs(expense.due_date).format('DD/MM/YYYY') : 'Sem data';
                    return `<li><strong>${esc(expense.description || 'Despesa')}</strong> · vence a ${dueLabel}${
                      expense.property_name ? ` · ${esc(expense.property_name)}` : ''
                    } · € ${eur(expense.amount_cents || 0)}</li>`;
                  })
                  .join('')}
              </ul>
            </section>
          `
        : '';

    const simulationHiddenProperty = hasRequestedProperty
      ? html`<input type="hidden" name="property" value="${requestedPropertyId}" />`
      : '';
    const occupancyInputValue = Number.isFinite(occupancyPercent) ? occupancyPercent.toFixed(1) : '0.0';
    const nightlyRateInputValue = Number.isFinite(nightlyRateEuros) ? nightlyRateEuros.toFixed(2) : '0.00';
    const projectedRevenueLabel = `€ ${eur(projectedRevenueCents)}`;
    const actualFutureRevenueLabel = `€ ${eur(simulation.futureRevenue90 || 0)}`;
    const projectedNightsLabel = integerFormatter.format(projectedNights);
    const actualFutureNightsLabel = integerFormatter.format(simulation.futureNights90 || 0);
    const comparisonMessage =
      revenueComparisonCents == null
        ? ''
        : revenueComparisonCents === 0
        ? 'Resultado igual ao pipeline atual.'
        : revenueComparisonCents > 0
        ? `+ € ${eur(revenueComparisonCents)} vs. pipeline atual.`
        : `- € ${eur(Math.abs(revenueComparisonCents))} vs. pipeline atual.`;

    const simulationCardHtml = html`
      <section class="bo-card owners-simulation">
        <div class="owners-simulation__header">
          <div>
            <h2>Simulador de rendimento (90 dias)</h2>
            <p class="bo-subtitle">Antecipe resultados alterando a taxa de ocupação ou o preço médio por noite.</p>
          </div>
          <div class="owners-simulation__stats">
            <div>
              <span>Ocupação atual</span>
              <strong>${percentFormatter.format(futureOccupancyRate || 0)}</strong>
            </div>
            <div>
              <span>Preço médio atual</span>
              <strong>€ ${eur(Math.round((futureAverageRateEuros || averageNightlyRateEuros) * 100))}</strong>
            </div>
            <div>
              <span>Noites disponíveis</span>
              <strong>${integerFormatter.format(simulation.availableNights90 || 0)}</strong>
            </div>
          </div>
        </div>
        <form method="get" class="owners-simulation__form">
          ${simulationHiddenProperty}
          <div class="owners-simulation__grid">
            <label class="form-field">
              <span class="form-label">Ocupação prevista (%)</span>
              <input type="number" min="0" max="100" step="0.1" class="input" name="sim_occupancy" value="${occupancyInputValue}" />
            </label>
            <label class="form-field">
              <span class="form-label">Preço médio por noite (€)</span>
              <input type="number" min="0" step="0.01" class="input" name="sim_rate" value="${nightlyRateInputValue}" />
            </label>
            <div class="owners-simulation__actions">
              <button class="btn btn-primary" type="submit">Calcular</button>
              ${
                hasRequestedProperty
                  ? html`<a class="btn btn-light" href="/owners?property=${requestedPropertyId}">Repor valores</a>`
                  : html`<a class="btn btn-light" href="/owners">Repor valores</a>`
              }
            </div>
          </div>
        </form>
        <div class="owners-simulation__results">
          <div>
            <span>Receita projetada</span>
            <strong>${projectedRevenueLabel}</strong>
            <p>${comparisonMessage}</p>
          </div>
          <div>
            <span>Noites projetadas</span>
            <strong>${projectedNightsLabel}</strong>
            <p>Pipeline atual: ${actualFutureNightsLabel} noite(s).</p>
          </div>
          <div>
            <span>Receita em carteira</span>
            <strong>${actualFutureRevenueLabel}</strong>
            <p>Baseado em reservas confirmadas até 90 dias.</p>
          </div>
        </div>
      </section>
    `;

    const propertySectionsHtml = propertyList.length
      ? propertyList
          .map(summary => {
            const occupancyLabel = percentFormatter.format(summary.occupancy30 || 0);
            const revenueLabel = `€ ${eur(summary.revenue30)}`;
            const invoicesLabel = `€ ${eur(summary.invoicesCents || 0)}`;
            const expensesLabel = `€ ${eur(summary.expensesCents || 0)}`;
            const netProfitLabel = `€ ${eur(summary.netProfitCents || 0)}`;
            const futureRevenueLabel = `€ ${eur(summary.futureRevenue90 || 0)}`;
            const futureNightsLabel = integerFormatter.format(summary.futureNights90 || 0);
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

            const unitTableRows = summary.unitSummaries.length
              ? summary.unitSummaries
                  .map(unit => {
                    return `<tr>
                      <td>${esc(unit.name)}</td>
                      <td>${unit.capacity ? `${integerFormatter.format(unit.capacity)} pax` : '—'}</td>
                      <td>€ ${eur(unit.revenue30 || 0)}</td>
                      <td>€ ${eur(unit.invoiceCents || 0)}</td>
                      <td>€ ${eur(unit.expenseCents || 0)}</td>
                      <td>€ ${eur(unit.netProfitCents || 0)}</td>
                    </tr>`;
                  })
                  .join('')
              : '<tr><td colspan="6" class="owners-list-empty">Sem unidades com dados disponíveis.</td></tr>';

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
                    <span>Faturação extra</span>
                    <strong>${invoicesLabel}</strong>
                    <small>Inclui notas de crédito/débito registadas.</small>
                  </div>
                  <div class="owners-property__stat">
                    <span>Despesas</span>
                    <strong>${expensesLabel}</strong>
                    <small>Pagamentos, fornecedores e ajustes.</small>
                  </div>
                  <div class="owners-property__stat">
                    <span>Lucro líquido</span>
                    <strong>${netProfitLabel}</strong>
                    <small>Últimos 30 dias.</small>
                  </div>
                  <div class="owners-property__stat">
                    <span>Ocupação 30 dias</span>
                    <strong>${occupancyLabel}</strong>
                    <small>${integerFormatter.format(summary.availableNights30 || 0)} noites disponíveis</small>
                  </div>
                  <div class="owners-property__stat">
                    <span>Reservas confirmadas (mês)</span>
                    <strong>${integerFormatter.format(summary.confirmedThisMonth || 0)}</strong>
                  </div>
                  <div class="owners-property__stat">
                    <span>Estado actual</span>
                    ${pendingHtml}
                  </div>
                  <div class="owners-property__stat">
                    <span>Pipeline 90 dias</span>
                    <strong>${futureRevenueLabel}</strong>
                    <small>${futureNightsLabel} noite(s) confirmadas</small>
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
                <div class="owners-unit-table owners-table">
                  <h3 class="bo-section-title">Lucro líquido por unidade</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Unidade</th>
                        <th>Capacidade</th>
                        <th>Receita 30d</th>
                        <th>Faturação</th>
                        <th>Despesas</th>
                        <th>Lucro líquido</th>
                      </tr>
                    </thead>
                    <tbody>${unitTableRows}</tbody>
                  </table>
                </div>
              </section>
            `;
          })
          .join('')
      : html`
          <section class="bo-card owners-empty">
            <h2>Sem propriedades atribuídas</h2>
            <p class="bo-subtitle">Para consultar dados operacionais precisa que a direção associe a sua conta às propriedades relevantes.</p>
            <p>Assim que existir pelo menos uma propriedade atribuída, esta área mostra reservas, receita e canais atualizados em tempo real.</p>
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

    const propertyOptionsForForms = activeProperties.length
      ? activeProperties
          .map(property => `<option value="${property.id}">${esc(property.name)}</option>`)
          .join('')
      : allProperties
          .map(property => `<option value="${property.id}">${esc(property.name)}</option>`)
          .join('');

    const unitOptionsForForms = propertyList.length
      ? propertyList
          .flatMap(property =>
            property.unitSummaries.map(unit =>
              `<option value="${unit.id}">${esc(property.name)} · ${esc(unit.name)}</option>`
            )
          )
          .join('')
      : '';

    const statusOptions = ['draft', 'pending', 'paid', 'cancelled'];
    const statusLabels = {
      draft: 'Rascunho',
      pending: 'Pendente',
      paid: 'Pago',
      cancelled: 'Cancelado'
    };

    const financialRowsHtml = financialEntries.length
      ? financialEntries
          .map(entry => {
            const type = (entry.entry_type || '').toLowerCase();
            const typeLabel = ENTRY_TYPE_LABELS[type] || 'Outro';
            const dueLabel = entry.due_date ? dayjs(entry.due_date).format('DD/MM/YYYY') : '—';
            const issueLabel = entry.issue_date ? dayjs(entry.issue_date).format('DD/MM/YYYY') : '—';
            const createdLabel = entry.created_at ? dayjs(entry.created_at).format('DD/MM/YYYY HH:mm') : '—';
            const statusValue = (entry.status || '').toLowerCase();
            const statusSelect = statusOptions
              .map(option => `<option value="${option}"${option === statusValue ? ' selected' : ''}>${statusLabels[option]}</option>`)
              .join('');
            const redirectInput = `<input type="hidden" name="redirect" value="${esc(redirectPath)}" />`;

            return `<tr>
              <td><span class="owners-finance-type owners-finance-type--${esc(type)}">${esc(typeLabel)}</span></td>
              <td>
                <strong>${esc(entry.description || 'Sem descrição')}</strong>
                ${entry.category ? `<div class="owners-finance-meta">Categoria: ${esc(entry.category)}</div>` : ''}
                ${entry.document_number ? `<div class="owners-finance-meta">Documento: ${esc(entry.document_number)}</div>` : ''}
                ${entry.notes ? `<div class="owners-finance-notes">${esc(entry.notes)}</div>` : ''}
              </td>
              <td>
                ${entry.property_name ? `<div>${esc(entry.property_name)}</div>` : '<div>—</div>'}
                ${entry.unit_name ? `<div class="owners-finance-meta">${esc(entry.unit_name)}</div>` : ''}
              </td>
              <td>
                <div class="owners-finance-meta">Emitido: ${issueLabel}</div>
                <div class="owners-finance-meta">Vencimento: ${dueLabel}</div>
                <div class="owners-finance-meta">Criado: ${createdLabel}</div>
              </td>
              <td>€ ${eur(entry.amount_cents || 0)}</td>
              <td>
                <form method="post" action="/owners/financial-entries/${entry.id}/update" class="owners-finance-inline-form">
                  <input type="hidden" name="_csrf" value="${csrfToken}" />
                  ${redirectInput}
                  <label>
                    <span class="sr-only">Estado</span>
                    <select name="status" class="input input-sm">${statusSelect}</select>
                  </label>
                  <label>
                    <span class="sr-only">Vencimento</span>
                    <input type="date" name="due_date" value="${entry.due_date || ''}" class="input input-sm" />
                  </label>
                  <button type="submit" class="btn btn-light btn-xs">Guardar</button>
                </form>
                <form method="post" action="/owners/financial-entries/${entry.id}/delete" class="owners-finance-inline-form owners-finance-inline-form--danger" onsubmit="return confirm('Remover registo financeiro?');">
                  <input type="hidden" name="_csrf" value="${csrfToken}" />
                  ${redirectInput}
                  <button type="submit" class="btn btn-danger btn-xs">Apagar</button>
                </form>
              </td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="owners-list-empty">Sem registos financeiros ainda.</td></tr>';

    const financeFlashHtml = financeError
      ? html`<div class="owners-finance-flash owners-finance-flash--error">${esc(financeError)}</div>`
      : financeNotice
      ? html`<div class="owners-finance-flash owners-finance-flash--success">${esc(financeNotice)}</div>`
      : '';

    const financialSectionHtml = html`
      <section class="bo-card owners-finance">
        <div class="owners-finance__header">
          <div>
            <h2>Gestão financeira</h2>
            <p class="bo-subtitle">Controle receitas, despesas e ajustes associados às suas unidades.</p>
          </div>
          <div class="owners-finance__totals">
            <div><span>Receitas extra</span><strong>€ ${eur(totalInvoicesCents)}</strong></div>
            <div><span>Despesas</span><strong>€ ${eur(totalExpensesCents)}</strong></div>
            <div><span>Lucro líquido 30 dias</span><strong>€ ${eur(netProfitCents)}</strong></div>
          </div>
        </div>
        ${financeFlashHtml}
        <div class="owners-finance__content">
          <div class="owners-finance__form">
            <h3 class="bo-section-title">Novo registo</h3>
            <form method="post" action="/owners/financial-entries" class="owners-finance-form">
              <input type="hidden" name="_csrf" value="${csrfToken}" />
              <input type="hidden" name="redirect" value="${esc(redirectPath)}" />
              <div class="owners-finance-form__grid">
                <label class="form-field">
                  <span class="form-label">Tipo</span>
                  <select name="entry_type" class="input" required>
                    <option value="invoice">Receita</option>
                    <option value="expense">Despesa</option>
                    <option value="adjustment">Ajuste</option>
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Descrição</span>
                  <input type="text" name="description" class="input" maxlength="200" required />
                </label>
                <label class="form-field">
                  <span class="form-label">Montante (€)</span>
                  <input type="number" name="amount_eur" class="input" min="0" step="0.01" required />
                </label>
                <label class="form-field">
                  <span class="form-label">Categoria</span>
                  <input type="text" name="category" class="input" maxlength="80" />
                </label>
                <label class="form-field">
                  <span class="form-label">Propriedade</span>
                  <select name="property_id" class="input">
                    <option value="">--</option>
                    ${propertyOptionsForForms}
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Unidade</span>
                  <select name="unit_id" class="input">
                    <option value="">--</option>
                    ${unitOptionsForForms}
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Data emissão</span>
                  <input type="date" name="issue_date" class="input" />
                </label>
                <label class="form-field">
                  <span class="form-label">Vencimento</span>
                  <input type="date" name="due_date" class="input" />
                </label>
                <label class="form-field form-field--full">
                  <span class="form-label">Notas</span>
                  <textarea name="notes" class="input" rows="2" maxlength="500"></textarea>
                </label>
              </div>
              <div class="owners-finance-form__actions">
                <button class="btn btn-primary" type="submit">Guardar registo</button>
              </div>
            </form>
          </div>
          <div class="owners-finance__table owners-table">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Detalhes</th>
                  <th>Alocação</th>
                  <th>Datas</th>
                  <th>Valor</th>
                  <th>Gestão</th>
                </tr>
              </thead>
              <tbody>${financialRowsHtml}</tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    const pageStyles = html`
      <style>
        .page-backoffice.page-owners .owners-main{display:grid;gap:24px;}
        .page-backoffice.page-owners .owners-filter{display:grid;gap:18px;align-items:end;}
        @media (min-width:720px){.page-backoffice.page-owners .owners-filter{grid-template-columns:minmax(0,1fr) auto;}}
        .page-backoffice.page-owners .owners-filter__actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end;}
        .page-backoffice.page-owners .owners-metric-label{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-metric-hint{margin:6px 0 0;font-size:.8rem;color:#b45309;}
        .page-backoffice.page-owners .owners-summary__grid{display:grid;gap:16px;}
        @media (min-width:900px){.page-backoffice.page-owners .owners-summary__grid{grid-template-columns:repeat(4,minmax(0,1fr));}}
        .page-backoffice.page-owners .owners-delta{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;font-size:.7rem;font-weight:700;}
        .page-backoffice.page-owners .owners-delta--up{background:rgba(16,185,129,.18);color:#047857;}
        .page-backoffice.page-owners .owners-delta--down{background:rgba(248,113,113,.22);color:#b91c1c;}
        .page-backoffice.page-owners .owners-delta--neutral{background:rgba(148,163,184,.22);color:#334155;}
        .page-backoffice.page-owners .owners-alert{background:#fff7ed;border:1px solid #fcd34d;box-shadow:0 14px 28px rgba(251,191,36,.22);display:grid;gap:6px;padding:18px;}
        .page-backoffice.page-owners .owners-alert h2{margin:0;font-size:1rem;color:#92400e;}
        .page-backoffice.page-owners .owners-alert p{margin:0;font-size:.85rem;color:#b45309;}
        .page-backoffice.page-owners .owners-alert__list{margin:0;padding-left:18px;color:#b45309;font-size:.85rem;display:grid;gap:4px;}
        .page-backoffice.page-owners .owners-alert--expenses{border-color:#f59e0b;background:#fff4e6;}
        .page-backoffice.page-owners .owners-property{display:grid;gap:18px;}
        .page-backoffice.page-owners .owners-property__header{display:grid;gap:8px;}
        @media (min-width:640px){.page-backoffice.page-owners .owners-property__header{grid-template-columns:minmax(0,1fr) auto;align-items:flex-start;}}
        .page-backoffice.page-owners .owners-property__meta{display:flex;flex-wrap:wrap;gap:10px;font-size:.75rem;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-property__stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));}
        .page-backoffice.page-owners .owners-property__stat{border-radius:18px;border:1px solid rgba(249,115,22,.18);background:#fff7ed;padding:14px;display:grid;gap:4px;align-content:start;}
        .page-backoffice.page-owners .owners-property__stat span{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:#b45309;}
        .page-backoffice.page-owners .owners-property__stat strong{font-size:1.1rem;color:#9a3412;}
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
        .page-backoffice.page-owners .owners-table td{padding:12px;border-bottom:1px solid rgba(148,163,184,.25);font-size:.85rem;color:#334155;vertical-align:top;}
        .page-backoffice.page-owners .owners-table tbody tr:nth-child(even){background:rgba(254,243,199,.35);}
        .page-backoffice.page-owners .owners-empty{display:grid;gap:8px;color:#b45309;}
        .page-backoffice.page-owners .owners-channel-card ul{margin:0;padding:0;list-style:none;display:grid;gap:10px;}
        .page-backoffice.page-owners .owners-channel-card li{display:flex;justify-content:space-between;gap:12px;font-size:.85rem;color:#334155;}
        .page-backoffice.page-owners .owners-channel-card li span:last-child{font-weight:600;color:#9a3412;}
        .page-backoffice.page-owners .owners-channel-card li span:first-child{display:flex;align-items:center;gap:8px;}
        .page-backoffice.page-owners .owners-simulation__header{display:grid;gap:12px;}
        @media (min-width:900px){.page-backoffice.page-owners .owners-simulation__header{grid-template-columns:minmax(0,1fr) auto;align-items:flex-start;}}
        .page-backoffice.page-owners .owners-simulation__stats{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));}
        .page-backoffice.page-owners .owners-simulation__stats span{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-simulation__stats strong{font-size:1.1rem;color:#9a3412;}
        .page-backoffice.page-owners .owners-simulation__form{margin-top:16px;display:grid;gap:12px;}
        .page-backoffice.page-owners .owners-simulation__grid{display:grid;gap:12px;}
        @media (min-width:720px){.page-backoffice.page-owners .owners-simulation__grid{grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;}}
        .page-backoffice.page-owners .owners-simulation__actions{display:flex;gap:12px;flex-wrap:wrap;}
        .page-backoffice.page-owners .owners-simulation__results{margin-top:16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));background:#fff7ed;border-radius:16px;padding:18px;border:1px solid rgba(249,115,22,.18);}
        .page-backoffice.page-owners .owners-simulation__results span{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-simulation__results strong{font-size:1.15rem;color:#9a3412;}
        .page-backoffice.page-owners .owners-simulation__results p{margin:4px 0 0;font-size:.8rem;color:#b45309;}
        .page-backoffice.page-owners .owners-unit-table{display:grid;gap:12px;}
        .page-backoffice.page-owners .owners-unit-table table{min-width:640px;}
        .page-backoffice.page-owners .owners-finance{display:grid;gap:18px;}
        .page-backoffice.page-owners .owners-finance__header{display:grid;gap:12px;}
        @media (min-width:900px){.page-backoffice.page-owners .owners-finance__header{grid-template-columns:minmax(0,1fr) auto;align-items:flex-start;}}
        .page-backoffice.page-owners .owners-finance__totals{display:flex;flex-wrap:wrap;gap:18px;justify-content:flex-end;}
        .page-backoffice.page-owners .owners-finance__totals span{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#b45309;font-weight:600;}
        .page-backoffice.page-owners .owners-finance__totals strong{display:block;font-size:1.1rem;color:#9a3412;}
        .page-backoffice.page-owners .owners-finance-flash{margin-top:12px;padding:12px 16px;border-radius:14px;font-size:.85rem;}
        .page-backoffice.page-owners .owners-finance-flash--error{background:rgba(248,113,113,.18);color:#b91c1c;border:1px solid rgba(248,113,113,.35);}
        .page-backoffice.page-owners .owners-finance-flash--success{background:rgba(16,185,129,.18);color:#047857;border:1px solid rgba(16,185,129,.35);}
        .page-backoffice.page-owners .owners-finance__content{display:grid;gap:18px;}
        @media (min-width:960px){.page-backoffice.page-owners .owners-finance__content{grid-template-columns:320px minmax(0,1fr);}}
        .page-backoffice.page-owners .owners-finance-form__grid{display:grid;gap:12px;}
        .page-backoffice.page-owners .owners-finance-form__grid .form-field--full{grid-column:1/-1;}
        .page-backoffice.page-owners .owners-finance-form__actions{display:flex;justify-content:flex-end;}
        .page-backoffice.page-owners .owners-finance-inline-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;}
        .page-backoffice.page-owners .owners-finance-inline-form label{display:flex;flex-direction:column;gap:4px;font-size:.7rem;color:#64748b;}
        .page-backoffice.page-owners .owners-finance-inline-form .input{min-width:120px;}
        .page-backoffice.page-owners .owners-finance-inline-form--danger{margin-top:4px;}
        .page-backoffice.page-owners .owners-finance-type{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:rgba(148,163,184,.15);color:#334155;}
        .page-backoffice.page-owners .owners-finance-type--invoice{background:rgba(16,185,129,.2);color:#047857;}
        .page-backoffice.page-owners .owners-finance-type--expense{background:rgba(248,113,113,.2);color:#b91c1c;}
        .page-backoffice.page-owners .owners-finance-type--adjustment{background:rgba(59,130,246,.18);color:#1d4ed8;}
        .page-backoffice.page-owners .owners-finance-meta{font-size:.75rem;color:#64748b;}
        .page-backoffice.page-owners .owners-finance-notes{margin-top:6px;font-size:.8rem;color:#334155;}
        .page-backoffice.page-owners .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
      </style>
    `;

    const body = html`
      ${pageStyles}
      <div class="bo-main owners-main">
        <header class="bo-header">
          <span class="pill-indicator">Área de Proprietários</span>
          <h1>Resumo de desempenho</h1>
          <p>Consulte receita recente, reservas futuras e simule cenários de rentabilidade sem aceder ao backoffice.</p>
        </header>
        ${filterFormHtml}
        ${summaryCardsHtml}
        ${simulationCardHtml}
        ${pendingBannerHtml}
        ${expensesDueSoonHtml}
        ${propertySectionsHtml}
        ${upcomingTableHtml}
        ${channelSummaryHtml}
        ${financialSectionHtml}
      </div>
    `;

    res.send(
      layout({
        title: 'Área de Proprietários',
        user: viewer,
        activeNav: 'owners',
        pageClass: 'page-backoffice page-owners',
        body
      })
    );
  });

  app.post('/owners/financial-entries', requireLogin, ensureOwnerPortalAccess, csrfProtection.middleware, (req, res) => {
    const viewer = req.user;
    const redirect = safeRedirect(req.body.redirect);
    const errors = [];

    const typeRaw = typeof req.body.entry_type === 'string' ? req.body.entry_type.toLowerCase().trim() : '';
    const validTypes = ['invoice', 'expense', 'adjustment'];
    const entryType = validTypes.includes(typeRaw) ? typeRaw : 'adjustment';

    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!description) {
      errors.push('Descrição é obrigatória.');
    }

    let propertyId = normalizePropertyId(req.body.property_id);
    let unitId = normalizeUnitId(req.body.unit_id);

    if (propertyId) {
      const property = findPropertyStmt.get(propertyId);
      if (!property) {
        errors.push('Propriedade inválida.');
      } else if (!canManageProperty(viewer, propertyId)) {
        errors.push('Sem acesso à propriedade selecionada.');
      }
    }

    if (unitId) {
      const unit = findUnitStmt.get(unitId);
      if (!unit) {
        errors.push('Unidade inválida.');
      } else {
        if (!canManageProperty(viewer, unit.property_id)) {
          errors.push('Sem acesso à unidade selecionada.');
        }
        if (propertyId && propertyId !== unit.property_id) {
          errors.push('A unidade não pertence à propriedade selecionada.');
        }
        propertyId = propertyId || unit.property_id;
        unitId = unit.id;
      }
    }

    const amountCents = parseAmountCents(req.body.amount_eur);
    if (!Number.isFinite(amountCents)) {
      errors.push('Montante inválido.');
    } else if (entryType !== 'adjustment' && amountCents <= 0) {
      errors.push('Montante deve ser superior a zero.');
    } else if (entryType === 'adjustment' && amountCents === 0) {
      errors.push('Montante de ajuste não pode ser zero.');
    }

    const category = typeof req.body.category === 'string' ? req.body.category.trim().slice(0, 80) : null;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 500) : null;
    const issueDate = normalizeDate(req.body.issue_date);
    const dueDate = normalizeDate(req.body.due_date);

    if (errors.length) {
      return redirectWithMessage(res, redirect, 'finance_error', errors.join(' '));
    }

    const normalizedAmountCents = entryType === 'adjustment' ? amountCents : Math.abs(amountCents);
    const status = entryType === 'adjustment' ? 'draft' : 'pending';

    try {
      insertFinancialEntryStmt.run(
        viewer.id,
        propertyId,
        unitId,
        entryType,
        category || null,
        description.slice(0, 200),
        null,
        normalizedAmountCents,
        issueDate,
        dueDate,
        status,
        notes || null
      );
      if (typeof logActivity === 'function') {
        logActivity(req, {
          action: 'owners.financial.create',
          target: 'owner_financial_entries',
          details: {
            entryType,
            amountCents: normalizedAmountCents,
            propertyId,
            unitId
          }
        });
      }
      return redirectWithMessage(res, redirect, 'finance_notice', 'Registo financeiro criado com sucesso.');
    } catch (err) {
      console.error('Falha ao criar registo financeiro:', err);
      return redirectWithMessage(res, redirect, 'finance_error', 'Não foi possível guardar o registo financeiro.');
    }
  });

  app.post(
    '/owners/financial-entries/:id/update',
    requireLogin,
    ensureOwnerPortalAccess,
    csrfProtection.middleware,
    (req, res) => {
      const viewer = req.user;
      const redirect = safeRedirect(req.body.redirect);
      const entryId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(entryId)) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Registo inválido.');
      }
      const entry = findFinancialEntryStmt.get(entryId);
      if (!entry) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Registo financeiro não encontrado.');
      }
      if (entry.user_id !== viewer.id && !userHasBackofficeAccess(viewer)) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Sem permissão para alterar este registo.');
      }

      const statusRaw = typeof req.body.status === 'string' ? req.body.status.toLowerCase().trim() : '';
      const allowedStatuses = ['draft', 'pending', 'paid', 'cancelled'];
      const status = allowedStatuses.includes(statusRaw) ? statusRaw : entry.status || 'pending';
      const dueDate = normalizeDate(req.body.due_date);

      try {
        updateFinancialEntryStmt.run(status, dueDate, entryId);
        if (typeof logActivity === 'function') {
          logActivity(req, {
            action: 'owners.financial.update',
            target: 'owner_financial_entries',
            details: {
              entryId,
              status,
              dueDate
            }
          });
        }
        return redirectWithMessage(res, redirect, 'finance_notice', 'Registo financeiro atualizado.');
      } catch (err) {
        console.error('Falha ao atualizar registo financeiro:', err);
        return redirectWithMessage(res, redirect, 'finance_error', 'Não foi possível atualizar o registo financeiro.');
      }
    }
  );

  app.post(
    '/owners/financial-entries/:id/delete',
    requireLogin,
    ensureOwnerPortalAccess,
    csrfProtection.middleware,
    (req, res) => {
      const viewer = req.user;
      const redirect = safeRedirect(req.body.redirect);
      const entryId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(entryId)) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Registo inválido.');
      }
      const entry = findFinancialEntryStmt.get(entryId);
      if (!entry) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Registo financeiro não encontrado.');
      }
      if (entry.user_id !== viewer.id && !userHasBackofficeAccess(viewer)) {
        return redirectWithMessage(res, redirect, 'finance_error', 'Sem permissão para remover este registo.');
      }

      try {
        deleteFinancialEntryStmt.run(entryId);
        if (typeof logActivity === 'function') {
          logActivity(req, {
            action: 'owners.financial.delete',
            target: 'owner_financial_entries',
            details: {
              entryId,
              entryType: entry.entry_type
            }
          });
        }
        return redirectWithMessage(res, redirect, 'finance_notice', 'Registo financeiro removido.');
      } catch (err) {
        console.error('Falha ao remover registo financeiro:', err);
        return redirectWithMessage(res, redirect, 'finance_error', 'Não foi possível remover o registo financeiro.');
      }
    }
  );

  app.get('/api/owners/dashboard', requireLogin, ensureOwnerPortalAccess, (req, res) => {
    try {
      const data = computeOwnerDashboardData(req.user, req.query);
      res.json({ ok: true, data: serializeDashboardData(data) });
    } catch (err) {
      console.error('Falha ao carregar dashboard de owners:', err);
      res.status(500).json({ ok: false, error: 'Não foi possível carregar o dashboard.' });
    }
  });

  app.post('/api/owners/push/register', requireLogin, ensureOwnerPortalAccess, (req, res) => {
    if (!ownerPushService || typeof ownerPushService.registerDevice !== 'function') {
      return res.status(503).json({ ok: false, error: 'Serviço de notificações indisponível.' });
    }
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const platform = typeof req.body.platform === 'string' ? req.body.platform.trim() : null;
    const label = typeof req.body.label === 'string' ? req.body.label.trim() : null;
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token obrigatório.' });
    }
    try {
      ownerPushService.registerDevice({ userId: req.user.id, token, platform, label });
      if (typeof logActivity === 'function') {
        logActivity(req, {
          action: 'owners.push.register',
          target: 'owner_push_devices',
          details: { platform: platform || null, hasLabel: !!label }
        });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/owners/push/notifications', requireLogin, ensureOwnerPortalAccess, (req, res) => {
    if (!ownerPushService || typeof ownerPushService.listNotifications !== 'function') {
      return res.json({ ok: true, notifications: [] });
    }
    const limit = Number.parseInt(req.query.limit, 10);
    const notifications = ownerPushService.listNotifications(req.user.id, {
      limit: Number.isFinite(limit) ? limit : undefined
    });
    res.json({ ok: true, notifications });
  });

  app.post('/api/owners/push/notifications', requireLogin, ensureOwnerPortalAccess, (req, res) => {
    if (!ownerPushService || typeof ownerPushService.acknowledgeNotifications !== 'function') {
      return res.status(503).json({ ok: false, error: 'Serviço de notificações indisponível.' });
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const normalizedIds = ids
      .map(id => Number.parseInt(id, 10))
      .filter(value => Number.isInteger(value) && value > 0);
    const updated = ownerPushService.acknowledgeNotifications(req.user.id, normalizedIds);
    res.json({ ok: true, updated });
  });
};
