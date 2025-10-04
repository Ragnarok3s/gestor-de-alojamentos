module.exports = function registerFrontoffice(app, context) {
  const {
    db,
    html,
    layout,
    esc,
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
    rescheduleBlockUpdateStmt
  } = context;

  // ===================== Front Office =====================
app.get('/', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const viewer = sess ? buildUserContext(sess) : undefined;
  const user = viewer;
  const theme = resolveBrandingForRequest(req);
  const queryProperty = parsePropertyId(req.query ? (req.query.propertyId ?? req.query.property_id ?? req.query.property ?? null) : null);
  if (queryProperty !== null) {
    rememberActiveBrandingProperty(res, req.brandingPropertyId);
  }
  const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
  const canManageBranding = userCan(viewer, 'users.manage');

  res.send(layout({
    title: 'Reservas',
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <section class="search-hero">
        <span class="pill-indicator">Percurso de reserva</span>
        <h1 class="search-title">${esc(theme.brandName)} coloca confiança em cada reserva</h1>
        <p class="search-intro">Combine comunicação profissional com dados operacionais em tempo real. A equipa vê sempre preços claros, disponibilidade fiável e o contexto necessário para acolher cada hóspede.</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step is-active">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step">3. Confirme a estadia</li>
        </ul>
        <form action="/search" method="get" class="search-form" data-search-form>
          <div class="search-field">
            <label for="checkin">Datas</label>
            <div class="search-dates">
              <input required type="date" id="checkin" name="checkin" class="search-input" onchange="syncCheckout(event)"/>
              <input required type="date" id="checkout" name="checkout" class="search-input"/>
            </div>
          </div>
          <div class="search-field">
            <label for="adults">Adultos</label>
            <input type="number" min="1" id="adults" name="adults" value="2" class="search-input"/>
          </div>
          <div class="search-field">
            <label for="children">Crianças</label>
            <input type="number" min="0" id="children" name="children" value="0" class="search-input"/>
          </div>
          <div class="search-field">
            <label for="property_id">Propriedade</label>
            <select id="property_id" name="property_id" class="search-input">
              <option value="">Todas</option>
              ${properties.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="search-submit">
            <button class="search-button" type="submit" data-submit>Procurar</button>
          </div>
          <div class="inline-feedback" data-feedback data-variant="info" aria-live="polite" role="status">
            <span class="inline-feedback-icon">ℹ</span>
            <div><strong>Comece por escolher as datas.</strong><br/>Escolha check-in e check-out válidos para ver disponibilidade instantânea.</div>
          </div>
        </form>
      </section>

      <section class="confidence-section">
        <h2 class="section-title">Credibilidade para quem gere alojamentos exigentes</h2>
        <p class="section-lead">Processos transparentes, linguagem coerente e dados acessíveis. Tudo pensado para equipas que querem focar-se na hospitalidade.</p>
        <div class="reassurance-grid">
          <article class="reassurance-card">
            <span class="reassurance-icon">✓</span>
            <h3 class="reassurance-title">Informação transparente</h3>
            <p class="reassurance-copy">Resumo imediato de valores, ocupação e contactos para acelerar cada decisão de reserva.</p>
          </article>
          <article class="reassurance-card">
            <span class="reassurance-icon">🛡</span>
            <h3 class="reassurance-title">Perfis com permissão certa</h3>
            <p class="reassurance-copy">Direção, gestão e operação trabalham com acessos distintos e auditáveis.</p>
          </article>
          <article class="reassurance-card">
            <span class="reassurance-icon">💬</span>
            <h3 class="reassurance-title">Comunicação consistente</h3>
            <p class="reassurance-copy">Mensagens automáticas falam sempre em “reserva” e “alojamento”, reforçando profissionalismo.</p>
          </article>
        </div>
      </section>

      <section class="branding-section">
        <div>
          <h2 class="section-title section-title--left">Tema visual ajustável à sua marca</h2>
          <p class="section-lead" style="text-align:left;">Defina cores, logotipo e mensagem de boas-vindas sem recorrer a desenvolvimento. O portal fica alinhado com a identidade do seu alojamento.</p>
        </div>
        <div class="branding-grid">
          <div class="branding-highlight">
            <h3>Escolha a paleta de cores</h3>
            <p>Personalize o degradé, botões e chamadas de atenção para refletir a experiência que quer entregar.</p>
          </div>
          <div class="branding-highlight">
            <h3>Carregue o logotipo</h3>
            <p>Envie o ficheiro com o símbolo da marca e veja-o aplicado em segundos na navegação e rodapé.</p>
          </div>
          <div class="branding-highlight">
            <h3>Mensagem de confiança</h3>
            <p>Ajuste o slogan que acompanha o logotipo e reforce a proposta de valor junto da equipa e dos hóspedes.</p>
          </div>
        </div>
        <div class="branding-actions">
          ${canManageBranding ? `<a class="btn btn-primary" href="/admin/identidade-visual">Personalizar identidade</a>` : `<a class="btn btn-light" href="/login">Entrar para personalizar</a>`}
        </div>
      </section>

      <section class="onboarding-section">
        <div class="onboarding-card">
          <h2 class="section-title section-title--left">Guia rápido de onboarding</h2>
          <p class="section-lead" style="text-align:left;">Três passos para colocar a operação em marcha e garantir reservas consistentes desde o primeiro dia.</p>
          <ol class="onboarding-steps">
            <li>
              <strong>Configure a identidade visual.</strong>
              <p>Aceda a <a href="/admin/identidade-visual">Identidade</a>, defina cores e carregue o logotipo para apresentar um portal coerente.</p>
            </li>
            <li>
              <strong>Registe propriedades e unidades.</strong>
              <p>Complete cada unidade com descrição, capacidade e tarifas para abrir disponibilidade imediata.</p>
            </li>
            <li>
              <strong>Convide a equipa.</strong>
              <p>Atribua perfis e permissões em <a href="/admin/utilizadores">Utilizadores</a>, garantindo que cada responsável trata reservas com segurança.</p>
            </li>
          </ol>
        </div>
      </section>
    `
  }));
});

app.get('/search', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { checkin, checkout, property_id } = req.query;
  const adults = Math.max(1, Number(req.query.adults ?? 1));
  const children = Math.max(0, Number(req.query.children ?? 0));
  const totalGuests = adults + children;
  if (!checkin || !checkout) return res.redirect('/');

  const propertyId = parsePropertyId(property_id);
  const propertyRow = propertyId ? selectPropertyById.get(propertyId) : null;
  const theme = resolveBrandingForRequest(req, { propertyId, propertyName: propertyRow ? propertyRow.name : null });
  if (propertyId) rememberActiveBrandingProperty(res, propertyId);

  const units = db.prepare(
    `SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id
     WHERE (? IS NULL OR u.property_id = ?)
       AND u.capacity >= ?
     ORDER BY p.name, u.name`
  ).all(propertyId || null, propertyId || null, Number(totalGuests));

  const imageStmt = db.prepare(
    'SELECT file, alt FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 4'
  );

  const available = units
    .filter(u => unitAvailable(u.id, checkin, checkout))
    .map(u => {
      const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
      const images = imageStmt.all(u.id).map(img => {
        const rawAlt = img.alt || `${u.property_name} - ${u.name}`;
        return {
          url: `/uploads/units/${u.id}/${img.file}`,
          alt: rawAlt,
          safeAlt: esc(rawAlt)
        };
      });
      const features = parseFeaturesStored(u.features);
      return { ...u, quote, images, features };
    })
    .filter(u => u.quote.nights >= u.quote.minStayReq)
    .sort((a,b)=> a.quote.total_cents - b.quote.total_cents);

  res.send(layout({
    title: 'Resultados',
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Passo 2 de 3</span>
        <h1 class="text-2xl font-semibold">Alojamentos disponíveis</h1>
        <p class="text-slate-600">
          ${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
          · ${adults} adulto(s)${children?` + ${children} criança(s)`:''}
        </p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step is-active">2. Escolha o alojamento</li>
          <li class="progress-step">3. Confirme e relaxe</li>
        </ul>
        <div class="inline-feedback" data-variant="info" aria-live="polite" role="status">
          <span class="inline-feedback-icon">💡</span>
          <div><strong>Selecione a unidade perfeita.</strong><br/>Clique em "Reservar" para confirmar em apenas mais um passo.</div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        ${available.map(u => {
          const galleryData = esc(JSON.stringify(u.images.map(img => ({ url: img.url, alt: img.alt }))));
          const thumbCount = Math.min(Math.max(u.images.length - 1, 0), 3);
          const gridClass = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][thumbCount - 1] || '';
          const thumbMarkup = thumbCount > 0
            ? `<div class="grid ${gridClass} gap-2 mb-3">
                ${u.images.slice(1, 1 + thumbCount).map((img, idx) => `
                  <button type="button" class="block overflow-hidden rounded" data-gallery-trigger data-gallery-images="${galleryData}" data-gallery-index="${idx + 1}">
                    <img src="${img.url}" alt="${img.safeAlt}" class="w-full h-20 object-cover" loading="lazy" />
                  </button>
                `).join('')}
              </div>`
            : '';
          const mainImage = u.images.length
            ? `<div class="relative mb-3">
                <button type="button" class="block w-full overflow-hidden rounded-md" data-gallery-trigger data-gallery-images="${galleryData}" data-gallery-index="0">
                  <img src="${u.images[0].url}" alt="${u.images[0].safeAlt}" class="w-full h-48 object-cover" loading="lazy" />
                </button>
                ${u.images.length > 1 ? `<div class="absolute bottom-2 right-2 bg-slate-900/75 text-white text-xs px-2 py-1 rounded">${u.images.length} foto${u.images.length > 1 ? 's' : ''}</div>` : ''}
              </div>
              ${thumbMarkup}`
            : '<div class="h-48 bg-slate-100 rounded flex items-center justify-center text-slate-400 mb-3">Sem fotos disponíveis</div>';
          const featuresHtml = featureChipsHtml(u.features, {
            className: 'flex flex-wrap gap-2 text-xs text-slate-600 mb-3',
            badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full',
            iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
          });
          return html`
            <div class="card p-4">
              ${mainImage}
              ${featuresHtml}
              <div class="flex items-center justify-between mb-2">
                <div>
                  <div class="text-sm text-slate-500">${u.property_name}</div>
                  <h3 class="text-lg font-semibold">${u.name}</h3>
                </div>
                <div class="text-right">
                  <div class="text-xs text-slate-500">desde/noite</div>
                  <div class="text-xl font-semibold flex items-center justify-end gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(u.base_price_cents)}</div>
                </div>
              </div>
              <p class="text-sm text-slate-600 mb-1">Capacidade: ${u.capacity} - Estadia min.: ${u.quote.minStayReq} noites</p>
              <p class="text-sm text-slate-700 mb-3">Total estadia: <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(u.quote.total_cents)}</strong></p>
              <a class="btn btn-primary" href="/book/${u.id}?checkin=${checkin}&checkout=${checkout}&adults=${adults}&children=${children}">Reservar</a>
            </div>
          `;
        }).join('')}
      </div>
      ${available.length === 0 ? `<div class="p-6 bg-amber-50 border border-amber-200 rounded-xl">Sem disponibilidade para os critérios selecionados.</div>`: ''}
    `
  }));
});

app.get('/book/:unitId', (req, res) => {
  const sess = getSession(req.cookies.adm);
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
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { unit_id, guest_name, guest_email, guest_nationality, guest_phone, checkin, checkout } = req.body;
  const adults = Math.max(1, Number(req.body.adults ?? 1));
  const children = Math.max(0, Number(req.body.children ?? 0));
  const totalGuests = adults + children;
  const agencyRaw = req.body.agency;
  const agency = agencyRaw ? String(agencyRaw).trim().toUpperCase() : null;
  if (user && !agency) return res.status(400).send('Agencia obrigatória para reservas internas.');
  const agencyValue = agency || 'DIRECT';

  const u = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);

  const trx = db.transaction(() => {
    const conflicts = db.prepare(
      `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING') AND NOT (checkout <= ? OR checkin >= ?)
       UNION ALL
       SELECT 1 FROM blocks WHERE unit_id = ? AND NOT (end_date <= ? OR start_date >= ?)`
    ).all(unit_id, checkin, checkout, unit_id, checkin, checkout);
    if (conflicts.length > 0) throw new Error('conflict');

    const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
    if (quote.nights < quote.minStayReq) throw new Error('minstay:'+quote.minStayReq);
    const total = quote.total_cents;

    const stmt = db.prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_nationality, guest_phone, agency, adults, children, checkin, checkout, total_cents, status, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const r = stmt.run(unit_id, guest_name, guest_email, guest_nationality || null, guest_phone || null,
                       agencyValue, adults, children, checkin, checkout, total, 'CONFIRMED', null);
    return r.lastInsertRowid;
  });

  try {
    const id = trx();
    res.redirect(`/booking/${id}`);
  } catch (e) {
    if (e.message === 'conflict') return res.status(409).send('Datas indisponíveis. Tente novamente.');
    if (e.message && e.message.startsWith('minstay:')) return res.status(400).send('Estadia mínima: ' + e.message.split(':')[1] + ' noites');
    console.error(e);
    res.status(500).send('Erro ao criar reserva');
  }
});

app.get('/booking/:id', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const b = db.prepare(
    `SELECT b.*, u.name as unit_name, u.property_id, p.name as property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?`
  ).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

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

  res.send(layout({
    title: 'Reserva Confirmada',
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Reserva finalizada</span>
        <h1 class="text-2xl font-semibold">Reserva confirmada</h1>
        <p class="text-slate-600">Enviámos a confirmação para ${safeGuestEmail}. Obrigado por reservar connosco!</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">3. Confirme e relaxe</li>
        </ul>
      </div>
      <div class="card p-6 space-y-6">
        <div class="inline-feedback" data-variant="success" aria-live="polite" role="status">
          <span class="inline-feedback-icon">✓</span>
          <div><strong>Reserva garantida!</strong><br/>A unidade ficou bloqueada para si e pode preparar a chegada com tranquilidade.</div>
        </div>
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
            <div class="text-xs text-slate-500">Status: ${b.status}</div>
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

  const units = db.prepare(
    'SELECT u.*, p.name as property_name ' +
    'FROM units u JOIN properties p ON p.id = u.property_id ' +
    'ORDER BY p.name, u.name'
  ).all();
  const canExportCalendar = userCan(req.user, 'bookings.export');

  res.send(layout({
    title: 'Mapa de Reservas',
    user: req.user,
    activeNav: 'calendar',
    branding: resolveBrandingForRequest(req),
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Mapa de Reservas</h1>
      <div class="flex items-center justify-between mb-4">
        <a class="btn btn-muted" href="/calendar?ym=${prev}">Mês anterior: ${formatMonthYear(prev + '-01')}</a>
        <div class="text-slate-600">Mês de ${formatMonthYear(month)}</div>
        <a class="btn btn-muted" href="/calendar?ym=${next}">Mês seguinte: ${formatMonthYear(next + '-01')}</a>
      </div>
      <div class="text-sm mb-3 flex gap-3 items-center">
        <span class="inline-block w-3 h-3 rounded bg-emerald-500"></span> Livre
        <span class="inline-block w-3 h-3 rounded bg-rose-500"></span> Ocupado
        <span class="inline-block w-3 h-3 rounded bg-amber-400"></span> Pendente
        <span class="inline-block w-3 h-3 rounded bg-red-600"></span> Bloqueado
        <span class="inline-block w-3 h-3 rounded bg-slate-200 ml-3"></span> Fora do mês
        ${canExportCalendar ? `<a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>` : ''}
      </div>
      <div class="space-y-6" data-calendar data-month="${month.format('YYYY-MM')}" data-calendar-fetch="/calendar/unit/:id/card">
        ${units.map(u => unitCalendarCard(u, month)).join('')}
      </div>
      <div class="calendar-action" data-calendar-action hidden></div>
      <div class="calendar-toast" data-calendar-toast hidden><span class="calendar-toast__dot"></span><span data-calendar-toast-message></span></div>
      <script>
        (function(){
          const root = document.querySelector('[data-calendar]');
          if (!root) return;
          const actionEl = document.querySelector('[data-calendar-action]');
          const toastEl = document.querySelector('[data-calendar-toast]');
          const toastMessage = toastEl ? toastEl.querySelector('[data-calendar-toast-message]') : null;
          const fetchTemplate = root.getAttribute('data-calendar-fetch');
          const month = root.getAttribute('data-month');
          let actionCtx = null;
          let dragCtx = null;
          let selectionCtx = null;
          let toastTimer = null;
          const CAN_RESCHEDULE = userCanClient('calendar.reschedule');
          const CAN_CANCEL_CALENDAR = userCanClient('calendar.cancel');
          const CAN_CREATE_BLOCK = userCanClient('calendar.block.create');
          const CAN_DELETE_BLOCK = userCanClient('calendar.block.delete');
          const CAN_MANAGE_BLOCK = userCanClient('calendar.block.manage');
          const CAN_VIEW_BOOKING = userCanClient('bookings.view');

          function isPrimaryPointer(e) {
            if (e.pointerType === 'mouse') {
              return typeof e.button === 'number' ? e.button === 0 : e.isPrimary !== false;
            }
            return true;
          }

          function parseDate(str) {
            if (!str) return null;
            const parts = str.split('-').map(Number);
            if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
            return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
          }

          function toISO(date) {
            return date.toISOString().slice(0, 10);
          }

          function shiftDate(str, delta) {
            const base = parseDate(str);
            if (!base) return null;
            base.setUTCDate(base.getUTCDate() + delta);
            return toISO(base);
          }

          function diffDays(start, end) {
            const a = parseDate(start);
            const b = parseDate(end);
            if (!a || !b) return 0;
            return Math.round((b - a) / 86400000);
          }

          function formatHuman(str) {
            const date = parseDate(str);
            if (!date) return str;
            return date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
          }

          function clearHighlight(className) {
            root.querySelectorAll('.' + className).forEach(function(cell){
              cell.classList.remove(className);
            });
          }

          function releaseCapture(ctx) {
            if (!ctx || !ctx.captureTarget || typeof ctx.pointerId !== 'number') return;
            if (typeof ctx.captureTarget.releasePointerCapture === 'function') {
              try { ctx.captureTarget.releasePointerCapture(ctx.pointerId); } catch (_) {}
            }
          }

          function highlightRange(unitId, start, endExclusive, className) {
            clearHighlight(className);
            if (!start || !endExclusive) return;
            const cells = Array.prototype.slice.call(root.querySelectorAll('[data-calendar-cell][data-unit="' + unitId + '"]'));
            cells.forEach(function(cell){
              const date = cell.getAttribute('data-date');
              if (date && date >= start && date < endExclusive) {
                cell.classList.add(className);
              }
            });
          }

          function rangeHasConflicts(unitId, start, endExclusive, currentId, currentKind) {
            const cells = Array.prototype.slice.call(root.querySelectorAll('[data-calendar-cell][data-unit="' + unitId + '"]'));
            return cells.some(function(cell){
              const date = cell.getAttribute('data-date');
              if (!date || date < start || date >= endExclusive) return false;
              const otherId = cell.getAttribute('data-entry-id');
              if (!otherId) return false;
              const otherKind = cell.getAttribute('data-entry-kind');
              if (otherId === currentId && otherKind === currentKind) return false;
              return true;
            });
          }

          function showToast(message, variant) {
            if (!toastEl || !toastMessage) return;
            toastEl.setAttribute('data-variant', variant || 'success');
            toastMessage.textContent = message;
            toastEl.hidden = false;
            if (toastTimer) window.clearTimeout(toastTimer);
            toastTimer = window.setTimeout(function(){ toastEl.hidden = true; }, 3200);
          }

          function hideAction() {
            if (!actionEl) return;
            actionEl.hidden = true;
            actionEl.innerHTML = '';
            actionCtx = null;
          }

          function showAction(config) {
            if (!actionEl) return;
            actionCtx = config;
            actionEl.style.left = config.clientX + 'px';
            actionEl.style.top = (config.clientY - 12) + 'px';
            actionEl.innerHTML = config.html;
            actionEl.hidden = false;
          }

          function refreshUnitCard(unitId) {
            const card = root.querySelector('[data-unit-card="' + unitId + '"]');
            if (!card || !fetchTemplate) return;
            card.setAttribute('data-loading', 'true');
            const url = fetchTemplate.replace(':id', unitId) + '?ym=' + month;
            fetch(url, { headers: { 'X-Requested-With': 'fetch' } })
              .then(function(res){ return res.text(); })
              .then(function(html){
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html.trim();
                const nextCard = wrapper.firstElementChild;
                if (nextCard) {
                  card.replaceWith(nextCard);
                } else {
                  card.removeAttribute('data-loading');
                }
                hideAction();
              })
              .catch(function(){
                card.removeAttribute('data-loading');
                showToast('Não foi possível atualizar o calendário.', 'danger');
                hideAction();
              });
          }

          function submitReschedule(ctx, range) {
            let url;
            let payload;
            if (ctx.entryKind === 'BOOKING') {
              url = '/calendar/booking/' + ctx.entryId + '/reschedule';
              payload = { checkin: range.start, checkout: range.end };
            } else {
              url = '/calendar/block/' + ctx.entryId + '/reschedule';
              payload = { start_date: range.start, end_date: range.end };
            }
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Atualizado com sucesso', 'success');
                  refreshUnitCard(result.data.unit_id || ctx.unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível reagendar.', 'danger');
                  refreshUnitCard(ctx.unitId);
                }
              })
              .catch(function(){
                showToast('Erro de rede ao guardar.', 'danger');
                refreshUnitCard(ctx.unitId);
              });
          }

          function submitBlock(unitId, start, endExclusive) {
            fetch('/calendar/unit/' + unitId + '/block', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start_date: start, end_date: endExclusive })
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Bloqueio criado.', 'success');
                  refreshUnitCard(unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível bloquear estas datas.', 'danger');
                  refreshUnitCard(unitId);
                }
              })
              .catch(function(){
                showToast('Erro de rede ao bloquear datas.', 'danger');
                refreshUnitCard(unitId);
              });
          }

          function submitBlockRemoval(blockId, unitId) {
            fetch('/calendar/block/' + blockId, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Bloqueio removido.', 'success');
                  refreshUnitCard(unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível remover o bloqueio.', 'danger');
                  refreshUnitCard(unitId);
                }
              })
              .catch(function(){
                showToast('Erro ao remover bloqueio.', 'danger');
                refreshUnitCard(unitId);
              });
          }

          function escapeHtml(str) {
            return String(str == null ? '' : str)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          }

          function formatStatusLabel(status) {
            switch ((status || '').toUpperCase()) {
              case 'CONFIRMED':
                return 'Reserva confirmada';
              case 'PENDING':
                return 'Reserva pendente';
              case 'BLOCK':
                return 'Bloqueio';
              default:
                return status ? 'Estado: ' + status : '';
            }
          }

          function formatGuestSummary(adults, children) {
            const parts = [];
            if (adults > 0) parts.push(adults + ' ' + (adults === 1 ? 'adulto' : 'adultos'));
            if (children > 0) parts.push(children + ' ' + (children === 1 ? 'criança' : 'crianças'));
            return parts.join(' · ');
          }

          function showEntryActions(cell) {
            if (!cell) return;
            const entryId = cell.getAttribute('data-entry-id');
            if (!entryId) return;
            const entryKind = cell.getAttribute('data-entry-kind');
            const status = cell.getAttribute('data-entry-status') || '';
            const guest = cell.getAttribute('data-entry-guest') || '';
            const label = cell.getAttribute('data-entry-label') || '';
            const start = cell.getAttribute('data-entry-start');
            const end = cell.getAttribute('data-entry-end');
            const url = cell.getAttribute('data-entry-url');
            const cancelUrl = cell.getAttribute('data-entry-cancel-url');
            const historyUrl = '/admin/auditoria?entity=' + encodeURIComponent(entryKind === 'BOOKING' ? 'booking' : 'block') + '&id=' + encodeURIComponent(entryId);
            const rect = cell.getBoundingClientRect();
            let html = '<div class="calendar-action__card">';
            if (entryKind === 'BOOKING') {
              const email = cell.getAttribute('data-entry-email') || '';
              const phone = cell.getAttribute('data-entry-phone') || '';
              const adults = Number(cell.getAttribute('data-entry-adults') || '0');
              const children = Number(cell.getAttribute('data-entry-children') || '0');
              const guestSummary = formatGuestSummary(adults, children);
              const nights = diffDays(start, end);
              const statusLabel = formatStatusLabel(status);
              html += '<div class="calendar-action__title">' + escapeHtml(guest || 'Reserva') + '</div>';
              if (statusLabel) {
                html += '<div class="text-xs text-slate-300 uppercase tracking-wide">' + escapeHtml(statusLabel) + '</div>';
              }
              html += '<div class="text-sm text-slate-200">' + formatHuman(start) + ' – ' + formatHuman(shiftDate(end, -1));
              if (nights > 0) {
                html += ' · ' + nights + ' ' + (nights === 1 ? 'noite' : 'noites');
              }
              html += '</div>';
              if (guestSummary) {
                html += '<div class="text-sm text-slate-200">' + escapeHtml(guestSummary) + '</div>';
              }
              if (email || phone) {
                html += '<div class="text-xs text-slate-300 leading-relaxed">';
                if (email) {
                  const mailHref = 'mailto:' + encodeURIComponent(email.trim());
                  html += '<div><span class="text-slate-400 uppercase tracking-wide">Email</span> <a class="text-white underline" href="' + mailHref + '">' + escapeHtml(email) + '</a></div>';
                }
                if (phone) {
                  const telHref = 'tel:' + encodeURIComponent(phone.replace(/\s+/g, ''));
                  html += '<div><span class="text-slate-400 uppercase tracking-wide">Telefone</span> <a class="text-white underline" href="' + telHref + '">' + escapeHtml(phone) + '</a></div>';
                }
                html += '</div>';
              }
              if (label) {
                html += '<div class="text-xs text-slate-300">' + escapeHtml(label) + '</div>';
              }
              const noteCount = Number(cell.getAttribute('data-entry-note-count') || '0');
              const notePreview = cell.getAttribute('data-entry-note-preview') || '';
              const noteMeta = cell.getAttribute('data-entry-note-meta') || '';
              if (noteCount > 0 && notePreview) {
                html += '<div class="text-xs text-slate-200 bg-slate-900/30 rounded-lg p-2 leading-relaxed">';
                html += '<div class="font-semibold">Última nota (' + escapeHtml(noteMeta || noteCount + (noteCount === 1 ? ' nota' : ' notas')) + ')</div>';
                html += '<div class="text-slate-100 whitespace-pre-line mt-1">' + escapeHtml(notePreview) + (notePreview.length >= 180 ? '…' : '') + '</div>';
                if (noteCount > 1) {
                  html += '<div class="mt-1 text-slate-400">' + noteCount + ' notas no total.</div>';
                }
                html += '</div>';
              }
              html += '<div class="calendar-action__buttons">';
              if (url && CAN_VIEW_BOOKING) html += '<a class="btn btn-light" href="' + url + '">Ver detalhes</a>';
              if (CAN_CANCEL_CALENDAR) {
                html += '<button class="btn btn-danger" data-action="cancel-booking" data-cancel-url="' + (cancelUrl || '') + '">Cancelar reserva</button>';
              }
              html += '</div>';
              html += '<a class="text-xs text-slate-200 underline" href="' + historyUrl + '">Ver histórico de alterações</a>';
              if (status !== 'CONFIRMED') {
                html += '<p class="text-xs text-amber-200">Arrastar para reagendar está disponível apenas para reservas confirmadas.</p>';
              } else if (!CAN_RESCHEDULE) {
                html += '<p class="text-xs text-amber-200">Não tem permissões para reagendar arrastando.</p>';
              } else {
                html += '<p class="text-xs text-slate-300">Arrasta para ajustar rapidamente as datas.</p>';
              }
            } else {
              html += '<div class="calendar-action__title">Bloqueio</div>';
              html += '<div class="text-sm text-slate-200">' + formatHuman(start) + ' – ' + formatHuman(shiftDate(end, -1)) + '</div>';
              if (label) {
                html += '<div class="text-xs text-slate-300">' + escapeHtml(label) + '</div>';
              }
              html += '<div class="calendar-action__buttons">';
              html += '<a class="btn btn-muted" href="' + historyUrl + '">Histórico</a>';
              if (CAN_DELETE_BLOCK) {
                html += '<button class="btn btn-danger" data-action="delete-block" data-block-id="' + entryId + '">Remover bloqueio</button>';
              }
              html += '</div>';
              if (CAN_MANAGE_BLOCK) {
                html += '<p class="text-xs text-slate-300">Clique e arrasta para mover o bloqueio.</p>';
              } else {
                html += '<p class="text-xs text-amber-200">Não tem permissões para mover este bloqueio.</p>';
              }
            }
            html += '</div>';
            showAction({ html: html, clientX: rect.left + rect.width / 2, clientY: rect.top });
            actionCtx = { type: 'entry', entryId: entryId, entryKind: entryKind, unitId: cell.getAttribute('data-unit'), cancelUrl: cancelUrl };
          }

          function normalizeRange(a, b) {
            if (!a || !b) return { start: a, endExclusive: shiftDate(a, 1), end: b };
            if (a <= b) {
              return { start: a, endExclusive: shiftDate(b, 1), end: b };
            }
            return { start: b, endExclusive: shiftDate(a, 1), end: a };
          }

          function showSelectionActions(ctx) {
            const humanStart = formatHuman(ctx.start);
            const humanEnd = formatHuman(shiftDate(ctx.end, -1));
            const nights = diffDays(ctx.start, ctx.end);
            let html = '<div class="calendar-action__card">';
            html += '<div class="calendar-action__title">' + (nights > 1 ? nights + ' noites selecionadas' : nights + ' noite selecionada') + '</div>';
            html += '<div class="text-sm text-slate-200">' + humanStart + ' – ' + humanEnd + '</div>';
            html += '<div class="calendar-action__buttons">';
            const disableBlock = ctx.conflict || !CAN_CREATE_BLOCK;
            html += '<button class="btn btn-primary" data-action="block-range"' + (disableBlock ? ' disabled' : '') + '>Bloquear estas datas</button>';
            html += '<a class="btn btn-light" href="/admin/units/' + ctx.unitId + '">Ver detalhes</a>';
            html += '</div>';
            if (ctx.conflict) {
              html += '<p class="text-xs text-rose-200">Existem reservas nesta seleção.</p>';
            } else if (!CAN_CREATE_BLOCK) {
              html += '<p class="text-xs text-amber-200">Não tem permissões para criar bloqueios.</p>';
            } else {
              html += '<p class="text-xs text-slate-300">Sem reservas nesta seleção.</p>';
            }
            html += '</div>';
            showAction({ html: html, clientX: ctx.clientX, clientY: ctx.clientY });
            actionCtx = { type: 'selection', unitId: ctx.unitId, start: ctx.start, end: ctx.end, conflict: ctx.conflict };
          }

          function onPointerDown(e) {
            if (!isPrimaryPointer(e)) return;
            const cell = e.target.closest('[data-calendar-cell]');
            if (!cell) return;
            if (cell.getAttribute('data-in-month') !== '1') return;
            hideAction();
            const entryId = cell.getAttribute('data-entry-id');
            if (entryId) {
              const entryKind = cell.getAttribute('data-entry-kind');
              const status = cell.getAttribute('data-entry-status') || '';
              const reschedPermission = entryKind === 'BOOKING'
                ? (CAN_RESCHEDULE && status === 'CONFIRMED')
                : CAN_MANAGE_BLOCK;
              if (typeof cell.setPointerCapture === 'function') {
                try { cell.setPointerCapture(e.pointerId); } catch (_) {}
              }
              dragCtx = {
                entryId: entryId,
                entryKind: entryKind,
                status: status,
                canReschedule: reschedPermission,
                unitId: cell.getAttribute('data-unit'),
                originStart: cell.getAttribute('data-entry-start'),
                originEnd: cell.getAttribute('data-entry-end'),
                anchorDate: cell.getAttribute('data-date'),
                pointerStart: { x: e.clientX, y: e.clientY },
                pointerId: e.pointerId,
                captureTarget: cell,
                moved: false,
                preview: null,
                conflict: false
              };
            } else {
              if (!CAN_CREATE_BLOCK) return;
              if (typeof cell.setPointerCapture === 'function') {
                try { cell.setPointerCapture(e.pointerId); } catch (_) {}
              }
              selectionCtx = {
                unitId: cell.getAttribute('data-unit'),
                startDate: cell.getAttribute('data-date'),
                endDate: cell.getAttribute('data-date'),
                pointerStart: { x: e.clientX, y: e.clientY },
                pointerId: e.pointerId,
                captureTarget: cell,
                active: true
              };
              highlightRange(selectionCtx.unitId, selectionCtx.startDate, shiftDate(selectionCtx.startDate, 1), 'calendar-cell--selection');
            }
          }

          function onPointerMove(e) {
            if (dragCtx) {
              if (!dragCtx.canReschedule) return;
              if (!dragCtx.moved) {
                const delta = Math.abs(e.clientX - dragCtx.pointerStart.x) + Math.abs(e.clientY - dragCtx.pointerStart.y);
                if (delta > 5) dragCtx.moved = true;
              }
              if (!dragCtx.moved) return;
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const cell = el && el.closest('[data-calendar-cell][data-unit="' + dragCtx.unitId + '"]');
              if (!cell) return;
              const hoverDate = cell.getAttribute('data-date');
              if (!hoverDate) return;
              const anchorOffset = diffDays(dragCtx.originStart, dragCtx.anchorDate);
              const duration = diffDays(dragCtx.originStart, dragCtx.originEnd);
              const newStart = shiftDate(hoverDate, -anchorOffset);
              const newEnd = shiftDate(newStart, duration);
              dragCtx.preview = { start: newStart, end: newEnd };
              dragCtx.conflict = rangeHasConflicts(dragCtx.unitId, newStart, newEnd, dragCtx.entryId, dragCtx.entryKind);
              highlightRange(dragCtx.unitId, newStart, newEnd, 'calendar-cell--preview');
              if (dragCtx.conflict) {
                highlightRange(dragCtx.unitId, newStart, newEnd, 'calendar-cell--invalid');
              } else {
                clearHighlight('calendar-cell--invalid');
              }
              e.preventDefault();
            } else if (selectionCtx && selectionCtx.active) {
              const targetEl = document.elementFromPoint(e.clientX, e.clientY);
              const targetCell = targetEl && targetEl.closest('[data-calendar-cell][data-unit="' + selectionCtx.unitId + '"]');
              if (!targetCell) return;
              const targetDate = targetCell.getAttribute('data-date');
              if (!targetDate || targetDate === selectionCtx.endDate) return;
              selectionCtx.endDate = targetDate;
              const range = normalizeRange(selectionCtx.startDate, selectionCtx.endDate);
              highlightRange(selectionCtx.unitId, range.start, range.endExclusive, 'calendar-cell--selection');
            }
          }

          function onPointerUp(e) {
            if (dragCtx) {
              const preview = dragCtx.preview;
              const wasDragging = dragCtx.moved;
              const conflict = dragCtx.conflict;
              if (!wasDragging) {
                clearHighlight('calendar-cell--preview');
                clearHighlight('calendar-cell--invalid');
                releaseCapture(dragCtx);
                dragCtx = null;
                return;
              }
              clearHighlight('calendar-cell--preview');
              clearHighlight('calendar-cell--invalid');
              const changed = preview && (preview.start !== dragCtx.originStart || preview.end !== dragCtx.originEnd);
              const ctxCopy = dragCtx;
              releaseCapture(dragCtx);
              dragCtx = null;
              if (preview && !conflict && changed) {
                submitReschedule(ctxCopy, preview);
              } else if (conflict) {
                showToast('As novas datas entram em conflito com outra ocupação.', 'danger');
                refreshUnitCard(ctxCopy.unitId);
              }
            } else if (selectionCtx && selectionCtx.active) {
              const range = normalizeRange(selectionCtx.startDate, selectionCtx.endDate);
              clearHighlight('calendar-cell--selection');
              const conflict = rangeHasConflicts(selectionCtx.unitId, range.start, range.endExclusive);
              releaseCapture(selectionCtx);
              showSelectionActions({
                unitId: selectionCtx.unitId,
                start: range.start,
                end: range.endExclusive,
                conflict: conflict,
                clientX: e.clientX,
                clientY: e.clientY
              });
              selectionCtx = null;
            }
          }

          function onPointerCancel() {
            if (dragCtx) {
              clearHighlight('calendar-cell--preview');
              clearHighlight('calendar-cell--invalid');
              releaseCapture(dragCtx);
              dragCtx = null;
            }
            if (selectionCtx && selectionCtx.active) {
              clearHighlight('calendar-cell--selection');
              releaseCapture(selectionCtx);
              selectionCtx = null;
            }
          }

          function onDoubleClick(e) {
            if (e.button !== 0) return;
            const cell = e.target.closest('[data-calendar-cell]');
            if (!cell) return;
            if (cell.getAttribute('data-in-month') !== '1') return;
            const entryId = cell.getAttribute('data-entry-id');
            if (!entryId) return;
            dragCtx = null;
            hideAction();
            showEntryActions(cell);
          }

          function onActionClick(e) {
            const target = e.target.closest('[data-action]');
            if (!target || !actionCtx) return;
            const action = target.getAttribute('data-action');
            if (action === 'block-range' && actionCtx.type === 'selection') {
              if (!CAN_CREATE_BLOCK) return;
              e.preventDefault();
              hideAction();
              submitBlock(actionCtx.unitId, actionCtx.start, actionCtx.end);
            }
            if (action === 'delete-block' && actionCtx.type === 'entry') {
              if (!CAN_DELETE_BLOCK) return;
              e.preventDefault();
              hideAction();
              submitBlockRemoval(target.getAttribute('data-block-id'), actionCtx.unitId);
            }
            if (action === 'cancel-booking' && actionCtx.type === 'entry' && actionCtx.entryKind === 'BOOKING') {
              if (!CAN_CANCEL_CALENDAR) return;
              e.preventDefault();
              const proceed = window.confirm('Cancelar esta reserva?');
              if (!proceed) return;
              const cancelUrl = target.getAttribute('data-cancel-url') || actionCtx.cancelUrl || ('/calendar/booking/' + actionCtx.entryId + '/cancel');
              const unitId = actionCtx.unitId;
              fetch(cancelUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              })
                .then(function(res){
                  return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                    return { res: res, data: data };
                  });
                })
                .then(function(result){
                  const ok = result.res && result.res.ok && result.data && result.data.ok;
                  if (ok) {
                    showToast(result.data.message || 'Reserva cancelada.', 'info');
                    refreshUnitCard(unitId);
                  } else {
                    showToast(result.data && result.data.message ? result.data.message : 'Não foi possível cancelar.', 'danger');
                    refreshUnitCard(unitId);
                  }
                })
                .catch(function(){
                  showToast('Erro ao cancelar a reserva.', 'danger');
                  refreshUnitCard(unitId);
                });
            }
          }

          function onDocumentClick(e) {
            if (!actionEl || actionEl.hidden) return;
            if (!actionEl.contains(e.target)) hideAction();
          }

          function onKeyDown(e) {
            if (e.key === 'Escape') {
              clearHighlight('calendar-cell--selection');
              clearHighlight('calendar-cell--preview');
              clearHighlight('calendar-cell--invalid');
              hideAction();
              releaseCapture(dragCtx);
              dragCtx = null;
              releaseCapture(selectionCtx);
              selectionCtx = null;
            }
          }

          root.addEventListener('pointerdown', onPointerDown);
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerCancel);
          root.addEventListener('dblclick', onDoubleClick);
          if (actionEl) actionEl.addEventListener('click', onActionClick);
          document.addEventListener('click', onDocumentClick);
          document.addEventListener('keydown', onKeyDown);
        })();
      </script>
    `
  }));
});

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

  const rawEntries = db.prepare(
    `SELECT 'BOOKING' as kind, id, checkin as s, checkout as e, guest_name, guest_email, guest_phone, status, adults, children, total_cents, agency
       FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
     UNION ALL
     SELECT 'BLOCK' as kind, id, start_date as s, end_date as e, 'Bloqueio' as guest_name, NULL as guest_email, NULL as guest_phone, 'BLOCK' as status, NULL as adults, NULL as children, NULL as total_cents, NULL as agency
       FROM blocks WHERE unit_id = ?`
  ).all(u.id, u.id).map(row => ({
    ...row,
    label: row.kind === 'BLOCK'
      ? 'Bloqueio de datas'
      : `${row.guest_name || 'Reserva'} (${row.adults || 0}A+${row.children || 0}C)`,
  }));

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
      label: 'Bloqueio de datas',
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
  return `
    <div class="card p-4 calendar-card" data-unit-card="${u.id}" data-unit-name="${esc(u.name)}">
      <div class="flex items-center justify-between mb-2">
        <div>
          <div class="text-sm text-slate-500">${u.property_name}</div>
          <h3 class="text-lg font-semibold">${u.name}</h3>
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
