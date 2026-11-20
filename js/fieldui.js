/* Creamino Field Session – user interface (module "Field Session" in Creamino Lab).
   Real field data only (origin "real" or "test"); never reads the synthetic demo datasets. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var F = CR.field, ST = CR.fieldStore;
  var ACTIVE_KEY = 'creamino_field_active';
  var ui = { session: null, sessions: [], ready: false, storageOk: true, tab: 'CSI', filter: 'ALL', msg: null, lastSaved: null };
  var host = null, hooks = {};

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) { (hooks.toast || alert)(m); }
  function pct(v) { return v === null || v === undefined ? '–' : Math.round(v * 100) + ' %'; }
  function nowLocalInput() { var d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function toUTC(v) { if (!v) return ''; var t = new Date(v); return isFinite(t) ? t.toISOString() : v; }
  function getActive() { try { return localStorage.getItem(ACTIVE_KEY); } catch (e) { return null; } }
  function setActive(id) { try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch (e) { } }
  function draftKey(type) { return 'creamino_field_draft_' + (ui.session ? ui.session.session_id : '') + '_' + type; }
  function download(name, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function save() {
    return ST.saveSession(ui.session).then(function () { ui.lastSaved = new Date(); }, function (e) { ui.msg = { kind: 'bad', text: 'Saving failed: ' + e.message + ' – export the session now.' }; });
  }
  function loadAll() {
    return ST.open().then(function (ok) {
      ui.storageOk = ok && !ST.usingMemory();
      return ST.listSessions();
    }).then(function (list) {
      ui.sessions = list.sort(function (a, b) { return b.created_utc.localeCompare(a.created_utc); });
      var id = getActive();
      ui.session = id ? (list.filter(function (s) { return s.session_id === id; })[0] || null) : null;
      ui.ready = true;
    });
  }

  /* ---------- render ---------- */
  function render(el, hk) {
    host = el || host; hooks = hk || hooks;
    if (!ui.ready) { host.innerHTML = '<h1>Field Session</h1><p class="lead">Opening local storage…</p>'; loadAll().then(function () { render(); }); return; }
    if (hooks.shell) hooks.shell(ui.session);
    host.innerHTML = ui.session ? sessionView() : startView();
    bind();
  }
  function storageNote() {
    if (!ui.storageOk) return '<div class="note bad"><b>Local storage is not available in this browser mode.</b> Data are kept only in memory and are lost when the tab closes. Use a normal (not private) window, or export after every record.</div>';
    return '';
  }
  function msgHTML() { if (!ui.msg) return ''; var m = ui.msg; ui.msg = null; return '<div class="note ' + (m.kind || 'info') + '" role="status">' + h(m.text) + '</div>'; }

  function startView() {
    var list = ui.sessions.map(function (s) {
      var ev = F.evaluate(s);
      return '<tr><td class="l mono">' + h(s.session_id) + '</td><td class="l">' + h(s.site_id) + '</td><td class="l">' + h(s.session_date) + '</td><td class="l"><span class="tag ' + (s.data_origin === 'real' ? 'exp' : '') + '">' + h(s.data_origin.toUpperCase()) + '</span></td><td class="l">' + h(s.status) + '</td><td>' + ev.metrics.measurements + '</td><td>' + ev.metrics.pairs_valid + '</td><td><button class="btn small" data-open="' + h(s.session_id) + '">Open</button></td></tr>';
    }).join('');
    return '<h1>Field Session</h1><p class="lead">Collection of real CSI, TDR and Clegg measurements for local calibration. Data stay in this browser until you export them. The synthetic demo data are not used here.</p>' +
      storageNote() + msgHTML() +
      '<div class="note">' + h(F.CALIBRATION_MESSAGE) + '</div>' +
      (ui.sessions.length ? '<h2>Sessions on this device</h2><div class="tablewrap"><table class="data"><thead><tr><th class="l">Session ID</th><th class="l">Site</th><th class="l">Date</th><th class="l">Origin</th><th class="l">Status</th><th>Records</th><th>Valid pairs</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' : '') +
      '<h2>New measurement session</h2><form id="fNew" class="card" autocomplete="off">' +
      '<div class="controls">' +
      '<label>Site ID<input type="text" name="site_id" value="LAZUR" required></label>' +
      '<label>Site name<input type="text" name="site_name" value="Стадион „Лазур“, Бургас" style="min-width:220px"></label>' +
      '<label>Field ID<input type="text" name="field_id" value="MAIN"></label>' +
      '<label>Session date<input type="date" name="session_date" value="' + nowLocalInput().slice(0, 10) + '" required></label>' +
      '<label>Session no.<input type="number" name="seq" value="' + (ui.sessions.length + 1) + '" min="1" max="99"></label>' +
      '<label>Operator<input type="text" name="operator_id" placeholder="initials or ID"></label>' +
      '<label>Data origin<select name="data_origin"><option value="real">REAL – field measurements</option><option value="test">TEST – rehearsal / equipment test</option></select></label></div>' +
      '<h3>Device and CSI configuration</h3><div class="controls">' +
      '<label>Device ID<input type="text" name="device_id"></label><label>Device model<input type="text" name="device_model"></label>' +
      '<label>Firmware<input type="text" name="firmware_version"></label><label>Wi-Fi channel<input type="number" name="wifi_channel" min="1" max="196"></label>' +
      '<label>Bandwidth (MHz)<select name="bandwidth"><option value=""></option><option>20</option><option>40</option><option>80</option><option>160</option></select></label>' +
      '<label>Subcarriers<input type="number" name="subcarrier_count" min="1"></label><label>CSI window (s)<input type="number" name="window_duration" min="1" step="0.1"></label></div>' +
      '<div class="controls"><label style="flex:1">Measurement configuration (antenna layout, distances, heights)<input type="text" name="configuration" style="width:100%"></label></div>' +
      '<h3>Grid and QC limits</h3><div class="controls">' +
      '<label>Field length (m)<input type="number" name="length_m" value="105" step="0.1"></label><label>Field width (m)<input type="number" name="width_m" value="68" step="0.1"></label>' +
      '<label>Grid cell (m)<input type="number" name="cell_m" value="10" step="0.5"></label>' +
      '<label>Max packet loss (%)<input type="number" name="max_packet_loss" value="' + F.DEFAULT_QC.max_packet_loss + '" step="0.1"></label>' +
      '<label>Min CSI window (s)<input type="number" name="min_window_s" value="' + F.DEFAULT_QC.min_window_s + '"></label>' +
      '<label>Pair: max Δt (min)<input type="number" name="match_max_dt_min" value="' + F.DEFAULT_QC.match_max_dt_min + '"></label>' +
      '<label>Pair: max distance (m)<input type="number" name="match_max_dist_m" value="' + F.DEFAULT_QC.match_max_dist_m + '" step="0.1"></label></div>' +
      '<p class="muted" style="margin:4px 0 10px">Grid cells are named by column letter (along the length, from the origin corner) and row number (along the width): A1, B1, … Coordinates are metres from the same corner.</p>' +
      '<button class="btn cyan" type="submit" id="fCreate">Create session</button></form>' +
      '<h2>Restore a session</h2><div class="card"><p class="muted" style="margin-top:0">From a JSON export of this module (e.g. on another device). Raw files are restored separately from the ZIP package.</p><input type="file" id="fImport" accept=".json,application/json"></div>';
  }

  function kpi(v, l, s) { return '<div class="card kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function qcTag(st) { var c = st === 'PASS' ? 'L' : st === 'WARNING' ? 'M' : st === 'FAIL' ? 'H' : ''; return '<span class="tag ' + c + '">' + st + '</span>'; }

  function sessionView() {
    var s = ui.session, ev = F.evaluate(s), M = ev.metrics, g = F.grid(s.grid);
    var origin = s.data_origin === 'real' ? '<span class="tag exp">REAL FIELD DATA</span>' : '<span class="tag">TEST DATA – not for calibration</span>';
    var html = '<div class="flex" style="justify-content:space-between"><h1 style="margin:0">Field Session <span class="mono" style="font-size:16px">' + h(s.session_id) + '</span></h1><button class="btn ghost small" id="fClose">Sessions list</button></div>' +
      '<p class="lead" style="margin-top:6px">' + h(s.site_name) + ' · ' + h(s.site_id) + ' / ' + h(s.field_id) + ' · ' + h(s.session_date) + ' · ' + origin + '</p>' +
      storageNote() + msgHTML() +
      '<div class="note" style="font-size:13px"><b>INITIAL CALIBRATION — ' + h(s.site_id) + '</b><br>' + h(F.CALIBRATION_MESSAGE) + '</div>';
    /* dashboard */
    html += '<h2>Session dashboard</h2><div class="grid g4">' +
      kpi('<span style="font-size:17px">' + h(s.status) + '</span>', 'Session status', 'mode: initial calibration') +
      kpi(M.measurements, 'Measurement count', M.revisions ? M.revisions + ' superseded revisions kept' : 'current records') +
      kpi(M.csi, 'CSI records', M.raw_files + ' raw files stored') +
      kpi(M.tdr + ' / ' + M.clegg, 'TDR / Clegg records', 'reference measurements') +
      kpi(M.pairs_valid + '<span class="unit"> of ' + M.pairs_total + '</span>', 'Matched CSI–reference pairs', 'valid / all · ' + M.csi_with_valid_reference + ' CSI with a valid reference') +
      kpi(pct(M.qc_pass_rate), 'QC pass rate', 'PASS ' + M.qc.PASS + ' · WARN ' + M.qc.WARNING + ' · FAIL ' + M.qc.FAIL + ' · INCOMPL. ' + M.qc.INCOMPLETE) +
      kpi(pct(M.completeness), 'Data completeness', 'required fields filled') +
      kpi(M.session_missing.length || '0', 'Missing session metadata', h(M.session_missing.join(', ') || 'none')) + '</div>';
    html += '<div class="flex" style="margin-top:10px"><span class="muted">Status:</span>' +
      ['IN PROGRESS', 'CALIBRATION'].map(function (st) { return '<button class="btn ghost small" data-status="' + st + '"' + (s.status === st ? ' disabled' : '') + '>' + st + '</button>'; }).join('') +
      '<button class="btn small" id="fFinish">Close session</button><span class="muted" style="font-size:12px">Close → COMPLETED, or REVIEW REQUIRED if any record FAILS or is INCOMPLETE.</span>' +
      '<span class="muted" style="margin-left:auto;font-size:12px">' + (ui.lastSaved ? 'Saved locally ' + ui.lastSaved.toLocaleTimeString() : 'Stored locally') + '</span></div>';
    /* entry forms */
    html += '<h2>Record a measurement</h2><div class="flex" role="tablist">' + ['CSI', 'TDR', 'CLEGG'].map(function (t) { return '<button class="btn ' + (ui.tab === t ? '' : 'ghost') + ' small" data-tab="' + t + '" role="tab" aria-selected="' + (ui.tab === t) + '">' + (t === 'CLEGG' ? 'Clegg' : t) + '</button>'; }).join('') + '</div>' +
      '<form id="fRec" class="card" style="margin-top:8px" autocomplete="off">' + entryForm(ui.tab, s) + '</form>';
    /* records */
    var rows = ev.current.filter(function (e) { return ui.filter === 'ALL' || e.rec.record_type === ui.filter || e.qc.status === ui.filter; });
    html += '<h2>Records</h2><div class="controls"><label>Show<select id="fFilter">' + ['ALL', 'CSI', 'TDR', 'CLEGG', 'PASS', 'WARNING', 'FAIL', 'INCOMPLETE'].map(function (o) { return '<option' + (ui.filter === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label></div>' +
      (rows.length ? '<div class="tablewrap"><table class="data"><thead><tr><th class="l">measurement_id</th><th class="l">Type</th><th class="l">Time (UTC)</th><th class="l">Cell</th><th>x / y (m)</th><th>Value</th><th class="l">QC</th><th class="l">Reasons</th><th></th></tr></thead><tbody>' +
        rows.map(function (e) {
          var r = e.rec, val = r.record_type === 'TDR' ? (F.isNum(r.reference_vwc) ? r.reference_vwc + ' % vol' : '–') : r.record_type === 'CLEGG' ? (F.isNum(r.reference_gmax) ? r.reference_gmax + ' G' : '–') : ('loss ' + (F.isNum(r.packet_loss) ? r.packet_loss + ' %' : '–') + ' · ' + (r.raw_stored ? 'raw ✓' : r.raw_data_reference ? 'raw ext.' : 'no raw'));
          return '<tr><td class="l mono">' + h(r.measurement_id) + (r.revision > 1 ? ' <span class="muted">r' + r.revision + '</span>' : '') + '</td><td class="l">' + h(r.record_type) + '</td><td class="l mono">' + h((r.timestamp_utc || '–').replace('T', ' ').slice(0, 19)) + '</td><td class="l">' + h(r.grid_cell_id || '–') + '</td><td>' + h((r.coordinates_x === '' ? '–' : r.coordinates_x) + ' / ' + (r.coordinates_y === '' ? '–' : r.coordinates_y)) + '</td><td>' + h(val) + '</td><td class="l">' + qcTag(e.qc.status) + '</td><td class="l" style="white-space:normal;min-width:220px">' + h(e.qc.checks.map(function (c) { return c.message; }).join('; ') || '–') + '</td><td><button class="btn ghost small" data-rev="' + h(r.measurement_id) + '">Correct</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No records' + (ui.filter !== 'ALL' ? ' for this filter' : '') + ' yet.</p>');
    /* pairs */
    html += '<h2>CSI–reference pairs</h2>' + (ev.pairs.length ? '<div class="tablewrap"><table class="data"><thead><tr><th class="l">CSI</th><th class="l">Reference</th><th class="l">Type</th><th>Δt (min)</th><th>Distance (m)</th><th class="l">Valid</th></tr></thead><tbody>' +
      ev.pairs.map(function (p) { var ok = ev.validPairs.indexOf(p) >= 0; return '<tr><td class="l mono">' + h(p.csi) + '</td><td class="l mono">' + h(p.ref) + '</td><td class="l">' + p.type + '</td><td>' + p.dt_min.toFixed(1) + '</td><td>' + (p.dist_m === null ? '–' : p.dist_m.toFixed(1)) + '</td><td class="l">' + (ok ? qcTag('PASS') : '<span class="tag H">NO – a record fails or is incomplete</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No pairs yet. A pair needs a CSI record and a TDR or Clegg reference in the same grid cell, within ' + s.qc_thresholds.match_max_dt_min + ' min and ' + s.qc_thresholds.match_max_dist_m + ' m.</p>');
    /* export */
    html += '<h2>Export</h2><div class="card"><div class="flex"><button class="btn" id="xCSV">CSV – measurements</button><button class="btn" id="xJSON">JSON – full metadata</button><button class="btn" id="xRep">Session report</button><button class="btn cyan" id="xZIP">ZIP package (all + raw files)</button></div>' +
      '<p class="muted" style="margin:8px 0 0">Export at the end of every session and keep the ZIP in two places. The CSV includes superseded revisions and the QC result of every record; FAIL records are kept with their reason.</p></div>';
    html += '<h2>Session metadata</h2><div class="card"><div class="grid g2"><div><h3>Configuration</h3><table class="data"><tbody>' +
      [['Operator', s.operator_id], ['Device ID', s.device.device_id], ['Device model', s.device.device_model], ['Firmware', s.device.firmware_version], ['Wi-Fi channel', s.device.wifi_channel], ['Bandwidth (MHz)', s.device.bandwidth], ['Subcarriers', s.device.subcarrier_count], ['CSI window (s)', s.device.window_duration], ['Measurement configuration', s.configuration], ['Grid', g.length_m + ' × ' + g.width_m + ' m, cell ' + g.cell_m + ' m (' + g.nx + ' × ' + g.ny + ')'], ['Processing version', s.processing_version]]
        .map(function (r) { return '<tr><td class="l">' + r[0] + '</td><td class="l" style="white-space:normal">' + (F.blank(r[1]) ? '<span class="tag H">missing</span>' : h(r[1])) + '</td></tr>'; }).join('') +
      '</tbody></table><button class="btn ghost small" id="fEditMeta" style="margin-top:8px">Edit session metadata</button></div><div><h3>Session log</h3><div class="tablewrap" style="max-height:260px;overflow:auto"><table class="data"><tbody>' +
      s.events.slice().reverse().map(function (e) { return '<tr><td class="l mono">' + h(e.time_utc.replace('T', ' ').slice(0, 19)) + '</td><td class="l" style="white-space:normal">' + h(e.action) + (e.by ? ' <span class="muted">· ' + h(e.by) + '</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div></div>';
    return html;
  }

  function entryForm(type, s) {
    var common = '<div class="controls">' +
      '<label>Time (local)<input type="datetime-local" name="ts" value="' + nowLocalInput() + '" step="1" required></label><button class="btn ghost small" type="button" id="fNow">Now</button>' +
      '<label>Grid cell<input type="text" name="grid_cell_id" placeholder="e.g. C4" maxlength="5" style="min-width:80px;width:90px;text-transform:uppercase"></label>' +
      '<label>x (m)<input type="number" name="coordinates_x" step="0.01" style="width:90px;min-width:0"></label><label>y (m)<input type="number" name="coordinates_y" step="0.01" style="width:90px;min-width:0"></label>' +
      '<span class="muted" id="fCellHint" style="font-size:12px"></span>' +
      '<label>Operator<input type="text" name="operator_id" value="' + h(s.operator_id) + '" style="width:110px;min-width:0"></label></div>';
    var spec = '';
    if (type === 'CSI') {
      spec = '<div class="controls"><label>Raw CSI file<input type="file" name="raw" id="fRaw"></label><label>or external raw reference<input type="text" name="raw_data_reference" placeholder="path / file name on the logger" style="min-width:240px"></label>' +
        '<label>Packet loss (%)<input type="number" name="packet_loss" min="0" max="100" step="0.01" style="width:100px;min-width:0"></label><label>Signal quality (RSSI dBm / note)<input type="text" name="signal_quality" style="width:150px;min-width:0"></label></div>' +
        '<details><summary class="muted">Device configuration for this record (defaults from the session)</summary><div class="controls" style="margin-top:8px">' +
        ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].map(function (k) { return '<label>' + k + '<input type="text" name="' + k + '" placeholder="' + h(s.device[k] || 'missing') + '" style="width:120px;min-width:0"></label>'; }).join('') + '</div></details>';
    } else if (type === 'TDR') {
      spec = '<div class="controls"><label>VWC (% vol)<input type="number" name="reference_vwc" step="0.1" style="width:110px;min-width:0"></label><label>Method / probe<input type="text" name="reference_measurement_method" value="TDR probe" style="min-width:220px"></label></div>';
    } else {
      spec = '<div class="controls"><label>Gmax (G)<input type="number" name="reference_gmax" step="0.1" style="width:110px;min-width:0"></label><label>Method / hammer<input type="text" name="reference_measurement_method" value="Clegg impact hammer" style="min-width:220px"></label></div>';
    }
    return common + spec + '<div class="controls"><label style="flex:1">Notes<input type="text" name="notes" style="width:100%"></label></div><button class="btn cyan" type="submit" id="fSave">Save ' + (type === 'CLEGG' ? 'Clegg' : type) + ' record</button> <span class="muted" style="font-size:12px">Saved immediately to local storage. A raw file is stored (with SHA-256) before the record.</span>';
  }

  /* ---------- actions ---------- */
  function val(form, n) { var e = form.elements[n]; return e ? e.value.trim() : ''; }
  function createSession(form) {
    var o = {
      site_id: val(form, 'site_id') || 'LAZUR', site_name: val(form, 'site_name'), field_id: val(form, 'field_id') || 'MAIN', session_date: val(form, 'session_date'),
      seq: Number(val(form, 'seq')) || 1, operator_id: val(form, 'operator_id'), data_origin: val(form, 'data_origin'), configuration: val(form, 'configuration'),
      device: {}, grid: { length_m: val(form, 'length_m'), width_m: val(form, 'width_m'), cell_m: val(form, 'cell_m') },
      qc_thresholds: { max_packet_loss: Number(val(form, 'max_packet_loss')), min_window_s: Number(val(form, 'min_window_s')), match_max_dt_min: Number(val(form, 'match_max_dt_min')), match_max_dist_m: Number(val(form, 'match_max_dist_m')) }
    };
    ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].forEach(function (k) { o.device[k] = val(form, k); });
    var day = (o.session_date || '').replace(/-/g, '');
    var s = F.newSession(o, new Date());
    if (day) s.session_id = o.site_id.toUpperCase() + '-' + day + '-' + (o.data_origin === 'test' ? 'T' : 'S') + String(o.seq).padStart(2, '0');
    if (ui.sessions.some(function (x) { return x.session_id === s.session_id; })) { ui.msg = { kind: 'bad', text: 'Session ' + s.session_id + ' already exists on this device – choose another session number.' }; render(); return; }
    ui.session = s; setActive(s.session_id);
    save().then(function () { ui.sessions.unshift(s); ui.msg = { kind: 'info', text: 'Session ' + s.session_id + ' created and stored locally.' }; render(); });
  }

  function saveRecord(form, allowDup) {
    var s = ui.session, type = ui.tab;
    var input = { record_type: type, timestamp_utc: toUTC(val(form, 'ts')), grid_cell_id: val(form, 'grid_cell_id'), coordinates_x: val(form, 'coordinates_x'), coordinates_y: val(form, 'coordinates_y'), operator_id: val(form, 'operator_id'), notes: val(form, 'notes') };
    if (type === 'CSI') {
      ['packet_loss', 'signal_quality', 'device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].forEach(function (k) { input[k] = val(form, k); });
      input.raw_data_reference = val(form, 'raw_data_reference');
    } else if (type === 'TDR') { input.reference_vwc = val(form, 'reference_vwc'); input.reference_measurement_method = val(form, 'reference_measurement_method'); }
    else { input.reference_gmax = val(form, 'reference_gmax'); input.reference_measurement_method = val(form, 'reference_measurement_method'); }
    var file = type === 'CSI' && form.elements.raw && form.elements.raw.files[0];
    var step = Promise.resolve();
    if (file) {
      step = file.arrayBuffer().then(function (buf) {
        return ST.sha256(buf).then(function (sha) {
          return ST.putRaw({ sha256: sha, session_id: s.session_id, filename: file.name, type: file.type, size: file.size, last_modified: file.lastModified, stored_utc: new Date().toISOString(), data: buf }).then(function () {
            var r = F.addRawFile(s, { sha256: sha, filename: file.name, size: file.size, type: file.type });
            input.raw_sha256 = sha; input.raw_stored = true; input.raw_data_reference = F.rawRef(r.file);
          });
        });
      });
    }
    step.then(function () {
      var rec;
      try { rec = F.addRecord(s, input, { allowDuplicate: !!allowDup }); }
      catch (e) {
        if (e.code === 'DUPLICATE') {
          save();   // keep the raw file manifest even if the record is not saved
          if (hooks.openModal) hooks.openModal('<h3>Possible duplicate</h3><p>' + h(e.message) + '. The record was <b>not</b> saved.</p><p class="muted">Save anyway only if this is a deliberate repeat measurement; it will be flagged for review.</p><div class="flex"><button class="btn" id="dupYes">Save as repeat measurement</button><button class="btn ghost" data-close>Cancel</button></div>',
            function (m) { $('#dupYes', m).onclick = function () { hooks.closeModal(); saveRecord(form, true); }; });
          return;
        }
        ui.msg = { kind: 'bad', text: e.message }; render(); return;
      }
      return save().then(function () {
        try { localStorage.removeItem(draftKey(type)); } catch (x) { }
        var q = F.evaluate(s).current.filter(function (x) { return x.rec === rec; })[0].qc;
        ui.msg = { kind: q.status === 'PASS' ? 'info' : q.status === 'FAIL' ? 'bad' : '', text: rec.measurement_id + ' saved · QC ' + q.status + (q.checks.length ? ' – ' + q.checks.map(function (c) { return c.message; }).join('; ') : '') };
        render();
      });
    }).catch(function (e) { ui.msg = { kind: 'bad', text: 'Could not store the raw file: ' + e.message + '. Nothing was saved.' }; render(); });
  }

  function reviseModal(id) {
    var s = ui.session, r = F.current(s).filter(function (x) { return x.measurement_id === id; })[0]; if (!r) return;
    var keys = ['timestamp_utc', 'grid_cell_id', 'coordinates_x', 'coordinates_y', 'operator_id'].concat(r.record_type === 'CSI' ? ['packet_loss', 'signal_quality', 'device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'] : r.record_type === 'TDR' ? ['reference_vwc', 'reference_measurement_method'] : ['reference_gmax', 'reference_measurement_method']).concat(['notes']);
    hooks.openModal('<h3>Correct ' + h(id) + '</h3><p class="muted">A correction creates revision r' + (r.revision + 1) + '. The current values are kept unchanged as r' + r.revision + ' in the record history and in the exports. Raw data cannot be replaced.</p><form id="revF"><div class="controls">' +
      keys.map(function (k) { return '<label>' + k + '<input type="text" name="' + k + '" value="' + h(r[k]) + '"></label>'; }).join('') +
      '</div><div class="controls"><label style="flex:1">Reason for correction (required)<input type="text" name="_reason" required style="width:100%"></label></div><div class="flex"><button class="btn" type="submit">Save revision</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>',
      function (m) {
        $('#revF', m).onsubmit = function (e) {
          e.preventDefault(); var f = e.target, ch = {};
          keys.forEach(function (k) { var v = f.elements[k].value.trim(); if (String(r[k] === undefined ? '' : r[k]) !== v) ch[k] = v; });
          if (!Object.keys(ch).length) { hooks.closeModal(); return; }
          ch.notes = (ch.notes !== undefined ? ch.notes : r.notes) + (r.notes || ch.notes ? ' | ' : '') + 'correction: ' + f.elements._reason.value.trim();
          try { F.reviseRecord(s, id, ch, val(f, 'operator_id') || s.operator_id); } catch (x) { toast(x.message); return; }
          hooks.closeModal(); save().then(function () { ui.msg = { kind: 'info', text: id + ' corrected (revision kept).' }; render(); });
        };
      });
  }

  function metaModal() {
    var s = ui.session, d = s.device;
    var flds = [['operator_id', s.operator_id], ['configuration', s.configuration]].concat(Object.keys(d).map(function (k) { return [k, d[k]]; })).concat([['notes', s.notes]]);
    hooks.openModal('<h3>Session metadata</h3><p class="muted">Changes are logged. Device values are defaults for new CSI records; existing records keep the values they were saved with.</p><form id="metaF"><div class="controls">' +
      flds.map(function (f) { return '<label>' + f[0] + '<input type="text" name="' + f[0] + '" value="' + h(f[1]) + '"></label>'; }).join('') + '</div><div class="flex"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>',
      function (m) {
        $('#metaF', m).onsubmit = function (e) {
          e.preventDefault(); var f = e.target, changed = [];
          flds.forEach(function (x) {
            var v = f.elements[x[0]].value.trim(); if (String(x[1] || '') === v) return; changed.push(x[0] + ': "' + (x[1] || '') + '" → "' + v + '"');
            if (x[0] in d) d[x[0]] = v; else s[x[0]] = v;
          });
          if (changed.length) s.events.push({ time_utc: new Date().toISOString(), action: 'metadata ' + changed.join('; '), by: s.operator_id });
          hooks.closeModal(); save().then(function () { render(); });
        };
      });
  }

  function exportFiles() {
    var s = ui.session, base = F.exportBase(s), now = new Date();
    var names = [base + '_measurements.csv', base + '_session.json', base + '_report.html'];
    var rawNames = s.raw_files.map(function (f) { return 'raw/' + f.sha256.slice(0, 12) + '_' + f.filename; });
    return { base: base, names: names, rawNames: rawNames, csv: F.toCSV(s), json: F.toJSON(s, now), report: F.reportHTML(s, names.concat(rawNames), now) };
  }
  function exportZip() {
    var s = ui.session, x = exportFiles();
    Promise.all(s.raw_files.map(function (f) { return ST.getRaw(f.sha256); })).then(function (raws) {
      var missing = [];
      var files = [{ name: x.names[0], data: x.csv }, { name: x.names[1], data: x.json }, { name: x.names[2], data: x.report }];
      raws.forEach(function (r, i) { if (r && r.data) files.push({ name: x.rawNames[i], data: new Uint8Array(r.data) }); else missing.push(s.raw_files[i].filename); });
      if (missing.length) files.push({ name: 'MISSING_RAW_FILES.txt', data: 'These raw files are listed in the session but were not found in local storage:\n' + missing.join('\n') + '\n' });
      download(x.base + '_package.zip', new Blob([F.zip(files)], { type: 'application/zip' }));
      s.events.push({ time_utc: new Date().toISOString(), action: 'exported ZIP package (' + files.length + ' files)', by: s.operator_id });
      save().then(function () { render(); });
      if (missing.length) toast('Exported, but ' + missing.length + ' raw file(s) were missing – see MISSING_RAW_FILES.txt');
    });
  }
  function logExport(what) { var s = ui.session; s.events.push({ time_utc: new Date().toISOString(), action: 'exported ' + what, by: s.operator_id }); save().then(function () { render(); }); }

  function bind() {
    var nf = $('#fNew', host);
    if (nf) nf.onsubmit = function (e) { e.preventDefault(); createSession(nf); };
    $$('[data-open]', host).forEach(function (b) { b.onclick = function () { ui.session = ui.sessions.filter(function (s) { return s.session_id === b.dataset.open; })[0]; setActive(ui.session.session_id); render(); }; });
    var imp = $('#fImport', host);
    if (imp) imp.onchange = function () {
      var f = imp.files[0]; if (!f) return;
      f.text().then(function (t) {
        var s = F.fromJSON(t);
        if (ui.sessions.some(function (x) { return x.session_id === s.session_id; })) { ui.msg = { kind: 'bad', text: 'Session ' + s.session_id + ' already exists on this device; it was not overwritten.' }; render(); return; }
        ui.session = s; setActive(s.session_id); return save().then(function () { ui.sessions.unshift(s); ui.msg = { kind: 'info', text: 'Session ' + s.session_id + ' restored (' + s.records.length + ' records).' }; render(); });
      }).catch(function (e) { ui.msg = { kind: 'bad', text: 'Import failed: ' + e.message }; render(); });
    };
    if (!ui.session) return;
    var s = ui.session;
    $('#fClose', host).onclick = function () { ui.session = null; setActive(null); ST.listSessions().then(function (l) { ui.sessions = l.sort(function (a, b) { return b.created_utc.localeCompare(a.created_utc); }); render(); }); };
    $$('[data-status]', host).forEach(function (b) { b.onclick = function () { F.setStatus(s, b.dataset.status, s.operator_id); save().then(render); }; });
    $('#fFinish', host).onclick = function () { F.closeSession(s, s.operator_id); save().then(function () { ui.msg = { kind: s.status === 'COMPLETED' ? 'info' : 'bad', text: 'Session closed: ' + s.status + '. Export the ZIP package now.' }; render(); }); };
    $$('[data-tab]', host).forEach(function (b) { b.onclick = function () { ui.tab = b.dataset.tab; render(); }; });
    $('#fFilter', host).onchange = function () { ui.filter = this.value; render(); };
    $$('[data-rev]', host).forEach(function (b) { b.onclick = function () { reviseModal(b.dataset.rev); }; });
    $('#fEditMeta', host).onclick = metaModal;
    var form = $('#fRec', host);
    /* restore and autosave the draft so an interruption does not lose typed values */
    try { var dr = JSON.parse(localStorage.getItem(draftKey(ui.tab)) || 'null'); if (dr) Object.keys(dr).forEach(function (k) { if (form.elements[k] && form.elements[k].type !== 'file') form.elements[k].value = dr[k]; }); } catch (e) { }
    form.oninput = function () {
      var o = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name && el.type !== 'file') o[el.name] = el.value; });
      try { localStorage.setItem(draftKey(ui.tab), JSON.stringify(o)); } catch (e) { }
      var g = F.grid(s.grid), x = form.elements.coordinates_x.value, y = form.elements.coordinates_y.value, c = g.cellOf(x, y);
      $('#fCellHint', host).textContent = (x !== '' && y !== '') ? (c ? 'coordinates are in cell ' + c : 'coordinates are outside the field') : '';
    };
    $('#fNow', host).onclick = function () { form.elements.ts.value = nowLocalInput(); form.oninput(); };
    form.onsubmit = function (e) { e.preventDefault(); saveRecord(form, false); };
    $('#xCSV', host).onclick = function () { var x = exportFiles(); download(x.names[0], x.csv, 'text/csv;charset=utf-8'); logExport('CSV'); };
    $('#xJSON', host).onclick = function () { var x = exportFiles(); download(x.names[1], x.json, 'application/json'); logExport('JSON'); };
    $('#xRep', host).onclick = function () { var x = exportFiles(); download(x.names[2], x.report, 'text/html;charset=utf-8'); logExport('report'); };
    $('#xZIP', host).onclick = exportZip;
  }

  CR.fieldUI = { render: render, state: function () { return ui; } };
})(typeof window !== 'undefined' ? window : globalThis);
