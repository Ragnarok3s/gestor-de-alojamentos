const fs = require('fs');
const path = require('path');

const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { eur, esc } = require('../utils/format');
const {
  FEATURE_ICON_KEYS,
  parseFeaturesInput,
  parseFeaturesStored,
  featuresToTextarea,
  featureChipsHtml,
} = require('../utils/features');
const layout = require('../views/layout');
const { UPLOAD_UNITS } = require('../uploads');

function registerAdminDashboardRoutes(app, { db, requireLogin, uploadMiddleware }) {
  if (!requireLogin) throw new Error('requireLogin middleware is required for admin dashboard routes');
  if (!uploadMiddleware) throw new Error('upload middleware is required for image uploads');

  // ===================== Backoffice (protegido) =====================
  app.get('/admin', requireLogin, (req, res) => {
    const props = db.prepare('SELECT * FROM properties ORDER BY name').all();
    const units = db.prepare(
      `SELECT u.*, p.name as property_name
         FROM units u
         JOIN properties p ON p.id = u.property_id
        ORDER BY p.name, u.name`
    ).all();
    const recentBookings = db.prepare(
      `SELECT b.*, u.name as unit_name, p.name as property_name
         FROM bookings b
         JOIN units u ON u.id = b.unit_id
         JOIN properties p ON p.id = u.property_id
        ORDER BY b.created_at DESC
        LIMIT 10`
    ).all();
  
    res.send(layout({
      title: 'Backoffice',
      user: req.user,
      activeNav: 'backoffice',
      activeBackofficeNav: 'properties',
      body: html`
        <h1 class="text-2xl font-semibold mb-6">Backoffice</h1>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section class="card p-4" id="properties">
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
  
          <section class="card p-4 md:col-span-2" id="units">
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
  
  app.post('/admin/properties/create', requireLogin, (req, res) => {
    const { name, location, description } = req.body;
    db.prepare('INSERT INTO properties(name, location, description) VALUES (?, ?, ?)').run(name, location, description);
    res.redirect('/admin');
  });
  
  app.post('/admin/properties/:id/delete', requireLogin, (req, res) => {
    const id = req.params.id;
    const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
    if (!property) return res.status(404).send('Propriedade não encontrada');
    db.prepare('DELETE FROM properties WHERE id = ?').run(id);
    res.redirect('/admin');
  });
  
  app.get('/admin/properties/:id', requireLogin, (req, res) => {
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
  
    res.send(layout({
      title: p.name,
      user: req.user,
      activeNav: 'backoffice',
      activeBackofficeNav: 'properties',
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
  
  app.post('/admin/units/create', requireLogin, (req, res) => {
    let { property_id, name, capacity, base_price_eur, features_raw } = req.body;
    const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
    const features = parseFeaturesInput(features_raw);
    db.prepare('INSERT INTO units(property_id, name, capacity, base_price_cents, features) VALUES (?, ?, ?, ?, ?)')
      .run(property_id, name, Number(capacity), cents, JSON.stringify(features));
    res.redirect('/admin');
  });
  
  app.get('/admin/units/:id', requireLogin, (req, res) => {
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
    const images = db.prepare('SELECT * FROM unit_images WHERE unit_id = ? ORDER BY position, id').all(u.id);
  
    res.send(layout({
      title: `${esc(u.property_name)} – ${esc(u.name)}`,
      user: req.user,
      activeNav: 'backoffice',
      activeBackofficeNav: 'units',
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
  
          <section class="card p-4" id="rates">
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
              <button class="btn btn-primary">Carregar imagens</button>
            </form>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              ${images.map(img => `
                <div class="relative border rounded overflow-hidden">
                  <img src="/uploads/units/${u.id}/${img.file}" alt="${esc(img.alt||'')}" class="w-full h-32 object-cover"/>
                  <form method="post" action="/admin/images/${img.id}/delete" onsubmit="return confirm('Remover imagem?');" class="absolute top-1 right-1">
                    <button class="bg-rose-600 text-white text-xs px-2 py-1 rounded">X</button>
                  </form>
                </div>
              `).join('')}
            </div>
          </section>
        </div>
      `
    }));
  });

  app.get('/admin/rates', requireLogin, (req, res) => {
    const rates = db.prepare(
      `SELECT r.*, u.name AS unit_name, p.name AS property_name, u.base_price_cents AS unit_base_price_cents
         FROM rates r
         JOIN units u ON u.id = r.unit_id
         JOIN properties p ON p.id = u.property_id
        ORDER BY p.name, u.name, r.start_date`
    ).all();

    res.send(layout({
      title: 'Rates',
      user: req.user,
      activeNav: 'backoffice',
      activeBackofficeNav: 'rates',
      body: html`
        <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
        <h1 class="text-2xl font-semibold mb-4">Rates por unidade</h1>
        <div class="card p-0 overflow-x-auto">
          <table class="w-full min-w-[860px] text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Propriedade</th>
                <th>Unidade</th>
                <th>Base €/noite</th>
                <th>De</th>
                <th>Até</th>
                <th>€/noite (weekday)</th>
                <th>€/noite (weekend)</th>
                <th>Mín. noites</th>
              </tr>
            </thead>
            <tbody>
              ${rates.length
                ? rates
                    .map(r => `
                      <tr class="border-t">
                        <td>${esc(r.property_name)}</td>
                        <td><a class="underline" href="/admin/units/${r.unit_id}">${esc(r.unit_name)}</a></td>
                        <td>€ ${eur(r.unit_base_price_cents)}</td>
                        <td>${dayjs(r.start_date).format('DD/MM/YYYY')}</td>
                        <td>${dayjs(r.end_date).format('DD/MM/YYYY')}</td>
                        <td>€ ${eur(r.weekday_price_cents)}</td>
                        <td>€ ${eur(r.weekend_price_cents)}</td>
                        <td>${r.min_stay || 1}</td>
                      </tr>
                    `)
                    .join('')
                : '<tr><td colspan="8" class="p-4 text-slate-500">Sem rates configuradas.</td></tr>'}
            </tbody>
          </table>
        </div>
      `,
    }));
  });
  
  app.post('/admin/units/:id/update', requireLogin, (req, res) => {
    const { name, capacity, base_price_eur, features_raw } = req.body;
    const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
    const features = parseFeaturesInput(features_raw);
    db.prepare('UPDATE units SET name = ?, capacity = ?, base_price_cents = ?, features = ? WHERE id = ?')
      .run(name, Number(capacity), cents, JSON.stringify(features), req.params.id);
    res.redirect(`/admin/units/${req.params.id}`);
  });
  
  app.post('/admin/units/:id/delete', requireLogin, (req, res) => {
    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
    res.redirect('/admin');
  });
  
  app.post('/admin/units/:id/block', requireLogin, (req, res) => {
    const { start_date, end_date } = req.body;
    if (!dayjs(end_date).isAfter(dayjs(start_date)))
      return res.status(400).send('end_date deve ser > start_date');
  
    const conflicts = db.prepare(
      `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
        AND NOT (checkout <= ? OR checkin >= ?)`
    ).all(req.params.id, start_date, end_date);
    if (conflicts.length)
      return res.status(409).send('As datas incluem reservas existentes');
  
    db.prepare('INSERT INTO blocks(unit_id, start_date, end_date) VALUES (?, ?, ?)').run(req.params.id, start_date, end_date);
    res.redirect(`/admin/units/${req.params.id}`);
  });
  
  app.post('/admin/blocks/:blockId/delete', requireLogin, (req, res) => {
    const block = db.prepare('SELECT unit_id FROM blocks WHERE id = ?').get(req.params.blockId);
    if (!block) return res.status(404).send('Bloqueio não encontrado');
    db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.blockId);
    res.redirect(`/admin/units/${block.unit_id}`);
  });
  
  app.post('/admin/units/:id/rates/create', requireLogin, (req, res) => {
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
  
  app.post('/admin/rates/:rateId/delete', requireLogin, (req, res) => {
    const r = db.prepare('SELECT unit_id FROM rates WHERE id = ?').get(req.params.rateId);
    if (!r) return res.status(404).send('Rate não encontrada');
    db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
    res.redirect(`/admin/units/${r.unit_id}`);
  });
  
  // Imagens
  app.post('/admin/units/:id/images', requireLogin, uploadMiddleware.array('images', 12), (req,res)=>{
    const unitId = req.params.id;
    const files = req.files || [];
    const insert = db.prepare('INSERT INTO unit_images(unit_id,file,alt,position) VALUES (?,?,?,?)');
    let pos = db.prepare('SELECT COALESCE(MAX(position),0) as p FROM unit_images WHERE unit_id = ?').get(unitId).p;
    files.forEach(f => { insert.run(unitId, f.filename, null, ++pos); });
    res.redirect(`/admin/units/${unitId}`);
  });
  app.post('/admin/images/:imageId/delete', requireLogin, (req,res)=>{
    const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
    if (!img) return res.status(404).send('Imagem não encontrada');
    const filePath = path.join(UPLOAD_UNITS, String(img.unit_id), img.file);
    db.prepare('DELETE FROM unit_images WHERE id = ?').run(img.id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.redirect(`/admin/units/${img.unit_id}`);
  });
  
}

module.exports = registerAdminDashboardRoutes;
