const ExcelJS = require('exceljs');

const dayjs = require('../config/dayjs');
const html = require('../utils/html');
const layout = require('../views/layout');

function registerExportRoutes(app, { db, requireLogin }) {
  if (!requireLogin) throw new Error('requireLogin middleware is required for export routes');

  // ===================== Export Excel (privado) =====================
  app.get('/admin/export', requireLogin, (req,res)=>{
    const ymDefault = dayjs().format('YYYY-MM');
    res.send(layout({
      title: 'Exportar Mapa (Excel)',
      user: req.user,
      activeNav: 'export',
      activeBackofficeNav: 'calendar',
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
  app.get('/admin/export/download', requireLogin, async (req, res) => {
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
  
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  });
  
}

module.exports = registerExportRoutes;
