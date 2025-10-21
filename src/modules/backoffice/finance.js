// Centraliza as operações financeiras do backoffice (receitas, tarifários, regras e extras).
const fs = require('fs');
const path = require('path');
const { registerRatePlans } = require('./finance/ratePlans');
const { registerRateRules } = require('./finance/rateRules');
const { registerExtras } = require('./finance/extras');

const financeTemplatePath = path.join(__dirname, '..', '..', 'views', 'backoffice', 'finance.ejs');
let financeTemplateRenderer = null;

function compileEjsTemplate(template) {
  if (!template) return null;
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let index = 0;
  let source = "let __output = '';\n";
  source += 'const __append = value => { __output += value == null ? "" : String(value); };\n';
  source += 'with (locals || {}) {\n';
  let match;
  while ((match = matcher.exec(template)) !== null) {
    const text = template.slice(index, match.index);
    if (text) {
      const escapedText = text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      source += `__output += \`${escapedText}\`;\n`;
    }
    const indicator = match[1];
    const code = match[2];
    if (indicator === '=') {
      source += `__append(${code.trim()});\n`;
    } else if (indicator === '-') {
      source += `__output += (${code.trim()}) ?? '';\n`;
    } else {
      source += `${code}\n`;
    }
    index = match.index + match[0].length;
  }
  const tail = template.slice(index);
  if (tail) {
    const escapedTail = tail
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    source += `__output += \`${escapedTail}\`;\n`;
  }
  source += '}\nreturn __output;';
  try {
    // eslint-disable-next-line no-new-func
    return new Function('locals', source);
  } catch (err) {
    return null;
  }
}

try {
  const financeTemplate = fs.readFileSync(financeTemplatePath, 'utf8');
  financeTemplateRenderer = compileEjsTemplate(financeTemplate);
} catch (err) {
  financeTemplateRenderer = null;
}

function registerFinance(app, context) {
  registerRatePlans(app, context);
  registerRateRules(app, context);
  registerExtras(app, context);

  const {
    db,
    dayjs,
    layout,
    esc,
    eur,
    html,
    resolveBrandingForRequest,
    requireLogin,
    requirePermission
  } = context;

  app.get('/admin/finance', requireLogin, requirePermission('dashboard.view'), (req, res) => {
    const months = [];
    const reference = dayjs().startOf('month');
    for (let i = 11; i >= 0; i -= 1) {
      const start = reference.subtract(i, 'month').startOf('month');
      months.push({
        key: start.format('YYYY-MM'),
        label: start.format('MMM YYYY'),
        start,
        end: start.endOf('month')
      });
    }

    const periodStart = months[0].start;
    const periodEndExclusive = months[months.length - 1].start.add(1, 'month');

    const revenueByMonth = new Map(months.map((m) => [m.key, 0]));
    const nightsByMonth = new Map(months.map((m) => [m.key, 0]));

    const confirmedBookings = db
      .prepare(
        `SELECT checkin, checkout, total_cents
           FROM bookings
          WHERE checkin IS NOT NULL
            AND checkout IS NOT NULL
            AND julianday(checkout) > julianday(?)
            AND julianday(checkin) < julianday(?)
            AND UPPER(status) = 'CONFIRMED'`
      )
      .all(periodStart.format('YYYY-MM-DD'), periodEndExclusive.format('YYYY-MM-DD'));

    confirmedBookings.forEach((booking) => {
      const totalCents = Number(booking.total_cents) || 0;
      const checkin = dayjs(booking.checkin);
      if (checkin.isValid()) {
        const monthKey = checkin.format('YYYY-MM');
        if (revenueByMonth.has(monthKey)) {
          revenueByMonth.set(monthKey, revenueByMonth.get(monthKey) + totalCents);
        }
      }

      const rawStart = dayjs(booking.checkin);
      const rawEnd = dayjs(booking.checkout);
      if (!rawStart.isValid() || !rawEnd.isValid() || !rawEnd.isAfter(rawStart)) {
        return;
      }

      let cursor = dayjs.max(rawStart, periodStart);
      const limit = dayjs.min(rawEnd, periodEndExclusive);
      while (cursor.isBefore(limit)) {
        const key = cursor.format('YYYY-MM');
        if (nightsByMonth.has(key)) {
          nightsByMonth.set(key, nightsByMonth.get(key) + 1);
        }
        cursor = cursor.add(1, 'day');
      }
    });

    const unitsRow = db.prepare('SELECT COUNT(*) AS total FROM units').get();
    const unitsCount = unitsRow && unitsRow.total ? Number(unitsRow.total) : 0;

    const revenueLabels = months.map((m) => m.label);
    const revenueValues = months.map((m) => {
      const cents = revenueByMonth.get(m.key) || 0;
      return Number((cents / 100).toFixed(2));
    });
    const revenueSeries = months.map((m) => {
      const cents = revenueByMonth.get(m.key) || 0;
      return {
        label: m.label,
        cents,
        formatted: `€ ${eur(cents)}`
      };
    });

    const occupancyValues = months.map((m) => {
      const nights = nightsByMonth.get(m.key) || 0;
      const capacity = unitsCount * m.start.daysInMonth();
      if (!capacity) return 0;
      const percent = (nights / capacity) * 100;
      return Math.round(percent * 10) / 10;
    });

    const totalCapacity = months.reduce((acc, m) => acc + unitsCount * m.start.daysInMonth(), 0);
    const totalNightsSold = months.reduce((acc, m) => acc + (nightsByMonth.get(m.key) || 0), 0);
    const averageOccupancy = totalCapacity ? (totalNightsSold / totalCapacity) * 100 : 0;
    const totalRevenueCents = months.reduce((acc, m) => acc + (revenueByMonth.get(m.key) || 0), 0);

    const hasRevenueData = revenueSeries.some((item) => item.cents > 0);
    const hasOccupancyData = totalNightsSold > 0 && unitsCount > 0;

    const chartData = {
      revenue: { labels: revenueLabels, values: revenueValues },
      occupancy: { labels: revenueLabels, values: occupancyValues }
    };
    const chartDataJson = JSON.stringify(chartData).replace(/</g, '\\u003c');

    let bodyContent = null;
    if (financeTemplateRenderer) {
      try {
        bodyContent = financeTemplateRenderer({
          esc,
          revenueSeries,
          revenueLabels,
          revenueValues,
          occupancyValues,
          hasRevenueData,
          hasOccupancyData,
          averageOccupancy: Math.round(averageOccupancy * 10) / 10,
          totalRevenueLabel: `€ ${eur(totalRevenueCents)}`,
          chartDataJson
        });
      } catch (err) {
        bodyContent = null;
      }
    }

    if (!bodyContent) {
      bodyContent = html`
        <div class="bo-page">
          <h1 class="text-2xl font-semibold mb-4">Finanças</h1>
          <p class="text-sm text-slate-600">Não foi possível carregar a vista financeira.</p>
        </div>
      `;
    }

    res.locals.activeNav = '/admin/finance';
    res.send(layout({
      title: 'Finanças',
      user: req.user,
      activeNav: 'finance',
      branding: resolveBrandingForRequest(req),
      pageClass: 'page-backoffice page-finance',
      body: bodyContent
    }));
  });
}

module.exports = { registerFinance };
