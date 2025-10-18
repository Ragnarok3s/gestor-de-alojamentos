(function () {
  function formatCurrency(cents) {
    var value = Number.isFinite(cents) ? cents / 100 : 0;
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  }

  function formatPercent(value) {
    var pct = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('pt-PT', {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(pct);
  }

  function formatDecimal(value) {
    var num = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('pt-PT', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(num);
  }

  function formatInteger(value) {
    var num = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(num);
  }

  function parsePickupWindows(value) {
    if (!value) return [];
    return String(value)
      .split(',')
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);
  }

  function joinPickupSummary(pickups, windowsOrder) {
    if (!pickups) return '—';
    var labels = [];
    (windowsOrder || Object.keys(pickups)).forEach(function (window) {
      if (!Object.prototype.hasOwnProperty.call(pickups, window)) return;
      labels.push(window + 'd: ' + formatInteger(pickups[window] || 0));
    });
    return labels.length ? labels.join(' · ') : '—';
  }

  function renderAlertBadges(alerts, details) {
    if (!Array.isArray(alerts) || alerts.length === 0) return '<span class="text-slate-500">—</span>';
    var labels = {
      gap: 'Sem reservas',
      underpricing: 'Preço baixo',
      overpricing: 'Preço alto'
    };
    return alerts
      .map(function (alert, index) {
        var type = alert && alert.type ? alert.type : 'generic';
        var label = labels[type] || 'Alerta';
        var detail = Array.isArray(details) ? details[index] || '' : '';
        var title = detail ? ' title="' + detail.replace(/"/g, '&quot;') + '"' : '';
        var toneClass =
          type === 'gap'
            ? 'bg-amber-100 text-amber-800'
            : type === 'underpricing'
            ? 'bg-emerald-100 text-emerald-900'
            : type === 'overpricing'
            ? 'bg-rose-100 text-rose-900'
            : 'bg-slate-200 text-slate-700';
        return '<span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ' + toneClass + '"' + title + '>' + label + '</span>';
      })
      .join(' ');
  }

  function resetTable(tableBody) {
    if (tableBody) {
      tableBody.innerHTML = '';
    }
  }

  function showLoading(el, visible) {
    if (!el) return;
    el.hidden = !visible;
  }

  function showError(el, message) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function renderSummary(summaryEl, summary, pickupWindows) {
    if (!summaryEl) return;
    if (!summary) {
      summaryEl.innerHTML = '';
      return;
    }
    var occupancy = formatPercent(summary.occupancyRate || 0);
    var adr = formatCurrency(summary.adrCents || 0);
    var revpar = formatCurrency(summary.revparCents || 0);
    var revenue = formatCurrency(summary.revenueCents || 0);
    var nights = formatInteger(summary.nightsSold || 0);
    var pickupLabel = joinPickupSummary(summary.pickupTotals || {}, pickupWindows);

    var alerts = summary.alertTotals || {};
    var alertBadges = Object.keys(alerts)
      .filter(function (key) {
        return alerts[key] > 0;
      })
      .map(function (key) {
        var label;
        if (key === 'gap') label = 'Dias sem reservas';
        else if (key === 'underpricing') label = 'Possível subpricing';
        else if (key === 'overpricing') label = 'Possível overpricing';
        else label = key;
        return (
          '<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">' +
          label +
          ': ' +
          formatInteger(alerts[key]) +
          '</span>'
        );
      })
      .join(' ');

    summaryEl.innerHTML = [
      '<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">',
      '<div><div class="text-sm text-slate-500">Receita total</div><div class="text-lg font-semibold text-slate-900">' +
        revenue +
        '</div></div>',
      '<div><div class="text-sm text-slate-500">Ocupação média</div><div class="text-lg font-semibold text-slate-900">' +
        occupancy +
        '</div></div>',
      '<div><div class="text-sm text-slate-500">ADR médio</div><div class="text-lg font-semibold text-slate-900">' +
        adr +
        '</div></div>',
      '<div><div class="text-sm text-slate-500">RevPAR médio</div><div class="text-lg font-semibold text-slate-900">' +
        revpar +
        '</div></div>',
      '<div><div class="text-sm text-slate-500">Noites vendidas</div><div class="text-lg font-semibold text-slate-900">' +
        nights +
        '</div></div>',
      '<div class="sm:col-span-2"><div class="text-sm text-slate-500">Pickups no período</div><div class="text-lg font-semibold text-slate-900">' +
        pickupLabel +
        '</div></div>',
      alerts ? '<div class="sm:col-span-2 flex flex-wrap gap-2">' + (alertBadges || '<span class="text-sm text-slate-500">Sem alertas para o período.</span>') + '</div>' : '',
      '</div>'
    ].join('');
  }

  function renderTable(tableBody, days, pickupWindows) {
    if (!tableBody) return;
    if (!Array.isArray(days) || days.length === 0) {
      tableBody.innerHTML =
        '<tr><td colspan="9" class="py-6 text-center text-sm text-slate-500">Sem dados disponíveis para o intervalo selecionado.</td></tr>';
      return;
    }

    tableBody.innerHTML = days
      .map(function (day) {
        var pickupText = joinPickupSummary(day.pickups || {}, pickupWindows);
        return (
          '<tr>' +
          '<td data-label="Data"><div class="font-semibold text-slate-900">' +
          day.display +
          '</div><div class="text-xs text-slate-500">' +
          (day.weekday || '') +
          '</div></td>' +
          '<td data-label="Ocupação">' +
          formatPercent(day.occupancyRate || 0) +
          '</td>' +
          '<td data-label="Receita">' +
          formatCurrency(day.revenueCents || 0) +
          '</td>' +
          '<td data-label="ADR">' +
          (day.nightsSold ? formatCurrency(day.adrCents || 0) : '—') +
          '</td>' +
          '<td data-label="RevPAR">' +
          formatCurrency(day.revparCents || 0) +
          '</td>' +
          '<td data-label="Reservas">' +
          formatInteger(day.bookingsCount || 0) +
          '</td>' +
          '<td data-label="Noites vendidas">' +
          formatInteger(day.nightsSold || 0) +
          '</td>' +
          '<td data-label="Pickups">' +
          pickupText +
          '</td>' +
          '<td data-label="Alertas">' +
          renderAlertBadges(day.alerts, day.alertDetails) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('[data-revenue-calendar-form]');
    if (!form) return;

    var tableBody = document.querySelector('[data-revenue-calendar-table]');
    var summaryEl = document.querySelector('[data-revenue-calendar-summary]');
    var loadingEl = document.querySelector('[data-revenue-calendar-loading]');
    var errorEl = document.querySelector('[data-revenue-calendar-error]');
    var rangeEl = document.querySelector('[data-revenue-calendar-range]');
    var refreshButton = document.querySelector('[data-revenue-calendar-refresh]');

    function serializeForm() {
      var data = new FormData(form);
      var params = new URLSearchParams();
      data.forEach(function (value, key) {
        if (key === 'pickupWindows') {
          var windows = parsePickupWindows(value);
          if (windows.length) {
            params.set(key, windows.join(','));
          }
        } else if (value) {
          params.set(key, value);
        }
      });
      return params;
    }

    function fetchData() {
      showLoading(loadingEl, true);
      showError(errorEl, '');
      resetTable(tableBody);
      if (summaryEl) summaryEl.innerHTML = '';

      var params = serializeForm();
      fetch('/admin/api/revenue/calendar?' + params.toString(), {
        headers: {
          Accept: 'application/json'
        }
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Não foi possível obter os dados (HTTP ' + response.status + ').');
          }
          return response.json();
        })
        .then(function (payload) {
          if (!payload || payload.ok === false) {
            throw new Error((payload && payload.error) || 'Ocorreu um erro a processar os dados.');
          }
          var pickupWindows = Array.isArray(payload.pickupWindows)
            ? payload.pickupWindows.map(function (item) {
                return String(item);
              })
            : [];
          if (rangeEl && payload.range) {
            rangeEl.textContent = payload.range.start + ' a ' + payload.range.end;
          }
          renderSummary(summaryEl, payload.summary, pickupWindows);
          renderTable(tableBody, payload.days, pickupWindows);
        })
        .catch(function (err) {
          console.error('Calendário de receita: falha ao carregar dados', err);
          showError(errorEl, err.message || 'Ocorreu um erro a carregar o calendário.');
        })
        .finally(function () {
          showLoading(loadingEl, false);
        });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      fetchData();
    });

    if (refreshButton) {
      refreshButton.addEventListener('click', function (event) {
        event.preventDefault();
        fetchData();
      });
    }

    fetchData();
  });
})();
