/* VAYSHA Software Demo – application shell and modules. */
(function () {
  'use strict';
  var CR = window.CR, S = CR.stats, fmt = CR.fmt;
  var STATUS = ['SYNTHETIC DEMO', 'EXPERIMENTAL REFERENCE DATA', 'INDEPENDENTLY VALIDATED RESULTS'];
  var LS_KEY = 'creamino-demo-v1';
  var VIEWS = [
    ['home', 'Home'], ['dashboard', 'Dashboard'], ['explorer', 'Data Explorer'], ['analytics', 'Analytics'],
    ['validation', 'Validation Lab'], ['spatial', 'Spatial Intelligence'], ['srs', 'Surface Risk'], ['report', 'Report'], ['provenance', 'Data Provenance'], ['field', 'Field Session']
  ];
  var TARGETS = { vwc_ref: { short: 'VWC', name: 'Volumetric water content', unit: '% vol', pred: 'vwc_pred' }, gmax_ref: { short: 'Gmax', name: 'Impact hardness (Clegg)', unit: 'G', pred: 'gmax_pred' } };
  var METHODS = { loso: 'Leave-One-Session-Out', grouped: 'Grouped CV by session', kfold: 'K-fold CV (random)', insample: 'In-sample fit (train = test)' };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function h(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function nowISO() { return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }

  /* ---------- storage (best effort) ---------- */
  var store = {
    load: function () { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } },
    save: function (o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } },
    clear: function () { try { localStorage.removeItem(LS_KEY); } catch (e) { } }
  };

  /* ---------- state ---------- */
  var state;
  function freshState() {
    var syn = CR.synthetic.dataset();
    return {
      datasets: [syn], activeId: syn.id, session: 'ALL', view: 'home', started: false,
      log: [{ time: nowISO(), dataset: syn.id, action: 'Created', from: '', to: syn.status, by: 'system', reason: 'Synthetic dataset generated with seed ' + CR.synthetic.SPEC.seed }],
      ui: {
        explorer: { point: 'ALL', q: '', sort: 'obs_id', dir: 1, page: 1, size: 15 },
        analytics: { target: 'vwc_ref', method: 'loso' },
        val: { target: 'vwc_ref', method: 'loso', k: 5, seed: 7, model: 'ols3', result: null },
        spatial: { metric: 'vwc_ref', p: 2, res: 1, cover: 35, compare: false, b: null, sel: null },
        dash: { metric: 'vwc_ref', sel: null },
        srs: { vwc: 23, g: 80 },
        report: { name: '' }
      }
    };
  }
  function persist() {
    store.save({ imported: state.datasets.filter(function (d) { return !d.locked; }).map(function (d) { var c = Object.assign({}, d); delete c._cache; return c; }), log: state.log });
  }
  function init() {
    state = freshState();
    var saved = store.load();
    if (saved) {
      (saved.imported || []).forEach(function (d) { state.datasets.push(d); });
      if (saved.log && saved.log.length) state.log = saved.log;
    }
  }

  /* ---------- dataset helpers ---------- */
  function ds() { return state.datasets.filter(function (d) { return d.id === state.activeId; })[0] || state.datasets[0]; }
  function sessionsOf(d) {
    if (d.sessions && d.sessions.length) return d.sessions;
    var u = Array.from(new Set(d.rows.map(function (r) { return r.session; })));
    u.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    return u.map(function (id) { return { id: id, label: id, scenario: '' }; });
  }
  function pointsOf(d) {
    if (d.points && d.points.length) return d.points;
    var m = {};
    d.rows.forEach(function (r) { if (!m[r.point]) m[r.point] = { id: r.point, x: r.x, y: r.y }; });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  }
  function fieldOf(d) {
    if (d.field) return d.field;
    var mx = S.max(d.rows.map(function (r) { return r.x; })), my = S.max(d.rows.map(function (r) { return r.y; }));
    return { name: d.name || d.id, width: Math.ceil((mx + 5) / 5) * 5, height: Math.ceil((my + 5) / 5) * 5, unit: 'm' };
  }
  function hasFeatures(d) { return d.rows.some(function (r) { return isFinite(r.f1) && isFinite(r.f4) && isFinite(r.f7); }); }
  function getPred(d, target, method) {
    d._cache = d._cache || {};
    var key = target + '|' + method;
    if (!d._cache[key]) {
      d._cache[key] = hasFeatures(d)
        ? CR.validation.validate(d.rows, { method: method, model: 'ols3', target: target, k: 5, seed: 7 })
        : { pred: d.rows.map(function () { return NaN; }), warnings: ['This dataset has no CSI features (f1, f4, f7); predictions cannot be computed.'], pooled: null, folds: [] };
    }
    return d._cache[key];
  }
  function enriched(d) {
    var pv = getPred(d, 'vwc_ref', 'loso').pred, pg = getPred(d, 'gmax_ref', 'loso').pred;
    return d.rows.map(function (r, i) {
      var s = CR.srs.compute(r.vwc_ref, r.gmax_ref) || {};
      return Object.assign({}, r, { idx: i, vwc_pred: pv[i], gmax_pred: pg[i], moist_dev: s.moistDev, hard_dev: s.hardDev, srs: s.srs, cls: s.cls });
    });
  }
  function inSession(rows, sess) { return sess === 'ALL' ? rows : rows.filter(function (r) { return r.session === sess; }); }
  function sessLabel(d, id) { if (id === 'ALL') return 'All sessions'; var s = sessionsOf(d).filter(function (x) { return x.id === id; })[0]; return s ? s.id + ' – ' + s.label : id; }
  function statusClass(st) { return st === STATUS[0] ? 'syn' : st === STATUS[1] ? 'exp' : 'val'; }

  /* points for a map: one value per point (session mean when "All sessions") */
  function mapPoints(d, rows, metric) {
    var by = {};
    rows.forEach(function (r) {
      var v = metric === 'srs' ? r.srs : r[metric];
      if (!isFinite(v)) return;
      (by[r.point] = by[r.point] || { id: r.point, x: r.x, y: r.y, vals: [], vwc: [], g: [] });
      by[r.point].vals.push(v); by[r.point].vwc.push(r.vwc_ref); by[r.point].g.push(r.gmax_ref);
    });
    return Object.keys(by).sort().map(function (k) { var p = by[k]; return { id: p.id, x: p.x, y: p.y, z: S.mean(p.vals), vwc: S.mean(p.vwc), g: S.mean(p.g), n: p.vals.length }; });
  }
  function buildGrid(d, pts, metric, o) {
    var f = fieldOf(d), base = { width: f.width, height: f.height, res: o.res, power: o.p, coverRadius: o.cover };
    if (metric !== 'srs') return CR.idw.grid(pts.map(function (p) { return { x: p.x, y: p.y, z: p.z }; }), base);
    /* SRS map: interpolate VWC and Gmax separately, then apply the SRS definition per cell */
    var gv = CR.idw.grid(pts.map(function (p) { return { x: p.x, y: p.y, z: p.vwc }; }), base);
    var gg = CR.idw.grid(pts.map(function (p) { return { x: p.x, y: p.y, z: p.g }; }), base);
    gv.cells.forEach(function (c, i) { var s = CR.srs.compute(c.z, gg.cells[i].z); c.vwc = c.z; c.g = gg.cells[i].z; c.z = s ? s.srs : NaN; });
    return gv;
  }

  /* ---------- map renderer (canvas) ---------- */
  function drawMap(canvas, o) {
    var f = o.field, ml = 40, mb = 30, mt = 12, mr = 12, W = 960;
    var pw = W - ml - mr, ph = pw * f.height / f.width, H = Math.round(ph + mt + mb);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var sx = function (x) { return ml + x / f.width * pw; }, sy = function (y) { return mt + y / f.height * ph; };
    var g = o.grid, cw = pw / g.nx * (g.res * g.nx / f.width), chh = ph / g.ny * (g.res * g.ny / f.height);
    var hatch = document.createElement('canvas'); hatch.width = hatch.height = 8;
    var hc = hatch.getContext('2d'); hc.fillStyle = '#fff'; hc.fillRect(0, 0, 8, 8); hc.strokeStyle = '#D5DBE1'; hc.lineWidth = 2; hc.beginPath(); hc.moveTo(0, 8); hc.lineTo(8, 0); hc.stroke();
    var pat = ctx.createPattern(hatch, 'repeat');
    g.cells.forEach(function (c) {
      var x = ml + c.i * cw, y = mt + c.j * chh;
      var wcell = Math.min(cw, ml + pw - x), hcell = Math.min(chh, mt + ph - y);
      if (!c.covered || !isFinite(c.z)) { ctx.fillStyle = pat; }
      else ctx.fillStyle = CR.charts.ramp((c.z - o.vmin) / ((o.vmax - o.vmin) || 1), o.kind);
      ctx.fillRect(x, y, wcell + 0.5, hcell + 0.5);
    });
    ctx.strokeStyle = 'rgba(30,42,56,.18)'; ctx.lineWidth = 1; ctx.font = '14px Arial'; ctx.fillStyle = '#5F6B78';
    for (var gx = 0; gx <= f.width; gx += 10) { ctx.beginPath(); ctx.moveTo(sx(gx), mt); ctx.lineTo(sx(gx), mt + ph); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(gx, sx(gx), mt + ph + 20); }
    for (var gy = 0; gy <= f.height; gy += 10) { ctx.beginPath(); ctx.moveTo(ml, sy(gy)); ctx.lineTo(ml + pw, sy(gy)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(gy, ml - 5, sy(gy) + 4); }
    ctx.strokeStyle = '#1E2A38'; ctx.lineWidth = 1.5; ctx.strokeRect(ml, mt, pw, ph);
    (o.points || []).forEach(function (p) {
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 10, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1E2A38'; ctx.stroke();
      ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.strokeText(p.id, sx(p.x), sy(p.y) - 17); ctx.fillStyle = '#1E2A38'; ctx.fillText(p.id, sx(p.x), sy(p.y) - 17);
    });
    if (o.sel) { var X = sx(o.sel.x), Y = sy(o.sel.y); ctx.strokeStyle = '#B42318'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X - 13, Y); ctx.lineTo(X + 13, Y); ctx.moveTo(X, Y - 13); ctx.lineTo(X, Y + 13); ctx.stroke(); }
    return function (evt) {
      var r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
      var px = (evt.clientX - r.left) * k, py = (evt.clientY - r.top) * k;
      var x = (px - ml) / pw * f.width, y = (py - mt) / ph * f.height;
      return (x < 0 || y < 0 || x > f.width || y > f.height) ? null : { x: x, y: y };
    };
  }
  function legendHTML(kind, vmin, vmax, unit) {
    var stops = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return CR.charts.ramp(t, kind) + ' ' + (t * 100) + '%'; }).join(',');
    return '<div class="legend"><span>' + fmt(vmin, kind === 'srs' ? 2 : 1) + '</span><span class="bar" style="background:linear-gradient(90deg,' + stops + ')"></span><span>' + fmt(vmax, kind === 'srs' ? 2 : 1) + ' ' + h(unit) + '</span>' +
      '<span class="sw"><span class="dot"></span>measured input point</span><span class="sw"><span class="hatch"></span>not covered (beyond coverage radius)</span><span>coloured cells = interpolated values</span></div>';
  }
  function metricMeta(m) { return m === 'srs' ? { name: 'SRS', unit: '', kind: 'srs', d: 2 } : m === 'gmax_ref' ? { name: 'Gmax', unit: 'G', kind: 'gmax', d: 1 } : { name: 'VWC', unit: '% vol', kind: 'vwc', d: 1 }; }

  /* ---------- shell ---------- */
  function renderShell() {
    var d = ds();
    $('#nav').innerHTML = VIEWS.map(function (v, i) { return '<button data-view="' + v[0] + '" class="' + (state.view === v[0] ? 'on' : '') + '"><span class="n">' + (i ? i : '') + '</span>' + h(v[1]) + '</button>'; }).join('') +
      '<div class="foot">Point Surface · VAYSHA Software Demo v1.0<br>Synthetic data generator ' + CR.synthetic.SPEC.id + '</div>';
    $('#dsSelect').innerHTML = state.datasets.map(function (x) { return '<option value="' + h(x.id) + '"' + (x.id === d.id ? ' selected' : '') + '>' + h(x.name || x.id) + '</option>'; }).join('');
    $('#sessSelect').innerHTML = '<option value="ALL">All sessions</option>' + sessionsOf(d).map(function (s) { return '<option value="' + h(s.id) + '"' + (s.id === state.session ? ' selected' : '') + '>' + h(s.id + ' · ' + s.label) + '</option>'; }).join('');
    $('#sessSelect').value = state.session;
    var tag = $('#statusTag'); tag.textContent = d.status; tag.className = 'tag ' + statusClass(d.status);
    var b = $('#banner');
    if (d.status === STATUS[0]) { b.className = 'banner'; b.innerHTML = 'SYNTHETIC DEMONSTRATION DATA — NOT EXPERIMENTALLY VALIDATED<br>NOT LIVE STADIUM DATA'; }
    else if (d.status === STATUS[1]) { b.className = 'banner exp'; b.innerHTML = 'EXPERIMENTAL REFERENCE DATA — USER-PROVIDED, NOT INDEPENDENTLY VALIDATED<br>NOT LIVE STADIUM DATA'; }
    else { b.className = 'banner val'; b.textContent = 'INDEPENDENTLY VALIDATED RESULTS — see provenance log for the validation record'; }
  }
  function go(view) { state.view = view; try { history.replaceState(null, '', view === 'home' ? location.pathname : '#' + view); } catch (e) {} render(); window.scrollTo(0, 0); var m = $('#main'); if (m) m.focus({ preventScroll: true }); }
  function render() {
    renderShell();
    document.body.classList.toggle('fieldmode', state.view === 'field');
    if (state.view === 'field') { CR.fieldUI.render($('#main'), { toast: toast, openModal: openModal, closeModal: closeModal, shell: fieldShell }); return; }
    var fn = { home: vHome, dashboard: vDashboard, explorer: vExplorer, analytics: vAnalytics, validation: vValidation, spatial: vSpatial, srs: vSRS, report: vReport, provenance: vProvenance }[state.view];
    fn($('#main'));
  }

  /* Field Session: real data only – the banner and tag describe the field session, not the synthetic dataset */
  function fieldShell(sess) {
    var tag = $('#statusTag'), b = $('#banner');
    if (!sess) { tag.textContent = 'FIELD SESSION'; tag.className = 'tag exp'; b.className = 'banner exp'; b.innerHTML = 'FIELD SESSION — REAL MEASUREMENTS ONLY · SYNTHETIC DEMO DATA ARE NOT USED HERE<br>INITIAL CALIBRATION — NO VALIDATED LOCAL MODEL'; return; }
    tag.textContent = sess.data_origin === 'real' ? 'REAL FIELD DATA' : 'TEST DATA'; tag.className = 'tag ' + (sess.data_origin === 'real' ? 'exp' : '');
    b.className = 'banner exp'; b.innerHTML = 'INITIAL CALIBRATION — ' + h(sess.site_id) + ' · ' + (sess.data_origin === 'real' ? 'REAL FIELD DATA' : 'TEST DATA – NOT FOR CALIBRATION') + '<br>NO CSI-DERIVED PREDICTIONS · NO OPERATIONAL STATUS';
  }

  /* ---------- Home ---------- */
  function vHome(el) {
    el.innerHTML =
      '<section class="hero"><div><div class="tagline">Smart Sports Surface Intelligence Platform</div><h1>VAYSHA</h1><p style="font-size:18px;color:#fff;margin:4px 0 10px">Every Athlete. Every Surface.</p>' +
      '<p>Interactive software demo of the VAYSHA platform by Point Surface: data management, analytics, model validation, spatial interpolation, surface risk scoring and reporting – all computed live in your browser.</p>' +
      '<div class="actions"><button class="btn cyan" id="startBtn">START DEMO</button><button class="btn ghost" style="color:#fff;border-color:#4A6079" id="sampleBtn">LOAD SAMPLE SESSION</button><button class="btn ghost" style="color:#fff;border-color:#4A6079" id="walk2">Guided walkthrough</button><a class="btn cyan" href="map/" style="display:inline-flex;align-items:center;text-decoration:none">VAYSHA Explore · Satellite Map</a></div><p style="font-size:13px;margin:14px 0 0;color:#cae5ea">2027 pilot proposal · 10 natural-grass pitches · 30 / 60 / 90-day assessment. Proposal only; not an approved government project.</p></div>' +
      '<div class="note bad" style="margin:0">This is a <b>software demo</b>. It runs on <b>' + h(CR.synthetic.SPEC.id) + '</b>, a programmatically generated dataset. Results show how the software works – they are not measurements and are not evidence of VAYSHA’s accuracy.</div></section>' +
      '<div class="tiles">' + [
        ['dashboard', 'Field Monitoring', 'KPIs and a live field map per session.'],
        ['explorer', 'Data Analytics & Reporting', 'Explore, filter, import and export observations.'],
        ['analytics', 'Surface Moisture Intelligence', 'Reference vs predicted moisture, error analysis.'],
        ['validation', 'Surface Hardness Analysis', 'K-fold, grouped CV and LOSO on real algorithms.'],
        ['spatial', 'Spatial Interpolation', 'Inverse Distance Weighting with adjustable power.'],
        ['srs', 'Surface Risk Scoring', 'SRS calculator from the documented methodology.']
      ].map(function (t) { return '<button class="tile" data-go="' + t[0] + '"><b>' + t[1] + '</b><span>' + t[2] + '</span></button>'; }).join('') + '</div>';
    $('#startBtn').onclick = startDemo;
    $('#sampleBtn').onclick = sampleSessionModal;
    $('#walk2').onclick = function () { startWalk(0); };
    $$('.tile', el).forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
  }
  function startDemo() {
    var syn = state.datasets[0];
    state.activeId = syn.id; state.session = 'ALL'; state.started = true;
    toast('Synthetic demo dataset loaded – ' + syn.rows.length + ' observations');
    go('dashboard');
  }
  function sampleSessionModal() {
    var d = ds();
    openModal('<h3>Load sample session</h3><p class="muted">Choose a demonstration session. All views switch to it.</p>' +
      '<div class="grid">' + sessionsOf(d).map(function (s) { return '<button class="tile" data-s="' + h(s.id) + '"><b>' + h(s.id + ' · ' + s.label) + '</b><span>' + h(s.scenario || '') + '</span></button>'; }).join('') + '</div>' +
      '<div class="flex" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-close>Cancel</button></div>', function (box) {
        $$('[data-s]', box).forEach(function (b) { b.onclick = function () { state.session = b.dataset.s; closeModal(); toast('Session ' + b.dataset.s + ' loaded'); go(state.view === 'home' ? 'dashboard' : state.view); }; });
      });
  }

  /* ---------- Dashboard ---------- */
  function vDashboard(el) {
    var d = ds(), all = enriched(d), rows = inSession(all, state.session), u = state.ui.dash;
    var sess = sessionsOf(d), last = sess[sess.length - 1];
    var vw = rows.map(function (r) { return r.vwc_ref; }), gm = rows.map(function (r) { return r.gmax_ref; });
    var dev = rows.filter(function (r) { return r.srs > CR.srs.DEF.classes[0].max; }).length;
    var mm = metricMeta(u.metric);
    el.innerHTML = '<h1>Dashboard</h1><p class="lead">' + h(fieldOf(d).name) + ' · ' + h(sessLabel(d, state.session)) + '. Every figure below is computed from the active dataset.</p>' +
      '<div class="grid g4">' +
      kpi(rows.length, 'Measurements in view', 'of ' + all.length + ' in dataset') +
      kpi(sess.length, 'Sessions in dataset', state.session === 'ALL' ? 'showing all' : 'showing ' + state.session) +
      kpi(fmt(S.mean(vw), 1) + ' <span class="unit">% vol</span>', 'Mean VWC', 'min ' + fmt(S.min(vw), 1) + ' · max ' + fmt(S.max(vw), 1)) +
      kpi(fmt(S.mean(gm), 1) + ' <span class="unit">G</span>', 'Mean Gmax', 'min ' + fmt(S.min(gm), 1) + ' · max ' + fmt(S.max(gm), 1)) +
      kpi(dev, 'Observations with deviation', 'SRS > 0.35 (medium or high)') +
      kpi(h(last.id), 'Last demo session', h(last.label)) +
      kpi('<span class="tag ' + statusClass(d.status) + '">' + h(d.status) + '</span>', 'Dataset status', h(d.id + ' v' + (d.version || '1'))) +
      kpi(hasFeatures(d) ? 'LOSO' : '–', 'Prediction method', hasFeatures(d) ? 'linear model on CSI features' : 'no CSI features in dataset') +
      '</div>' +
      '<div class="grid g2" style="margin-top:14px;grid-template-columns:1.5fr 1fr"><div class="card"><div class="controls" style="margin-bottom:8px"><label>Map layer<select id="dMetric">' +
      opt('vwc_ref', 'VWC (reference)', u.metric) + opt('gmax_ref', 'Gmax (reference)', u.metric) + opt('srs', 'SRS', u.metric) + '</select></label>' +
      '<label>Session<select id="dSess"><option value="ALL">All sessions (mean per point)</option>' + sess.map(function (s) { return opt(s.id, s.id + ' · ' + s.label, state.session); }).join('') + '</select></label>' +
      '<button class="btn ghost small" id="dSample">LOAD SAMPLE SESSION</button></div>' +
      '<div class="mapwrap"><canvas id="dMap" aria-label="Field map"></canvas></div><div id="dLegend"></div><div class="info" id="dInfo">Click the map to read a value. IDW, p = 2, 1 × 1 m cells.</div>' +
      '<p class="muted" style="font-size:11px;margin:6px 0 0">DEMONSTRATION INTERPOLATION — SYNTHETIC COORDINATES</p></div>' +
      '<div class="card"><h3>Session means</h3><div class="chart" id="dBars"></div><h3 style="margin-top:14px">Points in view</h3><div class="tablewrap"><table class="data"><thead><tr><th>Point</th><th>VWC</th><th>Gmax</th><th>SRS</th><th class="l">Class</th></tr></thead><tbody>' +
      mapPoints(d, rows, 'srs').map(function (p) { var s = CR.srs.compute(p.vwc, p.g); return '<tr><td>' + h(p.id) + '</td><td>' + fmt(p.vwc, 1) + '</td><td>' + fmt(p.g, 1) + '</td><td>' + fmt(s.srs, 2) + '</td><td class="l"><span class="tag ' + s.cls + '">' + s.label + '</span></td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
    var pts = mapPoints(d, rows, u.metric), grid = buildGrid(d, pts, u.metric, { p: 2, res: 1, cover: 35 });
    var zs = grid.cells.filter(function (c) { return c.covered; }).map(function (c) { return c.z; }).concat(pts.map(function (p) { return p.z; }));
    var vmin = S.min(zs.filter(isFinite)), vmax = S.max(zs.filter(isFinite));
    var canvas = $('#dMap'), toField = drawMap(canvas, { field: fieldOf(d), grid: grid, points: pts, kind: mm.kind, vmin: vmin, vmax: vmax, sel: u.sel });
    $('#dLegend').innerHTML = legendHTML(mm.kind, vmin, vmax, mm.unit);
    canvas.onclick = function (e) { var p = toField(e); if (!p) return; u.sel = p; var c = CR.idw.at(pts.map(function (q) { return { x: q.x, y: q.y, z: q.z }; }), p.x, p.y, 2, 35);
      if (u.metric === 'srs') { var a = CR.idw.at(pts.map(function (q) { return { x: q.x, y: q.y, z: q.vwc }; }), p.x, p.y, 2, 35), b = CR.idw.at(pts.map(function (q) { return { x: q.x, y: q.y, z: q.g }; }), p.x, p.y, 2, 35); c.z = CR.srs.compute(a.z, b.z).srs; }
      drawMap(canvas, { field: fieldOf(d), grid: grid, points: pts, kind: mm.kind, vmin: vmin, vmax: vmax, sel: p });
      $('#dInfo').innerHTML = cellInfo(p, c, mm, pts); };
    var bs = sess.map(function (s) { var r = inSession(all, s.id); return { v: S.mean(r.map(function (x) { return x.vwc_ref; })), g: S.mean(r.map(function (x) { return x.gmax_ref; })) }; });
    $('#dBars').innerHTML = CR.charts.bars({ categories: sess.map(function (s) { return s.id; }), series: [{ name: 'Mean VWC (% vol)', values: bs.map(function (b) { return b.v; }) }], yLabel: '% vol', height: 220 }) +
      CR.charts.bars({ categories: sess.map(function (s) { return s.id; }), series: [{ name: 'Mean Gmax (G)', values: bs.map(function (b) { return b.g; }) }], yLabel: 'G', height: 220, colors: ['#2A9DB8'] });
    $('#dMetric').onchange = function () { u.metric = this.value; u.sel = null; render(); };
    $('#dSess').onchange = function () { state.session = this.value; u.sel = null; render(); };
    $('#dSample').onclick = sampleSessionModal;
  }
  function kpi(v, l, s) { return '<div class="card kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div><div class="s">' + (s || '') + '</div></div>'; }
  function opt(v, label, cur) { return '<option value="' + h(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + h(label) + '</option>'; }
  function cellInfo(p, c, mm, pts) {
    var near = pts.filter(function (q) { return Math.hypot(q.x - p.x, q.y - p.y) < 1.2; })[0];
    var kind = near ? '<b>measured point ' + h(near.id) + '</b>' : (c.covered ? 'interpolated value' : '<b>not covered</b> – nearest input point ' + fmt(c.dmin, 1) + ' m away');
    return 'x = ' + fmt(p.x, 1) + ' m · y = ' + fmt(p.y, 1) + ' m · ' + mm.name + ' = <b>' + (c.covered || near ? fmt(near ? near.z : c.z, mm.d) + ' ' + h(mm.unit) : '–') + '</b> · ' + kind + ' · distance to nearest point ' + fmt(c.dmin, 1) + ' m';
  }

  /* ---------- Data Explorer ---------- */
  var EXP_COLS = [
    { key: 'obs_id', label: 'Observation ID', l: true },
    { key: 'session', label: 'Session', l: true },
    { key: 'point', label: 'Point ID', l: true },
    { key: 'x', label: 'X', unit: 'm', d: 1 }, { key: 'y', label: 'Y', unit: 'm', d: 1 },
    { key: 'vwc_ref', label: 'VWC ref', unit: '% vol', d: 1 }, { key: 'vwc_pred', label: 'VWC pred', unit: '% vol · LOSO', d: 2 },
    { key: 'gmax_ref', label: 'Gmax ref', unit: 'G', d: 1 }, { key: 'gmax_pred', label: 'Gmax pred', unit: 'G · LOSO', d: 1 },
    { key: 'moist_dev', label: 'Moisture dev.', unit: '–', d: 3 }, { key: 'hard_dev', label: 'Hardness dev.', unit: '–', d: 3 },
    { key: 'srs', label: 'SRS', unit: '–', d: 3 }
  ];
  function explorerRows() {
    var d = ds(), u = state.ui.explorer, q = u.q.trim().toLowerCase();
    var rows = inSession(enriched(d), state.session).filter(function (r) {
      return (u.point === 'ALL' || r.point === u.point) && (!q || (r.obs_id + ' ' + r.session + ' ' + r.point).toLowerCase().indexOf(q) >= 0);
    });
    rows.sort(function (a, b) {
      var x = a[u.sort], y = b[u.sort];
      if (typeof x === 'number' || typeof y === 'number') { x = isFinite(x) ? x : -Infinity; y = isFinite(y) ? y : -Infinity; return (x - y) * u.dir; }
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * u.dir;
    });
    return rows;
  }
  function vExplorer(el) {
    var d = ds(), u = state.ui.explorer, rows = explorerRows();
    var pages = Math.max(1, Math.ceil(rows.length / u.size)); if (u.page > pages) u.page = pages;
    var view = rows.slice((u.page - 1) * u.size, u.page * u.size);
    el.innerHTML = '<h1>Data Explorer</h1><p class="lead">All observations of the active dataset. Predicted values are out-of-sample Leave-One-Session-Out predictions of a linear model on the CSI features; deviations and SRS use the reference values.</p>' +
      (hasFeatures(d) ? '' : '<div class="note">This dataset has no CSI features, so predicted columns are empty and no model results can be shown.</div>') +
      '<div class="controls"><label>Session<select id="eSess"><option value="ALL">All sessions</option>' + sessionsOf(d).map(function (s) { return opt(s.id, s.id, state.session); }).join('') + '</select></label>' +
      '<label>Point<select id="ePoint"><option value="ALL">All points</option>' + pointsOf(d).map(function (p) { return opt(p.id, p.id, u.point); }).join('') + '</select></label>' +
      '<label>Search ID<input type="search" id="eQ" placeholder="e.g. S3-C2" value="' + h(u.q) + '"></label>' +
      '<label>Rows per page<select id="eSize">' + [10, 15, 25, 56, 100].map(function (n) { return opt(n, n, u.size); }).join('') + '</select></label>' +
      '<div class="spacer" style="flex:1"></div><button class="btn ghost" id="eExport">Export CSV</button><label class="btn ghost" style="flex-direction:row;color:var(--navy);font-size:14px">Import CSV<input type="file" id="eImport" accept=".csv,text/csv" class="hidden"></label>' +
      '<button class="btn ghost" id="eTemplate">CSV template</button></div>' +
      '<div class="tablewrap"><table class="data" id="eTable"><thead><tr>' + EXP_COLS.map(function (c) { return '<th class="sort' + (c.l ? ' l' : '') + '" data-k="' + c.key + '">' + h(c.label) + (u.sort === c.key ? (u.dir > 0 ? ' ▲' : ' ▼') : '') + (c.unit ? '<br><span class="unit">' + h(c.unit) + '</span>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (view.length ? view.map(function (r) { return '<tr>' + EXP_COLS.map(function (c) { var v = r[c.key]; return '<td' + (c.l ? ' class="l"' : '') + '>' + (c.d !== undefined ? fmt(v, c.d) : h(v)) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + EXP_COLS.length + '" class="l muted">No observations match the filters.</td></tr>') +
      '</tbody></table></div><div class="pager"><span>' + rows.length + ' rows · page ' + u.page + ' of ' + pages + '</span><button class="btn ghost small" id="ePrev"' + (u.page <= 1 ? ' disabled' : '') + '>‹ Prev</button><button class="btn ghost small" id="eNext"' + (u.page >= pages ? ' disabled' : '') + '>Next ›</button></div>' +
      '<p class="muted" style="font-size:12px">Units: VWC in % volumetric water content; Gmax in G (Clegg impact gravities); X/Y in metres of the demo field; deviations are relative (|value − optimum| / optimum); SRS is unitless.</p>';
    $('#eSess').onchange = function () { state.session = this.value; u.page = 1; render(); };
    $('#ePoint').onchange = function () { u.point = this.value; u.page = 1; render(); };
    $('#eQ').oninput = function () { u.q = this.value; u.page = 1; var pos = this.selectionStart; render(); var q = $('#eQ'); q.focus(); q.setSelectionRange(pos, pos); };
    $('#eSize').onchange = function () { u.size = +this.value; u.page = 1; render(); };
    $('#ePrev').onclick = function () { u.page--; render(); };
    $('#eNext').onclick = function () { u.page++; render(); };
    $$('th.sort', el).forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (u.sort === k) u.dir *= -1; else { u.sort = k; u.dir = 1; } render(); }; });
    $('#eExport').onclick = function () {
      var csv = CR.csv.toCSV(rows, EXP_COLS.map(function (c) { return { key: c.key }; }).concat([{ key: 'f1' }, { key: 'f4' }, { key: 'f7' }, { key: 'cls', get: function (r) { return r.cls; } }]));
      var header = '# ' + d.id + ' v' + (d.version || '1') + ' · status: ' + d.status + ' · exported ' + nowISO() + (d.status === STATUS[0] ? ' · SYNTHETIC DEMONSTRATION DATA — NOT EXPERIMENTALLY VALIDATED' : '') + '\n';
      download((d.id + (state.session !== 'ALL' ? '_' + state.session : '') + '.csv'), header + csv, 'text/csv');
    };
    $('#eTemplate').onclick = function () { download('vaysha_import_template.csv', 'obs_id,session,point,x,y,vwc_ref,gmax_ref,f1,f4,f7\nS1-P1,S1,P1,10,10,22.5,85.0,,,\n', 'text/csv'); };
    $('#eImport').onchange = function () { var f = this.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { importFlow(f.name, String(rd.result)); }; rd.readAsText(f); this.value = ''; };
  }
  function download(name, content, type) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: type + ';charset=utf-8' });
    /* inside a claude.ai artifact frame, files go through the platform's downloads capability */
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then(function (dl) {
        if (!dl) { anchorDownload(name, blob); return; }
        return dl.save({ filename: name, data: blob }).then(function () { toast('Saved ' + name); }, function (e) { toast(e && e.code === 'declined' ? 'Download cancelled' : 'Download not available here (' + (e && e.code) + ')'); });
      });
      return;
    }
    anchorDownload(name, blob);
  }
  function anchorDownload(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Downloaded ' + name);
  }
  function importFlow(name, text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.charAt(0) !== '#'; }).join('\n');
    var v = CR.csv.validateImport(CR.csv.parse(lines));
    var body = '<h3>Import ' + h(name) + '</h3>';
    if (v.errors.length) { body += '<div class="note bad">' + v.errors.map(h).join('<br>') + '</div><div class="flex" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>'; openModal(body); return; }
    var sess = new Set(v.rows.map(function (r) { return r.session; })).size, feat = v.rows.some(function (r) { return isFinite(r.f1) && isFinite(r.f4) && isFinite(r.f7); });
    body += '<p><b>' + v.rows.length + '</b> valid rows · ' + sess + ' sessions · CSI features: ' + (feat ? 'yes – predictions will be computed' : 'no – reference data only') + '.</p>' +
      (v.excluded ? '<div class="note">' + v.excluded + ' row(s) failed validation and will <b>not</b> be included in any calculation.</div>' : '') +
      (v.warnings.length ? '<ul>' + v.warnings.map(function (w) { return '<li>' + h(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="controls"><label>Dataset name<input type="text" id="impName" value="' + h(name.replace(/\.csv$/i, '')) + '"></label><label>Status<select id="impStatus">' + opt(STATUS[0], STATUS[0], STATUS[1]) + opt(STATUS[1], STATUS[1], STATUS[1]) + '</select></label></div>' +
      '<p class="muted" style="font-size:12px">“Independently validated results” cannot be set at import. It requires an explicit, logged action in Data Provenance.</p>' +
      (v.excluded ? '<label class="flex" style="font-size:13px"><input type="checkbox" id="impAck"> I understand that ' + v.excluded + ' invalid row(s) are excluded.</label>' : '') +
      '<div class="flex" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="impGo">Add dataset</button></div>';
    openModal(body, function (box) {
      $('#impGo', box).onclick = function () {
        if (v.excluded && !$('#impAck', box).checked) { toast('Please confirm the excluded rows first'); return; }
        var id = 'IMPORT_' + Date.now().toString(36).toUpperCase(), st = $('#impStatus', box).value;
        var nd = { id: id, name: $('#impName', box).value || id, version: '1', created: new Date().toISOString().slice(0, 10), status: st, locked: false,
          source: 'CSV import: ' + name, method: 'User-provided file', dataType: st === STATUS[0] ? 'Synthetic' : 'Reference measurements (user-provided)',
          units: { vwc_ref: '% vol', gmax_ref: 'G', x: 'm', y: 'm', f1: 'dB', f4: 'slope', f7: 'index' },
          limitations: 'Imported by the user; values validated for type and range only. Provenance as stated by the user.', rows: v.rows };
        state.datasets.push(nd); state.activeId = id; state.session = 'ALL';
        state.log.push({ time: nowISO(), dataset: id, action: 'Imported', from: '', to: st, by: 'user', reason: v.rows.length + ' rows from ' + name + (v.excluded ? '; ' + v.excluded + ' invalid rows excluded' : '') });
        persist(); closeModal(); toast('Dataset added and activated'); render();
      };
    });
  }

  /* ---------- Analytics ---------- */
  function vAnalytics(el) {
    var d = ds(), u = state.ui.analytics, t = TARGETS[u.target];
    var res = getPred(d, u.target, u.method);
    var keep = d.rows.map(function (r, i) { return { r: r, p: res.pred[i] }; }).filter(function (o) { return state.session === 'ALL' || o.r.session === state.session; });
    var y = keep.map(function (o) { return o.r[u.target]; }), p = keep.map(function (o) { return o.p; });
    var m = S.metrics(y, p);
    var syn = d.status === STATUS[0];
    el.innerHTML = '<h1>Analytics Engine</h1><p class="lead">Reference vs predicted values, computed live from the active dataset. Choose the variable and how the predictions were produced.</p>' +
      '<div class="controls"><label>Variable<select id="aT">' + opt('vwc_ref', 'VWC – volumetric water content', u.target) + opt('gmax_ref', 'Gmax – impact hardness', u.target) + '</select></label>' +
      '<label>Predictions from<select id="aM">' + Object.keys(METHODS).map(function (k) { return opt(k, METHODS[k], u.method); }).join('') + '</select></label>' +
      '<label>Session<select id="aS"><option value="ALL">All sessions</option>' + sessionsOf(d).map(function (s) { return opt(s.id, s.id, state.session); }).join('') + '</select></label></div>' +
      (syn ? '<div class="note bad">Results from SYNTHETIC DEMONSTRATION DATA. They demonstrate the software, not the accuracy of VAYSHA.</div>' : '') +
      (u.method === 'insample' ? '<div class="note">In-sample fit: the model is tested on the same data it was trained on. This is optimistic and shown only for comparison.</div>' : '') +
      (u.method === 'kfold' ? '<div class="note info">Random K-fold mixes observations of the same session in training and test. Use LOSO or grouped CV for an estimate on unseen sessions.</div>' : '') +
      (res.warnings && res.warnings.length ? '<div class="note">' + res.warnings.map(h).join('<br>') + '</div>' : '') +
      (!m.ok ? '<div class="note bad">Not enough paired observations (n = ' + m.n + ', minimum ' + S.MIN_N + ') to compute metrics. No result is shown.</div>' :
        '<div class="grid g7" id="aKpi">' +
        kpi(m.n, 'N pairs', state.session === 'ALL' ? 'all sessions' : state.session) +
        kpi(fmt(m.rmse, 2), 'RMSE', t.unit) + kpi(fmt(m.mae, 2), 'MAE', t.unit) + kpi(fmt(m.r2, 3), 'R²', '1 − SSE/SST') +
        kpi(fmt(m.bias, 2), 'Mean error (bias)', 'pred − ref, ' + t.unit) + kpi(fmt(m.sdRes, 2), 'SD of residuals', t.unit) + kpi(fmt(m.r, 3), 'Pearson r', 'ref vs pred') + '</div>') +
      '<div class="grid g2" style="margin-top:14px"><div class="card chart"><h3>Reference vs predicted</h3><div id="aSc"></div></div><div class="card chart"><h3>Residuals (pred − ref)</h3><div id="aRes"></div></div>' +
      '<div class="card chart"><h3>Error distribution</h3><div id="aHist"></div></div><div class="card chart"><h3>Reference vs predicted mean by session</h3><div id="aBars"></div></div></div>' +
      '<p class="muted" style="font-size:12px">RMSE = √(mean((y − ŷ)²)) · MAE = mean(|y − ŷ|) · R² = 1 − SSE/SST · bias = mean(ŷ − y). Model: ' + h(CR.models.MODELS.ols3.label) + ', standardization fitted on each training fold only.</p>';
    var pts = keep.map(function (o) { return { x: o.r[u.target], y: o.p, label: o.r.obs_id }; });
    $('#aSc').innerHTML = CR.charts.scatter({ points: m.ok ? pts : [], fit: m.ok ? { slope: m.slope, intercept: m.intercept } : null, xLabel: 'Reference ' + t.short + ' (' + t.unit + ')', yLabel: 'Predicted ' + t.short + ' (' + t.unit + ')', emptyMsg: 'Insufficient data – no result' });
    $('#aRes').innerHTML = CR.charts.residuals({ points: m.ok ? keep.map(function (o) { return { x: o.r[u.target], y: o.p - o.r[u.target], label: o.r.obs_id }; }) : [], sd: m.sdRes, xLabel: 'Reference ' + t.short + ' (' + t.unit + ')', yLabel: 'Residual (' + t.unit + ')', emptyMsg: 'Insufficient data – no result' });
    $('#aHist').innerHTML = CR.charts.histogram({ values: m.ok ? keep.map(function (o) { return o.p - o.r[u.target]; }) : [], xLabel: 'Residual (' + t.unit + ')', emptyMsg: 'Insufficient data – no result' });
    var sess = sessionsOf(d).filter(function (s) { return state.session === 'ALL' || s.id === state.session; });
    $('#aBars').innerHTML = CR.charts.bars({ categories: sess.map(function (s) { return s.id; }), zero: false, yLabel: t.unit,
      series: [{ name: 'Reference', values: sess.map(function (s) { return S.mean(keep.filter(function (o) { return o.r.session === s.id; }).map(function (o) { return o.r[u.target]; })); }) },
        { name: 'Predicted', values: sess.map(function (s) { var v = keep.filter(function (o) { return o.r.session === s.id && isFinite(o.p); }).map(function (o) { return o.p; }); return v.length ? S.mean(v) : NaN; }) }] });
    $('#aT').onchange = function () { u.target = this.value; render(); };
    $('#aM').onchange = function () { u.method = this.value; render(); };
    $('#aS').onchange = function () { state.session = this.value; render(); };
  }

  /* ---------- Validation Lab ---------- */
  function vValidation(el) {
    var d = ds(), u = state.ui.val, t = TARGETS[u.target];
    el.innerHTML = '<h1>Model Validation Lab</h1><p class="lead">Runs real validation schemes on the active dataset. In every fold the model and its standardization are fitted on the training part only; the test part is used only for prediction.</p>' +
      (d.status === STATUS[0] ? '<div class="note bad">All results in this module come from SYNTHETIC DEMONSTRATION DATA.</div>' : '') +
      (!hasFeatures(d) ? '<div class="note">The active dataset has no CSI features (f1, f4, f7). Validation cannot run.</div>' : '') +
      '<div class="controls"><label>Target<select id="vT">' + opt('vwc_ref', 'VWC (% vol)', u.target) + opt('gmax_ref', 'Gmax (G)', u.target) + '</select></label>' +
      '<label>Scheme<select id="vM">' + ['loso', 'grouped', 'kfold'].map(function (k) { return opt(k, METHODS[k], u.method); }).join('') + '</select></label>' +
      '<label>k (folds)<input type="number" id="vK" min="2" max="20" value="' + u.k + '"' + (u.method === 'loso' ? ' disabled' : '') + '></label>' +
      '<label>Random seed<input type="number" id="vSeed" value="' + u.seed + '"' + (u.method === 'loso' ? ' disabled' : '') + '></label>' +
      '<label>Fold detail for<select id="vModel">' + Object.keys(CR.models.MODELS).map(function (k) { return opt(k, CR.models.MODELS[k].label, u.model); }).join('') + '</select></label>' +
      '<button class="btn" id="vRun"' + (hasFeatures(d) ? '' : ' disabled') + '>Run validation</button></div><div id="vOut"></div>';
    $('#vT').onchange = function () { u.target = this.value; u.result = null; render(); };
    $('#vM').onchange = function () { u.method = this.value; u.result = null; render(); };
    $('#vK').onchange = function () { u.k = Math.max(2, Math.min(20, +this.value || 5)); };
    $('#vSeed').onchange = function () { u.seed = +this.value || 1; };
    $('#vModel').onchange = function () { u.model = this.value; if (u.result) showVal(); };
    $('#vRun').onclick = function () {
      u.result = Object.keys(CR.models.MODELS).map(function (k) { return CR.validation.validate(d.rows, { method: u.method, model: k, target: u.target, k: u.k, seed: u.seed }); });
      u.result.dataset = d.id; showVal(); toast('Validation finished');
    };
    if (u.result && u.result.dataset === d.id) showVal();
  }
  function showVal() {
    var u = state.ui.val, t = TARGETS[u.target], R = u.result, out = $('#vOut');
    var sel = R.filter(function (r) { return r.model === u.model; })[0];
    var warn = R.map(function (r) { return r.warnings.join(' '); }).filter(Boolean);
    var html = (warn.length ? '<div class="note">' + h(warn[0]) + '</div>' : '') +
      '<h2>Model comparison · ' + h(METHODS[u.method]) + (u.method !== 'loso' ? ' · k = ' + u.k + ', seed ' + u.seed : '') + '</h2>' +
      '<div class="tablewrap"><table class="data"><thead><tr><th>Model</th><th>N</th><th>Folds</th><th>RMSE<br><span class="unit">' + t.unit + '</span></th><th>MAE<br><span class="unit">' + t.unit + '</span></th><th>R²</th><th>Bias<br><span class="unit">' + t.unit + '</span></th><th>Pearson r</th></tr></thead><tbody>' +
      R.map(function (r) { var m = r.pooled || {}; return '<tr><td>' + h(CR.models.MODELS[r.model].label) + '</td><td>' + r.n + '</td><td>' + r.folds.length + '</td><td>' + fmt(m.rmse, 2) + '</td><td>' + fmt(m.mae, 2) + '</td><td>' + fmt(m.r2, 3) + '</td><td>' + fmt(m.bias, 2) + '</td><td>' + fmt(m.r, 3) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted" style="font-size:12px">Pooled metrics over all out-of-fold predictions. The baseline predicts the training mean; a useful model must beat it.</p>' +
      '<div class="card chart" style="margin-top:12px"><h3>RMSE per fold (' + t.unit + ')</h3><div id="vBars"></div></div>' +
      '<h2>Folds · ' + h(CR.models.MODELS[u.model].label) + '</h2><div class="tablewrap"><table class="data"><thead><tr><th>Fold / test set</th><th>Train n</th><th>Test n</th><th>RMSE</th><th>MAE</th><th>R²</th><th>Bias</th><th class="l">Fitted coefficients (training only)</th></tr></thead><tbody>' +
      sel.folds.map(function (f) { var m = f.metrics || {}; return '<tr><td>' + h(f.name) + '</td><td>' + f.nTrain + '</td><td>' + f.nTest + '</td><td>' + fmt(m.rmse, 2) + '</td><td>' + fmt(m.mae, 2) + '</td><td>' + (m.n >= 3 ? fmt(m.r2, 3) : '–') + '</td><td>' + fmt(m.bias, 2) + '</td><td class="l mono">' +
        (f.error ? h(f.error) : 'b0 = ' + fmt(f.intercept, 3) + (f.coef || []).map(function (c, i) { return ' · ' + CR.models.MODELS[u.model].features[i].toUpperCase() + ' ' + fmt(c, 3); }).join('')) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted" style="font-size:12px">R² per fold is shown only for folds with at least 3 test observations; with 7 observations per session it is unstable and should be read with care.</p>';
    out.innerHTML = html;
    var names = R[0].folds.map(function (f) { return f.groups && f.groups.length === 1 ? f.groups[0] : f.name.replace(/ \(.*\)/, '').replace('Fold ', 'F'); });
    $('#vBars').innerHTML = CR.charts.bars({ categories: names, series: R.map(function (r) { return { name: CR.models.MODELS[r.model].label.replace('Linear regression · ', 'LR · '), values: r.folds.map(function (f) { return f.metrics ? f.metrics.rmse : NaN; }) }; }), yLabel: t.unit, height: 260, colors: ['#2A9DB8', '#69D0E6', '#B8C2CC'] });
  }

  /* ---------- Spatial Intelligence ---------- */
  function vSpatial(el) {
    var d = ds(), u = state.ui.spatial, sess = sessionsOf(d), all = enriched(d);
    var a = state.session === 'ALL' ? sess[0].id : state.session;
    if (!u.b || u.b === a) u.b = (sess.filter(function (s) { return s.id !== a; })[0] || sess[0]).id;
    var mm = metricMeta(u.metric);
    el.innerHTML = '<h1>Spatial Intelligence</h1><p class="lead">Inverse Distance Weighting: ẑ(x) = Σ wᵢzᵢ / Σ wᵢ, with wᵢ = 1 / dᵢᵖ. Measured input points and interpolated cells are drawn differently; cells farther than the coverage radius from any input point are not estimated.</p>' +
      '<div class="note info"><b>DEMONSTRATION INTERPOLATION — SYNTHETIC COORDINATES.</b> The field and point positions are invented for the demo and do not represent any real pitch.</div>' +
      '<div class="controls"><label>Variable<select id="sM">' + opt('vwc_ref', 'VWC (% vol)', u.metric) + opt('gmax_ref', 'Gmax (G)', u.metric) + opt('srs', 'SRS (from interpolated VWC and Gmax)', u.metric) + '</select></label>' +
      '<label>Session A<select id="sA">' + sess.map(function (s) { return opt(s.id, s.id + ' · ' + s.label, a); }).join('') + '</select></label>' +
      '<label>IDW power p = <b id="sPv">' + u.p + '</b><input type="range" id="sP" min="0.5" max="5" step="0.5" value="' + u.p + '"></label>' +
      '<label>Resolution<select id="sR">' + [0.5, 1, 2, 5].map(function (r) { return opt(r, r + ' × ' + r + ' m', u.res); }).join('') + '</select></label>' +
      '<label>Coverage radius = <b id="sCv">' + u.cover + '</b> m<input type="range" id="sC" min="10" max="80" step="5" value="' + u.cover + '"></label>' +
      '<label class="flex" style="flex-direction:row;align-items:center"><input type="checkbox" id="sCmp"' + (u.compare ? ' checked' : '') + '> Compare with</label>' +
      '<label>Session B<select id="sB"' + (u.compare ? '' : ' disabled') + '>' + sess.filter(function (s) { return s.id !== a; }).map(function (s) { return opt(s.id, s.id + ' · ' + s.label, u.b); }).join('') + '</select></label></div>' +
      '<div class="grid ' + (u.compare ? 'g3' : '') + '" id="sMaps"></div><div class="info" id="sInfo">Click a map to read a value.</div>' +
      '<h2>Input points · ' + h(a) + '</h2><div class="tablewrap"><table class="data"><thead><tr><th>Point</th><th>X <span class="unit">m</span></th><th>Y <span class="unit">m</span></th><th>VWC <span class="unit">% vol</span></th><th>Gmax <span class="unit">G</span></th><th>SRS</th></tr></thead><tbody>' +
      mapPoints(d, inSession(all, a), 'srs').map(function (p) { return '<tr><td>' + h(p.id) + '</td><td>' + fmt(p.x, 1) + '</td><td>' + fmt(p.y, 1) + '</td><td>' + fmt(p.vwc, 1) + '</td><td>' + fmt(p.g, 1) + '</td><td>' + fmt(p.z, 3) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var maps = [{ id: a, title: 'Session ' + a }];
    if (u.compare) maps.push({ id: u.b, title: 'Session ' + u.b }, { diff: true, title: 'Difference A − B' });
    var built = maps.filter(function (m) { return !m.diff; }).map(function (m) { var pts = mapPoints(d, inSession(all, m.id), u.metric); return { pts: pts, grid: buildGrid(d, pts, u.metric, u) }; });
    var allz = []; built.forEach(function (b) { b.grid.cells.forEach(function (c) { if (c.covered && isFinite(c.z)) allz.push(c.z); }); b.pts.forEach(function (p) { allz.push(p.z); }); });
    var vmin = S.min(allz), vmax = S.max(allz);
    var diff = null;
    if (u.compare) {
      diff = { nx: built[0].grid.nx, ny: built[0].grid.ny, res: u.res, cells: built[0].grid.cells.map(function (c, i) { var c2 = built[1].grid.cells[i]; return Object.assign({}, c, { z: c.z - c2.z, covered: c.covered && c2.covered }); }) };
      var dz = diff.cells.filter(function (c) { return c.covered; }).map(function (c) { return Math.abs(c.z); }), dm = S.max(dz) || 1;
      diff.vmin = -dm; diff.vmax = dm;
    }
    $('#sMaps').innerHTML = maps.map(function (m, i) { return '<div class="card"><h3>' + h(m.title) + '</h3><div class="mapwrap"><canvas data-i="' + i + '"></canvas></div><div class="lg"></div></div>'; }).join('');
    $$('#sMaps canvas').forEach(function (cv, i) {
      var m = maps[i], isD = !!m.diff, grid = isD ? diff : built[i].grid, pts = isD ? built[0].pts : built[i].pts;
      var o = { field: fieldOf(d), grid: grid, points: pts, kind: isD ? 'diff' : mm.kind, vmin: isD ? diff.vmin : vmin, vmax: isD ? diff.vmax : vmax, sel: u.sel };
      var toField = drawMap(cv, o);
      cv.parentNode.nextSibling.innerHTML = legendHTML(o.kind, o.vmin, o.vmax, mm.unit) + (isD ? '<div class="legend">blue = A lower than B · red = A higher than B</div>' : '');
      cv.onclick = function (e) {
        var p = toField(e); if (!p) return; u.sel = p;
        var res = Math.max(0, Math.min(grid.cells.length - 1, Math.floor(p.y / u.res) * grid.nx + Math.floor(p.x / u.res)));
        var c = grid.cells[res];
        $('#sInfo').innerHTML = '<b>' + h(m.title) + '</b> · ' + cellInfo(p, Object.assign({}, c, { dmin: c.dmin }), isD ? { name: 'Δ ' + mm.name, unit: mm.unit, d: mm.d } : mm, isD ? [] : pts) + ' · cell ' + u.res + ' × ' + u.res + ' m';
        $$('#sMaps canvas').forEach(function (cv2, k) { var mk = maps[k], dd = !!mk.diff; drawMap(cv2, { field: fieldOf(d), grid: dd ? diff : built[k].grid, points: dd ? built[0].pts : built[k].pts, kind: dd ? 'diff' : mm.kind, vmin: dd ? diff.vmin : vmin, vmax: dd ? diff.vmax : vmax, sel: p }); });
      };
    });
    $('#sM').onchange = function () { u.metric = this.value; render(); };
    $('#sA').onchange = function () { state.session = this.value; render(); };
    $('#sP').oninput = function () { u.p = +this.value; $('#sPv').textContent = u.p; };
    $('#sP').onchange = function () { u.p = +this.value; render(); };
    $('#sR').onchange = function () { u.res = +this.value; render(); };
    $('#sC').oninput = function () { u.cover = +this.value; $('#sCv').textContent = u.cover; };
    $('#sC').onchange = function () { u.cover = +this.value; render(); };
    $('#sCmp').onchange = function () { u.compare = this.checked; render(); };
    $('#sB').onchange = function () { u.b = this.value; render(); };
  }

  /* ---------- Surface Risk Engine ---------- */
  function vSRS(el) {
    var d = ds(), u = state.ui.srs, D = CR.srs.DEF, rows = inSession(enriched(d), state.session);
    el.innerHTML = '<h1>Surface Risk Engine</h1><p class="lead">Surface Risk Score from the Point Surface methodology (definition lock, Appendix P9): SRS = 0.4 × Moist_dev + 0.6 × Hard_dev, with Moist_dev = |VWC − VWC_opt| / VWC_opt and Hard_dev = |Gmax − G_opt| / G_opt; VWC_opt = 23 % vol, G_opt = 80 G.</p>' +
      '<div class="note bad">SRS is an analytical surface deviation indicator. It is not a medical, clinical, injury prediction or sports-surface certification index.</div>' +
      '<div class="grid g2"><div class="card"><h3>Calculator</h3><div class="controls"><label>VWC (% vol)<input type="range" id="rV" min="10" max="40" step="0.1" value="' + u.vwc + '"></label><label>&nbsp;<input type="number" id="rVn" min="0" max="60" step="0.1" value="' + u.vwc + '"></label></div>' +
      '<div class="controls"><label>Gmax (G)<input type="range" id="rG" min="40" max="160" step="0.5" value="' + u.g + '"></label><label>&nbsp;<input type="number" id="rGn" min="0" max="300" step="0.5" value="' + u.g + '"></label></div><div id="rOut"></div></div>' +
      '<div class="card"><h3>Formula and thresholds</h3><div class="formula">SRS = 0.4 · |VWC − 23| / 23 + 0.6 · |Gmax − 80| / 80</div>' +
      '<div class="tablewrap"><table class="data"><thead><tr><th>Class</th><th>Range</th><th class="l">Meaning</th></tr></thead><tbody><tr><td><span class="tag L">SRS-L</span></td><td>SRS ≤ 0.35</td><td class="l">Low deviation</td></tr><tr><td><span class="tag M">SRS-M</span></td><td>0.35 < SRS ≤ 0.65</td><td class="l">Medium deviation</td></tr><tr><td><span class="tag H">SRS-H</span></td><td>SRS > 0.65</td><td class="l">High deviation</td></tr></tbody></table></div>' +
      '<p class="muted" style="font-size:12px;margin-top:10px">Thresholds as documented in the methodology. TR-1 and TR-2 are not formally defined there and are not shown. TR-3 is defined as a spatial cluster rule on SRS-H cells; it requires the Confidence Gate (τ) of the full system and is not applied in this demo. Reference values are applied symmetrically (wet and dry, soft and hard deviations count the same).</p></div></div>' +
      '<h2>Observations · ' + h(sessLabel(d, state.session)) + '</h2><div class="tablewrap"><table class="data"><thead><tr><th>Observation</th><th>VWC</th><th>Gmax</th><th>Moist_dev</th><th>Hard_dev</th><th>0.4·M</th><th>0.6·H</th><th>SRS</th><th class="l">Class</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + h(r.obs_id) + '</td><td>' + fmt(r.vwc_ref, 1) + '</td><td>' + fmt(r.gmax_ref, 1) + '</td><td>' + fmt(r.moist_dev, 3) + '</td><td>' + fmt(r.hard_dev, 3) + '</td><td>' + fmt(0.4 * r.moist_dev, 3) + '</td><td>' + fmt(0.6 * r.hard_dev, 3) + '</td><td><b>' + fmt(r.srs, 3) + '</b></td><td class="l"><span class="tag ' + r.cls + '">SRS-' + r.cls + '</span></td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted" style="font-size:12px">Class counts: ' + ['L', 'M', 'H'].map(function (k) { return 'SRS-' + k + ' ' + rows.filter(function (r) { return r.cls === k; }).length; }).join(' · ') + ' (n = ' + rows.length + ').</p>';
    function upd() {
      var s = CR.srs.compute(u.vwc, u.g);
      var m = D.wMoist * s.moistDev, hh = D.wHard * s.hardDev, tot = m + hh || 1, pos = Math.min(100, s.srs * 100);
      $('#rOut').innerHTML = '<div class="grid g2" style="margin:6px 0 12px">' + kpi(fmt(s.moistDev, 3), 'Moist_dev', '|' + fmt(u.vwc, 1) + ' − 23| / 23') + kpi(fmt(s.hardDev, 3), 'Hard_dev', '|' + fmt(u.g, 1) + ' − 80| / 80') + '</div>' +
        '<div class="muted" style="font-size:12px;margin-bottom:4px">Weighted contributions (weights 0.4 and 0.6)</div><div class="contrib"><div style="width:' + (m / tot * 100) + '%;background:#2A9DB8">' + (m > 0.02 ? '0.4·M = ' + fmt(m, 3) : '') + '</div><div style="width:' + (hh / tot * 100) + '%;background:#1E2A38">' + (hh > 0.02 ? '0.6·H = ' + fmt(hh, 3) : '') + '</div></div>' +
        '<div style="margin:16px 0 6px;display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:26px;font-weight:700">SRS = ' + fmt(s.srs, 3) + '</span><span class="tag ' + s.cls + '">SRS-' + s.cls + ' · ' + s.label + '</span></div>' +
        '<div class="gauge"><div class="mk" style="left:calc(' + pos + '% - 1px)"></div></div><div class="flex muted" style="justify-content:space-between;font-size:11px"><span>0</span><span>0.35</span><span>0.65</span><span>1.0+</span></div>' +
        (s.srs > 1 ? '<div class="note">SRS above 1.0: the inputs are far outside the documented demo ranges.</div>' : '');
    }
    function bind(r, n, key) {
      $(r).oninput = function () { u[key] = +this.value; $(n).value = this.value; upd(); };
      $(n).oninput = function () { var v = +this.value; if (!isFinite(v) || this.value === '') { $('#rOut').innerHTML = '<div class="note bad">Enter a numeric value.</div>'; return; } u[key] = v; $(r).value = v; upd(); };
    }
    bind('#rV', '#rVn', 'vwc'); bind('#rG', '#rGn', 'g'); upd();
  }

  /* ---------- Report ---------- */
  function vReport(el) {
    var d = ds(), u = state.ui.report;
    if (!u.name) u.name = fieldOf(d).name;
    el.innerHTML = '<h1>Report Generator</h1><p class="lead">Builds a technical PDF report from the active dataset and session: KPIs, measurement table, model performance charts, spatial map, SRS analysis, methodology and limitations.</p>' +
      (d.status === STATUS[0] ? '<div class="note bad">The report will be marked SYNTHETIC DEMONSTRATION DATA on every page.</div>' : '') +
      '<div class="card"><div class="controls"><label>Field name<input type="text" id="pName" value="' + h(u.name) + '" style="min-width:240px"></label>' +
      '<label>Session<select id="pSess"><option value="ALL">All sessions</option>' + sessionsOf(d).map(function (s) { return opt(s.id, s.id + ' · ' + s.label, state.session); }).join('') + '</select></label>' +
      '<label>Map layer<select id="pLayer">' + opt('vwc_ref', 'VWC', 'vwc_ref') + opt('gmax_ref', 'Gmax', '') + opt('srs', 'SRS', '') + '</select></label>' +
      '<button class="btn cyan" id="pGo"' + (window.jspdf ? '' : ' disabled') + '>Generate PDF</button></div>' +
      (window.jspdf ? '' : '<div class="note bad">The PDF library did not load. Check that vendor/jspdf.umd.min.js is deployed.</div>') +
      '<p class="muted" style="font-size:12px;margin:0">Contents: 1 Summary and KPIs · 2 Measurements · 3 Model performance (LOSO) · 4 Spatial map · 5 Surface Risk Score · 6 Methodology · 7 Limitations and data provenance.</p></div>';
    $('#pName').oninput = function () { u.name = this.value; };
    $('#pSess').onchange = function () { state.session = this.value; renderShell(); };
    $('#pGo').onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Generating…';
      makeReport($('#pLayer').value).then(function (r) { download(r.name, r.blob); })
        .catch(function (e) { console.error(e); toast('PDF failed: ' + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = 'Generate PDF'; });
    };
  }
  function svgToPng(svg, w) {
    return new Promise(function (res, rej) {
      var img = new Image(), vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg), W = +vb[1], H = +vb[2], k = (w || 1040) / W;
      img.onload = function () { var c = document.createElement('canvas'); c.width = W * k; c.height = H * k; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); res({ data: c.toDataURL('image/jpeg', 0.92), w: W, h: H }); };
      img.onerror = function () { rej(new Error('chart rendering failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('width="100%"', 'width="' + W + '" height="' + H + '"'));
    });
  }
  function makeReport(layer) {
    var d = ds(), all = enriched(d), rows = inSession(all, state.session), mm = metricMeta(layer);
    var mv = getPred(d, 'vwc_ref', 'loso'), mg = getPred(d, 'gmax_ref', 'loso');
    function m(res, t) { var y = [], p = []; d.rows.forEach(function (r, i) { if (state.session === 'ALL' || r.session === state.session) { y.push(r[t]); p.push(res.pred[i]); } }); return S.metrics(y, p); }
    var metV = m(mv, 'vwc_ref'), metG = m(mg, 'gmax_ref');
    function sc(res, t, met) { var pts = []; d.rows.forEach(function (r, i) { if (state.session === 'ALL' || r.session === state.session) pts.push({ x: r[t], y: res.pred[i] }); }); return CR.charts.scatter({ points: met.ok ? pts : [], fit: met.ok ? met : null, xLabel: 'Reference ' + TARGETS[t].short + ' (' + TARGETS[t].unit + ')', yLabel: 'Predicted (' + TARGETS[t].unit + ')', width: 520, height: 360, emptyMsg: 'Insufficient data' }); }
    var pts = mapPoints(d, rows, layer), grid = buildGrid(d, pts, layer, { p: 2, res: 1, cover: 35 });
    var zs = grid.cells.filter(function (c) { return c.covered && isFinite(c.z); }).map(function (c) { return c.z; }).concat(pts.map(function (p) { return p.z; }));
    var cv = document.createElement('canvas');
    drawMap(cv, { field: fieldOf(d), grid: grid, points: pts, kind: mm.kind, vmin: S.min(zs), vmax: S.max(zs) });
    return Promise.all([svgToPng(sc(mv, 'vwc_ref', metV)), svgToPng(sc(mg, 'gmax_ref', metG))]).then(function (imgs) {
      return CR.report.generate({
        jsPDF: window.jspdf.jsPDF, ds: d, fieldName: state.ui.report.name || fieldOf(d).name, field: fieldOf(d), session: state.session, sessionLabel: sessLabel(d, state.session), sessions: sessionsOf(d),
        rows: rows, metV: metV, metG: metG, imgV: imgs[0], imgG: imgs[1], map: { data: cv.toDataURL('image/jpeg', 0.92), w: cv.width, h: cv.height, layer: mm, vmin: S.min(zs), vmax: S.max(zs), ramp: CR.charts.ramp },
        srsDef: CR.srs.DEF, hasFeatures: hasFeatures(d), log: state.log.filter(function (l) { return l.dataset === d.id; })
      });
    });
  }

  /* ---------- Data Provenance ---------- */
  function vProvenance(el) {
    el.innerHTML = '<h1>Data Provenance</h1><p class="lead">Origin, status and limitations of every dataset. Status levels: SYNTHETIC DEMO → EXPERIMENTAL REFERENCE DATA → INDEPENDENTLY VALIDATED RESULTS. A status changes only by an explicit action, which is written to the log.</p>' +
      state.datasets.map(function (x) { return provCard(x); }).join('') +
      '<div class="card" style="margin-top:14px"><div class="flex" style="justify-content:space-between"><h3 style="margin:0">Terrain 1 experimental file (N = 56)</h3><span class="tag exp">EXPERIMENTAL REFERENCE DATA</span></div>' +
      '<p class="muted" style="margin:8px 0 0">Not loaded in this demo. The file contains 56 TDR and Clegg reference observations in 8 sessions, but no CSI features or per-observation coordinates, so its models cannot be reproduced. It stays outside the demo until the raw data are available. No values from it are used here.</p></div>' +
      '<h2>Provenance log</h2><div class="tablewrap"><table class="data"><thead><tr><th>Time</th><th class="l">Dataset</th><th class="l">Action</th><th class="l">From</th><th class="l">To</th><th class="l">By</th><th class="l">Reason / record</th></tr></thead><tbody>' +
      state.log.slice().reverse().map(function (l) { return '<tr><td>' + h(l.time) + '</td><td class="l">' + h(l.dataset) + '</td><td class="l">' + h(l.action) + '</td><td class="l">' + h(l.from) + '</td><td class="l">' + h(l.to) + '</td><td class="l">' + h(l.by) + '</td><td class="l" style="white-space:normal">' + h(l.reason) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="flex" style="margin-top:10px"><button class="btn ghost small" id="logCsv">Export log (CSV)</button><button class="btn ghost small" id="dsJson">Export active dataset (JSON)</button></div>';
    $$('[data-chg]', el).forEach(function (b) { b.onclick = function () { statusModal(b.dataset.chg); }; });
    $$('[data-use]', el).forEach(function (b) { b.onclick = function () { state.activeId = b.dataset.use; state.session = 'ALL'; render(); }; });
    $$('[data-rules]', el).forEach(function (b) { b.onclick = function () { var x = state.datasets.filter(function (q) { return q.id === b.dataset.rules; })[0]; openModal('<h3>Generation rules · ' + h(x.id) + '</h3><ol style="font-size:13px">' + x.rules.map(function (r) { return '<li>' + h(r) + '</li>'; }).join('') + '</ol><div class="flex" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>'); }; });
    $('#logCsv').onclick = function () { download('vaysha_provenance_log.csv', CR.csv.toCSV(state.log, ['time', 'dataset', 'action', 'from', 'to', 'by', 'reason'].map(function (k) { return { key: k }; })), 'text/csv'); };
    $('#dsJson').onclick = function () { var x = Object.assign({}, ds()); delete x._cache; download(x.id + '.json', JSON.stringify(x, null, 2), 'application/json'); };
  }
  function provCard(x) {
    var f = [['Dataset ID', x.id], ['Version', x.version || '1'], ['Created', x.created], ['Source', x.source], ['Observations', x.rows.length], ['Units', Object.keys(x.units || {}).map(function (k) { return k + ': ' + x.units[k]; }).join(' · ')], ['Data type', x.dataType], ['Method', x.method], ['Limitations', x.limitations]];
    return '<div class="card" style="margin-top:14px"><div class="flex" style="justify-content:space-between"><h3 style="margin:0">' + h(x.name || x.id) + (x.id === state.activeId ? ' <span class="tag">ACTIVE</span>' : '') + '</h3><span class="tag ' + statusClass(x.status) + '">' + h(x.status) + '</span></div>' +
      '<table class="data" style="margin-top:8px"><tbody>' + f.map(function (r) { return '<tr><td style="width:150px">' + h(r[0]) + '</td><td class="l" style="white-space:normal">' + h(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="flex" style="margin-top:10px">' + (x.id !== state.activeId ? '<button class="btn ghost small" data-use="' + h(x.id) + '">Make active</button>' : '') + (x.rules ? '<button class="btn ghost small" data-rules="' + h(x.id) + '">Generation rules</button>' : '') +
      (x.locked ? '<span class="muted" style="font-size:12px">Status locked: a synthetic dataset can never be promoted to experimental or validated.</span>' : '<button class="btn small" data-chg="' + h(x.id) + '">Change status…</button>') + '</div></div>';
  }
  function statusModal(id) {
    var x = state.datasets.filter(function (q) { return q.id === id; })[0];
    openModal('<h3>Change status · ' + h(x.name || x.id) + '</h3><p class="muted">Current status: <b>' + h(x.status) + '</b>. The change and its justification are written to the provenance log.</p>' +
      '<div class="controls" style="flex-direction:column;align-items:stretch"><label>New status<select id="stNew">' + STATUS.filter(function (s) { return s !== x.status; }).map(function (s) { return opt(s, s, ''); }).join('') + '</select></label>' +
      '<label>Reason (required)<input type="text" id="stWhy" placeholder="Why the status changes"></label>' +
      '<label>Reviewer / validating body<input type="text" id="stWho" placeholder="Required for INDEPENDENTLY VALIDATED RESULTS"></label>' +
      '<label>Reference (report, DOI, protocol no.)<input type="text" id="stRef" placeholder="Required for INDEPENDENTLY VALIDATED RESULTS"></label></div>' +
      '<label class="flex" style="font-size:13px"><input type="checkbox" id="stOk"> I confirm this change is justified by the record above.</label><div id="stErr"></div>' +
      '<div class="flex" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="stGo">Apply and log</button></div>', function (box) {
        $('#stGo', box).onclick = function () {
          var to = $('#stNew', box).value, why = $('#stWhy', box).value.trim(), who = $('#stWho', box).value.trim(), ref = $('#stRef', box).value.trim(), err = [];
          if (!why) err.push('A reason is required.');
          if (to === STATUS[2] && (!who || !ref)) err.push('Independent validation needs a reviewer and a reference.');
          if (!$('#stOk', box).checked) err.push('Please confirm the change.');
          if (err.length) { $('#stErr', box).innerHTML = '<div class="note bad">' + err.join('<br>') + '</div>'; return; }
          state.log.push({ time: nowISO(), dataset: x.id, action: 'Status change', from: x.status, to: to, by: who || 'user', reason: why + (ref ? ' · ref: ' + ref : '') });
          x.status = to; persist(); closeModal(); toast('Status changed and logged'); render();
        };
      });
  }

  /* ---------- modal + walkthrough ---------- */
  function openModal(html, bind) {
    var m = $('#modal'); m.innerHTML = '<div class="box">' + html + '</div>'; m.classList.remove('hidden');
    $$('[data-close]', m).forEach(function (b) { b.onclick = closeModal; });
    m.onclick = function (e) { if (e.target === m) closeModal(); };
    if (bind) bind(m);
    var f = m.querySelector('input,select,button'); if (f) f.focus();
  }
  function closeModal() { var m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }
  var WALK = [
    ['explorer', '1 · Dataset', 'The synthetic demo dataset: 56 observations, 8 sessions, 7 points. Filter, sort, search, export – or import your own CSV. Every value is labelled as synthetic.'],
    ['analytics', '2 · Analytics', 'Reference vs predicted values with RMSE, MAE, R², bias, residual SD and Pearson r – recomputed whenever the dataset, session or prediction method changes.'],
    ['validation', '3 · Validation', 'Real K-fold, grouped and Leave-One-Session-Out validation. The model is refitted in every fold on training data only. Press “Run validation”.'],
    ['spatial', '4 · Spatial Intelligence', 'IDW interpolation on a demo field. Change the power p, the resolution and the coverage radius, or compare two sessions.'],
    ['srs', '5 · Surface Risk', 'The Surface Risk Score from the methodology. Move the sliders and see the deviations, the weights and the class.'],
    ['report', '6 · Report', 'Generate a technical PDF report for the selected session, with the synthetic-data label on every page.']
  ];
  function startWalk(i) {
    if (!state.started) { state.started = true; state.activeId = state.datasets[0].id; }
    var w = $('#walk'), s = WALK[i]; go(s[0]);
    w.innerHTML = '<div class="step">Guided walkthrough · step ' + (i + 1) + ' of ' + WALK.length + '</div><h3>' + h(s[1]) + '</h3><p>' + h(s[2]) + '</p><div class="row"><button class="btn ghost small" id="wX">Close</button>' +
      (i > 0 ? '<button class="btn ghost small" id="wB">Back</button>' : '') + (i < WALK.length - 1 ? '<button class="btn small" id="wN">Next</button>' : '<button class="btn small" id="wD">Finish</button>') + '</div>';
    w.classList.remove('hidden');
    $('#wX').onclick = function () { w.classList.add('hidden'); };
    if ($('#wB')) $('#wB').onclick = function () { startWalk(i - 1); };
    if ($('#wN')) $('#wN').onclick = function () { startWalk(i + 1); };
    if ($('#wD')) $('#wD').onclick = function () { w.classList.add('hidden'); go('dashboard'); };
  }

  /* ---------- global events ---------- */
  function bindGlobal() {
    $('#nav').onclick = function (e) { var b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); };
    $('#dsSelect').onchange = function () { state.activeId = this.value; state.session = 'ALL'; state.ui.val.result = null; render(); };
    $('#sessSelect').onchange = function () { state.session = this.value; render(); };
    $('#walkBtn').onclick = function () { startWalk(0); };
    $('#resetBtn').onclick = function () {
      openModal('<h3>Reset demo</h3><p>Restore the initial state: the synthetic dataset only, imported datasets and the provenance log removed, all settings back to default.</p><div class="flex" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="rsGo">Reset</button></div>', function (box) {
        $('#rsGo', box).onclick = function () { store.clear(); init(); closeModal(); $('#walk').classList.add('hidden'); toast('Demo reset'); go('home'); };
      });
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
  }

  init(); bindGlobal();
  (function () { var hv = location.hash.slice(1); if (VIEWS.some(function (v) { return v[0] === hv; })) state.view = hv; })();
  render();
  window.addEventListener('hashchange', function () { var hv = location.hash.slice(1); if (VIEWS.some(function (v) { return v[0] === hv; }) && hv !== state.view) go(hv); });
  window.CreaminoApp = { state: function () { return state; }, go: go, startDemo: startDemo, makeReport: makeReport };
})();
