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

    function readCssVar(name, fallback) {
      try {
        var styles = getComputedStyle(document.documentElement);
        var value = styles.getPropertyValue(name);
        return value && value.trim() ? value.trim() : fallback;
      } catch (err) {
        return fallback;
      }
    }

    function getPalette() {
      return {
        chartColors: {
          revenueLine: readCssVar('--chart-1', '#2563eb'),
          revenueFill: readCssVar('--chart-1-soft', 'rgba(37, 99, 235, 0.15)'),
          nightsBar: readCssVar('--chart-3-soft', 'rgba(249, 115, 22, 0.6)'),
          occupancyBar: readCssVar('--chart-2', '#22c55e')
        },
        channelPalette: [
          readCssVar('--chart-1', '#2563eb'),
          readCssVar('--chart-2', '#22c55e'),
          readCssVar('--chart-3', '#f97316'),
          readCssVar('--chart-4', '#0ea5e9'),
          readCssVar('--chart-5', '#a855f7'),
          readCssVar('--chart-6', '#ef4444'),
          readCssVar('--chart-7', '#14b8a6')
        ]
      };
    }

    var palette = getPalette();
    var charts = { revenue: null, occupancy: null, channel: null };

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

        var revenueCtx = document.getElementById('revenue-line-chart');
        if (revenueCtx && labels.length) {
          charts.revenue = new Chart(revenueCtx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [
                {
                  type: 'line',
                  label: 'Receita (EUR)',
                  data: revenueData,
                  borderColor: palette.chartColors.revenueLine,
                  backgroundColor: palette.chartColors.revenueFill,
                  pointRadius: 0,
                  tension: 0.3,
                  fill: true,
                  yAxisID: 'y'
                },
                {
                  type: 'bar',
                  label: 'Noites vendidas',
                  data: nightsData,
                  backgroundColor: palette.chartColors.nightsBar,
                  borderColor: palette.chartColors.nightsBar,
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
          charts.occupancy = new Chart(occupancyCtx, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [
                {
                  label: 'Ocupação (%)',
                  data: occupancyData,
                  backgroundColor: palette.chartColors.occupancyBar,
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
          charts.channel = new Chart(channelCtx, {
            type: 'doughnut',
            data: {
              labels: channelLabels,
              datasets: [
                {
                  data: channelValues,
                  backgroundColor: channelLabels.map(function (_, index) {
                    return palette.channelPalette[index % palette.channelPalette.length];
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

        function applyChartTheme() {
          palette = getPalette();
          if (charts.revenue) {
            var revenueDatasets = charts.revenue.data.datasets || [];
            if (revenueDatasets[0]) {
              revenueDatasets[0].borderColor = palette.chartColors.revenueLine;
              revenueDatasets[0].backgroundColor = palette.chartColors.revenueFill;
            }
            if (revenueDatasets[1]) {
              revenueDatasets[1].backgroundColor = palette.chartColors.nightsBar;
              revenueDatasets[1].borderColor = palette.chartColors.nightsBar;
            }
            charts.revenue.update('none');
          }
          if (charts.occupancy) {
            var occupancyDatasets = charts.occupancy.data.datasets || [];
            if (occupancyDatasets[0]) {
              occupancyDatasets[0].backgroundColor = palette.chartColors.occupancyBar;
            }
            charts.occupancy.update('none');
          }
          if (charts.channel) {
            var channelDataset = charts.channel.data.datasets && charts.channel.data.datasets[0];
            if (channelDataset) {
              channelDataset.backgroundColor = channelDataset.data.map(function (_, index) {
                return palette.channelPalette[index % palette.channelPalette.length];
              });
            }
            charts.channel.update('none');
          }
        }

        applyChartTheme();

        var themeObserver = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i += 1) {
            if (mutations[i].type === 'attributes') {
              applyChartTheme();
              break;
            }
          }
        });

        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      })
      .catch(function (err) {
        console.error('Painel de revenue: não foi possível carregar os gráficos', err);
        showChartFallback();
      });
  });
})();
