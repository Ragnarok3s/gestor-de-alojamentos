const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { formatMonthYear } = require('../utils/format');
const { overlaps } = require('../services/booking');
const layout = require('../views/layout');

function registerCalendarRoutes(app, { db, requireLogin }) {
  if (!requireLogin) throw new Error('requireLogin middleware is required for calendar routes');

  // ===================== Calendário (privado) =====================
  app.get('/calendar', requireLogin, (req, res) => {
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
  
    res.send(layout({
      title: 'Mapa de Reservas',
      user: req.user,
      activeNav: 'calendar',
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
          <a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>
        </div>
        <div class="space-y-6">
          ${units.map(u => unitCalendarCard(u, month)).join('')}
        </div>
      `
    }));
  });
  
  function unitCalendarCard(u, month) {
    const monthStart = month.startOf('month');
    const daysInMonth = month.daysInMonth();
    const weekdayOfFirst = (monthStart.day() + 6) % 7;
    const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;
  
    const entries = db.prepare(
      `SELECT 'B' as t, checkin as s, checkout as e, (guest_name || ' (' || adults || 'A+' || children || 'C)') as label, status
         FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
       UNION ALL
       SELECT 'X' as t, start_date as s, end_date as e, 'BLOQUEADO' as label, 'BLOCK' as status
         FROM blocks WHERE unit_id = ?`
    ).all(u.id, u.id);
  
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayIndexInMonth = i - weekdayOfFirst + 1;
      const inMonth = dayIndexInMonth >= 1 && dayIndexInMonth <= daysInMonth;
      const d = inMonth
        ? monthStart.date(dayIndexInMonth)
        : (i < weekdayOfFirst
            ? monthStart.subtract(weekdayOfFirst - i, 'day')
            : monthStart.add(dayIndexInMonth - daysInMonth, 'day'));
  
      const date = d.format('YYYY-MM-DD');
      const nextDate = d.add(1, 'day').format('YYYY-MM-DD');
  
      const hit = entries.find(en => overlaps(en.s, en.e, date, nextDate));
      let cls = !inMonth ? 'bg-slate-100 text-slate-400' : 'bg-emerald-500 text-white'; // livre
      if (hit) {
        if (hit.status === 'BLOCK') cls = 'bg-red-600 text-white';
        else if (hit.status === 'PENDING') cls = 'bg-amber-400 text-black';
        else cls = 'bg-rose-500 text-white'; // CONFIRMED
      }
  
      const title = hit ? ` title="${(hit.label || '').replace(/"/g, "'")}"` : '';
      cells.push(`<div class="h-12 sm:h-14 flex items-center justify-center rounded ${cls} text-xs sm:text-sm"${title}>${d.date()}</div>`);
    }
  
    const weekdayHeader = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']
      .map(w => `<div class="text-center text-xs text-slate-500 py-1">${w}</div>`)
      .join('');
    return `
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm text-slate-500">${u.property_name}</div>
            <h3 class="text-lg font-semibold">${u.name}</h3>
          </div>
          <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${u.id}">Gerir</a>
        </div>
        <div class="grid grid-cols-7 gap-1 mb-1">${weekdayHeader}</div>
        <div class="grid grid-cols-7 gap-1">${cells.join('')}</div>
      </div>
    `;
  }
  
}

module.exports = registerCalendarRoutes;
