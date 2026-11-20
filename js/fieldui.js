/* Creamino Field Session – user interface (module "Field Session" in Creamino Lab).
   Real field data only (origin "real" or "test"); never reads the synthetic demo datasets. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var F = CR.field, ST = CR.fieldStore;
  var ACTIVE_KEY = 'creamino_field_active';
  var ui = { session: null, sessions: [], ready: false, storageOk: true, tab: 'CSI', filter: 'ALL', msg: null, lastSaved: null, lastFailed: null, diag: null, integrity: null, verify: null };
  var host = null, hooks = {}, busyN = 0;
  /* warn before the tab is closed while a write, hash or export is still running */
  function busy(d) { busyN = Math.max(0, busyN + d); }
  if (root.addEventListener) root.addEventListener('beforeunload', function (e) { if (busyN > 0) { e.preventDefault(); e.returnValue = 'A save or export is still running.'; return e.returnValue; } });
  function mb(b) { return b === null || b === undefined ? '–' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'; }

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

  /* every change: snapshot → mutate → one atomic commit → on failure roll the page back to the committed state,
     so the screen never shows a record that is not in storage */
  function rollback(s, snap) { var o = JSON.parse(snap); Object.keys(s).forEach(function (k) { delete s[k]; }); Object.assign(s, o); }
  function failText(e) { return 'NOT SAVED – ' + e.message + (e.code === 'QUOTA' || e.code === 'CONFLICT' ? '' : ' Export the session ZIP now.'); }
  function mutate(fn, raws, opts) {
    var s = ui.session, snap = JSON.stringify(s), res;
    try { res = fn(s); } catch (e) { rollback(s, snap); return Promise.reject(e); }
    busy(1);
    return ST.commit(s, raws || [], opts).then(function () { busy(-1); ui.lastSaved = new Date(); ui.lastFailed = null; refreshDiag(); return res; },
      function (e) { busy(-1); rollback(s, snap); ui.lastFailed = { time: new Date(), text: e.message }; throw e; });
  }
  function act(fn, okMsg) {   // mutate + render, failure shown explicitly
    return mutate(fn).then(function (r) { if (okMsg) ui.msg = { kind: 'info', text: typeof okMsg === 'function' ? okMsg(r) : okMsg }; render(); return r; },
      function (e) { ui.msg = { kind: 'bad', text: failText(e) }; render(); });
  }
  function refreshDiag() { return ST.diagnostics().then(function (d) { ui.diag = d; }, function () { }); }
  function loadAll() {
    return ST.open().then(function (ok) {
      ui.storageOk = ok && !ST.usingMemory();
      return ST.listSessions();
    }).then(function (list) {
      list.forEach(F.migrate);
      ui.sessions = list.sort(function (a, b) { return b.created_utc.localeCompare(a.created_utc); });
      var id = getActive();
      ui.session = id ? (list.filter(function (s) { return s.session_id === id; })[0] || null) : null;
      return Promise.all([refreshDiag(), ST.scan(list).then(function (r) { ui.integrity = r; }, function (e) { ui.integrity = { error: e.message, missing: [], orphans: [] }; })]);
    }).then(function () { ui.ready = true; });
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
    var out = '';
    if (!ui.storageOk) out += '<div class="note bad"><b>Local storage is not available in this browser mode.</b> Data are kept only in memory and are lost when the tab closes. Use a normal (not private) window, or export after every record.</div>';
    if (ui.lastFailed) out += '<div class="note bad" id="fFailNote"><b>The last change was NOT saved</b> (' + h(ui.lastFailed.time.toLocaleTimeString()) + '): ' + h(ui.lastFailed.text) + '</div>';
    var I = ui.integrity;
    if (I && I.missing.length) {
      var mine = ui.session ? I.missing.filter(function (m) { return m.session_id === ui.session.session_id; }) : I.missing;
      if (mine.length) out += '<div class="note bad" id="fMissingNote"><b>' + mine.length + ' raw file(s) listed in ' + (ui.session ? 'this session' : 'saved sessions') + ' are missing from browser storage.</b> They will be reported as MISSING in any export. ' + h(mine.map(function (m) { return (ui.session ? '' : m.session_id + ': ') + (m.file_id || '') + ' ' + m.filename; }).join(', ')) + '</div>';
    }
    return out;
  }
  function storagePanel() {
    var d = ui.diag || {}, used = d.usage, q = d.quota, free = (q && used !== null && used !== undefined) ? q - used : null, frac = q ? used / q : null;
    var low = free !== null && (free < 300 * 1048576 || frac > 0.8);
    var I = ui.integrity || { missing: [], orphans: [] };
    return '<details class="card" id="fStorage"' + (low || !d.indexeddb ? ' open' : '') + ' style="margin-top:12px"><summary><b>Storage and backup</b> <span class="muted" style="font-size:12px">' +
      (d.indexeddb ? 'IndexedDB' : 'memory only') + ' · persistent: ' + (d.persistent === null || d.persistent === undefined ? 'unknown' : d.persistent ? 'yes' : 'NO') + ' · used ' + mb(used) + ' of ' + mb(q) + '</span></summary>' +
      (low ? '<div class="note bad" id="fLowSpace"><b>Low browser storage:</b> ' + mb(free) + ' free (' + Math.round(frac * 100) + ' % used). Large raw CSI files may fail to save. Export the ZIP and free space before measuring.</div>' : '') +
      '<table class="data"><tbody>' +
      '<tr><td class="l">Storage engine</td><td class="l">' + (d.indexeddb ? 'IndexedDB (this browser profile only)' : '<span class="tag H">memory only – lost on close</span>') + '</td></tr>' +
      '<tr><td class="l">Persistent storage</td><td class="l">' + (d.persistent ? 'granted – the browser should not evict the data automatically' : '<span class="tag M">not granted</span> – the browser may evict the data under storage pressure <button class="btn ghost small" id="fPersist" type="button">Request</button>') + '</td></tr>' +
      '<tr><td class="l">Usage / quota (browser estimate)</td><td class="l">' + mb(used) + ' / ' + mb(q) + (free !== null ? ' · ' + mb(free) + ' free' : '') + '</td></tr>' +
      '<tr><td class="l">Raw files missing in storage</td><td class="l">' + (I.missing.length ? '<span class="tag H">' + I.missing.length + '</span>' : '0') + '</td></tr>' +
      '<tr><td class="l">Unreferenced raw blobs</td><td class="l">' + I.orphans.length + (I.orphans.length ? ' <span class="muted">(bytes stored without a committed record, e.g. an interrupted save before v1.1; kept, not deleted)</span>' : '') + '</td></tr>' +
      '</tbody></table>' +
      '<p class="muted" style="margin:8px 0 0"><b>Browser storage is not a backup.</b> It lives only in this browser profile on this device and can be cleared by the browser, a reset or "clear site data". The only backup is a verified ZIP package saved outside this device.</p></details>';
  }
  function backupNote(s) {
    var b = F.backupStatus(s), n = F.current(s).length;
    var cls = b.state === 'EXPORTED' ? 'info' : (n ? 'bad' : '');
    var title = { NOT_BACKED_UP: 'NOT BACKED UP', OUTDATED: 'BACKUP OUTDATED', BACKUP_INCOMPLETE: 'BACKUP INCOMPLETE', EXPORTED: 'ZIP EXPORTED' }[b.state];
    return '<div class="note ' + cls + '" id="fBackup" data-state="' + b.state + '"><b>' + title + '</b> – ' + h(b.label) + (b.state === 'EXPORTED' ? '. The app cannot confirm where the downloaded file was kept.' : (n ? '. Data exist only in this browser. Export the ZIP package.' : '')) + '</div>';
  }
  function msgHTML() { if (!ui.msg) return ''; var m = ui.msg; ui.msg = null; return '<div class="note ' + (m.kind || 'info') + '" role="status">' + h(m.text) + '</div>'; }

  function startView() {
    var list = ui.sessions.map(function (s) {
      var ev = F.evaluate(s);
      return '<tr><td class="l mono">' + h(s.session_id) + '</td><td class="l">' + h(s.site_id) + '</td><td class="l">' + h(s.session_date) + '</td><td class="l"><span class="tag ' + (s.data_origin === 'real' ? 'exp' : '') + '">' + h(s.data_origin.toUpperCase()) + '</span></td><td class="l">' + h(s.status) + '</td><td>' + ev.metrics.measurements + '</td><td>' + ev.metrics.pairs_valid + '</td><td class="l"><span class="tag ' + (ev.metrics.backup.state === 'EXPORTED' ? 'L' : 'H') + '">' + ev.metrics.backup.state.replace(/_/g, ' ') + '</span></td><td><button class="btn small" data-open="' + h(s.session_id) + '">Open</button></td></tr>';
    }).join('');
    return '<h1>Field Session</h1><p class="lead">Collection of real CSI, TDR and Clegg measurements for local calibration. Data stay in this browser until you export them. The synthetic demo data are not used here.</p>' +
      storageNote() + msgHTML() +
      '<div class="note">' + h(F.CALIBRATION_MESSAGE) + '</div>' + storagePanel() +
      (ui.sessions.length ? '<h2>Sessions on this device</h2><div class="tablewrap"><table class="data"><thead><tr><th class="l">Session ID</th><th class="l">Site</th><th class="l">Date</th><th class="l">Origin</th><th class="l">Status</th><th>Records</th><th>Valid pairs</th><th class="l">Backup</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' : '') +
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
      '<h2>Restore a session</h2><div class="card"><p class="muted" style="margin-top:0"><b>From the ZIP package (recommended)</b> – records, revisions and raw files. Every raw file is checked against its size and SHA-256; a file that fails is not restored and is listed.</p><input type="file" id="fImportZip" accept=".zip,application/zip">' +
      '<p class="muted">From a JSON export – records and revisions only; raw files are then marked MISSING until restored from the ZIP.</p><input type="file" id="fImport" accept=".json,application/json"></div>';
  }

  function kpi(v, l, s) { return '<div class="card kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function qcTag(st) { var c = st === 'PASS' ? 'L' : st === 'WARNING' ? 'M' : st === 'FAIL' ? 'H' : ''; return '<span class="tag ' + c + '">' + st + '</span>'; }

  function sessionView() {
    var s = ui.session, ev = F.evaluate(s), M = ev.metrics, g = F.grid(s.grid);
    var origin = s.data_origin === 'real' ? '<span class="tag exp">REAL FIELD DATA</span>' : '<span class="tag">TEST DATA – not for calibration</span>';
    var html = '<div class="flex" style="justify-content:space-between"><h1 style="margin:0">Field Session <span class="mono" style="font-size:16px">' + h(s.session_id) + '</span></h1><button class="btn ghost small" id="fClose">Sessions list</button></div>' +
      '<p class="lead" style="margin-top:6px">' + h(s.site_name) + ' · ' + h(s.site_id) + ' / ' + h(s.field_id) + ' · ' + h(s.session_date) + ' · ' + origin + '</p>' +
      storageNote() + msgHTML() +
      '<div class="note" style="font-size:13px"><b>INITIAL CALIBRATION — ' + h(s.site_id) + '</b><br>' + h(F.CALIBRATION_MESSAGE) + '</div>' + backupNote(s) +
      (M.ambiguous_pairs ? '<div class="note bad" id="fAmbNote"><b>' + M.ambiguous_pairs + ' ambiguous CSI–reference match(es).</b> More than one candidate was within the limits; the closest was paired. Review the matching log below.</div>' : '');
    /* dashboard */
    html += '<h2>Session dashboard</h2><div class="grid g4">' +
      kpi('<span style="font-size:17px">' + h(s.status) + '</span>', 'Session status', 'mode: initial calibration') +
      kpi(M.measurements, 'Measurement count', M.revisions ? M.revisions + ' superseded revisions kept' : 'current records') +
      kpi(M.csi, 'CSI records', 'raw stored ' + M.csi_raw_stored + ' · external ' + M.csi_raw_external + ' · missing ' + M.csi_raw_missing + ' · parsed 0') +
      kpi(M.tdr + ' / ' + M.clegg, 'TDR / Clegg records', 'reference measurements') +
      kpi(M.pairs_valid + '<span class="unit"> of ' + M.pairs_total + '</span>', 'Matched CSI–reference pairs', 'valid / all · ' + M.csi_with_valid_reference + ' CSI with a valid reference') +
      kpi(pct(M.qc_pass_rate), 'QC pass rate', 'PASS ' + M.qc.PASS + ' · WARN ' + M.qc.WARNING + ' · FAIL ' + M.qc.FAIL + ' · INCOMPL. ' + M.qc.INCOMPLETE) +
      kpi(pct(M.completeness), 'Data completeness', 'required fields filled') +
      kpi(M.session_missing.length || '0', 'Missing session metadata', h(M.session_missing.join(', ') || 'none')) + '</div>';
    html += '<div class="flex" style="margin-top:10px"><span class="muted">Status:</span>' +
      ['IN PROGRESS', 'CALIBRATION'].map(function (st) { return '<button class="btn ghost small" data-status="' + st + '"' + (s.status === st ? ' disabled' : '') + '>' + st + '</button>'; }).join('') +
      '<button class="btn small" id="fFinish">Close session</button><span class="muted" style="font-size:12px">Close → COMPLETED, or REVIEW REQUIRED if any record FAILS or is INCOMPLETE.</span>' +
      '<span class="muted" style="margin-left:auto;font-size:12px">' + (ui.lastFailed ? '<b style="color:#C0392B">Last change NOT saved</b>' : ui.lastSaved ? 'Saved locally ' + ui.lastSaved.toLocaleTimeString() + ' (this browser only)' : 'Stored locally (this browser only)') + '</span></div>';
    /* logger file intake */
    var stg = function (v, good) { return '<span class="tag ' + (good ? 'L' : (/^NO|NOT|MISSING|CORRUPTED|UNKNOWN|EMPTY/.test(v) ? 'H' : 'M')) + '">' + h(v) + '</span>'; };
    html += '<h2>Logger file intake</h2><div class="card" id="fIntakeCard"><p class="muted" style="margin-top:0">Import the original files copied from the CSI logger. Each file is read, hashed (SHA-256), stored unchanged, re-read and re-hashed, and its container (pcap, text, …) is identified from standard signatures. <b>No CSI is decoded here:</b> CSI format stays NOT IDENTIFIED and parse status NOT PARSED. Link each file to a CSI record to enter its metadata.</p>' +
      '<input type="file" id="fIntake" multiple> <span class="muted" id="fIntakeOut" style="font-size:12px"></span>' +
      (s.raw_files.length ? '<div class="tablewrap" style="margin-top:10px"><table class="data" id="fIntakeTable"><thead><tr><th class="l">File ID / original name</th><th>Size</th><th class="l">1 Received</th><th class="l">2 Raw stored</th><th class="l">3 SHA-256 verified</th><th class="l">4 Metadata</th><th class="l">5 Container / CSI format</th><th class="l">6 CSI parse status</th><th></th></tr></thead><tbody>' +
        s.raw_files.map(function (f) {
          var st = F.intakeState(s, f), linked = st.metadata.indexOf('MANUAL') === 0;
          return '<tr data-sha="' + h(f.sha256) + '"><td class="l mono" style="white-space:normal">' + h(f.file_id) + '<br><span class="muted">' + h(f.filename) + '</span><br><span class="muted" style="font-size:11px">' + h(f.sha256.slice(0, 16)) + '…</span></td><td>' + mb(f.size) + '</td>' +
            '<td class="l mono" style="font-size:11px">' + h((st.file_received || '–').replace('T', ' ').slice(0, 19)) + '</td><td class="l">' + stg(st.raw_stored, st.raw_stored === 'YES') + '</td>' +
            '<td class="l">' + stg(st.sha256_verified, /^VERIFIED/.test(st.sha256_verified)) + '</td><td class="l" style="white-space:normal">' + stg(linked ? 'MANUAL' : 'NOT ENTERED', linked) + (linked ? '<br><span class="muted" style="font-size:11px">' + h(st.metadata.slice(8, -1)) + '</span>' : '') + '</td>' +
            '<td class="l" style="white-space:normal">' + stg(st.container_format, /^PCAP$|^TEXT/.test(st.container_format)) + ' / ' + stg(st.csi_format) + (f.container ? '<br><span class="muted" style="font-size:11px">' + h(f.container.evidence) + '</span>' : '') + '</td>' +
            '<td class="l">' + stg(st.csi_parse_status) + '</td><td>' + (linked ? '' : '<button class="btn small" data-link="' + h(f.sha256) + '" type="button">Create CSI record</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') + '</div>';
    /* entry forms */
    html += '<h2>Record a measurement</h2><div class="flex" role="tablist">' + ['CSI', 'TDR', 'CLEGG'].map(function (t) { return '<button class="btn ' + (ui.tab === t ? '' : 'ghost') + ' small" data-tab="' + t + '" role="tab" aria-selected="' + (ui.tab === t) + '">' + (t === 'CLEGG' ? 'Clegg' : t) + '</button>'; }).join('') + '</div>' +
      '<form id="fRec" class="card" style="margin-top:8px" autocomplete="off">' + entryForm(ui.tab, s) + '</form>';
    /* records */
    var rows = ev.current.filter(function (e) { return ui.filter === 'ALL' || e.rec.record_type === ui.filter || e.qc.status === ui.filter; });
    html += '<h2>Records</h2><div class="controls"><label>Show<select id="fFilter">' + ['ALL', 'CSI', 'TDR', 'CLEGG', 'PASS', 'WARNING', 'FAIL', 'INCOMPLETE'].map(function (o) { return '<option' + (ui.filter === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label></div>' +
      (rows.length ? '<div class="tablewrap"><table class="data"><thead><tr><th class="l">measurement_id</th><th class="l">Type</th><th class="l">Time (UTC)</th><th class="l">Cell</th><th>x / y (m)</th><th>Value</th><th class="l">QC</th><th class="l">Reasons</th><th></th></tr></thead><tbody>' +
        rows.map(function (e) {
          var r = e.rec, rs = F.rawState(s, r), val = r.record_type === 'TDR' ? (F.isNum(r.reference_vwc) ? r.reference_vwc + ' % vol' : '–') : r.record_type === 'CLEGG' ? (F.isNum(r.reference_gmax) ? r.reference_gmax + ' G' : '–') : ('loss ' + (F.isNum(r.packet_loss) ? r.packet_loss + ' %' : '–') + ' · ' + ({ STORED: 'raw ✓ stored', EXTERNAL_REFERENCE: 'raw ext. reference', MISSING: 'raw MISSING' }[rs.raw_file_status]) + ' · metadata manual · CSI not parsed');
          return '<tr><td class="l mono">' + h(r.measurement_id) + (r.revision > 1 ? ' <span class="muted">r' + r.revision + '</span>' : '') + '</td><td class="l">' + h(r.record_type) + '</td><td class="l mono">' + h((r.timestamp_utc || '–').replace('T', ' ').slice(0, 19)) + '</td><td class="l">' + h(r.grid_cell_id || '–') + '</td><td>' + h((r.coordinates_x === '' ? '–' : r.coordinates_x) + ' / ' + (r.coordinates_y === '' ? '–' : r.coordinates_y)) + '</td><td>' + h(val) + '</td><td class="l">' + qcTag(e.qc.status) + '</td><td class="l" style="white-space:normal;min-width:220px">' + h(e.qc.checks.map(function (c) { return c.message; }).join('; ') || '–') + '</td><td><button class="btn ghost small" data-rev="' + h(r.measurement_id) + '">Correct</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No records' + (ui.filter !== 'ALL' ? ' for this filter' : '') + ' yet.</p>');
    /* pairs */
    html += '<h2>CSI–reference pairs</h2><p class="muted" style="margin-top:0">One-to-one: a reference is paired with at most one CSI record. Distance is computed from x/y of both records – the same cell alone is not accepted.</p>' + (ev.pairs.length ? '<div class="tablewrap"><table class="data" id="fPairs"><thead><tr><th class="l">CSI</th><th class="l">Reference</th><th class="l">Type</th><th>Δt (min)</th><th>Distance (m)</th><th class="l">Match</th><th class="l">Valid</th></tr></thead><tbody>' +
      ev.pairs.map(function (p) { var ok = ev.validPairs.indexOf(p) >= 0; return '<tr><td class="l mono">' + h(p.csi) + '</td><td class="l mono">' + h(p.ref) + '</td><td class="l">' + p.type + '</td><td>' + p.dt_min.toFixed(1) + '</td><td>' + p.dist_m.toFixed(2) + '</td><td class="l">' + (p.ambiguous ? '<span class="tag M">AMBIGUOUS</span>' : 'unique') + '</td><td class="l">' + (ok ? qcTag('PASS') : '<span class="tag H">NO – a record fails, is incomplete or the match is ambiguous</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No pairs yet. A pair needs a CSI record and a TDR or Clegg reference in the same grid cell, with x/y on both, within ' + s.qc_thresholds.match_max_dt_min + ' min and ' + s.qc_thresholds.match_max_dist_m + ' m.</p>') +
      (ev.unmatchedRefs.length ? '<p class="muted">Unmatched reference measurements (kept): ' + h(ev.unmatchedRefs.join(', ')) + '</p>' : '') +
      (ev.matchLog.length ? '<details id="fMatchLog"><summary class="muted">Matching log – every candidate with the reason it was accepted or rejected (' + ev.matchLog.length + ')</summary><div class="tablewrap"><table class="data"><thead><tr><th class="l">CSI</th><th class="l">Reference</th><th>Δt (min)</th><th>Distance (m)</th><th class="l">Decision</th><th class="l">Reason</th></tr></thead><tbody>' +
        ev.matchLog.map(function (e) { return '<tr><td class="l mono">' + h(e.csi) + '</td><td class="l mono">' + h(e.ref) + '</td><td>' + (e.dt_min === null ? '–' : e.dt_min.toFixed(1)) + '</td><td>' + (e.dist_m === null ? '–' : e.dist_m.toFixed(2)) + '</td><td class="l">' + (e.decision === 'accepted' ? '<span class="tag L">ACCEPTED</span>' : '<span class="tag H">REJECTED</span>') + '</td><td class="l" style="white-space:normal">' + h(e.reason) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '');
    /* traceability */
    var tr = F.trace(s);
    html += '<h2>Traceability</h2><p class="muted" style="margin-top:0">Original file → SHA-256 → measurement → session → logger configuration → TDR → Clegg → QC → archive. No prediction or calibration is produced.</p>' +
      (tr.length ? '<div class="tablewrap"><table class="data" id="fTrace"><thead><tr><th class="l">File</th><th class="l">SHA-256</th><th class="l">Measurement</th><th class="l">Logger configuration (as entered)</th><th class="l">TDR</th><th class="l">Clegg</th><th class="l">QC</th><th class="l">CSI parse status</th><th class="l">Archive</th></tr></thead><tbody>' +
        tr.map(function (r) { return '<tr><td class="l mono" style="white-space:normal">' + h(r.file_id || '–') + '<br><span class="muted">' + h(r.original_filename || '–') + '</span></td><td class="l mono" style="font-size:11px">' + h(r.sha256 ? r.sha256.slice(0, 12) + '… ' : '–') + '<br>' + h(r.sha256_verified) + '</td><td class="l mono">' + h(r.measurement_id) + '</td><td class="l" style="white-space:normal;font-size:12px;min-width:200px">' + h(r.logger || '–') + '</td><td class="l mono" style="white-space:normal">' + h(r.tdr_id || '–') + (r.tdr_match ? '<br><span class="muted">' + h(r.tdr_match + ' · ' + r.tdr_qc) + '</span>' : '') + '</td><td class="l mono" style="white-space:normal">' + h(r.clegg_id || '–') + (r.clegg_match ? '<br><span class="muted">' + h(r.clegg_match + ' · ' + r.clegg_qc) + '</span>' : '') + '</td><td class="l">' + (r.qc_status ? qcTag(r.qc_status) : '–') + '</td><td class="l">' + h(r.csi_parse_status) + '</td><td class="l" style="font-size:12px">' + h(r.archive) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No CSI records or raw files yet.</p>');
    /* export */
    html += '<h2>Export</h2><div class="card"><div class="flex"><button class="btn" id="xTrace">Traceability CSV</button><button class="btn" id="xCSV">CSV – measurements</button><button class="btn" id="xJSON">JSON – full metadata</button><button class="btn" id="xRep">Session report</button><button class="btn cyan" id="xZIP">ZIP package (all + raw files)</button></div>' +
      '<div class="flex" style="margin-top:8px"><button class="btn ghost small" id="xVerify" type="button">Verify stored raw files (re-hash)</button><span class="muted" style="font-size:12px" id="fVerifyOut">' + (ui.verify ? h(ui.verify) : '') + '</span></div>' +
      '<p class="muted" style="margin:8px 0 0">The ZIP export re-hashes every raw file and writes MANIFEST.json / MANIFEST.csv (file ID, measurement IDs, size, SHA-256, verification). Keep the ZIP in two places and open it once to confirm. The CSV includes superseded revisions and the QC result of every record; FAIL records are kept with their reason.</p></div>' + storagePanel();
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
      var unassigned = s.raw_files.filter(function (f) { return !F.current(s).some(function (r) { return r.record_type === 'CSI' && r.raw_sha256 === f.sha256; }) && !f.unavailable; });
      spec = (unassigned.length ? '<div class="controls"><label>Raw file from logger intake<select name="intake_sha" id="fIntakeSel"><option value="">– none –</option>' + unassigned.map(function (f) { return '<option value="' + h(f.sha256) + '"' + (ui.intakeSel === f.sha256 ? ' selected' : '') + '>' + h(f.file_id + ' · ' + f.filename) + '</option>'; }).join('') + '</select></label></div>' : '') +
        '<div class="controls"><label>Raw CSI file<input type="file" name="raw" id="fRaw"></label><label>or external raw reference<input type="text" name="raw_data_reference" placeholder="path / file name on the logger" style="min-width:240px"></label>' +
        '<label>Packet loss (%)<input type="number" name="packet_loss" min="0" max="100" step="0.01" style="width:100px;min-width:0"></label><label>Signal quality (RSSI dBm / note)<input type="text" name="signal_quality" style="width:150px;min-width:0"></label></div>' +
        '<details><summary class="muted">Device configuration for this record (defaults from the session)</summary><div class="controls" style="margin-top:8px">' +
        ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].map(function (k) { return '<label>' + k + '<input type="text" name="' + k + '" placeholder="' + h(s.device[k] || 'missing') + '" style="width:120px;min-width:0"></label>'; }).join('') + '</div></details>';
    } else if (type === 'TDR') {
      spec = '<div class="controls"><label>VWC (% vol)<input type="number" name="reference_vwc" step="0.1" style="width:110px;min-width:0"></label><label>Method / probe<input type="text" name="reference_measurement_method" value="TDR probe" style="min-width:220px"></label></div>';
    } else {
      spec = '<div class="controls"><label>Gmax (G)<input type="number" name="reference_gmax" step="0.1" style="width:110px;min-width:0"></label><label>Method / hammer<input type="text" name="reference_measurement_method" value="Clegg impact hammer" style="min-width:220px"></label></div>';
    }
    return common + spec + '<div class="controls"><label style="flex:1">Notes<input type="text" name="notes" style="width:100%"></label></div><button class="btn cyan" type="submit" id="fSave">Save ' + (type === 'CLEGG' ? 'Clegg' : type) + ' record</button> <span class="muted" style="font-size:12px">Saved immediately to this browser. A raw file and its record are written in one transaction – both or neither.</span>';
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
    busy(1);
    ST.commit(s, [], { create: true }).then(function () {
      busy(-1); ui.session = s; setActive(s.session_id); ui.sessions.unshift(s); ui.lastSaved = new Date();
      ui.msg = { kind: 'info', text: 'Session ' + s.session_id + ' created and stored in this browser.' }; render();
    }, function (e) { busy(-1); ui.msg = { kind: 'bad', text: 'Session NOT created – ' + e.message }; render(); });
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
    var intakeSha = type === 'CSI' && form.elements.intake_sha ? form.elements.intake_sha.value : '';
    if (file && intakeSha) { ui.msg = { kind: 'bad', text: 'Choose either a file from the logger intake or a new raw file, not both. Nothing was saved.' }; ui.retryFile = file; render(); return; }
    if (intakeSha) { var inf = s.raw_files.filter(function (f) { return f.sha256 === intakeSha; })[0]; if (inf) { input.raw_sha256 = inf.sha256; input.raw_stored = true; input.raw_data_reference = F.rawRef(inf); } }
    var receivedUtc = new Date().toISOString();
    var btn = $('#fSave', host); if (btn) { btn.disabled = true; btn.textContent = file ? 'Hashing and saving…' : 'Saving…'; }
    busy(1);
    /* 1. read and hash the original bytes (nothing is written yet) */
    var prep = file ? file.arrayBuffer().then(function (buf) {
      if (buf.byteLength !== file.size) throw new Error('the file could not be read completely (' + buf.byteLength + ' of ' + file.size + ' B)');
      return ST.sha256(buf).then(function (sha) { return { sha: sha, buf: buf }; });
    }) : Promise.resolve(null);
    prep.then(function (raw) {
      var raws = raw ? [{ sha256: raw.sha, session_id: s.session_id, filename: file.name, type: file.type, size: file.size, last_modified: file.lastModified, stored_utc: new Date().toISOString(), data: raw.buf }] : [];
      /* 2. raw manifest + record + raw bytes in one atomic commit */
      return mutate(function (s) {
        if (raw) {
          var r = F.addRawFile(s, { sha256: raw.sha, filename: file.name, size: file.size, type: file.type, last_modified: file.lastModified, received_utc: receivedUtc, container: F.inspectContainer(new Uint8Array(raw.buf)), source: 'record-form' });
          input.raw_sha256 = raw.sha; input.raw_stored = true; input.raw_data_reference = F.rawRef(r.file);
        }
        return F.addRecord(s, input, { allowDuplicate: !!allowDup });
      }, raws);
    }).then(function (rec) {
      return (rec.raw_sha256 && file ? recordVerify([rec.raw_sha256]) : Promise.resolve()).then(function () { return rec; });
    }).then(function (rec) {
      busy(-1); ui.retryFile = null; ui.intakeSel = null;
      try { localStorage.removeItem(draftKey(type)); } catch (x) { }
      var q = F.evaluate(s).current.filter(function (x) { return x.rec.measurement_id === rec.measurement_id; })[0].qc;
      ui.msg = { kind: q.status === 'PASS' ? 'info' : q.status === 'FAIL' ? 'bad' : '', text: rec.measurement_id + ' saved' + (file ? ' with raw file (SHA-256 ' + rec.raw_sha256.slice(0, 12) + '…)' : '') + ' · QC ' + q.status + (q.checks.length ? ' – ' + q.checks.map(function (c) { return c.message; }).join('; ') : '') };
      render();
    }, function (e) {
      busy(-1);
      ui.retryFile = file || null;   // keep the selected raw file attached after the form is re-drawn
      if (e.code === 'DUPLICATE') {
        render();
        if (hooks.openModal) hooks.openModal('<h3>Possible duplicate</h3><p>' + h(e.message) + '. The record was <b>not</b> saved' + (file ? ' and the raw file was not stored' : '') + '.</p><p class="muted">Save anyway only if this is a deliberate repeat measurement; it will be flagged for review.' + (file ? ' The raw file stays selected in the form.' : '') + '</p><div class="flex"><button class="btn" id="dupYes">Save as repeat measurement</button><button class="btn ghost" data-close>Cancel</button></div>',
          function (m) { $('#dupYes', m).onclick = function () { hooks.closeModal(); saveRecord(form, true); }; });
        return;
      }
      ui.msg = { kind: 'bad', text: failText(e) + (file ? ' The raw file was not stored either; it is still selected in the form for a retry.' : '') };
      render();
    });
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
          var by = val(f, 'operator_id') || s.operator_id;
          hooks.closeModal();
          act(function (s) { F.reviseRecord(s, id, ch, by); }, id + ' corrected (revision kept).').catch(function () { });
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
          e.preventDefault(); var f = e.target, vals = {};
          flds.forEach(function (x) { vals[x[0]] = f.elements[x[0]].value.trim(); });
          hooks.closeModal();
          act(function (s) {
            var changed = [];
            flds.forEach(function (x) { var v = vals[x[0]]; if (String(x[1] || '') === v) return; changed.push(x[0] + ': "' + (x[1] || '') + '" → "' + v + '"'); if (x[0] in s.device) s.device[x[0]] = v; else s[x[0]] = v; });
            if (changed.length) { s.events.push({ time_utc: new Date().toISOString(), action: 'metadata ' + changed.join('; '), by: s.operator_id }); F.touch(s); }
          });
        };
      });
  }

  function enc(str) { return new TextEncoder().encode(str); }
  function exportFiles() {
    var s = ui.session, base = F.exportBase(s), now = new Date();
    var names = [base + '_measurements.csv', base + '_session.json', base + '_report.html', base + '_traceability.csv'];
    var rawNames = s.raw_files.map(F.rawZipPath);
    return { base: base, names: names, rawNames: rawNames, now: now, csv: F.toCSV(s), json: F.toJSON(s, now), trace: F.traceCSV(s), report: F.reportHTML(s, names.concat(rawNames, ['MANIFEST.json', 'MANIFEST.csv']), now) };
  }
  /* ZIP = CSV + JSON + report + every raw file that re-hashes correctly + MANIFEST.json/.csv.
     Missing or corrupted raw files are not packed; they are listed in the manifest and INTEGRITY_PROBLEMS.txt. */
  function exportZip() {
    var s = ui.session, x = exportFiles(), btn = $('#xZIP', host);
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying raw files…'; }
    busy(1);
    var docs = [{ name: x.names[0], data: enc(x.csv) }, { name: x.names[1], data: enc(x.json) }, { name: x.names[2], data: enc(x.report) }, { name: x.names[3], data: enc(x.trace) }];
    var verdict = {}, rawEntries = [], problems = [];
    var chain = Promise.resolve();
    s.raw_files.forEach(function (f, i) {
      chain = chain.then(function () {
        if (f.unavailable) { verdict[f.sha256] = f.unavailable.indexOf('CORRUPTED') === 0 ? 'CORRUPTED' : 'MISSING'; problems.push((f.file_id || '') + ' ' + f.filename + ': ' + f.unavailable); return; }
        return ST.verifyRaw(f).then(function (v) {
          verdict[f.sha256] = v.status;
          if (v.status === 'VERIFIED') rawEntries.push({ name: x.rawNames[i], data: new Uint8Array(v.data) });
          else problems.push((f.file_id || '') + ' ' + f.filename + ': ' + v.status + ' – ' + v.reason);
        });
      });
    });
    chain.then(function () {
      return Promise.all(docs.map(function (d) { return ST.sha256(d.data); }));
    }).then(function (hs) {
      var docMeta = docs.map(function (d, i) { return { zip_path: d.name, size: d.data.length, sha256: hs[i] }; });
      var man = F.buildManifest(s, verdict, docMeta, x.now);
      var files = docs.concat(rawEntries, [{ name: 'MANIFEST.json', data: enc(JSON.stringify(man, null, 2)) }, { name: 'MANIFEST.csv', data: enc(F.manifestCSV(man)) }]);
      if (problems.length) files.push({ name: 'INTEGRITY_PROBLEMS.txt', data: enc('THIS PACKAGE IS NOT A COMPLETE BACKUP.\nThe following raw files listed in the session could not be verified and are NOT included:\n' + problems.join('\n') + '\n') });
      var zipBytes = F.zip(files);
      /* self-check: read the package back before handing it over */
      var back = F.unzip(zipBytes), bad = back.filter(function (e) { return !e.ok; });
      if (bad.length || back.length !== files.length) throw new Error('the generated ZIP failed its own read-back check (' + (bad[0] ? bad[0].name + ': ' + bad[0].problem : 'entry count') + ')');
      download(x.base + '_package.zip', new Blob([zipBytes], { type: 'application/zip' }));
      var complete = man.summary.complete;
      return mutate(function (s) {
        s.backup = { last_zip_utc: man.export_utc, change_seq_at_zip: s.change_seq, files: rawEntries.length, verified: complete };
        s.events.push({ time_utc: man.export_utc, action: 'exported ZIP package (' + files.length + ' files; raw verified ' + man.summary.verified + '/' + man.summary.raw_total + (complete ? '' : '; missing ' + man.summary.missing + ', corrupted ' + man.summary.corrupted) + ')', by: s.operator_id });
      }).then(function () {
        busy(-1);
        ui.msg = complete ? { kind: 'info', text: 'ZIP package generated: ' + files.length + ' files, all ' + man.summary.raw_total + ' raw file(s) verified by SHA-256. Download started – check the file is saved and copy it to a second place.' }
          : { kind: 'bad', text: 'ZIP package is INCOMPLETE – ' + man.summary.missing + ' raw file(s) missing, ' + man.summary.corrupted + ' corrupted; they are not in the package (see INTEGRITY_PROBLEMS.txt). This is not a complete backup.' };
        render();
      });
    }).catch(function (e) { busy(-1); ui.msg = { kind: 'bad', text: 'ZIP export failed – ' + e.message + '. No backup was made.' }; render(); });
  }
  function logExport(what) { act(function (s) { s.events.push({ time_utc: new Date().toISOString(), action: 'exported ' + what + ' (not a backup of raw files)', by: s.operator_id }); }); }

  /* re-read stored bytes, re-hash, and record the result on the raw-file entry (bookkeeping only, not a data change) */
  function recordVerify(shas) {
    var s = ui.session, res = {}, chain = Promise.resolve();
    shas.forEach(function (sha) { var f = s.raw_files.filter(function (x) { return x.sha256 === sha; })[0]; if (f) chain = chain.then(function () { return ST.verifyRaw(f).then(function (v) { res[sha] = { status: v.status, utc: new Date().toISOString(), reason: v.reason || '' }; }); }); });
    return chain.then(function () { return mutate(function (s) { s.raw_files.forEach(function (f) { if (res[f.sha256]) f.verify = res[f.sha256]; }); }); }).then(function () { return res; });
  }
  function intakeFiles(list) {
    var s = ui.session, out = [], chain = Promise.resolve(), o = $('#fIntakeOut', host);
    busy(1);
    list.forEach(function (file, i) {
      chain = chain.then(function () {
        var received = new Date().toISOString();
        if (o) o.textContent = 'File ' + (i + 1) + ' of ' + list.length + ': reading and hashing ' + file.name + '…';
        return file.arrayBuffer().then(function (buf) {
          if (buf.byteLength !== file.size) throw new Error('read ' + buf.byteLength + ' of ' + file.size + ' B');
          return ST.sha256(buf).then(function (sha) {
            var ex = s.raw_files.filter(function (f) { return f.sha256 === sha; })[0];
            if (ex && !ex.unavailable) { out.push(file.name + ': identical bytes already in this session as ' + ex.file_id + ' – not stored again'); return; }
            var cont = F.inspectContainer(new Uint8Array(buf));
            return mutate(function (s) {
              var r = F.addRawFile(s, { sha256: sha, filename: file.name, size: file.size, type: file.type, last_modified: file.lastModified, received_utc: received, container: cont, source: 'logger-intake' });
              s.events.push({ time_utc: new Date().toISOString(), action: 'logger intake ' + r.file.file_id + ' ' + file.name + ' (' + file.size + ' B, ' + cont.format + ')', by: s.operator_id });
              return r.file;
            }, [{ sha256: sha, session_id: s.session_id, filename: file.name, type: file.type, size: file.size, last_modified: file.lastModified, stored_utc: received, data: buf }])
              .then(function (f) { return recordVerify([sha]).then(function (v) { out.push(f.file_id + ' ' + file.name + ': stored, re-hash ' + v[sha].status + ', container ' + cont.format + ', CSI not parsed'); }); });
          });
        }).catch(function (e) { out.push(file.name + ': NOT STORED – ' + e.message); });
      });
    });
    chain.then(function () {
      busy(-1);
      var bad = out.filter(function (x) { return /NOT STORED|FAILED|MISSING|CORRUPTED/.test(x); });
      ui.msg = { kind: bad.length ? 'bad' : 'info', text: 'Logger intake: ' + out.join(' · ') };
      refreshDiag().then(render);
    });
  }

  function verifyStored() {
    var s = ui.session, out = { VERIFIED: 0, MISSING: [], CORRUPTED: [] }, chain = Promise.resolve();
    ui.verify = 'verifying…'; var o = $('#fVerifyOut', host); if (o) o.textContent = ui.verify;
    busy(1);
    s.raw_files.forEach(function (f) { chain = chain.then(function () { return ST.verifyRaw(f).then(function (v) { if (v.status === 'VERIFIED') out.VERIFIED++; else out[v.status].push((f.file_id || '') + ' ' + f.filename + ' (' + v.reason + ')'); }); }); });
    chain.then(function () { return recordVerify(s.raw_files.filter(function (f) { return !f.unavailable; }).map(function (f) { return f.sha256; })).catch(function () { }); }).then(function () {
      busy(-1);
      var n = s.raw_files.length;
      ui.verify = n ? out.VERIFIED + '/' + n + ' verified' + (out.MISSING.length ? ' · MISSING: ' + out.MISSING.join(', ') : '') + (out.CORRUPTED.length ? ' · CORRUPTED: ' + out.CORRUPTED.join(', ') : '') : 'no raw files stored';
      if (out.MISSING.length || out.CORRUPTED.length) ui.msg = { kind: 'bad', text: 'Raw file verification FAILED: ' + ui.verify };
      render();
    });
  }

  /* ---------- restore ---------- */
  function restoreZip(file) {
    busy(1);
    file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), entries = F.unzip(u8), hashes = {};
      return Promise.all(entries.map(function (e) { return e.data ? ST.sha256(e.data).then(function (hh) { hashes[e.name] = hh; }) : null; })).then(function () { return F.planRestore(entries, hashes); });
    }).then(function (plan) {
      busy(-1);
      var s = plan.session;
      if (ui.sessions.some(function (x) { return x.session_id === s.session_id; })) { ui.msg = { kind: 'bad', text: 'Session ' + s.session_id + ' already exists on this device; it was not overwritten. Nothing restored.' }; render(); return; }
      var bad = plan.files.filter(function (v) { return v.status !== 'VERIFIED'; });
      if (plan.ok) { commitRestore(plan); return; }
      hooks.openModal('<h3>Integrity problems in the package</h3><p>Session <b class="mono">' + h(s.session_id) + '</b>: ' + s.records.length + ' records. ' + (plan.files.length - bad.length) + ' of ' + plan.files.length + ' raw files verified.</p>' +
        (bad.length ? '<p><b>These raw files will NOT be restored:</b></p><ul id="rBad">' + bad.map(function (v) { return '<li><span class="tag H">' + v.status + '</span> ' + h((v.file.file_id || '') + ' ' + v.file.filename) + ' – ' + h(v.reason) + '</li>'; }).join('') + '</ul>' : '') +
        (plan.problems.length ? '<p><b>Other problems:</b></p><ul>' + plan.problems.map(function (p) { return '<li>' + h(p) + '</li>'; }).join('') + '</ul>' : '') +
        '<p class="muted">Records that reference a file that is not restored will show raw MISSING. The session will be marked BACKUP INCOMPLETE.</p><div class="flex"><button class="btn" id="rGo">Restore records without the failed files</button><button class="btn ghost" data-close>Cancel – restore nothing</button></div>',
        function (m) { $('#rGo', m).onclick = function () { hooks.closeModal(); commitRestore(plan); }; });
    }).catch(function (e) { busy(-1); ui.msg = { kind: 'bad', text: 'ZIP restore failed – ' + e.message }; render(); });
  }
  function commitRestore(plan) {
    var s = plan.session, now = new Date(), good = plan.files.filter(function (v) { return v.status === 'VERIFIED'; });
    F.markUnavailable(s, plan.files, now);
    s.backup = { last_zip_utc: plan.manifest ? plan.manifest.export_utc : null, change_seq_at_zip: s.change_seq, files: good.length, verified: plan.ok };
    s.events.push({ time_utc: now.toISOString(), action: 'restored from ZIP package – raw files verified ' + good.length + '/' + plan.files.length + (plan.ok ? '' : ' (INCOMPLETE)'), by: '' });
    var raws = good.map(function (v) { var f = v.file; return { sha256: f.sha256, session_id: s.session_id, filename: f.filename, type: f.type, size: f.size, last_modified: f.last_modified || null, stored_utc: f.stored_utc, data: v.data.slice().buffer }; });
    busy(1);
    ST.commit(s, raws, { create: true }).then(function () {
      busy(-1); ui.sessions.unshift(s); ui.session = s; setActive(s.session_id);
      return ST.scan(ui.sessions).then(function (r) { ui.integrity = r; });
    }).then(function () {
      ui.msg = { kind: plan.ok ? 'info' : 'bad', text: 'Session ' + s.session_id + ' restored from ZIP: ' + s.records.length + ' records, ' + good.length + '/' + plan.files.length + ' raw files verified by SHA-256' + (plan.ok ? '.' : ' – INCOMPLETE, see the session log.') };
      refreshDiag().then(render);
    }, function (e) { busy(-1); ui.msg = { kind: 'bad', text: 'Restore NOT saved – ' + e.message }; render(); });
  }
  function restoreJSON(f) {
    f.text().then(function (t) {
      var s = F.fromJSON(t), now = new Date();
      if (ui.sessions.some(function (x) { return x.session_id === s.session_id; })) { ui.msg = { kind: 'bad', text: 'Session ' + s.session_id + ' already exists on this device; it was not overwritten.' }; render(); return; }
      s.raw_files.forEach(function (rf) { rf.unavailable = 'MISSING after JSON restore ' + now.toISOString() + ': a JSON export contains no raw bytes – restore from the ZIP package'; });
      s.backup = { last_zip_utc: null, change_seq_at_zip: null, files: 0, verified: null };
      s.events.push({ time_utc: now.toISOString(), action: 'restored from JSON export (raw files not included)', by: '' });
      return ST.commit(s, [], { create: true }).then(function () {
        ui.sessions.unshift(s); ui.session = s; setActive(s.session_id);
        ui.msg = { kind: s.raw_files.length ? 'bad' : 'info', text: 'Session ' + s.session_id + ' restored from JSON (' + s.records.length + ' records).' + (s.raw_files.length ? ' ' + s.raw_files.length + ' raw file(s) are MISSING – restore the ZIP package to recover them.' : '') };
        render();
      });
    }).catch(function (e) { ui.msg = { kind: 'bad', text: 'Import failed – ' + e.message }; render(); });
  }

  function bind() {
    var nf = $('#fNew', host);
    if (nf) nf.onsubmit = function (e) { e.preventDefault(); createSession(nf); };
    $$('[data-open]', host).forEach(function (b) { b.onclick = function () { ui.session = ui.sessions.filter(function (s) { return s.session_id === b.dataset.open; })[0]; setActive(ui.session.session_id); render(); }; });
    var imp = $('#fImport', host);
    if (imp) imp.onchange = function () { var f = imp.files[0]; if (f) restoreJSON(f); };
    var impZ = $('#fImportZip', host);
    if (impZ) impZ.onchange = function () { var f = impZ.files[0]; if (f) restoreZip(f); };
    var pb = $('#fPersist', host);
    if (pb) pb.onclick = function () { ST.requestPersist().then(refreshDiag).then(function () { if (!ui.diag.persistent) ui.msg = { kind: 'bad', text: 'The browser did not grant persistent storage. Data may be evicted under storage pressure – export after every session.' }; render(); }); };
    if (!ui.session) return;
    var s = ui.session;
    $('#fClose', host).onclick = function () {
      var b = F.backupStatus(s), warn = b.state !== 'EXPORTED' && F.current(s).length;
      ui.session = null; setActive(null);
      ST.listSessions().then(function (l) {
        l.forEach(F.migrate);
        ui.sessions = l.sort(function (a, b) { return b.created_utc.localeCompare(a.created_utc); });
        if (warn) ui.msg = { kind: 'bad', text: s.session_id + ': ' + b.state.replace(/_/g, ' ') + ' – ' + b.label + '. Its data exist only in this browser.' };
        render();
      });
    };
    $$('[data-status]', host).forEach(function (b) { b.onclick = function () { act(function (s) { F.setStatus(s, b.dataset.status, s.operator_id); }); }; });
    $('#fFinish', host).onclick = function () {
      act(function (s) { F.closeSession(s, s.operator_id); }).then(function () {
        if (!ui.lastFailed) {
          var b = F.backupStatus(s);
          ui.msg = { kind: s.status === 'COMPLETED' && b.state === 'EXPORTED' ? 'info' : 'bad', text: 'Session closed: ' + s.status + '. ' + (b.state === 'EXPORTED' ? 'Last ZIP covers all changes.' : 'NOT BACKED UP: ' + b.label + '. Export the ZIP package now.') };
          render();
        }
      });
    };
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
    if (ui.retryFile && ui.tab === 'CSI' && form.elements.raw) {
      try { var dt = new DataTransfer(); dt.items.add(ui.retryFile); form.elements.raw.files = dt.files; } catch (e) { ui.retryFile = null; }
    }
    $$('[data-tab]', host).forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.tab !== 'CSI') ui.retryFile = null; }); });
    $('#fNow', host).onclick = function () { form.elements.ts.value = nowLocalInput(); form.oninput(); };
    form.onsubmit = function (e) { e.preventDefault(); saveRecord(form, false); };
    $('#xCSV', host).onclick = function () { var x = exportFiles(); download(x.names[0], x.csv, 'text/csv;charset=utf-8'); logExport('CSV'); };
    $('#xJSON', host).onclick = function () { var x = exportFiles(); download(x.names[1], x.json, 'application/json'); logExport('JSON'); };
    $('#xRep', host).onclick = function () { var x = exportFiles(); download(x.names[2], x.report, 'text/html;charset=utf-8'); logExport('report'); };
    $('#xZIP', host).onclick = exportZip;
    $('#xTrace', host).onclick = function () { var x = exportFiles(); download(x.names[3], x.trace, 'text/csv;charset=utf-8'); logExport('traceability CSV'); };
    var ib = $('#fIntake', host); if (ib) ib.onchange = function () { var l = Array.prototype.slice.call(ib.files); if (l.length) intakeFiles(l); };
    $$('[data-link]', host).forEach(function (b) { b.onclick = function () { ui.tab = 'CSI'; ui.intakeSel = b.dataset.link; render(); var f = $('#fRec', host); if (f) f.scrollIntoView({ block: 'start' }); }; });
    $('#xVerify', host).onclick = verifyStored;
  }

  CR.fieldUI = { render: render, state: function () { return ui; } };
})(typeof window !== 'undefined' ? window : globalThis);
