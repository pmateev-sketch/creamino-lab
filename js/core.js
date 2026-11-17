/* Creamino Software Demo – core engine (stats, models, validation, IDW, SRS, CSV).
   Plain script: works in the browser (window.CR) and in Node (module.exports). */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});

  /* ---------- seeded random numbers ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalFrom(rand) {
    var spare = null;
    return function (mu, sd) {
      var z;
      if (spare !== null) { z = spare; spare = null; }
      else {
        var u = 0, v = 0;
        while (u === 0) u = rand();
        v = rand();
        var r = Math.sqrt(-2 * Math.log(u));
        z = r * Math.cos(2 * Math.PI * v);
        spare = r * Math.sin(2 * Math.PI * v);
      }
      return (mu || 0) + (sd === undefined ? 1 : sd) * z;
    };
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- descriptive statistics ---------- */
  function mean(a) { if (!a.length) return NaN; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a, ddof) {
    ddof = ddof === undefined ? 1 : ddof;
    if (a.length - ddof <= 0) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - ddof));
  }
  function min(a) { return a.length ? Math.min.apply(null, a) : NaN; }
  function max(a) { return a.length ? Math.max.apply(null, a) : NaN; }
  function pearson(x, y) {
    if (x.length < 3) return NaN;
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < x.length; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return NaN;
    return sxy / Math.sqrt(sxx * syy);
  }

  /* metrics: y = reference, p = prediction. Residual = p − y. */
  var MIN_N = 5;
  function metrics(y, p) {
    var yy = [], pp = [];
    for (var i = 0; i < y.length; i++) {
      if (isFinite(y[i]) && isFinite(p[i])) { yy.push(y[i]); pp.push(p[i]); }
    }
    var n = yy.length;
    var out = { n: n, ok: n >= MIN_N };
    if (!n) return out;
    var res = pp.map(function (v, i) { return v - yy[i]; });
    var sse = 0, sae = 0, my = mean(yy), sst = 0;
    for (i = 0; i < n; i++) { sse += res[i] * res[i]; sae += Math.abs(res[i]); sst += (yy[i] - my) * (yy[i] - my); }
    out.rmse = Math.sqrt(sse / n);
    out.mae = sae / n;
    out.r2 = sst > 0 ? 1 - sse / sst : NaN;
    out.bias = mean(res);
    out.sdRes = sd(res, 1);
    out.r = pearson(yy, pp);
    var fit = simpleFit(yy, pp);
    out.slope = fit.slope; out.intercept = fit.intercept;
    return out;
  }
  function simpleFit(x, y) {
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0;
    for (var i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
    var slope = sxx > 0 ? sxy / sxx : NaN;
    return { slope: slope, intercept: my - slope * mx };
  }

  /* ---------- linear algebra: solve A x = b (Gaussian elimination, partial pivoting) ---------- */
  function solve(A, b) {
    var n = A.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) throw new Error('Singular matrix: features are collinear or constant in the training data');
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (r = 0; r < n; r++) {
        if (r === c) continue;
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / row[i]; });
  }

  /* ---------- models ---------- */
  /* Ordinary least squares with standardization fitted on the training part only. */
  function fitOLS(X, y) {
    var p = X[0].length, n = X.length;
    if (n <= p + 1) throw new Error('Not enough training observations for ' + p + ' features');
    var mu = [], sg = [];
    for (var j = 0; j < p; j++) {
      var col = X.map(function (r) { return r[j]; });
      mu.push(mean(col)); var s = sd(col, 1); sg.push(s > 0 ? s : 1);
    }
    var Z = X.map(function (r) { return [1].concat(r.map(function (v, j) { return (v - mu[j]) / sg[j]; })); });
    var q = p + 1, A = [], b = [];
    for (var a = 0; a < q; a++) {
      A.push([]); var s2 = 0;
      for (var c = 0; c < q; c++) { var s1 = 0; for (var i = 0; i < n; i++) s1 += Z[i][a] * Z[i][c]; A[a].push(s1); }
      for (i = 0; i < n; i++) s2 += Z[i][a] * y[i];
      b.push(s2);
    }
    var beta = solve(A, b);
    /* coefficients on the original feature scale, for display */
    var coef = beta.slice(1).map(function (bj, j) { return bj / sg[j]; });
    var intercept = beta[0] - coef.reduce(function (s, cj, j) { return s + cj * mu[j]; }, 0);
    return {
      type: 'ols', mu: mu, sg: sg, beta: beta, coef: coef, intercept: intercept,
      predict: function (x) { var s = beta[0]; for (var j = 0; j < p; j++) s += beta[j + 1] * (x[j] - mu[j]) / sg[j]; return s; }
    };
  }
  function fitMean(X, y) {
    var m = mean(y);
    return { type: 'mean', intercept: m, coef: [], predict: function () { return m; } };
  }

  var MODELS = {
    ols3: { label: 'Linear regression · F1 + F4 + F7', features: ['f1', 'f4', 'f7'], fit: fitOLS },
    ols1: { label: 'Linear regression · F1 only', features: ['f1'], fit: fitOLS },
    mean: { label: 'Baseline · training mean', features: [], fit: fitMean }
  };

  /* ---------- validation splitters ---------- */
  function kfoldSplit(n, k, seed) {
    var idx = shuffle(Array.from({ length: n }, function (_, i) { return i; }), mulberry32(seed));
    var folds = [];
    for (var f = 0; f < k; f++) folds.push([]);
    idx.forEach(function (v, i) { folds[i % k].push(v); });
    return folds.map(function (test, f) { return { name: 'Fold ' + (f + 1), test: test }; });
  }
  function groupedSplit(groups, k, seed) {
    var uniq = Array.from(new Set(groups));
    var order = shuffle(uniq, mulberry32(seed));
    k = Math.min(k, uniq.length);
    var bucket = {};
    order.forEach(function (g, i) { bucket[g] = i % k; });
    var folds = [];
    for (var f = 0; f < k; f++) folds.push({ name: 'Fold ' + (f + 1), test: [], groups: [] });
    groups.forEach(function (g, i) { folds[bucket[g]].test.push(i); });
    order.forEach(function (g) { folds[bucket[g]].groups.push(g); });
    folds.forEach(function (fo) { fo.groups.sort(); fo.name += ' (' + fo.groups.join(', ') + ')'; });
    return folds;
  }
  function losoSplit(groups) {
    var uniq = Array.from(new Set(groups)).sort();
    return uniq.map(function (g) {
      var test = []; groups.forEach(function (gg, i) { if (gg === g) test.push(i); });
      return { name: 'Test ' + g, test: test, groups: [g] };
    });
  }

  /* Run a validation scheme. Each fold: fit model (incl. standardization) on train only, predict test only. */
  function validate(rows, opts) {
    var model = MODELS[opts.model], target = opts.target;
    var usable = [], skipped = 0;
    rows.forEach(function (r, i) {
      var ok = isFinite(r[target]) && model.features.every(function (f) { return isFinite(r[f]); });
      if (ok) usable.push(i); else skipped++;
    });
    var sub = usable.map(function (i) { return rows[i]; });
    var n = sub.length, groups = sub.map(function (r) { return r.session; });
    var result = { method: opts.method, model: opts.model, target: target, n: n, skipped: skipped, folds: [], pred: new Array(rows.length).fill(NaN), warnings: [] };
    if (n < 10) { result.warnings.push('Too few usable observations (' + n + ') for validation.'); return result; }
    var folds;
    if (opts.method === 'kfold') folds = kfoldSplit(n, Math.min(opts.k || 5, n), opts.seed || 1);
    else if (opts.method === 'grouped') {
      if (new Set(groups).size < 2) { result.warnings.push('Grouped CV needs at least 2 sessions.'); return result; }
      folds = groupedSplit(groups, opts.k || 4, opts.seed || 1);
    } else if (opts.method === 'loso') {
      if (new Set(groups).size < 2) { result.warnings.push('LOSO needs at least 2 sessions.'); return result; }
      folds = losoSplit(groups);
    } else if (opts.method === 'insample') {
      folds = [{ name: 'In-sample (train = test)', test: sub.map(function (_, i) { return i; }), insample: true }];
    }
    folds.forEach(function (fo) {
      var testSet = new Set(fo.test);
      var train = fo.insample ? fo.test : sub.map(function (_, i) { return i; }).filter(function (i) { return !testSet.has(i); });
      var Xtr = train.map(function (i) { return model.features.map(function (f) { return sub[i][f]; }); });
      var ytr = train.map(function (i) { return sub[i][target]; });
      var rec = { name: fo.name, nTrain: train.length, nTest: fo.test.length, groups: fo.groups || null };
      try {
        var m = model.fit(model.features.length ? Xtr : ytr.map(function () { return []; }), ytr);
        var yt = [], pt = [];
        fo.test.forEach(function (i) {
          var pr = m.predict(model.features.map(function (f) { return sub[i][f]; }));
          result.pred[usable[i]] = pr; yt.push(sub[i][target]); pt.push(pr);
        });
        rec.metrics = metrics(yt, pt);
        rec.coef = m.coef; rec.intercept = m.intercept;
      } catch (e) { rec.error = e.message; }
      result.folds.push(rec);
    });
    var y = [], p = [];
    rows.forEach(function (r, i) { if (isFinite(result.pred[i])) { y.push(r[target]); p.push(result.pred[i]); } });
    result.pooled = metrics(y, p);
    if (!result.pooled.ok) result.warnings.push('Not enough predictions to compute metrics.');
    return result;
  }

  /* ---------- Surface Risk Score (methodology definition, P9 Definition Lock) ---------- */
  var SRS_DEF = {
    vwcOpt: 23, gOpt: 80, wMoist: 0.4, wHard: 0.6,
    classes: [
      { key: 'L', label: 'Low deviation', max: 0.35 },
      { key: 'M', label: 'Medium deviation', max: 0.65 },
      { key: 'H', label: 'High deviation', max: Infinity }
    ]
  };
  function srs(vwc, gmax) {
    if (!isFinite(vwc) || !isFinite(gmax)) return null;
    var md = Math.abs(vwc - SRS_DEF.vwcOpt) / SRS_DEF.vwcOpt;
    var hd = Math.abs(gmax - SRS_DEF.gOpt) / SRS_DEF.gOpt;
    var s = SRS_DEF.wMoist * md + SRS_DEF.wHard * hd;
    var cls = SRS_DEF.classes.filter(function (c) { return s <= c.max; })[0];
    return { moistDev: md, hardDev: hd, srs: s, cls: cls.key, label: cls.label };
  }

  /* ---------- Inverse Distance Weighting ---------- */
  function idwGrid(points, opts) {
    var W = opts.width, H = opts.height, res = opts.res, p = opts.power, cover = opts.coverRadius || Infinity;
    var nx = Math.ceil(W / res), ny = Math.ceil(H / res), cells = [];
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var cx = Math.min((i + 0.5) * res, W), cy = Math.min((j + 0.5) * res, H);
        cells.push(idwAt(points, cx, cy, p, cover, i, j));
      }
    }
    return { nx: nx, ny: ny, res: res, cells: cells };
  }
  function idwAt(points, x, y, p, cover, i, j) {
    var sw = 0, swz = 0, dmin = Infinity, exact = null;
    for (var k = 0; k < points.length; k++) {
      var d = Math.hypot(points[k].x - x, points[k].y - y);
      if (d < dmin) dmin = d;
      if (d < 1e-9) { exact = points[k].z; break; }
      var w = 1 / Math.pow(d, p); sw += w; swz += w * points[k].z;
    }
    var z = exact !== null ? exact : (sw > 0 ? swz / sw : NaN);
    return { i: i, j: j, x: x, y: y, z: z, dmin: dmin, covered: dmin <= cover };
  }

  /* ---------- CSV ---------- */
  function toCSV(rows, cols) {
    function esc(v) {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
      var s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [cols.map(function (c) { return c.key; }).join(',')]
      .concat(rows.map(function (r) { return cols.map(function (c) { return esc(c.get ? c.get(r) : r[c.key]); }).join(','); }))
      .join('\n');
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = (first.split(';').length > first.split(',').length) ? ';' : ',';
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
    return rows;
  }

  /* Validate an imported table against the schema. Returns {rows, errors, warnings}. */
  var SCHEMA = {
    required: ['session', 'point', 'x', 'y', 'vwc_ref', 'gmax_ref'],
    optional: ['obs_id', 'f1', 'f4', 'f7'],
    ranges: { vwc_ref: [0, 60, '% vol'], gmax_ref: [0, 300, 'G'], x: [0, 1000, 'm'], y: [0, 1000, 'm'], f1: [-120, 0, 'dB'], f4: [-5, 5, 'slope'], f7: [-5, 5, 'index'] }
  };
  function validateImport(table) {
    var out = { rows: [], errors: [], warnings: [], excluded: 0 };
    if (!table.length) { out.errors.push('The file is empty.'); return out; }
    var head = table[0].map(function (h) { return h.trim().toLowerCase().replace(/\s*\(.*\)$/, ''); });
    var missing = SCHEMA.required.filter(function (c) { return head.indexOf(c) < 0; });
    if (missing.length) { out.errors.push('Missing required column(s): ' + missing.join(', ') + '. Required: ' + SCHEMA.required.join(', ') + '.'); return out; }
    var known = SCHEMA.required.concat(SCHEMA.optional);
    var extra = head.filter(function (h) { return known.indexOf(h) < 0; });
    if (extra.length) out.warnings.push('Ignored column(s): ' + extra.join(', ') + '.');
    var numeric = ['x', 'y', 'vwc_ref', 'gmax_ref', 'f1', 'f4', 'f7'];
    var seen = {};
    for (var r = 1; r < table.length; r++) {
      var rec = {}, bad = [];
      head.forEach(function (h, i) { if (known.indexOf(h) >= 0) rec[h] = (table[r][i] || '').trim(); });
      numeric.forEach(function (k) {
        if (rec[k] === undefined || rec[k] === '') { rec[k] = NaN; if (SCHEMA.required.indexOf(k) >= 0) bad.push(k + ' is empty'); return; }
        var v = Number(String(rec[k]).replace(',', '.'));
        if (!isFinite(v)) { bad.push(k + ' is not a number ("' + rec[k] + '")'); rec[k] = NaN; return; }
        var rg = SCHEMA.ranges[k];
        if (rg && (v < rg[0] || v > rg[1])) bad.push(k + ' = ' + v + ' is outside ' + rg[0] + '–' + rg[1] + ' ' + rg[2]);
        rec[k] = v;
      });
      if (!rec.session) bad.push('session is empty');
      if (!rec.point) bad.push('point is empty');
      rec.obs_id = rec.obs_id || (rec.session + '-' + rec.point);
      if (seen[rec.obs_id]) bad.push('duplicate obs_id ' + rec.obs_id);
      seen[rec.obs_id] = true;
      if (bad.length) { out.excluded++; if (out.warnings.length < 25) out.warnings.push('Row ' + (r + 1) + ' excluded: ' + bad.join('; ') + '.'); continue; }
      out.rows.push(rec);
    }
    if (!out.rows.length) out.errors.push('No valid rows after validation.');
    return out;
  }

  /* ---------- formatting ---------- */
  function fmt(v, d) { return (v === null || v === undefined || !isFinite(v)) ? '–' : Number(v).toFixed(d === undefined ? 2 : d); }

  CR.rng = { mulberry32: mulberry32, normalFrom: normalFrom, shuffle: shuffle };
  CR.stats = { mean: mean, sd: sd, min: min, max: max, pearson: pearson, metrics: metrics, simpleFit: simpleFit, MIN_N: MIN_N };
  CR.models = { MODELS: MODELS, fitOLS: fitOLS, fitMean: fitMean, solve: solve };
  CR.validation = { kfoldSplit: kfoldSplit, groupedSplit: groupedSplit, losoSplit: losoSplit, validate: validate };
  CR.srs = { DEF: SRS_DEF, compute: srs };
  CR.idw = { grid: idwGrid, at: idwAt };
  CR.csv = { toCSV: toCSV, parse: parseCSV, validateImport: validateImport, SCHEMA: SCHEMA };
  CR.fmt = fmt;
  if (typeof module !== 'undefined' && module.exports) module.exports = CR;
})(typeof window !== 'undefined' ? window : globalThis);
