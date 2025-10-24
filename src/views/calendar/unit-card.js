'use strict';

function renderUnitCard({
  unit,
  month,
  bookingRows,
  unitBlocks,
  legacyBlocks,
  notesMeta,
  dayjs,
  esc,
  overlaps
}) {
  const monthStart = month.startOf('month');
  const daysInMonth = month.daysInMonth();
  const weekdayOfFirst = (monthStart.day() + 6) % 7;
  const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

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

  const noteCounts = notesMeta ? notesMeta.counts : new Map();
  const noteLatest = notesMeta ? notesMeta.latest : new Map();

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
      `data-unit="${unit.id}"`,
      `data-date="${date}"`,
      `data-in-month="${inMonth ? 1 : 0}"`
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

  const weekdayHeader = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
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
    ? ` <span class="bo-status-badge bo-status-badge--warning" data-block-badge="${unit.id}" title="${esc(
          'Bloqueado ' + badgeSummaries.join(', ')
        )}">Bloqueado</span>`
    : ` <span class="bo-status-badge bo-status-badge--warning hidden" data-block-badge="${unit.id}" hidden>Bloqueado</span>`;

  return `
      <div class="card p-4 calendar-card" data-unit-card="${unit.id}" data-unit-name="${esc(unit.name)}">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm text-slate-500">${unit.property_name}</div>
            <h3 class="text-lg font-semibold">${esc(unit.name)}${blockBadge}</h3>
          </div>
          <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${unit.id}">Gerir</a>
        </div>
        <div class="calendar-grid mb-1">${weekdayHeader}</div>
        <div class="calendar-grid" data-calendar-unit="${unit.id}">${cells.join('')}</div>
      </div>
    `;
}

module.exports = { renderUnitCard };
