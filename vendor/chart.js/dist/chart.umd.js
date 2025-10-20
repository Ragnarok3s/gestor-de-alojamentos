(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    global.Chart = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function resolveContext(target) {
    if (!target) return null;
    if (typeof target.getContext === 'function') {
      return target.getContext('2d');
    }
    if (target.canvas && typeof target.canvas.getContext === 'function') {
      return target;
    }
    return null;
  }

  function ensureCanvas(target) {
    if (!target) return null;
    if (typeof target.getContext === 'function') {
      return target;
    }
    if (target.canvas instanceof HTMLCanvasElement) {
      return target.canvas;
    }
    return null;
  }

  function Chart(target, config) {
    if (!(this instanceof Chart)) {
      return new Chart(target, config);
    }
    this.canvas = ensureCanvas(target);
    this.ctx = resolveContext(target);
    if (!this.ctx || !this.canvas) {
      throw new Error('Chart: contexto inválido');
    }
    this.config = config || {};
    this._resizeCanvas();
    this.update();
  }

  Chart.defaults = {};
  Chart.register = function () {
    // noop para compatibilidade mínima
  };

  Chart.prototype._resizeCanvas = function () {
    var canvas = this.canvas;
    var ctx = this.ctx;
    if (!canvas || !ctx) return;
    var dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    var width = canvas.clientWidth || canvas.width;
    var height = canvas.clientHeight || canvas.height;
    if (!width || !height) {
      width = 600;
      height = 400;
    }
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  };

  Chart.prototype.clear = function () {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  Chart.prototype.update = function (config) {
    if (config) {
      this.config = config;
    }
    var cfg = this.config || {};
    var type = cfg.type || 'bar';
    var data = cfg.data || {};
    var labels = Array.isArray(data.labels) ? data.labels : [];
    var datasets = Array.isArray(data.datasets) ? data.datasets : [];
    this.clear();
    if (!labels.length || !datasets.length) {
      return;
    }
    if (type === 'line') {
      drawLineChart(this.ctx, this.canvas, labels, datasets[0], cfg.options || {});
    } else {
      drawBarChart(this.ctx, this.canvas, labels, datasets[0], cfg.options || {});
    }
  };

  function parseColor(value, fallback) {
    if (!value) return fallback;
    if (Array.isArray(value)) {
      return value[0] || fallback;
    }
    return value;
  }

  function drawAxes(ctx, canvas, options) {
    var width = canvas.width / ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var height = canvas.height / ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var chartArea = options.chartArea || { top: 24, right: 24, bottom: 32, left: 48 };
    ctx.strokeStyle = options.axisColor || 'rgba(30,41,59,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, chartArea.top);
    ctx.lineTo(chartArea.left, height - chartArea.bottom);
    ctx.lineTo(width - chartArea.right, height - chartArea.bottom);
    ctx.stroke();
    return {
      width: width,
      height: height,
      left: chartArea.left,
      right: width - chartArea.right,
      top: chartArea.top,
      bottom: height - chartArea.bottom
    };
  }

  function drawBarChart(ctx, canvas, labels, dataset, options) {
    var area = drawAxes(ctx, canvas, options);
    var values = Array.isArray(dataset.data) ? dataset.data.map(function (v) { return Number(v) || 0; }) : [];
    if (!values.length) return;
    var max = values.reduce(function (acc, val) { return val > acc ? val : acc; }, 0);
    if (max === 0) max = 1;
    var barWidth = (area.right - area.left) / values.length * 0.6;
    var gap = ((area.right - area.left) - barWidth * values.length) / Math.max(values.length - 1, 1);
    var baseY = area.bottom;
    var color = parseColor(dataset.backgroundColor, '#fb923c');
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '12px Inter, sans-serif';
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      var x = area.left + i * (barWidth + gap);
      var height = (value / max) * (area.bottom - area.top);
      ctx.beginPath();
      ctx.roundRect(x, baseY - height, barWidth, height, 6);
      ctx.fill();
      if (options.showValues) {
        ctx.fillStyle = options.valueColor || '#0f172a';
        ctx.fillText(String(Math.round(value)), x + barWidth / 2, baseY - height - 16);
        ctx.fillStyle = color;
      }
      if (options.showLabels) {
        ctx.fillStyle = options.labelColor || '#475569';
        ctx.fillText(labels[i], x + barWidth / 2, baseY + 8);
        ctx.fillStyle = color;
      }
    }
  }

  CanvasRenderingContext2D.prototype.roundRect =
    CanvasRenderingContext2D.prototype.roundRect ||
    function (x, y, width, height, radius) {
      radius = radius || 0;
      if (typeof radius === 'number') {
        radius = { tl: radius, tr: radius, br: radius, bl: radius };
      } else {
        var defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
        for (var side in defaultRadius) {
          radius[side] = radius[side] || defaultRadius[side];
        }
      }
      this.beginPath();
      this.moveTo(x + radius.tl, y);
      this.lineTo(x + width - radius.tr, y);
      this.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
      this.lineTo(x + width, y + height - radius.br);
      this.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
      this.lineTo(x + radius.bl, y + height);
      this.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
      this.lineTo(x, y + radius.tl);
      this.quadraticCurveTo(x, y, x + radius.tl, y);
      this.closePath();
      return this;
    };

  function drawLineChart(ctx, canvas, labels, dataset, options) {
    var area = drawAxes(ctx, canvas, options);
    var values = Array.isArray(dataset.data) ? dataset.data.map(function (v) { return Number(v) || 0; }) : [];
    if (!values.length) return;
    var max = values.reduce(function (acc, val) { return val > acc ? val : acc; }, values[0]);
    var min = values.reduce(function (acc, val) { return val < acc ? val : acc; }, values[0]);
    if (max === min) {
      max = min + 1;
    }
    var color = parseColor(dataset.borderColor || dataset.backgroundColor, '#f97316');
    ctx.lineWidth = dataset.borderWidth || 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    var chartWidth = area.right - area.left;
    var chartHeight = area.bottom - area.top;
    var stepX = chartWidth / Math.max(values.length - 1, 1);
    for (var i = 0; i < values.length; i++) {
      var x = area.left + stepX * i;
      var norm = (values[i] - min) / (max - min);
      var y = area.bottom - norm * chartHeight;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        if (dataset.tension) {
          var prevX = area.left + stepX * (i - 1);
          var prevNorm = (values[i - 1] - min) / (max - min);
          var prevY = area.bottom - prevNorm * chartHeight;
          var cpX1 = prevX + stepX * dataset.tension * 0.5;
          var cpY1 = prevY;
          var cpX2 = x - stepX * dataset.tension * 0.5;
          var cpY2 = y;
          ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
    if (dataset.fill) {
      ctx.lineTo(area.right, area.bottom);
      ctx.lineTo(area.left, area.bottom);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    for (var j = 0; j < values.length; j++) {
      var px = area.left + stepX * j;
      var pNorm = (values[j] - min) / (max - min);
      var py = area.bottom - pNorm * chartHeight;
      ctx.moveTo(px + 3, py);
      ctx.arc(px, py, 3, 0, Math.PI * 2);
    }
    ctx.fill();
    if (options.showLabels) {
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = options.labelColor || '#475569';
      for (var k = 0; k < labels.length; k++) {
        var lx = area.left + stepX * k;
        ctx.fillText(labels[k], lx, area.bottom + 8);
      }
    }
  }

  return Chart;
});
