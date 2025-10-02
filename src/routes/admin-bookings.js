const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { eur, esc } = require('../utils/format');
const { rateQuote } = require('../services/booking');
const layout = require('../views/layout');

function registerAdminBookingsRoutes(app, { db, requireLogin, requireAdmin }) {
  if (!requireLogin) throw new Error('requireLogin middleware is required for admin booking routes');
  if (!requireAdmin) throw new Error('requireAdmin middleware is required for destructive admin booking routes');

  // ===================== Booking Management (Admin) =====================
  app.get('/admin/bookings', requireLogin, (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim(); // '', CONFIRMED, PENDING
    const ym = String(req.query.ym || '').trim();         // YYYY-MM opcional
  
    const where = [];
    const args = [];
  
    if (q) {
      where.push(`(b.guest_name LIKE ? OR b.guest_email LIKE ? OR u.name LIKE ? OR p.name LIKE ? OR b.agency LIKE ?)`);
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push(`b.status = ?`);
      args.push(status);
    }
    if (/^\d{4}-\d{2}$/.test(ym)) {
      const startYM = `${ym}-01`;
      const endYM = dayjs(startYM).endOf('month').add(1, 'day').format('YYYY-MM-DD'); // exclusivo
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
        LIMIT 500
    `;
    const rows = db.prepare(sql).all(...args);
  
    res.send(layout({
      title: 'Reservas',
      user: req.user,
      activeNav: 'bookings',
      activeBackofficeNav: 'bookings',
      body: html`
        <h1 class="text-2xl font-semibold mb-4">Reservas</h1>
  
        <form method="get" class="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
          <input class="input md:col-span-2" name="q" placeholder="Procurar por hóspede, email, unidade, propriedade" value="${esc(q)}"/>
          <select class="input" name="status">
            <option value="">Todos os estados</option>
            <option value="CONFIRMED" ${status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
            <option value="PENDING" ${status==='PENDING'?'selected':''}>PENDING</option>
          </select>
          <input class="input" type="month" name="ym" value="${/^\d{4}-\d{2}$/.test(ym)?ym:''}"/>
          <button class="btn btn-primary">Filtrar</button>
        </form>
  
        <div class="card p-0 overflow-x-auto">
          <table class="w-full min-w-[980px] text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Check-in</th><th>Check-out</th><th>Propriedade/Unidade</th><th>Agência</th><th>Hóspede</th><th>Ocup.</th><th>Total</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(b => `
                <tr class="border-t">
                  <td>${dayjs(b.checkin).format('DD/MM/YYYY')}</td>
                  <td>${dayjs(b.checkout).format('DD/MM/YYYY')}</td>
                  <td>${esc(b.property_name)} - ${esc(b.unit_name)}</td>
                  <td>${esc(b.agency || '')}</td>
                  <td>${esc(b.guest_name)} <span class="text-slate-500">(${esc(b.guest_email)})</span></td>
                  <td>${b.adults}A+${b.children}C</td>
                  <td>€ ${eur(b.total_cents)}</td>
                  <td>
                    <span class="text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                      ${b.status}
                    </span>
                  </td>
                  <td class="whitespace-nowrap">
                    <a class="underline" href="/admin/bookings/${b.id}">Editar</a>
                    <form method="post" action="/admin/bookings/${b.id}/cancel" style="display:inline" onsubmit="return confirm('Cancelar esta reserva?');">
                      <button class="text-rose-600 ml-2">Cancelar</button>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${rows.length===0?'<div class="p-4 text-slate-500">Sem resultados.</div>':''}
        </div>
      `
    }));
  });
  
  app.get('/admin/bookings/:id', requireLogin, (req, res) => {
    const b = db.prepare(`
      SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, p.name as property_name
        FROM bookings b
        JOIN units u ON u.id = b.unit_id
        JOIN properties p ON p.id = u.property_id
       WHERE b.id = ?
    `).get(req.params.id);
    if (!b) return res.status(404).send('Reserva não encontrada');
  
    res.send(layout({
      title: `Editar reserva #${b.id}`,
      user: req.user,
      activeNav: 'bookings',
      activeBackofficeNav: 'bookings',
      body: html`
        <a class="text-slate-600 underline" href="/admin/bookings">&larr; Reservas</a>
        <h1 class="text-2xl font-semibold mb-4">Editar reserva #${b.id}</h1>
  
        <div class="card p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div class="text-sm text-slate-500">${esc(b.property_name)}</div>
            <div class="font-semibold mb-3">${esc(b.unit_name)}</div>
            <ul class="text-sm text-slate-700 space-y-1">
              <li>Atual: ${dayjs(b.checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
              <li>Ocupação: ${b.adults}A+${b.children}C (cap. ${b.capacity})</li>
              <li>Total atual: € ${eur(b.total_cents)}</li>
            </ul>
            ${b.internal_notes ? `
              <div class="mt-4">
                <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Anotacoes internas</div>
                <div class="text-sm text-slate-700 whitespace-pre-line">${esc(b.internal_notes)}</div>
              </div>
            ` : ''}
          </div>
  
          <form method="post" action="/admin/bookings/${b.id}/update" class="grid gap-3">
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
            <input class="input" name="guest_nationality" value="${esc(b.guest_nationality || '')}" placeholder="Nacionalidade" />
            <div>
              <label class="text-sm">Agência</label>
              <input class="input" name="agency" value="${esc(b.agency || '')}" placeholder="Ex: BOOKING" />
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Anotacoes internas</label>
              <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas (apenas equipa)">${esc(b.internal_notes || '')}</textarea>
              <p class="text-xs text-slate-500">Nao aparece para o hospede.</p>
            </div>
  
            <div>
              <label class="text-sm">Estado</label>
              <select name="status" class="input">
                <option value="CONFIRMED" ${b.status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
                <option value="PENDING" ${b.status==='PENDING'?'selected':''}>PENDING</option>
              </select>
            </div>
  
            <div class="flex items-center gap-3">
              <button class="btn btn-primary">Guardar alterações</button>
              <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                <button class="btn" style="background:#e11d48;color:#fff;">Cancelar</button>
              </form>
            </div>
          </form>
        </div>
      `
    }));
  });
  
  app.post('/admin/bookings/:id/update', requireLogin, (req, res) => {
    const id = req.params.id;
    const b = db.prepare(`
      SELECT b.*, u.capacity, u.base_price_cents
        FROM bookings b JOIN units u ON u.id = b.unit_id
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
  
    const q = rateQuote(db, b.unit_id, checkin, checkout, b.base_price_cents);
    if (q.nights < q.minStayReq) return res.status(400).send(`Estadia mínima: ${q.minStayReq} noites`);
  
    db.prepare(`
      UPDATE bookings
         SET checkin = ?, checkout = ?, adults = ?, children = ?, guest_name = ?, guest_email = ?, guest_phone = ?, guest_nationality = ?, agency = ?, internal_notes = ?, status = ?, total_cents = ?
       WHERE id = ?
    `).run(checkin, checkout, adults, children, guest_name, guest_email, guest_phone, guest_nationality, agency, internal_notes, status, q.total_cents, id);
  
    res.redirect(`/admin/bookings/${id}`);
  });
  
  app.post('/admin/bookings/:id/cancel', requireLogin, (req, res) => {
    const id = req.params.id;
    const exists = db.prepare('SELECT 1 FROM bookings WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('Reserva não encontrada');
    db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    const back = req.get('referer') || '/admin/bookings';
    res.redirect(back);
  });
  
  // (Opcional) Apagar definitivamente
  app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    res.redirect('/admin/bookings');
  });
  
}

module.exports = registerAdminBookingsRoutes;
