// Bookings module: handles backoffice booking routes and reservation management helpers.
const { ConflictError, ValidationError } = require('../../services/errors');

function registerBookings(app, context) {
  if (!app) throw new Error('registerBookings: app é obrigatório');
  if (!context) throw new Error('registerBookings: context é obrigatório');

  const {
    db,
    dayjs,
    html,
    layout,
    esc,
    eur,
    renderIcon,
    resolveBrandingForRequest,
    rememberActiveBrandingProperty,
    userCan,
    requireLogin,
    requirePermission,
    requireAdmin,
    ratePlanService,
    rateQuote,
    overbookingGuard,
    logChange,
    logActivity,
    deleteLockByBookingStmt,
    adminBookingUpdateStmt,
    bookingEmailer,
    buildBookingExportRow,
    sendBookingsExport
  } = context;

  if (typeof buildBookingExportRow !== 'function' || typeof sendBookingsExport !== 'function') {
    throw new Error('registerBookings: export helpers são obrigatórios.');
  }

  function renderBookingDetailPage(req, res, { booking, bookingNotes, planOptions = [], feedback = null, statusCode = 200 }) {
    if (!booking) {
      return res.status(404).send('Reserva não encontrada');
    }

    const b = booking;
    const canEditBooking = userCan(req.user, 'bookings.edit');
    const canCancelBooking = userCan(req.user, 'bookings.cancel');
    const canAddNote = userCan(req.user, 'bookings.notes');

    const feedbackHtml = feedback && feedback.message
      ? `<div class="inline-feedback" data-variant="${feedback.variant === 'success' ? 'success' : 'danger'}" role="alert" aria-live="polite">`
          + `<span class="inline-feedback-icon">${feedback.variant === 'success' ? '✓' : '⚠'}</span>`
          + `<div>${esc(feedback.message)}</div>`
          + '</div>'
      : '';

    const notes = Array.isArray(bookingNotes) ? bookingNotes : [];
    const sortedPlans = Array.isArray(planOptions) ? [...planOptions] : [];
    sortedPlans.sort((a, bOption) => {
      const aName = (a && a.name) || '';
      const bName = (bOption && bOption.name) || '';
      return aName.localeCompare(bName);
    });

    const planOptionsHtml = sortedPlans
      .map(plan => {
        if (!plan || !plan.id) return '';
        const active = plan.active === undefined || plan.active === null ? true : !!plan.active;
        const label = `${plan.name}${active ? '' : ' (inativo)'}`;
        const selected = Number(b.rate_plan_id || 0) === Number(plan.id) ? 'selected' : '';
        return `<option value="${plan.id}" ${selected}>${esc(label)}</option>`;
      })
      .filter(Boolean)
      .join('');

    const theme = resolveBrandingForRequest(req, { propertyId: b.property_id, propertyName: b.property_name });
    rememberActiveBrandingProperty(res, b.property_id);

    const formattedNotes = notes.map(n => ({
      ...n,
      created_human: dayjs(n.created_at).format('DD/MM/YYYY HH:mm')
    }));

    const planSelect = `<div>
              <label class="text-sm">Plano tarifário</label>
              <select name="rate_plan_id" class="input">
                <option value="">Sem plano</option>
                ${planOptionsHtml}
              </select>
              <p class="text-xs text-slate-500">Respeita restrições de chegada (CTA) e saída (CTD) associadas.</p>
            </div>`;

    const body = html`
      <div class="bo-page">
        <a class="text-slate-600 underline" href="/admin/bookings">&larr; Reservas</a>
        <h1 class="text-2xl font-semibold mb-4">Editar reserva #${b.id}</h1>
        ${feedbackHtml}

        <div class="card p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div class="text-sm text-slate-500">${esc(b.property_name)}</div>
          <div class="font-semibold mb-3">${esc(b.unit_name)}</div>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Atual: ${dayjs(b.checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
            <li>Ocupação: ${b.adults}A+${b.children}C (cap. ${b.capacity})</li>
            <li>Total atual: € ${eur(b.total_cents)}</li>
          </ul>
          ${b.internal_notes
            ? html`
                <div class="mt-4">
                  <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Anotacoes internas</div>
                  <div class="text-sm text-slate-700 whitespace-pre-line">${esc(b.internal_notes)}</div>
                </div>
              `
            : ''}
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
            <input class="input" name="guest_nationality" value="${esc(b.guest_nationality || '')}" placeholder="Nacionalidade"/>
            <div>
              <label class="text-sm">Agência</label>
              <input class="input" name="agency" value="${esc(b.agency || '')}" placeholder="Ex: BOOKING" />
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Anotações internas</label>
              <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas">${esc(b.internal_notes || '')}</textarea>
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Status</label>
              <select class="input" name="status">
                <option value="CONFIRMED" ${b.status === 'CONFIRMED' ? 'selected' : ''}>Confirmada</option>
                <option value="PENDING" ${b.status === 'PENDING' ? 'selected' : ''}>Pendente</option>
              </select>
            </div>
            ${planOptionsHtml ? planSelect : ''}
          </fieldset>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="grid gap-2">
              <button type="submit" class="btn btn-primary" ${canEditBooking ? '' : 'disabled'}>Guardar alterações</button>
              <p class="text-xs text-slate-500">As alterações ficam imediatamente disponíveis para integrações e o portal do hóspede.</p>
            </div>
            <div class="grid gap-2">
              <div class="card bg-slate-50 p-4 text-sm text-slate-600">
                <p class="font-semibold text-slate-900">Resumo</p>
                <ul class="mt-2 space-y-1">
                  <li>Check-in: ${dayjs(b.checkin).format('DD/MM/YYYY')}</li>
                  <li>Check-out: ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
                  <li>Noites: ${dayjs(b.checkout).diff(dayjs(b.checkin), 'day')}</li>
                  <li>Total atual: € ${eur(b.total_cents)}</li>
                </ul>
              </div>
            </div>
          </div>
        </form>

        <div class="grid gap-4">
          <section>
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-lg font-semibold">Notas internas</h2>
              ${canAddNote
                ? `<form method="post" action="/admin/bookings/${b.id}/notes" class="flex gap-2">
                    <input name="note" class="input" placeholder="Adicionar nota" required />
                    <button class="btn btn-secondary">Adicionar</button>
                  </form>`
                : ''}
            </div>
            <ul class="space-y-2">
              ${formattedNotes.length
                ? formattedNotes
                    .map(note => `
                      <li class="border border-slate-200 rounded-lg p-3">
                        <div class="text-xs text-slate-500">${esc(note.created_human)} · ${esc(note.username || '')}</div>
                        <div class="text-sm text-slate-700 whitespace-pre-line">${esc(note.note)}</div>
                      </li>
                    `)
                    .join('')
                : '<li class="text-sm text-slate-500">Sem notas registadas.</li>'}
            </ul>
          </section>

          <section class="border border-rose-200 bg-rose-50 rounded-lg p-4 space-y-2">
            <h2 class="text-lg font-semibold text-rose-700">Cancelar reserva</h2>
            <p class="text-sm text-rose-600">
              Cancela definitivamente esta reserva e liberta a disponibilidade da unidade. Esta ação é irreversível.
            </p>
            ${canCancelBooking
              ? `<form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                  <button class="btn btn-danger">Cancelar reserva</button>
                </form>`
              : '<p class="text-sm text-slate-500">Sem permissões para cancelar reservas.</p>'}
          </section>
        </div>
      </div>
    `;

    res.status(statusCode).send(layout({
      title: `Reserva #${b.id}`,
      language: req.language,
      t: req.t,
      user: req.user,
      activeNav: 'bookings',
      branding: theme,
      pageClass: 'page-backoffice page-bookings-detail',
      body
    }));
  }

  app.get(
    '/admin/bookings',
    requireLogin,
    requirePermission('bookings.view'),
    async (req, res) => {
      const translate = req.t
        ? (key, options = {}) => req.t(key, options)
        : (key, options = {}) => options.defaultValue || key;

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const ym = typeof req.query.ym === 'string' ? req.query.ym.trim() : '';

      const exportFormatRaw =
        typeof req.query.export === 'string' ? req.query.export.trim().toLowerCase() : '';
      const isExport = exportFormatRaw === 'csv' || exportFormatRaw === 'xlsx';
      const limit = isExport ? 2000 : 500;

      const where = [];
      const args = [];

      if (q) {
        const pattern = `%${q}%`;
        where.push(
          `(b.guest_name LIKE ? OR b.guest_email LIKE ? OR u.name LIKE ? OR p.name LIKE ? OR b.agency LIKE ?)`
        );
        args.push(pattern, pattern, pattern, pattern, pattern);
      }

      if (status) {
        where.push(`b.status = ?`);
        args.push(status);
      }

      let hasMonthFilter = false;
      if (/^\d{4}-\d{2}$/.test(ym)) {
        hasMonthFilter = true;
        const startYM = `${ym}-01`;
        const endYM = dayjs(startYM).endOf('month').add(1, 'day').format('YYYY-MM-DD');
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
          LIMIT ?
      `;

      let rows = [];
      try {
        rows = db.prepare(sql).all(...args, limit);
      } catch (err) {
        console.error('Erro ao carregar reservas:', err);
        return res.status(500).send('Não foi possível carregar as reservas.');
      }

      if (isExport) {
        try {
          const exportRows = rows.map(buildBookingExportRow);
          await sendBookingsExport(res, exportFormatRaw, exportRows);
        } catch (err) {
          console.error('Erro ao exportar reservas:', err);
          res.status(500).send('Falha ao gerar exportação de reservas.');
        }
        return;
      }

      const filterParams = new URLSearchParams();
      if (q) filterParams.set('q', q);
      if (status) filterParams.set('status', status);
      if (hasMonthFilter) filterParams.set('ym', ym);
      const baseQuery = filterParams.toString();
      const csvUrl = `/admin/bookings${baseQuery ? `?${baseQuery}&` : '?'}export=csv`;
      const xlsxUrl = `/admin/bookings${baseQuery ? `?${baseQuery}&` : '?'}export=xlsx`;

      const pageTitle = translate('backoffice.bookings.title', { defaultValue: 'Reservas' });
      const exportGroupLabel = translate('backoffice.bookings.export.groupLabel', {
        defaultValue: 'Exportar reservas'
      });
      const exportCsvLabel = translate('backoffice.bookings.export.csv', {
        defaultValue: 'Exportar CSV'
      });
      const exportXlsxLabel = translate('backoffice.bookings.export.xlsx', {
        defaultValue: 'Exportar XLSX'
      });
      const searchPlaceholder = translate('backoffice.bookings.filters.searchPlaceholder', {
        defaultValue: 'Procurar por hóspede, email, unidade, propriedade'
      });
      const searchLabel = translate('backoffice.bookings.filters.searchLabel', {
        defaultValue: 'Pesquisar reservas'
      });
      const filterFormLabel = translate('backoffice.bookings.filters.formLabel', {
        defaultValue: 'Filtros de reservas'
      });
      const statusAnyLabel = translate('backoffice.bookings.filters.statusAny', {
        defaultValue: 'Todos os estados'
      });
      const statusFilterLabel = translate('backoffice.bookings.filters.statusLabel', {
        defaultValue: 'Filtrar por estado'
      });
      const monthFilterLabel = translate('backoffice.bookings.filters.monthLabel', {
        defaultValue: 'Filtrar por mês'
      });
      const statusConfirmedLabel = translate('backoffice.bookings.status.confirmed', {
        defaultValue: 'Confirmada'
      });
      const statusPendingLabel = translate('backoffice.bookings.status.pending', {
        defaultValue: 'Pendente'
      });
      const cancelPrompt = translate('backoffice.bookings.actions.cancelConfirm', {
        defaultValue: 'Cancelar esta reserva?'
      });
      const cancelLabel = translate('actions.cancel', { defaultValue: 'Cancelar' });
      const editLabel = translate('actions.edit', { defaultValue: 'Editar' });
      const viewLabel = translate('actions.view', { defaultValue: 'Ver' });
      const emptyStateText = translate('table.empty', {
        defaultValue: 'Sem registos para apresentar.'
      });
      const propertyUnitLabel = translate('backoffice.bookings.table.propertyUnit', {
        defaultValue: 'Propriedade/Unidade'
      });
      const agencyLabel = translate('backoffice.bookings.table.agency', { defaultValue: 'Agência' });
      const guestLabel = translate('backoffice.bookings.table.guest', { defaultValue: 'Hóspede' });
      const occupancyLabel = translate('backoffice.bookings.table.occupancy', { defaultValue: 'Ocup.' });
      const totalLabel = translate('backoffice.bookings.table.total', { defaultValue: 'Total' });
      const statusColumnLabel = translate('labels.status', { defaultValue: 'Estado' });
      const actionsColumnLabel = translate('table.actionsColumn', { defaultValue: 'Ações' });
      const filterButtonLabel = translate('actions.filter', { defaultValue: 'Filtrar' });

      const canEditBooking = userCan(req.user, 'bookings.edit');
      const canCancelBooking = userCan(req.user, 'bookings.cancel');
      const detailLabel = canEditBooking ? editLabel : viewLabel;

      res.send(
        layout({
          title: pageTitle,
          language: req.language,
          t: req.t,
          user: req.user,
          activeNav: 'bookings',
          branding: resolveBrandingForRequest(req),
          pageClass: 'page-backoffice page-bookings',
          body: html`
            <div class="bo-page" data-bookings-root>
              <h1 class="text-2xl font-semibold mb-4">${esc(pageTitle)}</h1>

              <form
                method="get"
                class="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-4"
                role="search"
                aria-label="${esc(filterFormLabel)}"
              >
                <input
                  class="input md:col-span-2"
                  type="search"
                  name="q"
                  placeholder="${esc(searchPlaceholder)}"
                  value="${esc(q)}"
                  aria-label="${esc(searchLabel)}"
                />
                <select class="input" name="status" aria-label="${esc(statusFilterLabel)}">
                  <option value="">${esc(statusAnyLabel)}</option>
                  <option value="CONFIRMED" ${status === 'CONFIRMED' ? 'selected' : ''}>
                    ${esc(statusConfirmedLabel)}
                  </option>
                  <option value="PENDING" ${status === 'PENDING' ? 'selected' : ''}>
                    ${esc(statusPendingLabel)}
                  </option>
                </select>
                <input
                  class="input"
                  type="month"
                  name="ym"
                  value="${/^\d{4}-\d{2}$/.test(ym) ? ym : ''}"
                  aria-label="${esc(monthFilterLabel)}"
                />
                <button class="btn btn-primary" type="submit">${esc(filterButtonLabel)}</button>
              </form>

              <div class="flex flex-wrap justify-end gap-2 mb-4" role="group" aria-label="${esc(
                exportGroupLabel
              )}">
                <a class="btn btn-light" href="${csvUrl}">
                  ${renderIcon('file-down', { className: 'w-4 h-4' })}
                  <span>${esc(exportCsvLabel)}</span>
                </a>
                <a class="btn btn-light" href="${xlsxUrl}">
                  ${renderIcon('file-spreadsheet', { className: 'w-4 h-4' })}
                  <span>${esc(exportXlsxLabel)}</span>
                </a>
              </div>

              <div class="card p-0" data-table-container>
                <div class="responsive-table">
                  <table class="w-full text-sm" aria-label="${esc(pageTitle)}">
                    <thead>
                      <tr class="text-left text-slate-500">
                        <th scope="col">Check-in</th>
                        <th scope="col">Check-out</th>
                        <th scope="col">${esc(propertyUnitLabel)}</th>
                        <th scope="col">${esc(agencyLabel)}</th>
                        <th scope="col">${esc(guestLabel)}</th>
                        <th scope="col">${esc(occupancyLabel)}</th>
                        <th scope="col">${esc(totalLabel)}</th>
                        <th scope="col">${esc(statusColumnLabel)}</th>
                        <th scope="col" class="text-right">${esc(actionsColumnLabel)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows
                        .map(b => {
                          const statusLabel =
                            b.status === 'CONFIRMED'
                              ? statusConfirmedLabel
                              : b.status === 'PENDING'
                              ? statusPendingLabel
                              : b.status || '';
                          return `
                            <tr>
                              <td data-label="Check-in">
                                <span class="table-cell-value">${dayjs(b.checkin).format('DD/MM/YYYY')}</span>
                              </td>
                              <td data-label="Check-out">
                                <span class="table-cell-value">${dayjs(b.checkout).format('DD/MM/YYYY')}</span>
                              </td>
                              <td data-label="${esc(propertyUnitLabel)}">
                                <span class="table-cell-value">${esc(b.property_name)} - ${esc(b.unit_name)}</span>
                              </td>
                              <td data-label="${esc(agencyLabel)}">
                                <span class="table-cell-value">${esc(b.agency || '') || '—'}</span>
                              </td>
                              <td data-label="${esc(guestLabel)}">
                                <span class="table-cell-value">
                                  ${esc(b.guest_name)}
                                  <span class="table-cell-muted">${esc(b.guest_email || '')}</span>
                                </span>
                              </td>
                              <td data-label="${esc(occupancyLabel)}">
                                <span class="table-cell-value">${b.adults}A+${b.children}C</span>
                              </td>
                              <td data-label="${esc(totalLabel)}">
                                <span class="table-cell-value">€ ${eur(b.total_cents)}</span>
                              </td>
                              <td data-label="${esc(statusColumnLabel)}">
                                <span class="inline-flex items-center text-xs font-semibold rounded px-2 py-0.5 ${
                                  b.status === 'CONFIRMED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : b.status === 'PENDING'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-200 text-slate-700'
                                }">
                                  ${esc(statusLabel)}
                                </span>
                              </td>
                              <td data-label="${esc(actionsColumnLabel)}">
                                <div class="table-cell-actions">
                                  <a class="underline" href="/admin/bookings/${b.id}">${esc(detailLabel)}</a>
                                  ${
                                    canCancelBooking
                                      ? `
                                          <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm(&quot;${esc(
                                            cancelPrompt
                                          )}&quot;);">
                                            <button class="text-rose-600" type="submit">${esc(cancelLabel)}</button>
                                          </form>
                                        `
                                      : ''
                                  }
                                </div>
                              </td>
                            </tr>
                          `;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>
                ${rows.length === 0 ? `<div class="p-4 text-slate-500">${esc(emptyStateText)}</div>` : ''}
              </div>
            </div>
          `
        })
      );
    }
  );

  app.get('/admin/bookings/:id', requireLogin, requirePermission('bookings.view'), (req, res) => {
    const b = db.prepare(`
      SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, u.property_id, p.name as property_name
        FROM bookings b
        JOIN units u ON u.id = b.unit_id
        JOIN properties p ON p.id = u.property_id
       WHERE b.id = ?
    `).get(req.params.id);
    if (!b) return res.status(404).send('Reserva não encontrada');

    const bookingNotes = db.prepare(`
      SELECT bn.id, bn.note, bn.created_at, u.username
        FROM booking_notes bn
        JOIN users u ON u.id = bn.user_id
       WHERE bn.booking_id = ?
       ORDER BY bn.created_at DESC
    `).all(b.id);
    let planOptions = [];
    if (ratePlanService) {
      try {
        planOptions = ratePlanService.listPlans({ propertyId: b.property_id, includeInactive: true });
        if (b.rate_plan_id) {
          const currentPlan = ratePlanService.getPlan(b.rate_plan_id);
          if (currentPlan && !planOptions.some(p => Number(p.id) === Number(currentPlan.id))) {
            planOptions = [...planOptions, currentPlan];
          }
        }
      } catch (err) {
        console.warn('Falha ao carregar planos tarifários:', err.message);
      }
    }

    renderBookingDetailPage(req, res, {
      booking: b,
      bookingNotes,
      planOptions,
      feedback: null,
      statusCode: 200
    });
  });

  app.post('/admin/bookings/:id/update', requireLogin, requirePermission('bookings.edit'), (req, res) => {
    const id = req.params.id;
    const b = db.prepare(`
      SELECT b.*, u.capacity, u.base_price_cents, u.name AS unit_name, u.property_id, p.name AS property_name
        FROM bookings b
        JOIN units u ON u.id = b.unit_id
        JOIN properties p ON p.id = u.property_id
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
    const rawPlanId = typeof req.body.rate_plan_id === 'string' ? req.body.rate_plan_id.trim() : '';
    let ratePlanId = null;
    let latestQuoteCents = b.total_cents;

    const renderUpdateError = (message, statusCode) => {
      let planOptions = [];
      let bookingNotes = [];
      try {
        bookingNotes = db
          .prepare(
            `SELECT bn.id, bn.note, bn.created_at, u.username
               FROM booking_notes bn
               JOIN users u ON u.id = bn.user_id
              WHERE bn.booking_id = ?
              ORDER BY bn.created_at DESC`
          )
          .all(b.id);
        if (ratePlanService) {
          planOptions = ratePlanService.listPlans({ propertyId: b.property_id, includeInactive: true });
          if (ratePlanId) {
            const currentPlan = ratePlanService.getPlan(ratePlanId);
            if (currentPlan && !planOptions.some(p => Number(p.id) === Number(currentPlan.id))) {
              planOptions = [...planOptions, currentPlan];
            }
          }
        }
      } catch (err) {
        console.warn('Falha ao preparar contexto da reserva:', err.message);
      }

      const attempted = {
        ...b,
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
        total_cents: latestQuoteCents,
        rate_plan_id: ratePlanId
      };

      renderBookingDetailPage(req, res, {
        booking: attempted,
        bookingNotes,
        planOptions,
        feedback: { message, variant: 'danger' },
        statusCode
      });
    };

    if (rawPlanId) {
      const parsedPlan = Number.parseInt(rawPlanId, 10);
      if (!Number.isInteger(parsedPlan) || parsedPlan <= 0) {
        return renderUpdateError('Plano tarifário inválido.', 400);
      }
      ratePlanId = parsedPlan;
    }

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

    if (ratePlanService) {
      try {
        ratePlanService.assertBookingAllowed({ ratePlanId, checkin, checkout });
      } catch (err) {
        if (err instanceof ConflictError || (err && err.status === 409)) {
          return renderUpdateError(err.message || 'Plano tarifário indisponível para estas datas.', err.status || 409);
        }
        if (err instanceof ValidationError || (err && err.status === 400)) {
          return renderUpdateError(err.message || 'Plano tarifário inválido.', err.status || 400);
        }
        throw err;
      }
    }

    const q = rateQuote(b.unit_id, checkin, checkout, b.base_price_cents);
    latestQuoteCents = q.total_cents;
    if (q.nights < q.minStayReq) return res.status(400).send(`Estadia mínima: ${q.minStayReq} noites`);

    if (ratePlanService && ratePlanId) {
      try {
        ratePlanService.assertBookingAllowed({ ratePlanId, checkin, checkout });
      } catch (err) {
        if (err instanceof ConflictError || (err && err.status === 409)) {
          return renderUpdateError(err.message || 'Plano tarifário indisponível para estas datas.', err.status || 409);
        }
        if (err instanceof ValidationError || (err && err.status === 400)) {
          return renderUpdateError(err.message || 'Plano tarifário inválido.', err.status || 400);
        }
        throw err;
      }
    }

    try {
      if (status === 'CONFIRMED') {
        overbookingGuard.reserveSlot({
          unitId: b.unit_id,
          from: checkin,
          to: checkout,
          bookingId: b.id,
          actorId: req.user ? req.user.id : null
        });
      } else if (deleteLockByBookingStmt) {
        deleteLockByBookingStmt.run(b.id);
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        return res.status(409).send('Conflito com outra reserva ou bloqueio.');
      }
      throw err;
    }

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
      ratePlanId || null,
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

    const statusChangedToConfirmed = b.status !== 'CONFIRMED' && status === 'CONFIRMED';
    if (statusChangedToConfirmed) {
      const updatedBooking = db
        .prepare(
          `SELECT b.*, u.name AS unit_name, u.property_id, p.name AS property_name
             FROM bookings b
             JOIN units u ON u.id = b.unit_id
             JOIN properties p ON p.id = u.property_id
            WHERE b.id = ?`
        )
        .get(id);
      if (updatedBooking) {
        const branding = resolveBrandingForRequest(req, {
          propertyId: updatedBooking.property_id,
          propertyName: updatedBooking.property_name
        });
        bookingEmailer
          .sendGuestEmail({ booking: updatedBooking, templateKey: 'booking_confirmed_guest', branding, request: req })
          .catch(err => console.warn('Falha ao enviar email de confirmação:', err.message));
      }
    }

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
    if (deleteLockByBookingStmt) deleteLockByBookingStmt.run(id);
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

  app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (existing) {
      db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
      if (deleteLockByBookingStmt) deleteLockByBookingStmt.run(Number(req.params.id));
      logChange(req.user.id, 'booking', Number(req.params.id), 'delete', {
        checkin: existing.checkin,
        checkout: existing.checkout,
        unit_id: existing.unit_id,
        guest_name: existing.guest_name
      }, null);
    }
    res.redirect('/admin/bookings');
  });
}

module.exports = { registerBookings };
