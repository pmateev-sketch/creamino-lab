/* Creamino Software Demo – dependency-free SVG charts. Each function returns an SVG string. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var C = { ink: '#1E2A38', muted: '#6B7785', grid: '#E3E7EC', cyan: '#69D0E6', cyanDark: '#2A9DB8', warn: '#C2410C', ref: '#1E2A38' };

  function niceTicks(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / (n || 5))));
    var err = (n || 5) / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var t = [], s = Math.floor(lo / step) * step;
    for (var v = s; v <= hi + step * 0.5; v += step) t.push(Math.round(v / step) * step);
    return t;
  }
  var clipN = 0;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function dec(step) { return step >= 1 ? 0 : step >= 0.1 ? 1 : 2; }

  function frame(o) {
    var W = o.width || 520, H = o.height || 340, m = { l: 58, r: 16, t: 14, b: 46 };
    var xt = niceTicks(o.xmin, o.xmax, 6), yt = niceTicks(o.ymin, o.ymax, 5);
    var x0 = xt[0], x1 = xt[xt.length - 1], y0 = yt[0], y1 = yt[yt.length - 1];
    var sx = function (v) { return m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r); };
    var sy = function (v) { return H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
    var dx = dec(xt[1] - xt[0]), dy = dec(yt[1] - yt[0]);
    var g = '';
    yt.forEach(function (v) { g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + sy(v) + '" y2="' + sy(v) + '" stroke="' + C.grid + '"/>' +
      '<text x="' + (m.l - 8) + '" y="' + (sy(v) + 4) + '" text-anchor="end" font-size="11" fill="' + C.muted + '">' + v.toFixed(dy) + '</text>'; });
    if (!o.categorical) xt.forEach(function (v) { g += '<text x="' + sx(v) + '" y="' + (H - m.b + 16) + '" text-anchor="middle" font-size="11" fill="' + C.muted + '">' + v.toFixed(dx) + '</text>'; });
    g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '" stroke="' + C.muted + '"/>';
    g += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="' + C.ink + '">' + esc(o.xLabel || '') + '</text>';
    g += '<text transform="translate(14,' + ((m.t + H - m.b) / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" fill="' + C.ink + '">' + esc(o.yLabel || '') + '</text>';
    clipN++;
    var clip = 'crclip' + clipN;
    g = '<defs><clipPath id="' + clip + '"><rect x="' + m.l + '" y="' + m.t + '" width="' + (W - m.l - m.r) + '" height="' + (H - m.t - m.b) + '"/></clipPath></defs>' + g;
    return { clip: clip, W: W, H: H, m: m, sx: sx, sy: sy, x0: x0, x1: x1, y0: y0, y1: y1, grid: g };
  }
  function wrap(f, body, title) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f.W + ' ' + f.H + '" width="100%" role="img" aria-label="' + esc(title || '') + '" font-family="Inter, Segoe UI, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>' + f.grid + body + '</svg>';
  }
  function empty(msg, W, H) {
    W = W || 520; H = H || 340;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%"><rect width="100%" height="100%" fill="#fff" stroke="' + C.grid + '"/><text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="13" fill="' + C.warn + '" font-family="Arial">' + esc(msg) + '</text></svg>';
  }

  /* scatter: reference (x) vs predicted (y), with y = x and fitted line */
  function scatter(o) {
    var pts = o.points.filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
    if (pts.length < 2) return empty(o.emptyMsg || 'Not enough data');
    var all = pts.map(function (p) { return p.x; }).concat(pts.map(function (p) { return p.y; }));
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.05 || 1;
    var f = frame({ width: o.width, height: o.height, xmin: lo - pad, xmax: hi + pad, ymin: lo - pad, ymax: hi + pad, xLabel: o.xLabel, yLabel: o.yLabel });
    var b = '', a = Math.max(f.x0, f.y0), z = Math.min(f.x1, f.y1);
    b += '<line x1="' + f.sx(a) + '" y1="' + f.sy(a) + '" x2="' + f.sx(z) + '" y2="' + f.sy(z) + '" stroke="' + C.muted + '" stroke-dasharray="5 4"/>';
    if (o.fit && isFinite(o.fit.slope)) {
      var ya = o.fit.intercept + o.fit.slope * f.x0, yb = o.fit.intercept + o.fit.slope * f.x1;
      b += '<line x1="' + f.sx(f.x0) + '" y1="' + f.sy(ya) + '" x2="' + f.sx(f.x1) + '" y2="' + f.sy(yb) + '" stroke="' + C.cyanDark + '" stroke-width="2" clip-path="url(#' + f.clip + ')"/>';
    }
    pts.forEach(function (p) { b += '<circle cx="' + f.sx(p.x).toFixed(1) + '" cy="' + f.sy(p.y).toFixed(1) + '" r="4.2" fill="' + C.cyan + '" fill-opacity="0.75" stroke="' + C.ink + '" stroke-width="0.6"><title>' + esc(p.label || '') + ' · ref ' + p.x.toFixed(2) + ' · pred ' + p.y.toFixed(2) + '</title></circle>'; });
    b += '<g font-size="11" fill="' + C.ink + '"><line x1="' + (f.m.l + 10) + '" x2="' + (f.m.l + 34) + '" y1="' + (f.m.t + 10) + '" y2="' + (f.m.t + 10) + '" stroke="' + C.muted + '" stroke-dasharray="5 4"/><text x="' + (f.m.l + 40) + '" y="' + (f.m.t + 14) + '">y = x</text>' +
      (o.fit ? '<line x1="' + (f.m.l + 10) + '" x2="' + (f.m.l + 34) + '" y1="' + (f.m.t + 26) + '" y2="' + (f.m.t + 26) + '" stroke="' + C.cyanDark + '" stroke-width="2"/><text x="' + (f.m.l + 40) + '" y="' + (f.m.t + 30) + '">fitted line</text>' : '') + '</g>';
    return wrap(f, b, o.title);
  }

  /* residuals vs reference, zero line, ±1 SD band */
  function residuals(o) {
    var pts = o.points.filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
    if (pts.length < 2) return empty(o.emptyMsg || 'Not enough data');
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var ya = Math.max(Math.abs(Math.min.apply(null, ys)), Math.abs(Math.max.apply(null, ys))) * 1.15 || 1;
    var xl = Math.min.apply(null, xs), xh = Math.max.apply(null, xs), pad = (xh - xl) * 0.05 || 1;
    var f = frame({ width: o.width, height: o.height, xmin: xl - pad, xmax: xh + pad, ymin: -ya, ymax: ya, xLabel: o.xLabel, yLabel: o.yLabel });
    var b = '';
    if (isFinite(o.sd)) b += '<rect x="' + f.m.l + '" width="' + (f.W - f.m.l - f.m.r) + '" y="' + f.sy(o.sd) + '" height="' + (f.sy(-o.sd) - f.sy(o.sd)) + '" fill="' + C.cyan + '" fill-opacity="0.12"/>';
    b += '<line x1="' + f.m.l + '" x2="' + (f.W - f.m.r) + '" y1="' + f.sy(0) + '" y2="' + f.sy(0) + '" stroke="' + C.ink + '"/>';
    pts.forEach(function (p) { b += '<circle cx="' + f.sx(p.x).toFixed(1) + '" cy="' + f.sy(p.y).toFixed(1) + '" r="4" fill="' + C.cyan + '" fill-opacity="0.75" stroke="' + C.ink + '" stroke-width="0.6"><title>' + esc(p.label || '') + ' · residual ' + p.y.toFixed(2) + '</title></circle>'; });
    if (isFinite(o.sd)) b += '<text x="' + (f.W - f.m.r - 4) + '" y="' + (f.sy(o.sd) - 4) + '" text-anchor="end" font-size="10" fill="' + C.muted + '">±1 SD of residuals</text>';
    return wrap(f, b, o.title);
  }

  /* histogram of residuals */
  function histogram(o) {
    var v = o.values.filter(isFinite);
    if (v.length < 3) return empty(o.emptyMsg || 'Not enough data');
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    var nb = o.bins || Math.max(6, Math.min(14, Math.round(Math.sqrt(v.length)) + 2)), w = 2 * m / nb, counts = new Array(nb).fill(0);
    v.forEach(function (x) { var k = Math.min(nb - 1, Math.floor((x + m) / w)); counts[k]++; });
    var f = frame({ width: o.width, height: o.height, xmin: -m, xmax: m, ymin: 0, ymax: Math.max.apply(null, counts), xLabel: o.xLabel, yLabel: 'Count' });
    var b = '';
    counts.forEach(function (c, k) {
      var xa = f.sx(-m + k * w), xb = f.sx(-m + (k + 1) * w);
      b += '<rect x="' + (xa + 1) + '" y="' + f.sy(c) + '" width="' + Math.max(1, xb - xa - 2) + '" height="' + (f.sy(0) - f.sy(c)) + '" fill="' + C.cyan + '" stroke="' + C.cyanDark + '"><title>' + (-m + k * w).toFixed(2) + ' to ' + (-m + (k + 1) * w).toFixed(2) + ': ' + c + '</title></rect>';
    });
    b += '<line x1="' + f.sx(0) + '" x2="' + f.sx(0) + '" y1="' + f.m.t + '" y2="' + f.sy(0) + '" stroke="' + C.ink + '" stroke-dasharray="3 3"/>';
    return wrap(f, b, o.title);
  }

  /* categorical paired bars (e.g. reference vs predicted mean per session) or single series */
  function bars(o) {
    var cats = o.categories, series = o.series;
    if (!cats.length) return empty('No data');
    var vals = []; series.forEach(function (s) { s.values.forEach(function (v) { if (isFinite(v)) vals.push(v); }); });
    if (!vals.length) return empty(o.emptyMsg || 'No data');
    var lo = o.zero === false ? Math.min.apply(null, vals) * 0.95 : 0;
    var f = frame({ width: o.width, height: o.height, xmin: 0, xmax: 1, ymin: lo, ymax: Math.max.apply(null, vals), xLabel: o.xLabel, yLabel: o.yLabel, categorical: true });
    var b = '', bw = (f.W - f.m.l - f.m.r) / cats.length, gw = bw * 0.72, sw = gw / series.length;
    var colors = o.colors || [C.ink, C.cyan, C.cyanDark];
    cats.forEach(function (c, i) {
      var x = f.m.l + i * bw + (bw - gw) / 2;
      series.forEach(function (s, k) {
        var v = s.values[i]; if (!isFinite(v)) return;
        b += '<rect x="' + (x + k * sw) + '" y="' + f.sy(v) + '" width="' + (sw - 2) + '" height="' + Math.max(0, f.sy(f.y0) - f.sy(v)) + '" fill="' + colors[k % colors.length] + '"><title>' + esc(c) + ' · ' + esc(s.name) + ': ' + v.toFixed(2) + '</title></rect>';
      });
      b += '<text x="' + (f.m.l + i * bw + bw / 2) + '" y="' + (f.H - f.m.b + 16) + '" text-anchor="middle" font-size="11" fill="' + C.muted + '">' + esc(c) + '</text>';
    });
    var lx = f.W - f.m.r - 8;
    series.slice().reverse().forEach(function (s, k) {
      var idx = series.length - 1 - k, y = f.m.t + 8 + k * 16;
      b += '<rect x="' + (lx - 10) + '" y="' + (y - 8) + '" width="10" height="10" fill="' + colors[idx % colors.length] + '"/><text x="' + (lx - 14) + '" y="' + (y + 1) + '" text-anchor="end" font-size="11" fill="' + C.ink + '">' + esc(s.name) + '</text>';
    });
    return wrap(f, b, o.title);
  }

  /* colour scale shared by maps */
  function ramp(t, kind) {
    t = Math.max(0, Math.min(1, t));
    var stops = kind === 'srs' ? [[241, 248, 233], [253, 224, 140], [234, 120, 70], [180, 40, 40]]
      : kind === 'diff' ? [[33, 102, 172], [247, 247, 247], [178, 24, 43]]
        : kind === 'gmax' ? [[245, 247, 250], [180, 198, 224], [92, 110, 160], [30, 42, 56]]
          : [[247, 244, 226], [170, 226, 236], [105, 208, 230], [30, 110, 150], [22, 52, 82]];
    var s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), u = s - i;
    var c = stops[i].map(function (v, k) { return Math.round(v + (stops[i + 1][k] - v) * u); });
    return 'rgb(' + c.join(',') + ')';
  }

  CR.charts = { scatter: scatter, residuals: residuals, histogram: histogram, bars: bars, ramp: ramp, empty: empty, niceTicks: niceTicks, COLORS: C };
})(typeof window !== 'undefined' ? window : globalThis);
