const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { eur, esc } = require('../utils/format');
const {
  parseFeaturesStored,
  featureChipsHtml,
} = require('../utils/features');
const {
  dateRangeNights,
  unitAvailable,
  rateQuote,
} = require('../services/booking');
const layout = require('../views/layout');

function registerFrontOfficeRoutes(app, { db, resolveUser }) {
  if (!resolveUser) throw new Error('resolveUser helper is required for front office routes');

  // ===================== Front Office =====================
  app.get('/', (req, res) => {
    const user = resolveUser(db, req);
    const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
    res.send(layout({
      title: 'Reservas',
      user,
      activeNav: 'search',
      body: html`
        <section class="search-hero">
          <h1 class="search-title">Reservar a Casa</h1>
          <form action="/search" method="get" class="search-form">
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
              <button class="search-button" type="submit">Procurar</button>
            </div>
          </form>
        </section>
      `
    }));
  });
  
  app.get('/search', (req, res) => {
    const user = resolveUser(db, req);
  
    const { checkin, checkout, property_id } = req.query;
    const adults = Math.max(1, Number(req.query.adults ?? 1));
    const children = Math.max(0, Number(req.query.children ?? 0));
    const totalGuests = adults + children;
    if (!checkin || !checkout) return res.redirect('/');
  
    const units = db.prepare(
      `SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id
       WHERE (? IS NULL OR u.property_id = ?)
         AND u.capacity >= ?
       ORDER BY p.name, u.name`
    ).all(property_id || null, property_id || null, Number(totalGuests));
  
    const imageStmt = db.prepare('SELECT file, alt FROM unit_images WHERE unit_id = ? ORDER BY position, id LIMIT 4');
  
    const available = units
      .filter(u => unitAvailable(db, u.id, checkin, checkout))
      .map(u => {
        const quote = rateQuote(db, u.id, checkin, checkout, u.base_price_cents);
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
      body: html`
        <h1 class="text-2xl font-semibold mb-4">Alojamentos disponíveis</h1>
        <p class="mb-4 text-slate-600">
          ${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
          · ${adults} adulto(s)${children?` + ${children} criança(s)`:''}
        </p>
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
    const user = resolveUser(db, req);
  
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
    if (!unitAvailable(db, u.id, checkin, checkout)) return res.status(409).send('Este alojamento já não tem disponibilidade.');

    const quote = rateQuote(db, u.id, checkin, checkout, u.base_price_cents);
    if (quote.nights < quote.minStayReq) return res.status(400).send('Estadia mínima: ' + quote.minStayReq + ' noites');
    const total = quote.total_cents;
    const unitFeaturesBooking = featureChipsHtml(parseFeaturesStored(u.features), { className: 'flex flex-wrap gap-2 text-xs text-slate-600 mt-3', badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full', iconWrapClass: 'inline-flex items-center justify-center text-emerald-700' });
  
    res.send(layout({
      title: 'Confirmar Reserva',
      user,
      activeNav: 'search',
      body: html`
        <h1 class="text-2xl font-semibold mb-4">${u.property_name} – ${u.name}</h1>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-4">
            <h2 class="font-semibold mb-3">Detalhes da reserva</h2>
            <ul class="text-sm text-slate-700 space-y-1">
              <li>Check-in: <strong>${dayjs(checkin).format('DD/MM/YYYY')}</strong></li>
              <li>Check-out: <strong>${dayjs(checkout).format('DD/MM/YYYY')}</strong></li>
              <li>Noites: <strong>${quote.nights}</strong></li>
              <li>Hóspedes: <strong>${adults} adulto(s)${children?` + ${children} criança(s)`:''}</strong></li>
              <li>Estadia mínima aplicada: <strong>${quote.minStayReq} noites</strong></li>
              <li>Total: <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(total)}</strong></li>
            </ul>
            ${unitFeaturesBooking}
          </div>
          <form class="card p-4" method="post" action="/book">
            <h2 class="font-semibold mb-3">Dados do hóspede</h2>
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
            <div class="grid gap-3 mt-2">
              <input required name="guest_name" class="input" placeholder="Nome completo" />
              <input required name="guest_nationality" class="input" placeholder="Nacionalidade" />
              <input required name="guest_phone" class="input" placeholder="Telefone/Telemóvel" />
              <input required type="email" name="guest_email" class="input" placeholder="Email" />
              ${user ? `
                <div>
                  <label class="text-sm">Agencia</label>
                  <input name="agency" class="input" placeholder="Ex: BOOKING" list="agency-options" required />
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
    const user = resolveUser(db, req);
  
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
  
      const quote = rateQuote(db, u.id, checkin, checkout, u.base_price_cents);
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
    const user = resolveUser(db, req);
  
    const b = db.prepare(
      `SELECT b.*, u.name as unit_name, p.name as property_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
       JOIN properties p ON p.id = u.property_id
       WHERE b.id = ?`
    ).get(req.params.id);
    if (!b) return res.status(404).send('Reserva não encontrada');
  
    res.send(layout({
      title: 'Reserva Confirmada',
      user,
      activeNav: 'search',
      body: html`
        <div class="card p-6">
          <h1 class="text-2xl font-semibold mb-2">Reserva confirmada</h1>
          <p class="text-slate-600 mb-6">Obrigado, ${b.guest_name}. Enviámos um email de confirmação para ${b.guest_email} (mock).</p>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <div class="font-semibold">${b.property_name} – ${b.unit_name}</div>
              <div>Hóspede: <strong>${b.guest_name}</strong> ${b.guest_nationality?`<span class="text-slate-500">(${b.guest_nationality})</span>`:''}</div>
              <div>Contacto: <strong>${b.guest_phone || '-'}</strong> &middot; <strong>${b.guest_email}</strong></div>
              <div>Ocupação: <strong>${b.adults} adulto(s)${b.children?` + ${b.children} criança(s)`:''}</strong></div>
              ${b.agency ? `<div>Agencia: <strong>${b.agency}</strong></div>` : ''}
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
          <div class="mt-6"><a class="btn btn-primary" href="/">Nova pesquisa</a></div>
        </div>
      `
    }));
  });
  
}

module.exports = registerFrontOfficeRoutes;
