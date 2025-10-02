const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const { formatMonthYear, esc } = require('../utils/format');
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

    const monthStart = month.startOf('month');
    const monthEndExclusive = month.endOf('month').add(1, 'day');

    const units = db.prepare(
      'SELECT u.*, p.name as property_name ' +
      'FROM units u JOIN properties p ON p.id = u.property_id ' +
      'ORDER BY p.name, u.name'
    ).all();

    const entriesStmt = db.prepare(`
      SELECT 'BOOKING' AS kind, checkin, checkout, guest_name, adults, children, status
        FROM bookings
       WHERE unit_id = ?
         AND status IN ('CONFIRMED','PENDING')
         AND NOT (checkout <= ? OR checkin >= ?)
      UNION ALL
      SELECT 'BLOCK' AS kind, start_date AS checkin, end_date AS checkout, 'Bloqueado' AS guest_name,
             NULL AS adults, NULL AS children, 'BLOCK' AS status
        FROM blocks
       WHERE unit_id = ?
         AND NOT (end_date <= ? OR start_date >= ?)
      ORDER BY checkin
    `);

    const calendarView = buildUnitCalendars({
      units,
      monthStart,
      monthEndExclusive,
      entriesStmt,
      month,
    });

    res.send(layout({
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
        <style>
          .calendar-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:.8125rem;color:#475569;}
          .calendar-legend span{display:flex;align-items:center;gap:6px;}
          .calendar-swatch{width:12px;height:12px;border-radius:9999px;box-shadow:0 0 0 1px rgba(15,23,42,.08);}
          .calendar-swatch.free{background:#22c55e;}
          .calendar-swatch.confirmed{background:#047857;}
          .calendar-swatch.pending{background:#fbbf24;}
          .calendar-swatch.block{background:#dc2626;}
          .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;}
          .calendar-weekday{font-size:.7rem;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.08em;text-align:center;}
          .unit-calendar-card{background:#fff;border:1px solid #e2e8f0;border-radius:1rem;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,.08);display:flex;flex-direction:column;gap:12px;}
          .unit-calendar-header{display:flex;align-items:center;justify-content:space-between;gap:12px;}
          .unit-calendar-title{font-size:1rem;font-weight:600;color:#1e293b;}
          .unit-calendar-actions a{font-size:.75rem;font-weight:600;color:#475569;text-decoration:none;}
          .unit-calendar-actions a:hover{color:#0f172a;}
          .calendar-cell{position:relative;min-height:56px;border-radius:.6rem;border:1px solid #e2e8f0;background:#f8fafc;padding:6px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;}
          .calendar-cell.other-month{background:#f1f5f9;color:#94a3b8;}
          .calendar-cell .day-number{position:absolute;top:6px;left:6px;font-size:.65rem;font-weight:600;}
          .calendar-cell .cell-label{font-size:.68rem;font-weight:600;line-height:1.2;color:inherit;}
          .calendar-cell.booking{color:#fff;background:transparent;border-color:rgba(14,116,144,.25);}
          .calendar-cell.booking.pending{color:#1f2937;}
          .calendar-cell::after{content:'';position:absolute;inset:4px;border-radius:.4rem;background:transparent;z-index:0;}
          .calendar-cell.booking::after{background-image:linear-gradient(to right,transparent 0,transparent var(--start-offset,0%),var(--cell-color) var(--start-offset,0%),var(--cell-color) calc(100% - var(--end-offset,0%)),transparent calc(100% - var(--end-offset,0%)),transparent 100%);box-shadow:inset 0 0 0 1px rgba(15,23,42,.12);}
          .calendar-cell.booking.start::after{border-top-left-radius:.55rem;border-bottom-left-radius:.55rem;}
          .calendar-cell.booking.end::after{border-top-right-radius:.55rem;border-bottom-right-radius:.55rem;}
          .calendar-cell.booking.single::after{border-radius:.55rem;}
          .calendar-cell.booking .day-number,.calendar-cell.booking .cell-label{position:relative;z-index:1;}
          .calendar-cell.booking.confirmed{--cell-color:#047857;}
          .calendar-cell.booking.pending{--cell-color:#fbbf24;}
          .calendar-cell.booking.block{--cell-color:#dc2626;}
          .calendar-cell.booking.other-month::after{opacity:.65;}
          .calendar-cell.free{color:#16a34a;background:#f0fdf4;border-color:#bbf7d0;}
          .calendar-cell.free .cell-label{font-weight:500;}
          .unit-calendars{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
          @media (max-width:640px){.unit-calendars{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}.calendar-cell{min-height:48px;}}
        </style>
        <div class="calendar-legend mb-4">
          <span><span class="calendar-swatch free"></span> Livre</span>
          <span><span class="calendar-swatch confirmed"></span> Confirmado</span>
          <span><span class="calendar-swatch pending"></span> Pendente</span>
          <span><span class="calendar-swatch block"></span> Bloqueado</span>
          <a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>
        </div>
        ${calendarView}
      `
    }));
  });

  function buildUnitCalendars({ units, monthStart, monthEndExclusive, entriesStmt, month }) {
    const monthEnd = monthEndExclusive.subtract(1, 'day');
    const monthStartIso = monthStart.format('YYYY-MM-DD');
    const monthEndIso = monthEndExclusive.format('YYYY-MM-DD');

    const startWeekday = (monthStart.day() + 6) % 7; // Monday as first day (0)
    const endWeekday = (monthEnd.day() + 6) % 7;
    const gridStart = monthStart.subtract(startWeekday, 'day');
    const gridEnd = monthEnd.add(6 - endWeekday, 'day');
    const gridEndExclusive = gridEnd.add(1, 'day');
    const totalDays = gridEndExclusive.diff(gridStart, 'day');

    const calendarDays = Array.from({ length: totalDays }, (_, idx) => {
      const date = gridStart.add(idx, 'day');
      return {
        date,
        inMonth: date.month() === month.month(),
        dayLabel: date.format('D'),
      };
    });

    const weekdayNames = Array.from({ length: 7 }, (_, idx) => {
      const date = gridStart.add(idx, 'day');
      const weekday = date.locale('pt').format('ddd').replace('.', '');
      return weekday.charAt(0).toUpperCase() + weekday.slice(1);
    });

    const cards = [];
    let lastProperty = null;

    for (const unit of units) {
      const entries = entriesStmt.all(unit.id, monthStartIso, monthEndIso, unit.id, monthStartIso, monthEndIso);
      const occupancy = new Array(totalDays).fill(null);
      const keyForEntry = (entry) => `${entry.kind}:${entry.checkin}:${entry.checkout}:${entry.guest_name || ''}`;

      for (const entry of entries) {
        const entryCheckin = dayjs(entry.checkin);
        const entryCheckout = dayjs(entry.checkout);

        if (!entryCheckout.isAfter(gridStart)) continue;
        if (!entryCheckin.isBefore(gridEndExclusive)) continue;

        const startIndex = Math.max(0, entryCheckin.diff(gridStart, 'day'));
        const endIndex = Math.min(totalDays, entryCheckout.diff(gridStart, 'day'));

        if (startIndex >= endIndex) continue;

        const meta = {
          entry,
          key: keyForEntry(entry),
          startIndex,
          endIndex,
          startsInView: !entryCheckin.isBefore(gridStart),
          endsInView: !entryCheckout.isAfter(gridEndExclusive),
        };

        for (let idx = startIndex; idx < endIndex; idx++) {
          occupancy[idx] = meta;
        }
      }

      const cells = calendarDays.map((calendarDay, idx) => {
        const slot = occupancy[idx];
        if (!slot) {
          const classes = ['calendar-cell'];
          if (!calendarDay.inMonth) classes.push('other-month');
          if (calendarDay.inMonth) {
            classes.push('free');
          }
          return `
            <div class="${classes.join(' ')}">
              <span class="day-number">${calendarDay.dayLabel}</span>
            </div>
          `;
        }

        const entry = slot.entry;
        const status = entry.status;
        const label = status === 'BLOCK' ? 'Bloqueado' : formatBookingLabel(entry);
        const title = buildEntryTitle(entry, label);

        const isSegmentStart = idx === slot.startIndex;
        const isSegmentEnd = idx + 1 === slot.endIndex;
        const isStart = isSegmentStart && slot.startsInView;
        const isEnd = isSegmentEnd && slot.endsInView;
        let startOffset = isStart ? 50 : 0;
        let endOffset = isEnd ? 50 : 0;

        if (isStart && isEnd) {
          startOffset = 25;
          endOffset = 25;
        }

        const classes = ['calendar-cell', 'booking'];
        if (!calendarDay.inMonth) classes.push('other-month');
        classes.push(status.toLowerCase());
        if (isStart) classes.push('start');
        if (isEnd) classes.push('end');
        if (isStart && isEnd) classes.push('single');

        const labelHtml = isSegmentStart && label ? `<div class="cell-label">${esc(label)}</div>` : '';
        const titleAttr = title ? ` title="${esc(title)}"` : '';
        const styleAttr = ` style="--start-offset:${startOffset}%;--end-offset:${endOffset}%"`;

        return `
          <div class="${classes.join(' ')}"${titleAttr}${styleAttr}>
            <span class="day-number">${calendarDay.dayLabel}</span>
            ${labelHtml}
          </div>
        `;
      });

      const weeks = [];
      for (let i = 0; i < cells.length; i += 7) {
        const weekCells = cells.slice(i, i + 7).join('');
        weeks.push(`<div class="calendar-grid">${weekCells}</div>`);
      }

      const unitLabel = unit.property_name === unit.name
        ? esc(unit.name)
        : `${esc(unit.property_name)} · ${esc(unit.name)}`;

      if (lastProperty !== unit.property_name) {
        if (lastProperty !== null) cards.push('</div>');
        const headingClass = lastProperty === null
          ? 'text-lg font-semibold text-slate-700 mb-3'
          : 'text-lg font-semibold text-slate-700 mt-8 mb-3';
        cards.push(`<h2 class="${headingClass}">${esc(unit.property_name)}</h2>`);
        cards.push('<div class="unit-calendars">');
        lastProperty = unit.property_name;
      }

      cards.push(`
        <div class="unit-calendar-card">
          <div class="unit-calendar-header">
            <div class="unit-calendar-title">${unitLabel}</div>
            <div class="unit-calendar-actions"><a href="/admin/units/${unit.id}">Gerir</a></div>
          </div>
          <div class="calendar-grid">
            ${weekdayNames
              .map((weekday) => `<div class="calendar-weekday">${weekday}</div>`)
              .join('')}
          </div>
          ${weeks.join('')}
        </div>
      `);
    }

    if (lastProperty !== null) {
      cards.push('</div>');
    }

    return cards.join('');
  }

  function formatBookingLabel(entry) {
    const parts = [];
    if (entry.guest_name && entry.guest_name !== 'Bloqueado') {
      parts.push(entry.guest_name);
    }
    const counts = [];
    if (typeof entry.adults === 'number' && entry.adults > 0) counts.push(`${entry.adults}A`);
    if (typeof entry.children === 'number' && entry.children > 0) counts.push(`${entry.children}C`);
    if (counts.length) parts.push(`(${counts.join('+')})`);
    return parts.join(' ');
  }

  function buildEntryTitle(entry, label) {
    const start = dayjs(entry.checkin).format('DD/MM/YYYY');
    const end = dayjs(entry.checkout).format('DD/MM/YYYY');
    if (entry.status === 'BLOCK') {
      return `Bloqueado · ${start} → ${end}`;
    }
    const descriptor = label || 'Reserva';
    return `${descriptor} · ${start} → ${end}`;
  }

}

module.exports = registerCalendarRoutes;
