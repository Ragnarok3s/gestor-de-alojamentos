const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { formatMonthYear, esc } = require('../utils/format');
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

    const units = db
      .prepare(
        'SELECT u.*, p.name as property_name ' +
          'FROM units u JOIN properties p ON p.id = u.property_id ' +
          'ORDER BY p.name, u.name'
      )
      .all();

    const cards = units.map((unit) => unitCalendarCard(unit, month)).join('');

    res.send(
      layout({
        title: 'Mapa de Reservas',
        user: req.user,
        activeNav: 'calendar',
        activeBackofficeNav: 'calendar',
        body: html`
          <h1 class="text-2xl font-semibold mb-4">Mapa de Reservas</h1>
          <div class="flex items-center justify-between mb-4">
            <a class="btn btn-muted" href="/calendar?ym=${prev}">Mês anterior: ${formatMonthYear(prev + '-01')}</a>
            <div class="text-slate-600">Mês de ${formatMonthYear(month)}</div>
            <a class="btn btn-muted" href="/calendar?ym=${next}">Mês seguinte: ${formatMonthYear(next + '-01')}</a>
          </div>
          <div class="text-sm mb-3 flex gap-3 items-center">
            <span class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded bg-emerald-500"></span> Livre</span>
            <span class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded bg-rose-500"></span> Ocupado</span>
            <span class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded bg-amber-400"></span> Pendente</span>
            <span class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded bg-red-600"></span> Bloqueado</span>
            <span class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded bg-slate-200"></span> Fora do mês</span>
            <a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>
          </div>
          <div class="space-y-6">
            ${cards}
          </div>
        `,
      })
    );
  });

  function unitCalendarCard(unit, month) {
    const monthStart = month.startOf('month');
    const daysInMonth = month.daysInMonth();
    const weekdayOfFirst = (monthStart.day() + 6) % 7; // Monday first
    const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

    const entries = db
      .prepare(
        `SELECT 'BOOKING' as kind, checkin as s, checkout as e, guest_name, adults, children, status
           FROM bookings
          WHERE unit_id = ?
            AND status IN ('CONFIRMED','PENDING')
         UNION ALL
         SELECT 'BLOCK' as kind, start_date as s, end_date as e, 'Bloqueado' as guest_name, NULL as adults, NULL as children, 'BLOCK' as status
           FROM blocks
          WHERE unit_id = ?`
      )
      .all(unit.id, unit.id);

    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayIndexInMonth = i - weekdayOfFirst + 1;
      const inMonth = dayIndexInMonth >= 1 && dayIndexInMonth <= daysInMonth;
      const dateObj = inMonth
        ? monthStart.date(dayIndexInMonth)
        : i < weekdayOfFirst
        ? monthStart.subtract(weekdayOfFirst - i, 'day')
        : monthStart.add(dayIndexInMonth - daysInMonth, 'day');

      const date = dateObj.format('YYYY-MM-DD');
      const nextDate = dateObj.add(1, 'day').format('YYYY-MM-DD');

      const hit = entries.find((entry) => overlaps(entry.s, entry.e, date, nextDate));
      const baseClasses = [
        'h-12',
        'sm:h-14',
        'flex',
        'items-center',
        'justify-center',
        'rounded',
        'text-xs',
        'sm:text-sm',
        'border',
        'border-slate-300',
      ];

      if (!inMonth) {
        baseClasses.push('bg-slate-100', 'text-slate-400');
      } else if (!hit) {
        baseClasses.push('bg-emerald-500', 'text-white');
      } else if (hit.status === 'BLOCK') {
        baseClasses.push('bg-red-600', 'text-white');
      } else if (hit.status === 'PENDING') {
        baseClasses.push('bg-amber-400', 'text-black');
      } else {
        baseClasses.push('bg-rose-500', 'text-white');
      }

      const title = hit ? ` title="${esc(formatCellTitle(hit))}"` : '';
      cells.push(`<div class="${baseClasses.join(' ')}"${title}>${esc(String(dateObj.date()))}</div>`);
    }

    const weekdayHeader = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
      .map((weekday) => `<div class="text-center text-xs text-slate-500 py-1">${weekday}</div>`)
      .join('');

    return `
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm text-slate-500">${esc(unit.property_name)}</div>
            <h3 class="text-lg font-semibold">${esc(unit.name)}</h3>
          </div>
          <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${unit.id}">Gerir</a>
        </div>
        <div class="grid grid-cols-7 gap-1 mb-1">${weekdayHeader}</div>
        <div class="grid grid-cols-7 gap-1">${cells.join('')}</div>
      </div>
    `;
  }

  function formatCellTitle(entry) {
    if (entry.status === 'BLOCK') {
      return 'Bloqueado';
    }

    const parts = [];
    if (entry.guest_name) parts.push(entry.guest_name);
    const counts = [];
    if (typeof entry.adults === 'number' && entry.adults > 0) counts.push(`${entry.adults}A`);
    if (typeof entry.children === 'number' && entry.children > 0) counts.push(`${entry.children}C`);
    if (counts.length) parts.push(`(${counts.join('+')})`);
    return parts.join(' ');
  }
}

module.exports = registerCalendarRoutes;
