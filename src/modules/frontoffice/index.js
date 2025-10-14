module.exports = function registerFrontoffice(app, context) {
  const {
    db,
    html,
    layout,
    esc,
    crypto,
    dayjs,
    eur,
    getSession,
    buildUserContext,
    resolveBrandingForRequest,
    parsePropertyId,
    formatMonthYear,
    rememberActiveBrandingProperty,
    userCan,
    selectPropertyById,
    unitAvailable,
    rateQuote,
    csrfProtection,
    parseFeaturesStored,
    featureChipsHtml,
    dateRangeNights,
    requireLogin,
    requirePermission,
    logActivity,
    logChange,
    overlaps,
    ExcelJS,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    bookingEmailer
  } = context;

  function inlineScript(source) {
    return source.replace(/<\/(script)/gi, '<\\/$1');
  }

  function sanitizeBookingSubmission(payload, { requireAgency }) {
    const errors = [];

    const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const guestName = normalizeWhitespace(payload.guest_name);
    if (guestName.length < 2 || guestName.length > 120) {
      errors.push('Nome do hóspede deve ter entre 2 e 120 caracteres.');
    }

    const guestNationality = normalizeWhitespace(payload.guest_nationality);
    if (!guestNationality) {
      errors.push('Nacionalidade é obrigatória.');
    } else if (guestNationality.length > 80) {
      errors.push('Nacionalidade deve ter no máximo 80 caracteres.');
    }

    const rawEmail = String(payload.guest_email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail) || rawEmail.length > 160) {
      errors.push('Email do hóspede inválido.');
    }

    const rawPhone = String(payload.guest_phone || '').trim();
    const phoneNormalized = rawPhone.replace(/[^0-9+]/g, '');
    const numericDigits = phoneNormalized.replace(/\D/g, '');
    if (numericDigits.length < 6 || phoneNormalized.length > 32) {
      errors.push('Telefone do hóspede inválido.');
    }

    const checkin = String(payload.checkin || '').trim();
    const checkout = String(payload.checkout || '').trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(checkin) || !dayjs(checkin).isValid()) {
      errors.push('Data de check-in inválida.');
    }
    if (!datePattern.test(checkout) || !dayjs(checkout).isValid()) {
      errors.push('Data de check-out inválida.');
    } else if (!dayjs(checkout).isAfter(dayjs(checkin))) {
      errors.push('Check-out deve ser posterior ao check-in.');
    }

    const adults = Math.max(1, Math.min(12, Number.parseInt(payload.adults, 10) || 1));
    const children = Math.max(0, Math.min(12, Number.parseInt(payload.children, 10) || 0));

    const agencyRaw = normalizeWhitespace(payload.agency).toUpperCase();
    let agency = agencyRaw || null;
    if (requireAgency && !agency) {
      errors.push('Agência é obrigatória para reservas internas.');
    }
    if (agency && agency.length > 60) {
      agency = agency.slice(0, 60);
    }

    return {
      errors,
      data: {
        guest_name: guestName,
        guest_email: rawEmail,
        guest_nationality: guestNationality,
        guest_phone: phoneNormalized,
        checkin,
        checkout,
        adults,
        children,
        agency,
      },
    };
  }

  // ===================== Front Office =====================
  function renderSearchPage(req, res) {
    const sess = getSession(req.cookies.adm, req);
    const viewer = sess ? buildUserContext(sess) : undefined;
    const user = viewer;

    const rawQuery = req.query || {};
    const rawCheckin = typeof rawQuery.checkin === 'string' ? rawQuery.checkin.trim() : '';
    const rawCheckout = typeof rawQuery.checkout === 'string' ? rawQuery.checkout.trim() : '';
    const checkinValid = rawCheckin && dayjs(rawCheckin, 'YYYY-MM-DD', true).isValid();
    const checkoutValid = rawCheckout && dayjs(rawCheckout, 'YYYY-MM-DD', true).isValid();
    const searchActive = checkinValid && checkoutValid && dayjs(rawCheckout).isAfter(dayjs(rawCheckin));

    const adultsRaw = rawQuery.adults;
    const childrenRaw = rawQuery.children;
    const adults = Math.max(1, Number.parseInt(adultsRaw, 10) || 1);
    const children = Math.max(0, Number.parseInt(childrenRaw, 10) || 0);
    const totalGuests = adults + children;
    const guestFilterExplicit = Object.prototype.hasOwnProperty.call(rawQuery, 'adults') || Object.prototype.hasOwnProperty.call(rawQuery, 'children');
    const guestFilterActive = searchActive || guestFilterExplicit;

    const queryPropertyValue = rawQuery ? (rawQuery.propertyId ?? rawQuery.property_id ?? rawQuery.property ?? null) : null;
    const propertyId = parsePropertyId(queryPropertyValue);
    const propertyRow = propertyId ? selectPropertyById.get(propertyId) : null;

    const theme = resolveBrandingForRequest(req, { propertyId, propertyName: propertyRow ? propertyRow.name : null });
    if (propertyId) {
      rememberActiveBrandingProperty(res, propertyId);
    }

    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const hasPropertiesConfigured = properties.length > 0;

    let propertyNotFound = false;
    let propertyList = properties;
    if (propertyId) {
      propertyList = properties.filter(p => p.id === propertyId);
      if (propertyList.length === 0) {
        propertyNotFound = true;
      }
    }

    const propertyGroups = propertyList.map(p => ({
      id: p.id,
      name: p.name,
      safeName: esc(p.name),
      totalUnits: 0,
      units: [],
      availableUnits: 0
    }));
    const propertyGroupMap = new Map(propertyGroups.map(group => [group.id, group]));

    const units = propertyGroups.length
      ? db.prepare(
          `SELECT u.*, p.name AS property_name
             FROM units u
             JOIN properties p ON p.id = u.property_id
            WHERE (? IS NULL OR u.property_id = ?)
            ORDER BY p.name, u.name`
        ).all(propertyId || null, propertyId || null)
      : [];

    const primaryImageStmt = db.prepare(
      'SELECT file, alt FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 1'
    );

    units.forEach(u => {
      const group = propertyGroupMap.get(u.property_id);
      if (!group) return;
      group.totalUnits += 1;

      const meetsCapacity = !guestFilterActive || u.capacity >= totalGuests;
      const rawImage = primaryImageStmt.get(u.id);
      const image = rawImage
        ? {
            url: `/uploads/units/${u.id}/${rawImage.file}`,
            safeAlt: esc(rawImage.alt || `${u.property_name} - ${u.name}`)
          }
        : null;
      const features = parseFeaturesStored(u.features);

      if (searchActive) {
        if (!meetsCapacity) return;
        if (!unitAvailable(u.id, rawCheckin, rawCheckout)) return;
        const quote = rateQuote(u.id, rawCheckin, rawCheckout, u.base_price_cents);
        if (quote.nights < quote.minStayReq) return;
        group.units.push({
          id: u.id,
          name: u.name,
          safeName: esc(u.name),
          capacity: u.capacity,
          basePriceCents: u.base_price_cents,
          quote,
          image,
          features
        });
        group.availableUnits += 1;
      } else {
        group.units.push({
          id: u.id,
          name: u.name,
          safeName: esc(u.name),
          capacity: u.capacity,
          basePriceCents: u.base_price_cents,
          image,
          features
        });
      }
    });

    propertyGroups.forEach(group => {
      if (!searchActive) {
        group.availableUnits = group.units.length;
      }
      if (searchActive) {
        group.units.sort((a, b) => {
          if (!a.quote || !b.quote) return a.safeName.localeCompare(b.safeName);
          return a.quote.total_cents - b.quote.total_cents || a.safeName.localeCompare(b.safeName);
        });
      } else {
        group.units.sort((a, b) => a.safeName.localeCompare(b.safeName));
      }
    });

    const totalProperties = propertyGroups.length;
    const totalVisibleUnits = propertyGroups.reduce((sum, group) => sum + group.units.length, 0);
    const totalUnits = propertyGroups.reduce((sum, group) => sum + group.totalUnits, 0);

    const dateSummary = searchActive ? `${dayjs(rawCheckin).format('DD/MM/YYYY')} - ${dayjs(rawCheckout).format('DD/MM/YYYY')}` : '';
    const guestsSummary = `${adults} adulto${adults === 1 ? '' : 's'}${children ? ` · ${children} criança${children === 1 ? '' : 's'}` : ''}`;
    const propertySummary = propertyRow ? propertyRow.name : propertyId ? 'Propriedade desconhecida' : 'Todas as propriedades';

    const searchStyles = html`
      <style>
        .search-layout {
          display: grid;
          gap: 1.5rem;
        }
        @media (min-width: 1024px) {
          .search-layout {
            grid-template-columns: 320px 1fr;
            align-items: flex-start;
          }
        }
        .search-panel__form {
          display: grid;
          gap: 1rem;
        }
        .search-panel__actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .search-panel .inline-feedback {
          margin-top: 0.5rem;
        }
        .search-results {
          display: grid;
          gap: 1.5rem;
        }
        .search-banner {
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 0.9rem;
          padding: 1.15rem 1.35rem;
          background: #f8fafc;
          display: grid;
          gap: 0.75rem;
        }
        .search-banner__header {
          display: grid;
          gap: 0.35rem;
        }
        .search-banner__title {
          font-size: 1rem;
          font-weight: 600;
          color: #0f172a;
        }
        .search-banner__subtitle {
          font-size: 0.875rem;
          color: #475569;
        }
        .search-banner__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .search-banner__chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          background: #ffffff;
          border: 1px solid rgba(148, 163, 184, 0.45);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #1e293b;
        }
        .search-banner__chip i {
          width: 0.95rem;
          height: 0.95rem;
        }
        @media (max-width: 1024px) {
          .search-banner {
            padding: 1rem 1.1rem;
          }
          .search-banner__chips {
            justify-content: flex-start;
            gap: 0.4rem;
          }
          .search-panel__actions {
            justify-content: stretch;
          }
          .search-panel__actions .btn,
          .search-panel__actions .btn-light {
            flex: 1 1 160px;
            justify-content: center;
          }
        }
        @media (max-width: 900px) {
          .search-property__header {
            gap: 0.75rem;
          }
          .search-property__badge {
            width: 100%;
            justify-content: center;
          }
        }
        .search-guidance {
          margin: 0;
          padding-left: 1.25rem;
          display: grid;
          gap: 0.35rem;
          color: #475569;
        }
        .search-property-card {
          display: grid;
          gap: 1.25rem;
        }
        .search-property__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .search-property__summary {
          color: #475569;
          font-size: 0.875rem;
        }
        .search-property__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: #ecfdf5;
          color: #047857;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .search-units {
          display: grid;
          gap: 1rem;
        }
        @media (min-width: 768px) {
          .search-units {
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          }
        }
        .search-unit {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 0.9rem;
          padding: 1rem;
          background: #ffffff;
        }
        .search-unit__image {
          border-radius: 0.75rem;
          overflow: hidden;
          height: 180px;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #475569;
          font-size: 0.875rem;
        }
        .search-unit__image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .search-unit__header {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          align-items: baseline;
        }
        .search-unit__property {
          color: #475569;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .search-unit__name {
          font-size: 1rem;
          font-weight: 600;
          color: #0f172a;
        }
        .search-unit__capacity {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e293b;
          background: #e2e8f0;
          border-radius: 999px;
          padding: 0.25rem 0.75rem;
        }
        .search-unit__features {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .search-unit__feature {
          background: rgba(16, 185, 129, 0.15);
          color: #047857;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          font-size: 0.75rem;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-weight: 500;
        }
        .search-unit__feature-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .search-unit__price {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .search-unit__price-label {
          font-size: 0.75rem;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
        }
        .search-unit__price-value {
          font-size: 1.5rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .search-unit__price-note {
          font-size: 0.75rem;
          color: #475569;
        }
        .search-unit__cta {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .search-unit__cta-hint {
          font-size: 0.75rem;
          color: #475569;
        }
        .search-property__empty {
          padding: 1rem;
          border-radius: 0.75rem;
          background: #f8fafc;
          color: #475569;
          border: 1px dashed rgba(148, 163, 184, 0.5);
        }
      </style>
    `;

    const summaryBanner = searchActive
      ? html`
          <section class="search-banner">
            <div class="search-banner__header">
              <h2 class="search-banner__title">Filtros aplicados</h2>
              <p class="search-banner__subtitle">Mostramos apenas as unidades disponíveis para estes critérios.</p>
            </div>
            <div class="search-banner__chips">
              <span class="search-banner__chip"><i data-lucide="calendar"></i>${esc(dateSummary)}</span>
              <span class="search-banner__chip"><i data-lucide="users"></i>${esc(guestsSummary)}</span>
              <span class="search-banner__chip"><i data-lucide="map-pin"></i>${esc(propertySummary)}</span>
            </div>
          </section>
        `
      : html`
          <section class="search-banner">
            <div class="search-banner__header">
              <h2 class="search-banner__title">Prepare a pesquisa de reservas</h2>
              <p class="search-banner__subtitle">Selecione datas para ver apenas as unidades disponíveis por propriedade.</p>
            </div>
            <ul class="search-guidance">
              <li>Escolha check-in e check-out válidos para ativar o cálculo automático do valor total.</li>
              <li>Ajuste o número de hóspedes para garantir que a capacidade das unidades é respeitada.</li>
              <li>Use o filtro de propriedade para focar apenas numa localização específica.</li>
            </ul>
          </section>
        `;

    const propertyCards = propertyGroups.length
      ? propertyGroups
          .map(group => {
            const summaryLabel = searchActive
              ? `${group.availableUnits} unidade${group.availableUnits === 1 ? '' : 's'} disponível${group.availableUnits === 1 ? '' : 's'} · ${group.totalUnits} no total`
              : `${group.totalUnits} unidade${group.totalUnits === 1 ? '' : 's'} registada${group.totalUnits === 1 ? '' : 's'}`;
            const unitsHtml = group.units.length
              ? html`
                  <div class="search-units">
                    ${group.units
                      .map(unit => {
                        const featuresHtml = featureChipsHtml(unit.features, {
                          className: 'search-unit__features',
                          badgeClass: 'search-unit__feature',
                          iconWrapClass: 'search-unit__feature-icon'
                        });
                        const imageHtml = unit.image
                          ? html`<div class="search-unit__image"><img src="${esc(unit.image.url)}" alt="${unit.image.safeAlt}" loading="lazy"/></div>`
                          : '<div class="search-unit__image">Sem fotografia disponível</div>';
                        const priceLabel = searchActive
                          ? `${unit.quote.nights} noite${unit.quote.nights === 1 ? '' : 's'}`
                          : 'Tarifa base';
                        const priceNote = searchActive
                          ? `Estadia mínima: ${unit.quote.minStayReq} noite${unit.quote.minStayReq === 1 ? '' : 's'}`
                          : 'Indique datas para ver o total da estadia.';
                        const priceValue = searchActive ? eur(unit.quote.total_cents) : eur(unit.basePriceCents);
                        let actionHtml;
                        if (searchActive) {
                          const bookingLink = `/book/${unit.id}?checkin=${encodeURIComponent(rawCheckin)}&checkout=${encodeURIComponent(rawCheckout)}&adults=${encodeURIComponent(adults)}&children=${encodeURIComponent(children)}`;
                          actionHtml = html`<a class="btn btn-primary" href="${esc(bookingLink)}">Reservar</a>`;
                        } else {
                          actionHtml = '<span class="search-unit__cta-hint">Escolha datas para verificar disponibilidade.</span>';
                        }
                        return html`
                          <article class="search-unit">
                            ${imageHtml}
                            <div class="search-unit__header">
                              <div>
                                <div class="search-unit__property">${group.safeName}</div>
                                <div class="search-unit__name">${unit.safeName}</div>
                              </div>
                              <span class="search-unit__capacity">${unit.capacity} hóspede${unit.capacity === 1 ? '' : 's'}</span>
                            </div>
                            ${featuresHtml}
                            <div class="search-unit__price">
                              <span class="search-unit__price-label">${esc(priceLabel)}</span>
                              <span class="search-unit__price-value"><i data-lucide="euro" class="w-4 h-4"></i>${priceValue}</span>
                              <span class="search-unit__price-note">${esc(priceNote)}</span>
                            </div>
                            <div class="search-unit__cta">
                              ${actionHtml}
                            </div>
                          </article>
                        `;
                      })
                      .join('')}
                  </div>
                `
              : `<div class="search-property__empty">${searchActive ? 'Sem unidades disponíveis para os critérios selecionados.' : 'Sem unidades registadas nesta propriedade.'}</div>`;
            const badge = searchActive
              ? `<span class="search-property__badge">${group.availableUnits ? 'Disponível' : 'Sem disponibilidade'}</span>`
              : '';
            return html`
              <section class="bo-card search-property-card">
                <header class="search-property__header">
                  <div>
                    <h2>${group.safeName}</h2>
                    <p class="search-property__summary">${esc(summaryLabel)}</p>
                  </div>
                  ${badge}
                </header>
                ${unitsHtml}
              </section>
            `;
          })
          .join('')
      : '';

    const emptyState = searchActive && totalVisibleUnits === 0 && !propertyNotFound
      ? '<div class="bo-card"><p class="bo-empty">Não encontrámos unidades disponíveis para os critérios selecionados.</p></div>'
      : '';

    const propertyNotFoundCard = propertyNotFound
      ? '<div class="bo-card"><p class="bo-empty">Propriedade não encontrada. Ajuste o filtro e tente novamente.</p></div>'
      : '';

    const noPropertiesCard = !hasPropertiesConfigured
      ? '<div class="bo-card"><p class="bo-empty">Ainda não existem propriedades configuradas.</p></div>'
      : '';

    const formAction = req.path === '/search' ? '/search' : '/';
    const resetLink = formAction;
    res.send(layout({
      title: 'Pesquisar disponibilidade',
      user,
      activeNav: 'search',
      branding: theme,
      pageClass: 'page-backoffice page-search',
      body: html`
        <div class="bo-main search-main">
          <header class="bo-header">
            <h1>Pesquisar disponibilidade</h1>
          </header>
          ${searchStyles}
          <div class="search-layout">
            <section class="bo-card search-panel">
              <h2>Filtros de reserva</h2>
              <p class="bo-subtitle">Escolha datas, hóspedes e propriedade para consultar as unidades disponíveis.</p>
              <form action="${esc(formAction)}" method="get" class="search-panel__form" data-search-form>
                <div class="bo-field">
                  <label for="checkin">Check-in</label>
                  <input
                    type="date"
                    id="checkin"
                    name="checkin"
                    class="input"
                    value="${esc(rawCheckin)}"
                    onchange="syncCheckout(event)"
                    required
                  />
                </div>
                <div class="bo-field">
                  <label for="checkout">Check-out</label>
                  <input
                    type="date"
                    id="checkout"
                    name="checkout"
                    class="input"
                    value="${esc(rawCheckout)}"
                    ${checkinValid ? `min="${esc(rawCheckin)}"` : ''}
                    required
                  />
                </div>
                <div class="bo-field">
                  <label for="adults">Adultos</label>
                  <input type="number" min="1" id="adults" name="adults" value="${esc(String(adults))}" class="input" />
                </div>
                <div class="bo-field">
                  <label for="children">Crianças</label>
                  <input type="number" min="0" id="children" name="children" value="${esc(String(children))}" class="input" />
                </div>
                <div class="bo-field">
                  <label for="property_id">Propriedade</label>
                  <select id="property_id" name="property_id" class="input">
                    <option value="">Todas as propriedades</option>
                    ${properties
                      .map(p => `<option value="${p.id}" ${propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
                      .join('')}
                  </select>
                </div>
                <div class="search-panel__actions">
                  <button class="btn btn-primary" type="submit" data-submit>Pesquisar disponibilidade</button>
                  ${(searchActive || propertyId || guestFilterExplicit)
                    ? `<a class="btn btn-light" href="${esc(resetLink)}">Limpar filtros</a>`
                    : ''}
                </div>
                <div class="inline-feedback" data-feedback data-variant="info" aria-live="polite" role="status">
                  <span class="inline-feedback-icon">ℹ</span>
                  <div><strong>Indique as datas desejadas.</strong><br/>Apenas as unidades disponíveis serão listadas após a pesquisa.</div>
                </div>
              </form>
            </section>
            <div class="search-results">
              ${summaryBanner}
              ${propertyNotFoundCard}
              ${!propertyNotFound ? propertyCards : ''}
              ${!propertyNotFound ? noPropertiesCard : ''}
              ${emptyState}
            </div>
          </div>
        </div>
      `
    }));
  }

  app.get('/', (req, res) => {
    renderSearchPage(req, res);
  });

  app.get('/search', (req, res) => {
    renderSearchPage(req, res);
  });
app.get('/book/:unitId', (req, res) => {
  const sess = getSession(req.cookies.adm, req);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { unitId } = req.params;
  const { checkin, checkout } = req.query;
  const adults = Math.max(1, Number(req.query.adults ?? 2));
  const children = Math.max(0, Number(req.query.children ?? 0));
  const totalGuests = adults + children;

  const u = db
    .prepare('SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?')
    .get(unitId);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (!checkin || !checkout) return res.redirect('/');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);
  if (!unitAvailable(u.id, checkin, checkout)) return res.status(409).send('Este alojamento já não tem disponibilidade.');

  const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
  if (quote.nights < quote.minStayReq) return res.status(400).send('Estadia mínima: ' + quote.minStayReq + ' noites');
  const total = quote.total_cents;
  const unitFeaturesBooking = featureChipsHtml(parseFeaturesStored(u.features), { className: 'flex flex-wrap gap-2 text-xs text-slate-600 mt-3', badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full', iconWrapClass: 'inline-flex items-center justify-center text-emerald-700' });
  const theme = resolveBrandingForRequest(req, { propertyId: u.property_id, propertyName: u.property_name });
  rememberActiveBrandingProperty(res, u.property_id);

  const csrfToken = csrfProtection.ensureToken(req, res);

  res.send(layout({
    title: 'Confirmar Reserva',
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Passo 3 de 3</span>
        <h1 class="text-2xl font-semibold">${u.property_name} – ${u.name}</h1>
        <p class="text-slate-600">Último passo antes de garantir a estadia.</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">3. Confirme e relaxe</li>
        </ul>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="card p-4">
          <h2 class="font-semibold mb-3">Detalhes da reserva</h2>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Check-in: <strong>${dayjs(checkin).format('DD/MM/YYYY')}</strong></li>
            <li>Check-out: <strong>${dayjs(checkout).format('DD/MM/YYYY')}</strong></li>
            <li>Noites: <strong>${quote.nights}</strong></li>
            <li>Hóspedes: <strong data-occupancy-summary>${adults} adulto(s)${children?` + ${children} criança(s)`:''}</strong></li>
            <li>Estadia mínima aplicada: <strong>${quote.minStayReq} noites</strong></li>
            <li>Total: <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(total)}</strong></li>
          </ul>
          ${unitFeaturesBooking}
        </div>
        <form class="card p-4" method="post" action="/book" data-booking-form>
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <h2 class="font-semibold mb-3">Dados do hóspede</h2>
          <p class="text-sm text-slate-500 mb-3">Confirmamos a reserva assim que estes dados forem submetidos. Usamos esta informação apenas para contacto com o hóspede.</p>
          <input type="hidden" name="unit_id" value="${u.id}" />
          <input type="hidden" name="checkin" value="${checkin}" />
          <input type="hidden" name="checkout" value="${checkout}" />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="text-sm">Adultos</label>
              <input required type="number" min="1" name="adults" value="${adults}" class="input"/>
            </div>
            <div>
              <label class="text-sm">Crianças</label>
              <input required type="number" min="0" name="children" value="${children}" class="input"/>
            </div>
          </div>
          <div class="inline-feedback mt-4" data-booking-feedback data-variant="info" aria-live="polite" role="status">
            <span class="inline-feedback-icon">ℹ</span>
            <div><strong>Preencha os dados do hóspede.</strong><br/>Os campos abaixo permitem-nos enviar a confirmação personalizada.</div>
          </div>
          <div class="grid gap-3 mt-2">
            <input required name="guest_name" class="input" placeholder="Nome completo" data-required />
            <input required name="guest_nationality" class="input" placeholder="Nacionalidade" data-required />
            <input required name="guest_phone" class="input" placeholder="Telefone/Telemóvel" data-required />
            <input required type="email" name="guest_email" class="input" placeholder="Email" data-required />
            ${user ? `
              <div>
                <label class="text-sm">Agencia</label>
                <input name="agency" class="input" placeholder="Ex: BOOKING" list="agency-options" required data-required />
              </div>
            ` : ''}
            <button class="btn btn-primary">Confirmar Reserva</button>
          </div>
          ${user ? `
            <datalist id="agency-options">
              <option value="BOOKING"></option>
              <option value="EXPEDIA"></option>
              <option value="AIRBNB"></option>
              <option value="DIRECT"></option>
            </datalist>
          ` : ''}
        </form>
      </div>
    `
  }));
});

app.post('/book', (req, res) => {
  if (!csrfProtection.validateRequest(req)) {
    csrfProtection.rotateToken(req, res);
    return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
  }
  const sess = getSession(req.cookies.adm, req);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { errors, data } = sanitizeBookingSubmission(req.body, { requireAgency: !!user });
  if (errors.length > 0) {
    return res.status(422).send(errors.join(' '));
  }

  const unitId = Number.parseInt(req.body.unit_id, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return res.status(400).send('Unidade inválida.');
  }

  const { guest_name, guest_email, guest_nationality, guest_phone, checkin, checkout, adults, children, agency } = data;
  const totalGuests = adults + children;
  const agencyValue = agency || 'DIRECT';

  const u = db
    .prepare(
      `SELECT u.*, p.name AS property_name, p.id AS property_id
         FROM units u
         JOIN properties p ON p.id = u.property_id
        WHERE u.id = ?`
    )
    .get(unitId);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);

  const trx = db.transaction(() => {
    const confirmationToken = crypto.randomBytes(16).toString('hex');
    const conflicts = db.prepare(
      `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING') AND NOT (checkout <= ? OR checkin >= ?)
       UNION ALL
       SELECT 1 FROM blocks WHERE unit_id = ? AND NOT (end_date <= ? OR start_date >= ?)`
    ).all(unitId, checkin, checkout, unitId, checkin, checkout);
    if (conflicts.length > 0) throw new Error('conflict');

    const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
    if (quote.nights < quote.minStayReq) throw new Error('minstay:'+quote.minStayReq);
    const total = quote.total_cents;
    const canAutoConfirm = user && userCan(user, 'bookings.edit');
    const bookingStatus = canAutoConfirm ? 'CONFIRMED' : 'PENDING';

    const stmt = db.prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_nationality, guest_phone, agency, adults, children, checkin, checkout, total_cents, status, external_ref, confirmation_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const r = stmt.run(
      unitId,
      guest_name,
      guest_email,
      guest_nationality || null,
      guest_phone || null,
      agencyValue,
      adults,
      children,
      checkin,
      checkout,
      total,
      bookingStatus,
      null,
      confirmationToken
    );
    return { id: r.lastInsertRowid, confirmationToken, status: bookingStatus };
  });

  try {
    const { id, confirmationToken } = trx();

    const bookingRow = db
      .prepare(
        `SELECT b.*, u.name AS unit_name, u.property_id, p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.id = ?`
      )
      .get(id);
    if (bookingRow) {
      const branding = resolveBrandingForRequest(req, {
        propertyId: bookingRow.property_id,
        propertyName: bookingRow.property_name
      });
      const templateKey = bookingRow.status === 'CONFIRMED' ? 'booking_confirmed_guest' : 'booking_pending_guest';
      bookingEmailer
        .sendGuestEmail({ booking: bookingRow, templateKey, branding, request: req })
        .catch(err => console.warn('Falha ao enviar email de reserva:', err.message));
    }

    csrfProtection.rotateToken(req, res);
    res.redirect(`/booking/${id}?token=${confirmationToken}`);
  } catch (e) {
    csrfProtection.rotateToken(req, res);
    if (e.message === 'conflict') return res.status(409).send('Datas indisponíveis. Tente novamente.');
    if (e.message && e.message.startsWith('minstay:')) return res.status(400).send('Estadia mínima: ' + e.message.split(':')[1] + ' noites');
    console.error(e);
    res.status(500).send('Erro ao criar reserva');
  }
});

app.get('/booking/:id', (req, res) => {
  const sess = getSession(req.cookies.adm, req);
  const viewer = sess ? buildUserContext(sess) : undefined;
  const user = viewer;
  const requestedToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';

  const b = db.prepare(
    `SELECT b.*, u.name as unit_name, u.property_id, p.name as property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?`
  ).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const viewerCanSeeBooking = viewer && userCan(viewer, 'bookings.view');
  if (requestedToken) {
    if (requestedToken !== b.confirmation_token) {
      return res.status(403).send('Pedido não autorizado');
    }
  } else if (!viewerCanSeeBooking) {
    return res.status(403).send('Pedido não autorizado');
  }

  const theme = resolveBrandingForRequest(req, { propertyId: b.property_id, propertyName: b.property_name });
  rememberActiveBrandingProperty(res, b.property_id);

  const safeGuestName = esc(b.guest_name || '');
  const safeGuestEmail = esc(b.guest_email || '');
  const safeGuestPhone = b.guest_phone ? esc(b.guest_phone) : '-';
  const guestNationalityHtml = b.guest_nationality
    ? `<span class="text-slate-500">(${esc(b.guest_nationality)})</span>`
    : '';
  const agencyHtml = b.agency ? `<div>Agencia: <strong>${esc(b.agency)}</strong></div>` : '';
  const safePropertyName = esc(b.property_name || '');
  const safeUnitName = esc(b.unit_name || '');
  const isPending = b.status === 'PENDING';
  const statusLabel = isPending ? 'Pendente' : 'Confirmada';
  const headerPill = isPending ? 'Pedido enviado' : 'Reserva finalizada';
  const headerTitle = isPending ? 'Reserva pendente' : 'Reserva confirmada';
  const headerDescriptionHtml = isPending
    ? `Vamos rever a sua reserva e enviar a confirmação para <strong>${safeGuestEmail}</strong> em breve.`
    : `Enviámos a confirmação para ${safeGuestEmail}. Obrigado por reservar connosco!`;
  const bookingStepLabel = isPending ? '3. Aguarde confirmação' : '3. Confirme e relaxe';
  const inlineFeedbackHtml = isPending
    ? `<div class="inline-feedback" data-variant="warning" aria-live="polite" role="status">
          <span class="inline-feedback-icon">⏳</span>
          <div><strong>Reserva pendente</strong><br/>A equipa foi notificada e irá validar o pedido antes de confirmar.</div>
        </div>`
    : `<div class="inline-feedback" data-variant="success" aria-live="polite" role="status">
          <span class="inline-feedback-icon">✓</span>
          <div><strong>Reserva garantida!</strong><br/>A unidade ficou bloqueada para si e pode preparar a chegada com tranquilidade.</div>
        </div>`;

  res.send(layout({
    title: headerTitle,
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">${headerPill}</span>
        <h1 class="text-2xl font-semibold">${headerTitle}</h1>
        <p class="text-slate-600">${headerDescriptionHtml}</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">${bookingStepLabel}</li>
        </ul>
      </div>
      <div class="card p-6 space-y-6">
        ${inlineFeedbackHtml}
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <div class="font-semibold">${safePropertyName} – ${safeUnitName}</div>
            <div>Hóspede: <strong>${safeGuestName}</strong> ${guestNationalityHtml}</div>
            <div>Contacto: <strong>${safeGuestPhone}</strong> &middot; <strong>${safeGuestEmail}</strong></div>
            <div>Ocupação: <strong>${b.adults} adulto(s)${b.children?` + ${b.children} criança(s)`:''}</strong></div>
            ${agencyHtml}
            <div>Check-in: <strong>${dayjs(b.checkin).format('DD/MM/YYYY')}</strong></div>
            <div>Check-out: <strong>${dayjs(b.checkout).format('DD/MM/YYYY')}</strong></div>
            <div>Noites: ${dateRangeNights(b.checkin, b.checkout).length}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Total</div>
            <div class="text-3xl font-semibold">€ ${eur(b.total_cents)}</div>
            <div class="text-xs text-slate-500">Status: ${statusLabel}</div>
          </div>
        </div>
        <div class="mt-2"><a class="btn btn-primary" href="/">Nova pesquisa</a></div>
      </div>
    `
  }));
});

// ===================== Calendário (privado) =====================
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
  const canExportCalendar = userCan(req.user, 'bookings.export');
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
          ${canExportCalendar ? '<a class="btn btn-primary" href="/admin/export">Exportar Excel</a>' : ''}
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

  rescheduleBookingUpdateStmt.run(checkin, checkout, quote.total_cents, booking.id);

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

// ===================== Export Excel (privado) =====================
app.get('/admin/export', requireLogin, requirePermission('bookings.export'), (req,res)=>{
  const ymDefault = dayjs().format('YYYY-MM');
  res.send(layout({
    title: 'Exportar Mapa (Excel)',
    user: req.user,
    activeNav: 'export',
    branding: resolveBrandingForRequest(req),
    body: html`
      <a class="text-slate-600" href="/calendar">&larr; Voltar ao Mapa</a>
      <h1 class="text-2xl font-semibold mb-4">Exportar Mapa de Reservas (Excel)</h1>
      <form method="get" action="/admin/export/download" class="card p-4 grid gap-3 max-w-md">
        <div>
          <label class="text-sm">Mês inicial</label>
          <input type="month" name="ym" value="${ymDefault}" class="input" required />
        </div>
        <div>
          <label class="text-sm">Quantos meses (1–12)</label>
          <input type="number" min="1" max="12" name="months" value="1" class="input" required />
        </div>
        <button class="btn btn-primary">Descarregar Excel</button>
      </form>
      <p class="text-sm text-slate-500 mt-3">Uma folha por mês. Cada linha = unidade; colunas = dias. Reservas em blocos unidos.</p>
    `
  }));
});

// Excel estilo Gantt + tabela de detalhes
app.get('/admin/export/download', requireLogin, requirePermission('bookings.export'), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  const months = Math.min(12, Math.max(1, Number(req.query.months || 1)));
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).send('Parâmetro ym inválido (YYYY-MM)');
  const start = dayjs(ym + '-01');
  if (!start.isValid()) return res.status(400).send('Data inválida.');

  const wb = new ExcelJS.Workbook();

  const units = db.prepare(`
    SELECT u.id, u.name as unit_name, p.name as property_name
      FROM units u
      JOIN properties p ON p.id = u.property_id
     ORDER BY p.name, u.name
  `).all();

  const entriesStmt = db.prepare(`
    SELECT * FROM (
      SELECT 'BOOKING' AS kind, b.id, b.checkin, b.checkout, b.guest_name, b.adults, b.children, b.status
        FROM bookings b
       WHERE b.unit_id = ? AND NOT (b.checkout <= ? OR b.checkin >= ?)
      UNION ALL
      SELECT 'BLOCK' AS kind, bl.id, bl.start_date AS checkin, bl.end_date AS checkout,
             'BLOQUEADO' AS guest_name, NULL AS adults, NULL AS children, 'BLOCK' AS status
        FROM blocks bl
       WHERE bl.unit_id = ? AND NOT (bl.end_date <= ? OR bl.start_date >= ?)
    )
    ORDER BY checkin
  `);

  const bookingsMonthStmt = db.prepare(`
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE NOT (b.checkout <= ? OR b.checkin >= ?)
     ORDER BY b.checkin, b.guest_name
  `);

  const numberToLetters = idx => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let n = idx;
    let label = '';
    do {
      label = alphabet[n % 26] + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  };

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF93C47D' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
  const weekendFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const bookingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6AA84F' } };
  const pendingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  const blockFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };

  const formatGuestCount = (adults, children) => {
    const parts = [];
    if (typeof adults === 'number') parts.push(`${adults}A`);
    if (typeof children === 'number' && children > 0) parts.push(`${children}C`);
    return parts.join('+');
  };

  const allCaps = str => {
    if (!str) return '';
    return str
      .split(' ')
      .map(word => (word ? word[0].toUpperCase() + word.slice(1) : ''))
      .join(' ');
  };

  for (let i = 0; i < months; i++) {
    const month = start.add(i, 'month');
    const sheetName = month.format('YYYY_MM');
    const ws = wb.addWorksheet(sheetName);
    ws.properties.defaultRowHeight = 22;

    const daysInMonth = month.daysInMonth();
    const monthStartObj = month.startOf('month');
    const monthStart = monthStartObj.format('YYYY-MM-DD');
    const monthEndExcl = monthStartObj.endOf('month').add(1, 'day').format('YYYY-MM-DD');
    const monthLabel = month.format("MMM'YY").replace('.', '');

    const dayNames = [''];
    const dayNumbers = [''];
    const weekendColumns = new Set();
    for (let d = 0; d < daysInMonth; d++) {
      const date = monthStartObj.add(d, 'day');
      const dow = date.day();
      const weekday = date.locale('pt').format('ddd');
      const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dayNames.push(label);
      dayNumbers.push(date.format('DD'));
      if (dow === 0 || dow === 6) weekendColumns.add(d + 2);
    }

    const dayNameRow = ws.addRow(dayNames);
    const dayNumberRow = ws.addRow(dayNumbers);
    dayNameRow.height = 20;
    dayNumberRow.height = 20;

    ws.mergeCells(dayNameRow.number, 1, dayNumberRow.number, 1);
    const monthCell = ws.getCell(dayNameRow.number, 1);
    monthCell.value = monthLabel;
    monthCell.fill = headerFill;
    monthCell.font = headerFont;
    monthCell.alignment = { vertical: 'middle', horizontal: 'center' };

    [dayNameRow, dayNumberRow].forEach(r => {
      r.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (weekendColumns.has(colNumber)) cell.fill = weekendFill;
        cell.font = { bold: r === dayNameRow };
      });
    });

    const MIN_DAY_WIDTH = 6.5;
    const MAX_DAY_WIDTH = 20;
    let maxDayWidth = MIN_DAY_WIDTH;

    ws.getColumn(1).width = 28;
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = MIN_DAY_WIDTH;
    }

    const bookingsForMonth = bookingsMonthStmt.all(monthStart, monthEndExcl);
    const refByBookingId = new Map();
    bookingsForMonth.forEach((booking, idx) => {
      refByBookingId.set(booking.id, numberToLetters(idx));
    });

    for (const u of units) {
      const nameRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      const occRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      nameRow.height = 20;
      occRow.height = 24;

      ws.mergeCells(nameRow.number, 1, occRow.number, 1);
      const unitCell = ws.getCell(nameRow.number, 1);
      unitCell.value = u.property_name === u.unit_name
        ? allCaps(u.unit_name)
        : `${allCaps(u.property_name)}\n${allCaps(u.unit_name)}`;
      unitCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      unitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      unitCell.font = { bold: true, color: { argb: 'FF1F2937' } };

      const entries = entriesStmt.all(u.id, monthStart, monthEndExcl, u.id, monthStart, monthEndExcl);

      for (const entry of entries) {
        const startDate = dayjs.max(dayjs(entry.checkin), monthStartObj);
        const endDateExclusive = dayjs.min(dayjs(entry.checkout), dayjs(monthEndExcl));
        const startOffset = startDate.diff(monthStartObj, 'day');
        const endOffset = endDateExclusive.diff(monthStartObj, 'day');
        const startCol = Math.max(2, startOffset + 2);
        const endCol = Math.min(daysInMonth + 1, endOffset + 1);
        if (endCol < startCol) continue;

        ws.mergeCells(nameRow.number, startCol, nameRow.number, endCol);
        ws.mergeCells(occRow.number, startCol, occRow.number, endCol);

        const nameCell = ws.getCell(nameRow.number, startCol);
        const occCell = ws.getCell(occRow.number, startCol);

        const isBooking = entry.kind === 'BOOKING';
        const ref = isBooking ? refByBookingId.get(entry.id) : null;
        const guestCount = isBooking ? formatGuestCount(entry.adults || 0, entry.children || 0) : '';

        nameCell.value = entry.guest_name;
        nameCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        nameCell.font = { bold: true, color: { argb: 'FF111827' } };

        const occLabel = entry.status === 'BLOCK'
          ? 'BLOQUEADO'
          : `${ref ? `(${ref}) ` : ''}${guestCount}`.trim();

        if (entry.status === 'BLOCK') {
          occCell.fill = blockFill;
          occCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          const fill = entry.status === 'PENDING' ? pendingFill : bookingFill;
          const fontColor = entry.status === 'PENDING' ? 'FF1F2937' : 'FFFFFFFF';
          occCell.fill = fill;
          occCell.font = { bold: true, color: { argb: fontColor } };
        }
        occCell.value = occLabel;
        occCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const span = endCol - startCol + 1;
        const labelChars = Math.max(String(nameCell.value || '').length, occLabel.length);
        const totalTargetWidth = Math.max(10, Math.min(80, labelChars * 1.1));
        const perColumnWidth = Math.max(MIN_DAY_WIDTH, Math.min(MAX_DAY_WIDTH, totalTargetWidth / span));
        maxDayWidth = Math.max(maxDayWidth, perColumnWidth);
      }

      for (const col of weekendColumns) {
        [nameRow, occRow].forEach(row => {
          const cell = row.getCell(col);
          const empty = cell.value === undefined || cell.value === null || String(cell.value).trim() === '';
          if (empty && !cell.isMerged) {
            cell.fill = weekendFill;
          }
        });
      }
    }

    const finalDayWidth = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, maxDayWidth));
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = finalDayWidth;
    }

    ws.addRow([]);

    const detailHeaders = [
      'Ref',
      'Nome',
      'Agência',
      'País',
      'Nr Hóspedes',
      'Nr Noites',
      'Data entrada',
      'Data saída',
      'Tlm',
      'Email',
      'Nr Quartos',
      'Hora Check-in',
      'Outras Informações',
      'Valor total a pagar',
      'Pré-pagamento 30%',
      'A pagar no check-out',
      'Fatura',
      'Data Pré-Pagamento',
      'Dados pagamento',
      'Dados faturação'
    ];

    const detailMonthRow = ws.addRow([monthLabel, ...Array(detailHeaders.length - 1).fill('')]);
    ws.mergeCells(detailMonthRow.number, 1, detailMonthRow.number, detailHeaders.length);
    const detailMonthCell = ws.getCell(detailMonthRow.number, 1);
    detailMonthCell.value = monthLabel;
    detailMonthCell.fill = headerFill;
    detailMonthCell.font = headerFont;
    detailMonthCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const headerRow = ws.addRow(detailHeaders);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 24;

    const currencyColumns = new Set([14, 15, 16]);
    const defaultDetailWidths = [6, 24, 14, 8, 12, 10, 12, 12, 14, 30, 10, 12, 24, 16, 16, 16, 10, 16, 22, 22];
    defaultDetailWidths.forEach((w, idx) => {
      const colIndex = idx + 1;
      const currentWidth = ws.getColumn(colIndex).width || 10;
      ws.getColumn(colIndex).width = Math.max(currentWidth, w);
    });

    bookingsForMonth.forEach((booking, idx) => {
      const ref = refByBookingId.get(booking.id) || numberToLetters(idx);
      const totalCents = booking.total_cents;
      const prepaymentCents = Math.round(totalCents * 0.3);
      const checkoutCents = totalCents - prepaymentCents;
      const nights = dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day');
      const guestCount = (booking.adults || 0) + (booking.children || 0);

      const detailRow = ws.addRow([
        ref,
        booking.guest_name,
        booking.agency || '',
        booking.guest_nationality || '',
        guestCount,
        nights,
        dayjs(booking.checkin).format('DD/MMM'),
        dayjs(booking.checkout).format('DD/MMM'),
        booking.guest_phone || '',
        booking.guest_email || '',
        1,
        '',
        booking.status === 'PENDING' ? 'PENDENTE' : '',
        totalCents / 100,
        prepaymentCents / 100,
        checkoutCents / 100,
        '',
        '',
        '',
        ''
      ]);

      detailRow.eachCell((cell, colNumber) => {
        if (currencyColumns.has(colNumber)) {
          cell.numFmt = '#,##0.00';
          cell.font = { color: { argb: 'FF1F2937' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if ([5, 6, 11].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
      });
    });

    ws.eachRow(r => {
      r.eachCell(c => {
        c.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
      });
    });
  }

  const filename =
    months === 1
      ? `mapa_${start.format('YYYY_MM')}.xlsx`
      : `mapa_${start.format('YYYY_MM')}_+${months - 1}m.xlsx`;

  logActivity(req.user.id, 'export:calendar_excel', null, null, { ym, months });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

};
