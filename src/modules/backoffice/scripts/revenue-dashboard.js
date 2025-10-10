(function () {
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (window.__chartJsPromise) return window.__chartJsPromise;
    window.__chartJsPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
      script.async = true;
      script.onload = function () {
        if (window.Chart) {
          resolve(window.Chart);
        } else {
          reject(new Error('Chart.js not available after loading.'));
        }
      };
      script.onerror = function () {
        reject(new Error('Failed to load Chart.js'));
      };
      document.head.appendChild(script);
    });
    return window.__chartJsPromise;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showChartFallback() {
    var fallback = document.querySelector('[data-revenue-chart-fallback]');
    if (fallback) fallback.hidden = false;
  }

  function getComputedVar(token, fallback) {
    var value = '';
    try {
      value = getComputedStyle(document.documentElement).getPropertyValue(token) || '';
      if (!value && document.body) {
        value = getComputedStyle(document.body).getPropertyValue(token) || '';
      }
    } catch (err) {
      value = '';
    }
    value = (value || '').trim();
    return value || fallback || '';
  }

  function isDarkThemeActive() {
    var root = document.documentElement;
    if (root && root.dataset && root.dataset.theme === 'dark') return true;
    return document.body && document.body.classList && document.body.classList.contains('theme-night');
  }

  function hexToRgba(color, alpha) {
    var hex = (color || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return color;
    var normalized = hex.slice(1);
    if (normalized.length === 3) {
      normalized = normalized
        .split('')
        .map(function (ch) {
          return ch + ch;
        })
        .join('');
    }
    var num = parseInt(normalized, 16);
    var r = (num >> 16) & 255;
    var g = (num >> 8) & 255;
    var b = num & 255;
    var clampedAlpha = typeof alpha === 'number' ? Math.max(0, Math.min(1, alpha)) : 1;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clampedAlpha + ')';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var dataEl = document.getElementById('revenue-analytics-data');
    if (!dataEl) return;

    var payload;
    try {
      payload = JSON.parse(dataEl.textContent || '{}');
    } catch (err) {
      console.error('Painel de revenue: payload inválido', err);
      return;
    }

    var summary = payload.summary || {};
    var daily = Array.isArray(payload.daily) ? payload.daily : [];
    var channels = Array.isArray(payload.channels) ? payload.channels : [];

    var currencyFormatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
    var percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    var numberFormatter = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
    var decimalFormatter = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    var metricMap = {
      revenue: currencyFormatter.format((summary.revenueCents || 0) / 100),
      adr: currencyFormatter.format((summary.adrCents || 0) / 100),
      revpar: currencyFormatter.format((summary.revparCents || 0) / 100),
      occupancy: percentFormatter.format(summary.occupancyRate || 0),
      nights: numberFormatter.format(summary.nights || 0),
      reservations: numberFormatter.format(summary.reservations || 0),
      averageStay: decimalFormatter.format(summary.averageStay || 0),
      bookingPace: decimalFormatter.format(summary.bookingPace || 0)
    };

    Object.keys(metricMap).forEach(function (key) {
      var el = document.querySelector('[data-revenue-metric="' + key + '"]');
      if (el) el.textContent = metricMap[key];
    });

    if (payload.range && payload.range.label) {
      var rangeEl = document.querySelector('[data-revenue-range]');
      if (rangeEl) rangeEl.textContent = payload.range.label;
    }

    var tableBody = document.getElementById('revenue-daily-table');
    if (tableBody) {
      if (daily.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-sm text-center text-slate-500">Sem dados de revenue para o período analisado.</td></tr>';
      } else {
        tableBody.innerHTML = daily
          .map(function (day) {
            var revenueLabel = currencyFormatter.format((day.revenueCents || 0) / 100);
            var adrLabel = day.nightsSold ? currencyFormatter.format((day.adrCents || 0) / 100) : '—';
            var revparLabel = currencyFormatter.format((day.revparCents || 0) / 100);
            var occupancyLabel = day.nightsSold ? percentFormatter.format(day.occupancyRate || 0) : '—';
            var nightsLabel = numberFormatter.format(day.nightsSold || 0);
            var bookingsLabel = numberFormatter.format(day.bookingsCount || 0);
            var averageStayLabel = day.bookingsCount ? decimalFormatter.format(day.averageStay || 0) : '—';
            var bookingPaceLabel = day.createdCount ? numberFormatter.format(day.createdCount || 0) : '—';
            return (
              '<tr>' +
              '<td data-label="Data"><span class="table-cell-value">' + escapeHtml(day.display || day.label || '') + '</span></td>' +
              '<td data-label="Receita">' + revenueLabel + '</td>' +
              '<td data-label="ADR">' + adrLabel + '</td>' +
              '<td data-label="RevPAR">' + revparLabel + '</td>' +
              '<td data-label="Ocupação">' + occupancyLabel + '</td>' +
              '<td data-label="Reservas">' + bookingsLabel + '</td>' +
              '<td data-label="Noites">' + nightsLabel + '</td>' +
              '<td data-label="Estadia média">' + averageStayLabel + '</td>' +
              '<td data-label="Booking pace">' + bookingPaceLabel + '</td>' +
              '</tr>'
            );
          })
          .join('');
      }
    }

    var channelLegend = document.getElementById('revenue-channel-legend');
    if (channelLegend) {
      if (channels.length === 0) {
        channelLegend.innerHTML = '<li class="text-sm text-slate-500">Sem dados de canais disponíveis.</li>';
      } else {
        var channelTotal = channels.reduce(function (sum, item) {
          return sum + (item.revenueCents || 0);
        }, 0);
        channelLegend.innerHTML = channels
          .map(function (item, index) {
            var pct = channelTotal ? (item.revenueCents || 0) / channelTotal : 0;
            return (
              '<li class="flex items-center justify-between gap-3">' +
              '<div>' +
              '<div class="font-semibold text-slate-700">' + escapeHtml(item.name || '') + '</div>' +
              '<div class="text-xs text-slate-500">' + currencyFormatter.format((item.revenueCents || 0) / 100) + '</div>' +
              '</div>' +
              '<div class="text-sm font-semibold text-slate-600">' + percentFormatter.format(pct) + '</div>' +
              '</li>'
            );
          })
          .join('');
      }
    }

    ensureChartJs()
      .then(function (Chart) {
        var labels = daily.map(function (day) {
          return day.label || day.date;
        });
        var revenueData = daily.map(function (day) {
          return Number(((day.revenueCents || 0) / 100).toFixed(2));
        });
        var nightsData = daily.map(function (day) {
          return day.nightsSold || 0;
        });
        var occupancyData = daily.map(function (day) {
          return Math.round((day.occupancyRate || 0) * 1000) / 10;
        });
        var channelLabels = channels.map(function (item) {
          return item.name || '';
        });
        var channelValues = channels.map(function (item) {
          return Number(((item.revenueCents || 0) / 100).toFixed(2));
        });

        var chartPrimary = getComputedVar('--chart-1', '#1F82FF');
        var chartAccent = getComputedVar('--chart-2', '#FF8A3D');
        var chartSuccess = getComputedVar('--chart-3', '#22C55E');
        var chartInfo = getComputedVar('--chart-4', '#06B6D4');
        var chartWarning = getComputedVar('--chart-5', '#F59E0B');
        var colorPalette = [chartPrimary, chartAccent, chartSuccess, chartInfo, chartWarning];

        if (isDarkThemeActive()) {
          var defaultText = getComputedVar('--text', '#E6EEFF');
          var defaultBorder = getComputedVar('--border', '#20304D');
          Chart.defaults.color = defaultText || Chart.defaults.color;
          Chart.defaults.borderColor = defaultBorder || Chart.defaults.borderColor;
          if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
            Chart.defaults.plugins.legend.labels.color = defaultText || Chart.defaults.plugins.legend.labels.color;
          }
          if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
            Chart.defaults.plugins.tooltip.titleColor = defaultText || Chart.defaults.plugins.tooltip.titleColor;
            Chart.defaults.plugins.tooltip.bodyColor = defaultText || Chart.defaults.plugins.tooltip.bodyColor;
          }
        }

        var revenueCtx = document.getElementById('revenue-line-chart');
        if (revenueCtx && labels.length) {
          new Chart(revenueCtx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [
                {
                  type: 'line',
                  label: 'Receita (EUR)',
                  data: revenueData,
                  borderColor: chartPrimary,
                  backgroundColor: hexToRgba(chartPrimary, 0.18),
                  pointRadius: 0,
                  tension: 0.3,
                  fill: true,
                  yAxisID: 'y'
                },
                {
                  type: 'bar',
                  label: 'Noites vendidas',
                  data: nightsData,
                  backgroundColor: hexToRgba(chartWarning, 0.6),
                  borderColor: chartWarning,
                  borderRadius: 6,
                  yAxisID: 'y1'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      if (context.datasetIndex === 0) {
                        return 'Receita: ' + currencyFormatter.format(context.parsed.y);
                      }
                      return 'Noites: ' + numberFormatter.format(context.parsed.y);
                    }
                  }
                }
              },
              scales: {
                x: {
                  ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
                  grid: { display: false }
                },
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: function (value) {
                      return currencyFormatter.format(value);
                    }
                  }
                },
                y1: {
                  beginAtZero: true,
                  grid: { drawOnChartArea: false },
                  ticks: {
                    callback: function (value) {
                      return numberFormatter.format(value);
                    }
                  }
                }
              }
            }
          });
        }

        var occupancyCtx = document.getElementById('revenue-occupancy-chart');
        if (occupancyCtx && labels.length) {
          new Chart(occupancyCtx, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [
                {
                  label: 'Ocupação (%)',
                  data: occupancyData,
                  backgroundColor: hexToRgba(chartSuccess, 0.6),
                  borderColor: chartSuccess,
                  borderRadius: 6
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      return 'Ocupação: ' + percentFormatter.format((context.parsed.y || 0) / 100);
                    }
                  }
                }
              },
              scales: {
                x: {
                  ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
                  grid: { display: false }
                },
                y: {
                  beginAtZero: true,
                  suggestedMax: 100,
                  ticks: {
                    callback: function (value) {
                      return numberFormatter.format(value) + '%';
                    }
                  }
                }
              }
            }
          });
        }

        var channelCtx = document.getElementById('revenue-channel-chart');
        if (channelCtx && channelLabels.length) {
          new Chart(channelCtx, {
            type: 'doughnut',
            data: {
              labels: channelLabels,
              datasets: [
                {
                  data: channelValues,
                  backgroundColor: channelLabels.map(function (_, index) {
                    return colorPalette[index % colorPalette.length];
                  }),
                  borderWidth: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      var label = context.label || '';
                      var value = context.parsed || 0;
                      var meta = context.chart.getDatasetMeta(context.datasetIndex);
                      var total = meta && meta.total ? meta.total : 0;
                      var pct = total ? value / total : 0;
                      return label + ': ' + currencyFormatter.format(value) + ' (' + percentFormatter.format(pct) + ')';
                    }
                  }
                }
              }
            }
          });
        }
      })
      .catch(function (err) {
        console.error('Painel de revenue: não foi possível carregar os gráficos', err);
        showChartFallback();
      });
  });
})();
