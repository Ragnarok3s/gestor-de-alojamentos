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
    const daysInMonth = month.daysInMonth();
    const monthEndExclusive = month.endOf('month').add(1, 'day');

    const days = Array.from({ length: daysInMonth }, (_, idx) => {
      const date = monthStart.add(idx, 'day');
      const weekday = date.locale('pt').format('ddd').replace('.', '');
      return {
        label: date.format('DD'),
        weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
        isWeekend: [0, 6].includes(date.day()),
      };
    });

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

    const calendarRows = buildCalendarRows({
      units,
      days,
      monthStart,
      monthEndExclusive,
      entriesStmt,
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
          .calendar-wrapper{overflow-x:auto;border-radius:.75rem;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.08);}
          table.calendar-table{width:100%;min-width:960px;border-collapse:separate;border-spacing:0;font-size:.75rem;}
          .calendar-table thead th{position:sticky;top:0;background:#f8fafc;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:10px 8px;border-bottom:1px solid #cbd5e1;z-index:2;}
          .calendar-table thead th.day-header{text-transform:none;letter-spacing:0;font-size:.7rem;}
          .calendar-table thead th.day-header span{display:block;line-height:1.1;}
          .calendar-table thead th.day-header span:first-child{font-size:.6rem;text-transform:uppercase;color:#94a3b8;letter-spacing:.1em;}
          .calendar-table thead th.day-header span:last-child{font-size:.85rem;font-weight:700;color:#1f2937;}
          .calendar-table thead th.day-header.weekend{background:#e2e8f0;color:#1f2937;}
          .calendar-table tbody td{border:1px solid #e2e8f0;padding:8px 6px;text-align:center;vertical-align:middle;}
          .calendar-table tbody td.unit-cell{position:sticky;left:0;z-index:1;text-align:left;font-weight:600;color:#1f2937;background:#f8fafc;min-width:220px;font-size:.8125rem;}
          .unit-cell-inner{display:flex;align-items:center;justify-content:space-between;gap:12px;}
          .unit-cell-inner span{display:block;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
          .unit-cell-inner a{font-size:.7rem;color:#475569;text-decoration:none;font-weight:600;}
          .unit-cell-inner a:hover{color:#111827;}
          .calendar-table tbody tr:nth-of-type(odd) td.unit-cell{background:#f1f5f9;}
          .calendar-table tbody tr.property-row td{background:#e2e8f0;color:#1e293b;font-weight:600;text-transform:uppercase;letter-spacing:.08em;}
          .calendar-table tbody td.segment{position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:.72rem;text-align:left;padding:6px 6px;background:#fff;}
          .calendar-table tbody td.segment span{display:block;position:relative;z-index:1;overflow:hidden;text-overflow:ellipsis;padding:0 4px;line-height:1.2;}
          .calendar-table tbody td.segment.start span{padding-left:calc(var(--start-offset, 0%) + 4px);}
          .calendar-table tbody td.segment.end span{padding-right:calc(var(--end-offset, 0%) + 4px);}
          .calendar-table tbody td.segment.free{background:#f8fafc;color:#16a34a;font-weight:500;}
          .calendar-table tbody td.segment.booking{color:#fff;--segment-color:#047857;--start-offset:0%;--end-offset:0%;--span:1;background-image:linear-gradient(to right,transparent 0,transparent var(--start-offset),var(--segment-color) var(--start-offset),var(--segment-color) calc(100% - var(--end-offset)),transparent calc(100% - var(--end-offset)),transparent 100%),repeating-linear-gradient(90deg,rgba(15,23,42,.16) 0,rgba(15,23,42,.16) 1px,transparent 1px,transparent calc(100% / var(--span)));background-repeat:no-repeat,repeat;background-color:transparent;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(15,23,42,.12);}
          .calendar-table tbody td.segment.booking span{color:inherit;}
          .calendar-table tbody td.segment.booking.pending{color:#1f2937;--segment-color:#fbbf24;}
          .calendar-table tbody td.segment.booking.block{--segment-color:#dc2626;}
          @media (max-width:640px){.calendar-wrapper{border-radius:.5rem;} .calendar-table tbody td.unit-cell{position:static;}}
        </style>
        <div class="calendar-legend mb-3">
          <span><span class="calendar-swatch free"></span> Livre</span>
          <span><span class="calendar-swatch confirmed"></span> Confirmado</span>
          <span><span class="calendar-swatch pending"></span> Pendente</span>
          <span><span class="calendar-swatch block"></span> Bloqueado</span>
          <a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>
        </div>
        <div class="calendar-wrapper">
          <table class="calendar-table">
            <thead>
              <tr>
                <th class="unit-heading">Unidade</th>
                ${days
                  .map(
                    (day) => `
                      <th class="day-header${day.isWeekend ? ' weekend' : ''}">
                        <span>${day.weekday}</span>
                        <span>${day.label}</span>
                      </th>
                    `
                  )
                  .join('')}
              </tr>
            </thead>
            <tbody>
              ${calendarRows}
            </tbody>
          </table>
        </div>
      `
    }));
  });

  function buildCalendarRows({ units, days, monthStart, monthEndExclusive, entriesStmt }) {
    const columnCount = days.length + 1;
    const classByStatus = {
      FREE: 'segment free',
      CONFIRMED: 'segment booking confirmed',
      PENDING: 'segment booking pending',
      BLOCK: 'segment booking block',
    };

    const monthEnd = monthEndExclusive.subtract(1, 'day');
    const monthStartIso = monthStart.format('YYYY-MM-DD');
    const monthEndIso = monthEndExclusive.format('YYYY-MM-DD');

    let lastProperty = null;
    const rows = [];

    for (const unit of units) {
      if (lastProperty !== unit.property_name) {
        lastProperty = unit.property_name;
        rows.push(`
          <tr class="property-row">
            <td colspan="${columnCount}">${esc(lastProperty.toUpperCase())}</td>
          </tr>
        `);
      }

      const entries = entriesStmt.all(unit.id, monthStartIso, monthEndIso, unit.id, monthStartIso, monthEndIso);

      const occupancy = new Array(days.length).fill(null);
      const keyForEntry = (entry) => `${entry.kind}:${entry.checkin}:${entry.checkout}:${entry.guest_name || ''}`;

      for (const entry of entries) {
        const entryCheckin = dayjs(entry.checkin);
        const entryCheckout = dayjs(entry.checkout);

        if (!entryCheckout.isAfter(monthStart)) continue;
        if (!entryCheckin.isBefore(monthEndExclusive)) continue;

        const startIndex = Math.max(0, entryCheckin.diff(monthStart, 'day'));
        const endIndex = Math.min(days.length, entryCheckout.diff(monthStart, 'day'));

        if (startIndex >= endIndex) continue;

        const meta = {
          entry,
          key: keyForEntry(entry),
          startIndex,
          endIndex,
          startsInMonth: !entryCheckin.isBefore(monthStart),
          endsInMonth: !entryCheckout.isAfter(monthEnd),
        };

        for (let idx = startIndex; idx < endIndex; idx++) {
          occupancy[idx] = meta;
        }
      }

      const segments = [];
      for (let idx = 0; idx < occupancy.length; ) {
        const slot = occupancy[idx];
        if (!slot) {
          let span = 1;
          while (idx + span < occupancy.length && !occupancy[idx + span]) span++;
          segments.push({ status: 'FREE', span, label: '', title: '' });
          idx += span;
          continue;
        }

        let span = 1;
        while (
          idx + span < occupancy.length &&
          occupancy[idx + span] &&
          occupancy[idx + span].key === slot.key
        ) {
          span++;
        }

        const entry = slot.entry;
        const status = entry.status;
        const label = status === 'BLOCK' ? 'Bloqueado' : formatBookingLabel(entry);
        const title = buildEntryTitle(entry, label);
        const isStart = idx === slot.startIndex && slot.startsInMonth;
        const isEnd = idx + span === slot.endIndex && slot.endsInMonth;
        const halfDay = span > 0 ? 50 / span : 0;
        let startOffset = isStart ? halfDay : 0;
        let endOffset = isEnd ? halfDay : 0;

        if (span === 1 && isStart && isEnd) {
          startOffset = 25;
          endOffset = 25;
        }

        segments.push({ status, span, label, title, isStart, isEnd, startOffset, endOffset });
        idx += span;
      }

      const segmentCells = segments
        .map((segment) => {
          const baseClasses = classByStatus[segment.status] || classByStatus.CONFIRMED;
          const classes = baseClasses.split(' ');
          if (segment.isStart) classes.push('start');
          if (segment.isEnd) classes.push('end');
          if (segment.isStart && segment.isEnd) classes.push('single');
          const cls = classes.join(' ');
          const titleAttr = segment.title ? ` title="${esc(segment.title)}"` : '';
          const content = segment.label ? `<span>${esc(segment.label)}</span>` : '<span>&nbsp;</span>';
          const startOffsetRaw = typeof segment.startOffset === 'number' ? segment.startOffset : 0;
          const endOffsetRaw = typeof segment.endOffset === 'number' ? segment.endOffset : 0;
          const startOffset = Math.round(startOffsetRaw * 10000) / 10000;
          const endOffset = Math.round(endOffsetRaw * 10000) / 10000;
          const styleAttr =
            segment.status === 'FREE'
              ? ''
              : ` style="--span:${segment.span};--start-offset:${startOffset}%;--end-offset:${endOffset}%"`;
          return `<td class="${cls}" colspan="${segment.span}"${titleAttr}${styleAttr}>${content}</td>`;
        })
        .join('');

      const unitLabel = unit.property_name === unit.name
        ? esc(unit.name)
        : `${esc(unit.property_name)} · ${esc(unit.name)}`;

      rows.push(`
        <tr>
          <td class="unit-cell"><div class="unit-cell-inner"><span>${unitLabel}</span><a href="/admin/units/${unit.id}">Gerir</a></div></td>
          ${segmentCells}
        </tr>
      `);
    }

    return rows.join('');
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
