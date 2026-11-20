/* Creamino Field Session engine – real field data collection (pre-calibration).
   Pure functions, no DOM. Works in the browser (window.CR.field) and in Node (module.exports).
   Rules: records are append-only (an edit creates a new revision, the old one is kept),
   raw CSI files are referenced by SHA-256 and never modified, synthetic data is never accepted,
   and no CSI-derived prediction is produced while no locally validated model exists. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var F = {};

  F.SCHEMA_VERSION = 'creamino-field-1.0';
  F.PROCESSING_VERSION = 'field-qc-1.1';
  F.ORIGINS = ['real', 'test'];                 // synthetic is deliberately not an allowed origin
  F.TYPES = ['CSI', 'TDR', 'CLEGG'];
  F.QC = ['PASS', 'WARNING', 'FAIL', 'INCOMPLETE'];
  F.STATUS = ['PLANNED', 'IN PROGRESS', 'CALIBRATION', 'COMPLETED', 'REVIEW REQUIRED'];
  F.CALIBRATION_MESSAGE = 'Локалната калибрация е в процес. CSI данните се събират и проверяват. Прогнозните стойности и оперативните препоръки не са активни.';

  F.FIELDS = ['measurement_id', 'session_id', 'site_id', 'field_id', 'grid_cell_id', 'timestamp_utc', 'operator_id', 'device_id', 'device_model',
    'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration', 'packet_loss', 'signal_quality', 'raw_data_reference',
    'reference_vwc', 'reference_gmax', 'reference_measurement_method', 'coordinates_x', 'coordinates_y', 'notes', 'quality_status', 'processing_version'];
  /* fields each record type needs to be complete */
  F.REQUIRED = {
    CSI: ['timestamp_utc', 'grid_cell_id', 'operator_id', 'device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration', 'packet_loss', 'raw_data_reference', 'coordinates_x', 'coordinates_y'],
    TDR: ['timestamp_utc', 'grid_cell_id', 'operator_id', 'reference_vwc', 'reference_measurement_method', 'coordinates_x', 'coordinates_y'],
    CLEGG: ['timestamp_utc', 'grid_cell_id', 'operator_id', 'reference_gmax', 'reference_measurement_method', 'coordinates_x', 'coordinates_y']
  };
  F.DEFAULT_QC = {
    max_packet_loss: 10,        // % – above this a CSI record FAILS
    warn_packet_loss: 5,        // % – above this a CSI record gets a WARNING
    min_window_s: 10,           // s – shorter CSI windows FAIL
    vwc_range: [0, 60],         // % vol – physically plausible TDR range
    gmax_range: [1, 300],       // G – plausible Clegg range
    match_max_dt_min: 30,       // minutes between CSI and reference to form a pair
    match_max_dist_m: 2,        // metres between CSI and reference positions
    cell_tolerance_m: 1         // coordinates may lie this far outside the declared cell
  };

  /* ---------- helpers ---------- */
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function iso(d) { return (d || new Date()).toISOString(); }
  function parseTime(v) { if (blank(v)) return NaN; var t = Date.parse(v); return t; }
  F.isNum = isNum; F.blank = blank;

  /* grid: columns lettered A.., rows numbered 1.. ; origin (0,0) = corner of column A row 1 */
  function colLetters(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  F.grid = function (g) {
    g = g || {};
    var L = Number(g.length_m) || 105, W = Number(g.width_m) || 68, c = Number(g.cell_m) || 10;
    var nx = Math.ceil(L / c), ny = Math.ceil(W / c);
    return { length_m: L, width_m: W, cell_m: c, nx: nx, ny: ny,
      cellId: function (i, j) { return colLetters(i) + (j + 1); },
      parse: function (id) {
        var m = /^([A-Z]{1,2})(\d{1,3})$/.exec(String(id || '').trim().toUpperCase());
        if (!m) return null;
        var i = colIndex(m[1]), j = Number(m[2]) - 1;
        if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
        return { i: i, j: j, x0: i * c, y0: j * c, x1: Math.min((i + 1) * c, L), y1: Math.min((j + 1) * c, W) };
      },
      cellOf: function (x, y) { if (!isNum(x) || !isNum(y)) return null; x = Number(x); y = Number(y); if (x < 0 || y < 0 || x > L || y > W) return null; return colLetters(Math.min(nx - 1, Math.floor(x / c))) + (Math.min(ny - 1, Math.floor(y / c)) + 1); }
    };
  };

  /* ---------- session ---------- */
  F.newSession = function (o, now) {
    o = o || {}; now = now || new Date();
    if (o.data_origin && F.ORIGINS.indexOf(o.data_origin) < 0) throw new Error('data_origin must be "real" or "test" (synthetic data is not accepted in Field Session)');
    var day = iso(now).slice(0, 10).replace(/-/g, '');
    var site = (o.site_id || 'LAZUR').toUpperCase();
    var seq = pad(o.seq || 1, 2);
    var origin = o.data_origin || 'real';
    return {
      schema_version: F.SCHEMA_VERSION,
      session_id: o.session_id || (site + '-' + day + '-' + (origin === 'test' ? 'T' : 'S') + seq),
      site_id: site,
      site_name: o.site_name || 'Стадион „Лазур“, Бургас',
      field_id: o.field_id || 'MAIN',
      data_origin: origin,
      mode: 'INITIAL_CALIBRATION',
      model_status: { validated: false, note: 'No locally validated CSI model for this site.' },
      created_utc: iso(now),
      session_date: o.session_date || iso(now).slice(0, 10),
      operator_id: o.operator_id || '',
      device: Object.assign({ device_id: '', device_model: '', firmware_version: '', wifi_channel: '', bandwidth: '', subcarrier_count: '', window_duration: '' }, o.device || {}),
      configuration: o.configuration || '',
      grid: { length_m: Number((o.grid || {}).length_m) || 105, width_m: Number((o.grid || {}).width_m) || 68, cell_m: Number((o.grid || {}).cell_m) || 10 },
      qc_thresholds: Object.assign({}, F.DEFAULT_QC, o.qc_thresholds || {}),
      status: 'PLANNED',
      notes: o.notes || '',
      processing_version: F.PROCESSING_VERSION,
      records: [],
      raw_files: [],      // manifest: {sha256, filename, size, type, stored_utc}
      events: [{ time_utc: iso(now), action: 'session created', by: o.operator_id || '' }],
      counters: { CSI: 0, TDR: 0, CLEGG: 0, RAW: 0 },
      change_seq: 0,      // incremented on every data change
      save_seq: 0,        // incremented on every successful write (conflict detection)
      backup: { last_zip_utc: null, change_seq_at_zip: null, files: 0, verified: null }
    };
  };
  F.touch = function (s) { s.change_seq = (s.change_seq || 0) + 1; return s; };
  /* older sessions (before field-qc-1.1) get the new bookkeeping fields */
  F.migrate = function (s) {
    s.counters = s.counters || {}; if (!s.counters.RAW) s.counters.RAW = 0;
    if (s.change_seq === undefined) s.change_seq = s.records.length;
    if (s.save_seq === undefined) s.save_seq = 0;
    if (!s.backup) s.backup = { last_zip_utc: null, change_seq_at_zip: null, files: 0, verified: null };
    (s.raw_files || []).forEach(function (f) { if (!f.file_id) { s.counters.RAW++; f.file_id = 'RAW-' + s.session_id + '-' + pad(s.counters.RAW, 4); } });
    return s;
  };

  F.setStatus = function (s, status, by, now) {
    if (F.STATUS.indexOf(status) < 0) throw new Error('Unknown status ' + status);
    if (s.status === status) return s;
    s.events.push({ time_utc: iso(now), action: 'status ' + s.status + ' → ' + status, by: by || s.operator_id || '' });
    s.status = status; F.touch(s); return s;
  };
  /* closing a session: COMPLETED only when nothing FAILS or is INCOMPLETE */
  F.closeSession = function (s, by, now) {
    var q = F.evaluate(s);
    var bad = q.current.some(function (r) { return r.qc.status === 'FAIL' || r.qc.status === 'INCOMPLETE'; });
    return F.setStatus(s, bad || !q.current.length ? 'REVIEW REQUIRED' : 'COMPLETED', by, now);
  };

  /* ---------- records (append-only) ---------- */
  function nextId(s, type) {
    s.counters[type] = (s.counters[type] || 0) + 1;
    return s.session_id + '-' + type + '-' + pad(s.counters[type], 4);
  }
  F.current = function (s) { return s.records.filter(function (r) { return !r.superseded_by; }); };

  /* possible duplicate: same type, cell and values within 5 s, or the same raw file */
  F.findDuplicate = function (s, rec) {
    var t = parseTime(rec.timestamp_utc);
    return F.current(s).filter(function (r) {
      if (rec.measurement_id && r.measurement_id === rec.measurement_id) return true;
      if (r.record_type !== rec.record_type) return false;
      if (rec.raw_sha256 && r.raw_sha256 === rec.raw_sha256) return true;
      var same = r.grid_cell_id === rec.grid_cell_id && Math.abs(parseTime(r.timestamp_utc) - t) <= 5000;
      if (!same) return false;
      if (rec.record_type === 'TDR') return String(r.reference_vwc) === String(rec.reference_vwc);
      if (rec.record_type === 'CLEGG') return String(r.reference_gmax) === String(rec.reference_gmax);
      return true;
    })[0] || null;
  };

  F.addRecord = function (s, input, opts, now) {
    opts = opts || {}; now = now || new Date();
    var type = String(input.record_type || '').toUpperCase();
    if (F.TYPES.indexOf(type) < 0) throw new Error('record_type must be CSI, TDR or CLEGG');
    if (input.data_origin && input.data_origin !== s.data_origin) throw new Error('Record origin "' + input.data_origin + '" does not match session origin "' + s.data_origin + '"');
    var rec = {
      record_type: type,
      measurement_id: input.measurement_id || null,
      session_id: s.session_id, site_id: s.site_id, field_id: s.field_id,
      data_origin: s.data_origin,
      grid_cell_id: blank(input.grid_cell_id) ? '' : String(input.grid_cell_id).trim().toUpperCase(),
      timestamp_utc: blank(input.timestamp_utc) ? '' : String(input.timestamp_utc),
      entered_utc: iso(now),
      operator_id: blank(input.operator_id) ? s.operator_id : input.operator_id,
      notes: input.notes || '',
      processing_version: F.PROCESSING_VERSION,
      revision: 1, supersedes: null, superseded_by: null
    };
    if (type === 'CSI') {
      ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].forEach(function (k) {
        rec[k] = blank(input[k]) ? (blank(s.device[k]) ? '' : s.device[k]) : input[k];
      });
      rec.packet_loss = blank(input.packet_loss) ? '' : input.packet_loss;
      rec.signal_quality = blank(input.signal_quality) ? '' : input.signal_quality;
      rec.raw_data_reference = input.raw_data_reference || '';
      rec.raw_sha256 = input.raw_sha256 || '';
      rec.raw_stored = !!input.raw_stored;
    } else {
      rec.reference_measurement_method = input.reference_measurement_method || (type === 'TDR' ? 'TDR probe' : 'Clegg impact hammer');
      if (type === 'TDR') rec.reference_vwc = blank(input.reference_vwc) ? '' : input.reference_vwc;
      else rec.reference_gmax = blank(input.reference_gmax) ? '' : input.reference_gmax;
    }
    rec.coordinates_x = blank(input.coordinates_x) ? '' : input.coordinates_x;
    rec.coordinates_y = blank(input.coordinates_y) ? '' : input.coordinates_y;

    var dup = F.findDuplicate(s, rec);
    if (dup && !opts.allowDuplicate) { var e = new Error('Possible duplicate of ' + dup.measurement_id); e.code = 'DUPLICATE'; e.duplicate = dup; throw e; }
    if (!rec.measurement_id) rec.measurement_id = nextId(s, type);
    else if (s.records.some(function (r) { return r.measurement_id === rec.measurement_id; }) && !opts.allowDuplicate) { var e2 = new Error('measurement_id already exists: ' + rec.measurement_id); e2.code = 'DUPLICATE'; throw e2; }
    if (dup) rec.duplicate_of = dup.measurement_id;
    s.records.push(rec); F.touch(s);
    if (s.status === 'PLANNED') F.setStatus(s, 'IN PROGRESS', rec.operator_id, now);
    s.events.push({ time_utc: iso(now), action: 'added ' + rec.measurement_id, by: rec.operator_id });
    return rec;
  };

  /* correction = new revision; the original record is kept and marked superseded */
  F.reviseRecord = function (s, measurement_id, changes, by, now) {
    var old = F.current(s).filter(function (r) { return r.measurement_id === measurement_id; })[0];
    if (!old) throw new Error('No current record ' + measurement_id);
    if (changes.raw_sha256 && changes.raw_sha256 !== old.raw_sha256 && old.raw_sha256) throw new Error('Raw data of a record cannot be replaced; add a new CSI record instead');
    var rec = Object.assign({}, old, changes, { revision: old.revision + 1, supersedes: old.measurement_id + '@r' + old.revision, superseded_by: null, entered_utc: iso(now) });
    old.superseded_by = old.measurement_id + '@r' + rec.revision;
    s.records.push(rec); F.touch(s);
    s.events.push({ time_utc: iso(now), action: 'revised ' + measurement_id + ' to r' + rec.revision, by: by || '' });
    return rec;
  };

  F.addRawFile = function (s, meta, now) {
    if (!meta || !meta.sha256) throw new Error('Raw file needs a SHA-256');
    var ex = s.raw_files.filter(function (f) { return f.sha256 === meta.sha256; })[0];
    if (ex) { if (ex.unavailable) { delete ex.unavailable; F.touch(s); } return { file: ex, duplicate: true }; }
    s.counters.RAW = (s.counters.RAW || 0) + 1;
    var f = { file_id: 'RAW-' + s.session_id + '-' + pad(s.counters.RAW, 4), sha256: meta.sha256, filename: meta.filename || 'raw.bin', size: meta.size || 0,
      type: meta.type || '', last_modified: meta.last_modified || null, stored_utc: iso(now) };
    if (meta.received_utc) f.received_utc = meta.received_utc;
    if (meta.container) f.container = meta.container;
    if (meta.source) f.source = meta.source;
    s.raw_files.push(f); F.touch(s);
    return { file: f, duplicate: false };
  };
  F.rawRef = function (f) { return 'sha256:' + f.sha256 + ' (' + f.filename + ')'; };

  /* ---------- quality control ---------- */
  function worst(list) {
    var rank = { PASS: 0, WARNING: 1, INCOMPLETE: 2, FAIL: 3 };
    return list.reduce(function (a, b) { return rank[b] > rank[a] ? b : a; }, 'PASS');
  }
  F.qcRecord = function (s, rec, ctx) {
    var T = s.qc_thresholds, g = F.grid(s.grid), checks = [];
    function add(level, code, msg) { checks.push({ level: level, code: code, message: msg }); }
    var t = parseTime(rec.timestamp_utc);
    if (blank(rec.timestamp_utc)) add('FAIL', 'TIMESTAMP_MISSING', 'Missing timestamp');
    else if (!isFinite(t)) add('FAIL', 'TIMESTAMP_INVALID', 'Timestamp is not a valid date/time');
    if (ctx && ctx.idCount[rec.measurement_id] > 1) add('FAIL', 'DUPLICATE_ID', 'Duplicate measurement ID');
    if (rec.duplicate_of) add('WARNING', 'POSSIBLE_DUPLICATE', 'Saved as possible duplicate of ' + rec.duplicate_of);
    if (rec.data_origin !== s.data_origin) add('FAIL', 'ORIGIN_MISMATCH', 'Record origin does not match session origin');
    /* grid cell / position */
    if (blank(rec.grid_cell_id)) add('INCOMPLETE', 'GRID_MISSING', 'Missing grid cell ID');
    else {
      var cell = g.parse(rec.grid_cell_id);
      if (!cell) add('FAIL', 'GRID_INVALID', 'Grid cell ' + rec.grid_cell_id + ' does not exist in the session grid');
      else if (isNum(rec.coordinates_x) && isNum(rec.coordinates_y)) {
        var x = Number(rec.coordinates_x), y = Number(rec.coordinates_y), tol = T.cell_tolerance_m;
        if (x < cell.x0 - tol || x > cell.x1 + tol || y < cell.y0 - tol || y > cell.y1 + tol)
          add('FAIL', 'GRID_MISMATCH', 'Coordinates (' + x + ', ' + y + ') lie in ' + (g.cellOf(x, y) || 'outside the field') + ', not in ' + rec.grid_cell_id);
      }
    }
    if ((isNum(rec.coordinates_x) && (Number(rec.coordinates_x) < 0 || Number(rec.coordinates_x) > g.length_m)) || (isNum(rec.coordinates_y) && (Number(rec.coordinates_y) < 0 || Number(rec.coordinates_y) > g.width_m)))
      add('FAIL', 'COORD_OUTSIDE', 'Coordinates outside the field');
    /* missing required metadata */
    var missing = F.REQUIRED[rec.record_type].filter(function (k) { return blank(rec[k]); });
    var missingCfg = missing.filter(function (k) { return ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].indexOf(k) >= 0; });
    if (missingCfg.length) add('INCOMPLETE', 'CONFIG_INCOMPLETE', 'Incomplete configuration: ' + missingCfg.join(', '));
    var otherMissing = missing.filter(function (k) { return missingCfg.indexOf(k) < 0 && k !== 'timestamp_utc' && k !== 'grid_cell_id' && k !== 'reference_vwc' && k !== 'reference_gmax'; });
    if (otherMissing.length) add('INCOMPLETE', 'METADATA_MISSING', 'Missing: ' + otherMissing.join(', '));

    if (rec.record_type === 'CSI') {
      if (isNum(rec.packet_loss)) {
        var pl = Number(rec.packet_loss);
        if (pl < 0 || pl > 100) add('FAIL', 'PACKET_LOSS_INVALID', 'Packet loss must be 0–100 %');
        else if (pl > T.max_packet_loss) add('FAIL', 'PACKET_LOSS_HIGH', 'Packet loss ' + pl + ' % above limit ' + T.max_packet_loss + ' %');
        else if (pl > T.warn_packet_loss) add('WARNING', 'PACKET_LOSS_ELEVATED', 'Packet loss ' + pl + ' % above ' + T.warn_packet_loss + ' %');
      }
      if (isNum(rec.window_duration) && Number(rec.window_duration) < T.min_window_s) add('FAIL', 'WINDOW_SHORT', 'CSI window ' + rec.window_duration + ' s shorter than ' + T.min_window_s + ' s');
      if (!blank(rec.raw_data_reference) && !rec.raw_stored) add('WARNING', 'RAW_EXTERNAL', 'Raw data referenced externally, not stored in this session');
      if (ctx && ctx.match) {
        var m = ctx.match[rec.measurement_id] || {};
        if (!m.tdr && !m.clegg) add('WARNING', m.nearMiss ? 'REFERENCE_MISMATCH' : 'REFERENCE_MISSING', m.nearMiss || 'No matching TDR/Clegg reference in the same cell and time window');
        if (m.ambiguous) add('WARNING', 'MATCH_AMBIGUOUS', 'Ambiguous CSI–reference match – review manually');
      }
      add.raw = true;
    }
    if (rec.record_type !== 'CSI' && ctx && ctx.pairedRefs && ctx.pairedRefs[rec.measurement_id] && ctx.pairedRefs[rec.measurement_id].ambiguous) add('WARNING', 'MATCH_AMBIGUOUS', 'Ambiguous CSI–reference match – review manually');
    if (rec.record_type === 'CSI') { /* checks above */ } else if (rec.record_type === 'TDR') {
      if (blank(rec.reference_vwc)) add('INCOMPLETE', 'REFERENCE_MISSING', 'Missing reference VWC');
      else if (!isNum(rec.reference_vwc) || Number(rec.reference_vwc) < T.vwc_range[0] || Number(rec.reference_vwc) > T.vwc_range[1]) add('FAIL', 'VWC_INVALID', 'Invalid VWC ' + rec.reference_vwc + ' (allowed ' + T.vwc_range.join('–') + ' % vol)');
    } else {
      if (blank(rec.reference_gmax)) add('INCOMPLETE', 'REFERENCE_MISSING', 'Missing reference Gmax');
      else if (!isNum(rec.reference_gmax) || Number(rec.reference_gmax) < T.gmax_range[0] || Number(rec.reference_gmax) > T.gmax_range[1]) add('FAIL', 'GMAX_INVALID', 'Invalid Gmax ' + rec.reference_gmax + ' (allowed ' + T.gmax_range.join('–') + ' G)');
    }
    return { status: worst(checks.map(function (c) { return c.level; })), checks: checks };
  };

  /* ---------- CSI ↔ reference matching ----------
     Criteria (unchanged): same grid cell, |Δt| ≤ match_max_dt_min, distance ≤ match_max_dist_m.
     Since field-qc-1.1: (a) the distance must be computed from X/Y of both records – the same cell alone
     is not accepted as proof of proximity; (b) matching is one-to-one per reference type: every candidate
     pair is sorted by Δt, then distance, then IDs, and assigned greedily (deterministic); a reference is
     never given to two CSI records; (c) when a CSI or a reference had more than one candidate, the accepted
     pair is flagged AMBIGUOUS for manual review. Every candidate gets an accept/reject reason. */
  F.match = function (s) {
    var T = s.qc_thresholds, cur = F.current(s), log = [], cands = [];
    var csis = cur.filter(function (r) { return r.record_type === 'CSI'; });
    var refs = cur.filter(function (r) { return r.record_type !== 'CSI'; });
    csis.forEach(function (c) {
      refs.forEach(function (r) {
        if (blank(c.grid_cell_id) || r.grid_cell_id !== c.grid_cell_id) return;   // only same-cell records are candidates
        var e = { csi: c.measurement_id, ref: r.measurement_id, type: r.record_type, dt_min: null, dist_m: null, decision: 'rejected', reason: '' };
        var tc = parseTime(c.timestamp_utc), tr = parseTime(r.timestamp_utc);
        if (!isFinite(tc) || !isFinite(tr)) { e.reason = 'no valid timestamp on ' + (!isFinite(tc) ? 'CSI' : 'reference'); log.push(e); return; }
        e.dt_min = Math.abs(tr - tc) / 60000;
        var hasXY = isNum(c.coordinates_x) && isNum(c.coordinates_y) && isNum(r.coordinates_x) && isNum(r.coordinates_y);
        if (hasXY) e.dist_m = Math.hypot(Number(c.coordinates_x) - Number(r.coordinates_x), Number(c.coordinates_y) - Number(r.coordinates_y));
        if (e.dt_min > T.match_max_dt_min) { e.reason = 'time difference ' + e.dt_min.toFixed(1) + ' min > ' + T.match_max_dt_min + ' min'; log.push(e); return; }
        if (!hasXY) { e.reason = 'distance cannot be verified: X/Y missing on ' + (isNum(c.coordinates_x) && isNum(c.coordinates_y) ? 'reference' : 'CSI') + ' (same cell is not proof of ≤ ' + T.match_max_dist_m + ' m)'; log.push(e); return; }
        if (e.dist_m > T.match_max_dist_m) { e.reason = 'distance ' + e.dist_m.toFixed(2) + ' m > ' + T.match_max_dist_m + ' m'; log.push(e); return; }
        e.reason = 'candidate: same cell, Δt ' + e.dt_min.toFixed(1) + ' min, distance ' + e.dist_m.toFixed(2) + ' m'; cands.push(e); log.push(e);
      });
    });
    var pairs = [], byCsi = {};
    csis.forEach(function (c) { byCsi[c.measurement_id] = { tdr: null, clegg: null, ambiguous: false, nearMiss: null }; });
    ['TDR', 'CLEGG'].forEach(function (type) {
      var list = cands.filter(function (e) { return e.type === type; });
      var nC = {}, nR = {};
      list.forEach(function (e) { nC[e.csi] = (nC[e.csi] || 0) + 1; nR[e.ref] = (nR[e.ref] || 0) + 1; });
      list.sort(function (a, b) { return a.dt_min - b.dt_min || a.dist_m - b.dist_m || (a.csi < b.csi ? -1 : a.csi > b.csi ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0); });
      var usedC = {}, usedR = {};
      list.forEach(function (e) {
        if (usedC[e.csi]) { e.reason = 'rejected: CSI already paired with ' + usedC[e.csi] + ' (closer in time/space)'; return; }
        if (usedR[e.ref]) { e.reason = 'rejected: reference already paired with ' + usedR[e.ref] + ' (one reference per CSI)'; return; }
        usedC[e.csi] = e.ref; usedR[e.ref] = e.csi; e.decision = 'accepted';
        e.ambiguous = nC[e.csi] > 1 || nR[e.ref] > 1;
        e.reason = 'accepted: same cell, Δt ' + e.dt_min.toFixed(1) + ' min, distance ' + e.dist_m.toFixed(2) + ' m' + (e.ambiguous ? ' – AMBIGUOUS: ' + (nC[e.csi] > 1 ? nC[e.csi] + ' ' + type + ' candidates for this CSI' : '') + (nC[e.csi] > 1 && nR[e.ref] > 1 ? ', ' : '') + (nR[e.ref] > 1 ? nR[e.ref] + ' CSI candidates for this reference' : '') + '; review manually' : '');
        var p = { csi: e.csi, ref: e.ref, type: type, dt_min: e.dt_min, dist_m: e.dist_m, ambiguous: e.ambiguous, reason: e.reason };
        pairs.push(p); byCsi[e.csi][type === 'TDR' ? 'tdr' : 'clegg'] = p; if (p.ambiguous) byCsi[e.csi].ambiguous = true;
      });
    });
    log.forEach(function (e) { if (e.decision === 'rejected' && e.reason.indexOf('candidate:') === 0) e.reason = 'rejected: ' + e.reason.slice(11); });
    csis.forEach(function (c) {
      var b = byCsi[c.measurement_id];
      if (!b.tdr && !b.clegg) { var rej = log.filter(function (e) { return e.csi === c.measurement_id; })[0]; b.nearMiss = rej ? 'Reference ' + rej.ref + ' not paired: ' + rej.reason.replace(/^rejected: /, '') : null; }
    });
    var pairedRefs = {}; pairs.forEach(function (p) { pairedRefs[p.ref] = p; });
    return { byCsi: byCsi, pairs: pairs, log: log, pairedRefs: pairedRefs,
      unmatchedCsi: csis.filter(function (c) { return !byCsi[c.measurement_id].tdr && !byCsi[c.measurement_id].clegg; }).map(function (c) { return c.measurement_id; }),
      unmatchedRefs: refs.filter(function (r) { return !pairedRefs[r.measurement_id]; }).map(function (r) { return r.measurement_id; }) };
  };

  /* three separate states for CSI data: raw file stored / metadata entered manually / CSI parsed.
     No CSI parser is implemented, so csi_parse_status is always NOT_PARSED. */
  F.rawState = function (s, r) {
    if (r.record_type !== 'CSI') return { raw_file_status: 'N/A', metadata_entry: 'MANUAL', csi_parse_status: 'N/A' };
    var stored = r.raw_stored && r.raw_sha256 && s.raw_files.some(function (f) { return f.sha256 === r.raw_sha256 && !f.unavailable; });
    return { raw_file_status: stored ? 'STORED' : (r.raw_stored ? 'MISSING' : !blank(r.raw_data_reference) ? 'EXTERNAL_REFERENCE' : 'MISSING'), metadata_entry: 'MANUAL', csi_parse_status: 'NOT_PARSED' };
  };
  F.rawStates = function (s) {
    var o = { stored: 0, external: 0, missing: 0 };
    F.current(s).forEach(function (r) { if (r.record_type !== 'CSI') return; var st = F.rawState(s, r).raw_file_status; if (st === 'STORED') o.stored++; else if (st === 'EXTERNAL_REFERENCE') o.external++; else o.missing++; });
    return o;
  };
  /* backup = a ZIP package was generated and verified in this browser; whether the file was kept is outside the app's knowledge */
  F.backupStatus = function (s) {
    var b = s.backup || {};
    if (!b.last_zip_utc) return { state: 'NOT_BACKED_UP', label: 'No ZIP package exported yet', changes_since: s.change_seq || 0 };
    var since = (s.change_seq || 0) - (b.change_seq_at_zip || 0);
    if (b.verified === false) return { state: 'BACKUP_INCOMPLETE', label: 'Last ZIP (' + b.last_zip_utc + ') had missing or corrupted raw files', changes_since: since };
    if (since > 0) return { state: 'OUTDATED', label: since + ' change(s) since the last ZIP (' + b.last_zip_utc + ')', changes_since: since };
    return { state: 'EXPORTED', label: 'ZIP exported and verified at ' + b.last_zip_utc + ' – confirm the file is saved in two places', changes_since: 0 };
  };

  /* full evaluation: QC for every current record + pairs + dashboard metrics */
  F.evaluate = function (s) {
    var cur = F.current(s), idCount = {};
    s.records.forEach(function (r) { if (!r.superseded_by) idCount[r.measurement_id] = (idCount[r.measurement_id] || 0) + 1; });
    var m = F.match(s);
    var ctx = { idCount: idCount, match: m.byCsi, pairedRefs: m.pairedRefs };
    var evald = cur.map(function (r) { return { rec: r, qc: F.qcRecord(s, r, ctx) }; });
    var qcById = {}; evald.forEach(function (e) { qcById[e.rec.measurement_id] = e.qc.status; });
    var validPairs = m.pairs.filter(function (p) { var a = qcById[p.csi], b = qcById[p.ref]; return !p.ambiguous && a !== 'FAIL' && a !== 'INCOMPLETE' && b !== 'FAIL' && b !== 'INCOMPLETE'; });
    var csiWithValid = {}; validPairs.forEach(function (p) { csiWithValid[p.csi] = true; });
    var counts = { PASS: 0, WARNING: 0, FAIL: 0, INCOMPLETE: 0 };
    evald.forEach(function (e) { counts[e.qc.status]++; });
    var req = 0, filled = 0;
    evald.forEach(function (e) { F.REQUIRED[e.rec.record_type].forEach(function (k) { req++; if (!blank(e.rec[k])) filled++; }); });
    var sessionMissing = [];
    if (blank(s.operator_id)) sessionMissing.push('operator');
    ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].forEach(function (k) { if (blank(s.device[k])) sessionMissing.push(k); });
    if (blank(s.configuration)) sessionMissing.push('measurement configuration');
    var byType = function (t) { return cur.filter(function (r) { return r.record_type === t; }).length; };
    var raw = F.rawStates(s);
    return {
      current: evald, matchLog: m.log, unmatchedCsi: m.unmatchedCsi, unmatchedRefs: m.unmatchedRefs, rawStates: raw,
      pairs: m.pairs, validPairs: validPairs,
      metrics: {
        measurements: cur.length,
        csi: byType('CSI'), tdr: byType('TDR'), clegg: byType('CLEGG'),
        pairs_total: m.pairs.length, pairs_valid: validPairs.length,
        csi_with_valid_reference: Object.keys(csiWithValid).length,
        qc: counts,
        qc_pass_rate: cur.length ? counts.PASS / cur.length : null,
        completeness: req ? filled / req : null,
        session_missing: sessionMissing,
        raw_files: s.raw_files.length, ambiguous_pairs: m.pairs.filter(function (p) { return p.ambiguous; }).length,
        csi_raw_stored: raw.stored, csi_raw_external: raw.external, csi_raw_missing: raw.missing, csi_parsed: 0,
        backup: F.backupStatus(s),
        revisions: s.records.length - cur.length
      },
      model: { validated: !!(s.model_status && s.model_status.validated), predictions_active: false, message: F.CALIBRATION_MESSAGE }
    };
  };
  /* there is no predictor in Field Session: asking for one is an explicit refusal */
  F.predict = function () { return { available: false, reason: F.CALIBRATION_MESSAGE }; };

  /* ---------- export ---------- */
  var CSV_COLS = ['record_type', 'data_origin'].concat(F.FIELDS).concat(['qc_checks', 'revision', 'supersedes', 'superseded_by', 'raw_sha256', 'raw_stored', 'raw_file_status', 'metadata_entry', 'csi_parse_status', 'paired_with', 'entered_utc', 'duplicate_of']);
  F.CSV_COLUMNS = CSV_COLS;
  function csvCell(v) { if (v === null || v === undefined) return ''; v = String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  F.toCSV = function (s, opts) {
    opts = opts || {};
    var ev = F.evaluate(s), qc = {}; ev.current.forEach(function (e) { qc[e.rec.measurement_id] = e.qc; });
    var rows = (opts.includeRevisions === false ? F.current(s) : s.records).map(function (r) {
      var q = r.superseded_by ? { status: 'SUPERSEDED', checks: [] } : qc[r.measurement_id];
      var pw = ev.pairs.filter(function (p) { return !r.superseded_by && (p.csi === r.measurement_id || p.ref === r.measurement_id); }).map(function (p) { return (p.csi === r.measurement_id ? p.ref : p.csi) + (p.ambiguous ? ' (AMBIGUOUS)' : ''); }).join(' ');
      var o = Object.assign({}, r, F.rawState(s, r), { quality_status: q.status, paired_with: pw, qc_checks: q.checks.map(function (c) { return c.level + ':' + c.code; }).join(' | ') });
      return CSV_COLS.map(function (k) { return csvCell(o[k]); }).join(',');
    });
    return '﻿' + CSV_COLS.join(',') + '\n' + rows.join('\n') + '\n';
  };
  F.toJSON = function (s, now) {
    var ev = F.evaluate(s);
    var out = JSON.parse(JSON.stringify(s));
    out.export = { exported_utc: iso(now), schema_version: F.SCHEMA_VERSION, processing_version: F.PROCESSING_VERSION, note: 'Raw CSI files are listed by SHA-256 in raw_files; their bytes are in the ZIP package, not in this JSON.' };
    out.qc = ev.current.map(function (e) { return { measurement_id: e.rec.measurement_id, status: e.qc.status, checks: e.qc.checks }; });
    out.pairs = ev.pairs; out.valid_pairs = ev.validPairs; out.match_log = ev.matchLog; out.metrics = ev.metrics; out.model = ev.model;
    return JSON.stringify(out, null, 2);
  };
  F.fromJSON = function (text) {
    var o = JSON.parse(text);
    if (!o || !o.session_id || !Array.isArray(o.records)) throw new Error('Not a Creamino field session file');
    if (F.ORIGINS.indexOf(o.data_origin) < 0) throw new Error('Session origin "' + o.data_origin + '" is not accepted (only real or test)');
    ['export', 'qc', 'pairs', 'valid_pairs', 'match_log', 'metrics', 'model'].forEach(function (k) { delete o[k]; });
    F.migrate(o);
    return o;
  };
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  F.reportHTML = function (s, files, now) {
    var ev = F.evaluate(s), M = ev.metrics, d = s.device;
    var inc = ev.current.filter(function (e) { return e.qc.status !== 'PASS'; });
    var pct = function (v) { return v === null ? '–' : Math.round(v * 100) + ' %'; };
    var h = '<!DOCTYPE html><html lang="bg"><head><meta charset="utf-8"><title>Session report ' + esc(s.session_id) + '</title><style>body{font:14px/1.5 Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1E2A38}h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #ddd}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;font-size:13px;vertical-align:top}.b{background:#FFF7E6;border:1px solid #F2D7A6;padding:8px 10px;border-radius:6px}</style></head><body>';
    h += '<h1>Creamino™ Field Session Report – ' + esc(s.session_id) + '</h1>';
    h += '<p class="b"><b>INITIAL CALIBRATION — ' + esc(s.site_id) + '</b><br>' + esc(F.CALIBRATION_MESSAGE) + '<br>Data origin: <b>' + esc(s.data_origin.toUpperCase()) + '</b>' + (s.data_origin === 'test' ? ' (test data – not for calibration)' : '') + '</p>';
    h += '<h2>Site and date</h2><table><tr><th>Site</th><td>' + esc(s.site_name) + ' (' + esc(s.site_id) + '), field ' + esc(s.field_id) + '</td></tr><tr><th>Session date</th><td>' + esc(s.session_date) + '</td></tr><tr><th>Status</th><td>' + esc(s.status) + '</td></tr><tr><th>Operator</th><td>' + esc(s.operator_id || '–') + '</td></tr><tr><th>Created</th><td>' + esc(s.created_utc) + '</td></tr></table>';
    h += '<h2>Configuration</h2><table>' + ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].map(function (k) { return '<tr><th>' + k + '</th><td>' + esc(d[k] || '–') + '</td></tr>'; }).join('') +
      '<tr><th>Measurement configuration</th><td>' + esc(s.configuration || '–') + '</td></tr><tr><th>Grid</th><td>' + s.grid.length_m + ' × ' + s.grid.width_m + ' m, cell ' + s.grid.cell_m + ' m</td></tr><tr><th>QC thresholds</th><td>' + esc(JSON.stringify(s.qc_thresholds)) + '</td></tr><tr><th>Processing version</th><td>' + esc(F.PROCESSING_VERSION) + '</td></tr></table>';
    h += '<h2>Counts</h2><table><tr><th>Measurements (current)</th><td>' + M.measurements + '</td></tr><tr><th>CSI records</th><td>' + M.csi + '</td></tr><tr><th>Reference measurements</th><td>TDR ' + M.tdr + ' · Clegg ' + M.clegg + '</td></tr><tr><th>CSI–reference pairs</th><td>' + M.pairs_total + ' (valid ' + M.pairs_valid + ')</td></tr><tr><th>Raw CSI files stored</th><td>' + M.raw_files + '</td></tr><tr><th>Superseded revisions kept</th><td>' + M.revisions + '</td></tr></table>';
    h += '<h2>QC statistics</h2><table><tr><th>PASS</th><td>' + M.qc.PASS + '</td></tr><tr><th>WARNING</th><td>' + M.qc.WARNING + '</td></tr><tr><th>FAIL</th><td>' + M.qc.FAIL + '</td></tr><tr><th>INCOMPLETE</th><td>' + M.qc.INCOMPLETE + '</td></tr><tr><th>QC pass rate</th><td>' + pct(M.qc_pass_rate) + '</td></tr><tr><th>Data completeness</th><td>' + pct(M.completeness) + '</td></tr><tr><th>Missing session metadata</th><td>' + esc(M.session_missing.join(', ') || 'none') + '</td></tr></table>';
    h += '<h2>Incomplete or flagged records</h2>' + (inc.length ? '<table><tr><th>measurement_id</th><th>QC</th><th>Reasons</th></tr>' + inc.map(function (e) { return '<tr><td>' + esc(e.rec.measurement_id) + '</td><td>' + e.qc.status + '</td><td>' + esc(e.qc.checks.map(function (c) { return c.message; }).join('; ')) + '</td></tr>'; }).join('') + '</table>' : '<p>None.</p>');
    var trc = F.trace(s);
    h += '<h2>Traceability</h2>' + (trc.length ? '<table><tr><th>File</th><th>SHA-256</th><th>Measurement</th><th>Logger configuration</th><th>TDR</th><th>Clegg</th><th>QC</th><th>CSI parse status</th><th>Archive</th></tr>' + trc.map(function (r) { return '<tr><td>' + esc((r.file_id || '–') + ' ' + (r.original_filename || '')) + '</td><td style="font-family:monospace;font-size:11px">' + esc(r.sha256 || '–') + '<br>' + esc(r.sha256_verified) + '</td><td>' + esc(r.measurement_id) + '</td><td style="font-size:12px">' + esc(r.logger || '–') + '</td><td>' + esc(r.tdr_id ? r.tdr_id + ' (' + r.tdr_match + ')' : '–') + '</td><td>' + esc(r.clegg_id ? r.clegg_id + ' (' + r.clegg_match + ')' : '–') + '</td><td>' + esc(r.qc_status || '–') + '</td><td>' + esc(r.csi_parse_status) + '</td><td>' + esc(r.archive) + '</td></tr>'; }).join('') + '</table>' : '<p>No CSI records or raw files.</p>');
    h += '<h2>Limitations</h2><ul><li>No locally validated CSI model exists for this site: no CSI-derived VWC, Gmax or SRS values are produced, and no operational recommendations are given.</li><li>Records flagged FAIL are kept unchanged with their reason; they must be reviewed before any use.</li><li>Data are stored locally in this browser (IndexedDB) until exported; export after every session.</li><li>Pairing (one-to-one) uses the same grid cell, ≤ ' + s.qc_thresholds.match_max_dt_min + ' min and ≤ ' + s.qc_thresholds.match_max_dist_m + ' m computed from x/y of both records; pairs without coordinates are rejected, ambiguous pairs are flagged and not counted as valid.</li><li>No CSI parser is implemented: CSI metadata are entered manually and raw files are stored unparsed.</li><li>Browser storage is not a backup; only a verified ZIP kept outside the device is.</li></ul>';
    h += '<h2>Files and data</h2><ul>' + (files || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><table><tr><th>Raw file</th><th>Size</th><th>SHA-256</th></tr>' + (s.raw_files.length ? s.raw_files.map(function (f) { return '<tr><td>' + esc((f.file_id ? f.file_id + ' · ' : '') + f.filename) + (f.unavailable ? ' – <b>' + esc(f.unavailable) + '</b>' : '') + '</td><td>' + f.size + ' B</td><td style="font-family:monospace;font-size:11px">' + esc(f.sha256) + '</td></tr>'; }).join('') : '<tr><td colspan="3">No raw files stored</td></tr>') + '</table>';
    h += '<p style="color:#777;font-size:12px">Generated ' + esc(iso(now)) + ' · ' + esc(F.SCHEMA_VERSION) + '</p></body></html>';
    return h;
  };
  F.exportBase = function (s) { return s.session_id + (s.data_origin === 'test' ? '_TEST' : ''); };

  /* ---------- minimal ZIP (store, no compression) ---------- */
  var CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  F.crc32 = crc32;
  function utf8(str) { if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str); return Uint8Array.from(Buffer.from(str, 'utf8')); }
  F.zip = function (files) {   // files: [{name, data: Uint8Array|string}]
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true); lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
      parts.push(lh, data); central.push(ch); offset += lh.length + data.length;
    });
    var csize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, csize, true); ev.setUint32(16, offset, true);
    var all = parts.concat(central, [end]), total = all.reduce(function (a, c) { return a + c.length; }, 0), out = new Uint8Array(total), p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  };

  /* ---------- logger file intake ----------
     Container inspection reads only standardised container signatures (libpcap, pcapng, gzip, zip, plain text).
     It does NOT decode CSI. csi_format stays NOT_IDENTIFIED and csi_parse_status NOT_PARSED until a parser,
     written against real logger files, has extracted and validated the contents. */
  F.inspectContainer = function (u8) {
    var n = u8.length, out = { format: 'UNKNOWN', evidence: '', checked_bytes: n };
    if (!n) { out.format = 'EMPTY'; out.evidence = 'file has 0 bytes'; return out; }
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), m = n >= 4 ? dv.getUint32(0, false) : 0;
    var pcapMagic = { 0xa1b2c3d4: [false, 'us'], 0xd4c3b2a1: [true, 'us'], 0xa1b23c4d: [false, 'ns'], 0x4d3cb2a1: [true, 'ns'] };
    if (pcapMagic[m] && n >= 24) {
      var le = pcapMagic[m][0], res = pcapMagic[m][1];
      var p = { format: 'PCAP', byte_order: le ? 'little-endian' : 'big-endian', ts_resolution: res,
        version: dv.getUint16(4, le) + '.' + dv.getUint16(6, le), snaplen: dv.getUint32(16, le), linktype: dv.getUint32(20, le),
        packets: 0, truncated_tail_bytes: 0, snapped_packets: 0, oversize_packets: 0, first_ts: null, last_ts: null, non_monotonic: 0, checked_bytes: n };
      var off = 24, prev = -Infinity, div = res === 'ns' ? 1e9 : 1e6;
      while (off + 16 <= n) {
        var sec = dv.getUint32(off, le), frac = dv.getUint32(off + 4, le), incl = dv.getUint32(off + 8, le), orig = dv.getUint32(off + 12, le);
        if (off + 16 + incl > n) { p.truncated_tail_bytes = n - off; break; }
        var t = sec + frac / div;
        if (p.first_ts === null) p.first_ts = t; if (t < prev) p.non_monotonic++; prev = t; p.last_ts = t;
        if (incl < orig) p.snapped_packets++; if (incl > p.snaplen) p.oversize_packets++;
        p.packets++; off += 16 + incl;
      }
      if (off < n && !p.truncated_tail_bytes) p.truncated_tail_bytes = n - off;
      p.structure_ok = p.truncated_tail_bytes === 0 && p.oversize_packets === 0;
      p.first_ts_utc = p.first_ts === null ? null : new Date(p.first_ts * 1000).toISOString();
      p.last_ts_utc = p.last_ts === null ? null : new Date(p.last_ts * 1000).toISOString();
      p.evidence = 'libpcap magic 0x' + m.toString(16) + ', v' + p.version + ', linktype ' + p.linktype + ', snaplen ' + p.snaplen + ', ' + p.packets + ' packet records' + (p.truncated_tail_bytes ? ', LAST RECORD TRUNCATED (' + p.truncated_tail_bytes + ' B)' : '') + (p.non_monotonic ? ', ' + p.non_monotonic + ' non-monotonic timestamps' : '');
      return p;
    }
    if (m === 0x0a0d0d0a) { out.format = 'PCAPNG'; out.evidence = 'pcapng section header block; block structure not walked by this module'; return out; }
    if (n >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) { out.format = 'GZIP'; out.evidence = 'gzip signature 1f8b; contents not inspected'; return out; }
    if (m === 0x504b0304) { out.format = 'ZIP'; out.evidence = 'zip local header signature; contents not inspected'; return out; }
    var k = Math.min(n, 65536), ctl = 0, nul = 0;
    for (var i = 0; i < k; i++) { var c = u8[i]; if (c === 0) nul++; else if (c < 9 || (c > 13 && c < 32)) ctl++; }
    if (!nul && ctl / k < 0.01) {
      var txt = utf8dec(u8.subarray(0, Math.min(n, 4096))), lines = txt.split(/\r?\n/), first = lines[0] || '';
      var delim = [',', ';', '\t', ' '].map(function (d) { return [d, first.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0];
      out.format = delim[1] > 2 ? 'TEXT_DELIMITED' : 'TEXT';
      out.evidence = 'no NUL bytes in first ' + k + ' B' + (delim[1] > 2 ? ', first line has ' + delim[1] + ' fields separated by "' + (delim[0] === '\t' ? '\\t' : delim[0]) + '"' : '') + '; first line: ' + JSON.stringify(first.slice(0, 120));
      return out;
    }
    out.evidence = 'no known container signature (first bytes ' + Array.prototype.slice.call(u8.subarray(0, 8)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(' ') + ')';
    return out;
  };
  /* six separate intake stages per raw file; nothing is inferred from another stage */
  F.intakeState = function (s, f) {
    var recs = F.current(s).filter(function (r) { return r.record_type === 'CSI' && r.raw_sha256 === f.sha256; });
    return {
      file_received: f.received_utc || f.stored_utc || null,
      raw_stored: f.unavailable ? 'NO – ' + f.unavailable : 'YES',
      sha256_verified: f.verify ? f.verify.status + ' ' + f.verify.utc : 'NOT YET RE-HASHED',
      metadata: recs.length ? 'MANUAL (' + recs.map(function (r) { return r.measurement_id; }).join(', ') + ')' : 'NOT ENTERED – file not linked to a CSI record',
      container_format: f.container ? f.container.format : 'NOT INSPECTED',
      csi_format: 'NOT_IDENTIFIED',
      csi_parse_status: 'NOT_PARSED'
    };
  };
  /* traceability: file → SHA-256 → measurement → session → logger config → TDR → Clegg → QC → archive */
  F.trace = function (s) {
    var ev = F.evaluate(s), qc = {}; ev.current.forEach(function (e) { qc[e.rec.measurement_id] = e.qc.status; });
    var b = s.backup || {}, covered = !!b.last_zip_utc && (s.change_seq || 0) === (b.change_seq_at_zip || 0);
    var byPair = function (id, type) { return ev.pairs.filter(function (p) { return p.csi === id && p.type === type; })[0] || null; };
    var rows = F.current(s).filter(function (r) { return r.record_type === 'CSI'; }).map(function (r) {
      var f = r.raw_sha256 ? s.raw_files.filter(function (x) { return x.sha256 === r.raw_sha256; })[0] : null;
      var t = byPair(r.measurement_id, 'TDR'), c = byPair(r.measurement_id, 'CLEGG');
      return { file_id: f ? f.file_id : '', original_filename: f ? f.filename : (r.raw_data_reference || ''), sha256: r.raw_sha256 || '',
        sha256_verified: f && f.verify ? f.verify.status : (f ? 'NOT YET RE-HASHED' : 'NO STORED FILE'), container_format: f && f.container ? f.container.format : '',
        measurement_id: r.measurement_id, session_id: s.session_id, timestamp_utc: r.timestamp_utc,
        logger: ['device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration'].map(function (k) { return k + '=' + (blank(r[k]) ? '?' : r[k]); }).join('; '),
        tdr_id: t ? t.ref : '', tdr_match: t ? (t.ambiguous ? 'AMBIGUOUS' : 'unique') + ' Δt ' + t.dt_min.toFixed(1) + ' min, ' + t.dist_m.toFixed(2) + ' m' : '',
        clegg_id: c ? c.ref : '', clegg_match: c ? (c.ambiguous ? 'AMBIGUOUS' : 'unique') + ' Δt ' + c.dt_min.toFixed(1) + ' min, ' + c.dist_m.toFixed(2) + ' m' : '',
        qc_status: qc[r.measurement_id], tdr_qc: t ? qc[t.ref] : '', clegg_qc: c ? qc[c.ref] : '',
        csi_parse_status: 'NOT_PARSED', archive: b.last_zip_utc ? b.last_zip_utc + (covered ? '' : ' (outdated)') + (b.verified === false ? ' (incomplete)' : '') : 'NOT ARCHIVED' };
    });
    s.raw_files.forEach(function (f) {
      if (!rows.some(function (x) { return x.sha256 === f.sha256; })) rows.push({ file_id: f.file_id, original_filename: f.filename, sha256: f.sha256, sha256_verified: f.verify ? f.verify.status : 'NOT YET RE-HASHED', container_format: f.container ? f.container.format : '', measurement_id: '(unassigned)', session_id: s.session_id, timestamp_utc: '', logger: '', tdr_id: '', tdr_match: '', clegg_id: '', clegg_match: '', qc_status: '', tdr_qc: '', clegg_qc: '', csi_parse_status: 'NOT_PARSED', archive: b.last_zip_utc ? b.last_zip_utc + (covered ? '' : ' (outdated)') : 'NOT ARCHIVED' });
    });
    return rows;
  };
  F.TRACE_COLS = ['file_id', 'original_filename', 'sha256', 'sha256_verified', 'container_format', 'measurement_id', 'session_id', 'timestamp_utc', 'logger', 'tdr_id', 'tdr_match', 'tdr_qc', 'clegg_id', 'clegg_match', 'clegg_qc', 'qc_status', 'csi_parse_status', 'archive'];
  F.traceCSV = function (s) { return '﻿' + F.TRACE_COLS.join(',') + '\n' + F.trace(s).map(function (r) { return F.TRACE_COLS.map(function (k) { return csvCell(r[k]); }).join(','); }).join('\n') + '\n'; };

  /* ---------- ZIP reading (store method only – the method this module writes) ----------
     Every entry is checked against its CRC-32 and size; nothing is accepted silently. */
  function utf8dec(u) { if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u); return Buffer.from(u).toString('utf8'); }
  F.unzip = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a ZIP file (end-of-central-directory record not found) – the file may be truncated');
    var n = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true), out = [];
    if (cd >= u8.length) throw new Error('ZIP central directory is outside the file – the file is truncated or damaged');
    for (var k = 0, p = cd; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP central directory is damaged at entry ' + (k + 1));
      var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      var name = utf8dec(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      var e = { name: name, size: usize, crc: crc, ok: false, problem: '' };
      if (lho + 30 > u8.length || dv.getUint32(lho, true) !== 0x04034b50) { e.problem = 'local header missing or damaged'; out.push(e); continue; }
      var start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      if (method !== 0) { e.problem = 'compressed entry (method ' + method + ') – this module reads only its own uncompressed packages'; out.push(e); continue; }
      if (start + csize > u8.length) { e.problem = 'entry data is cut off (file truncated)'; out.push(e); continue; }
      e.data = u8.subarray(start, start + csize);
      if (csize !== usize) e.problem = 'size mismatch in ZIP header';
      else if (crc32(e.data) !== crc) e.problem = 'CRC-32 mismatch – bytes are damaged';
      else e.ok = true;
      out.push(e);
    }
    return out;
  };

  /* zip path of a raw file: file_id keeps names unique even when two files share an original name */
  F.rawZipPath = function (f) { return 'raw/' + (f.file_id || f.sha256.slice(0, 12)) + '_' + String(f.filename).replace(/[\\/:*?"<>|]/g, '_'); };

  /* integrity manifest. verify: {sha256: 'VERIFIED'|'MISSING'|'CORRUPTED'} from re-hashing the stored bytes at export time */
  F.buildManifest = function (s, verify, docs, now) {
    var cur = s.records;
    var files = s.raw_files.map(function (f) {
      return { file_id: f.file_id, measurement_ids: cur.filter(function (r) { return r.raw_sha256 === f.sha256; }).map(function (r) { return r.measurement_id + (r.revision > 1 ? '@r' + r.revision : ''); }),
        container_format: f.container ? f.container.format : null, original_filename: f.filename, zip_path: verify[f.sha256] === 'VERIFIED' ? F.rawZipPath(f) : null, size: f.size, sha256: f.sha256, mime: f.type || '',
        last_modified: f.last_modified || null, stored_utc: f.stored_utc, verification: verify[f.sha256] || 'MISSING' };
    });
    var bad = files.filter(function (f) { return f.verification !== 'VERIFIED'; });
    return { manifest_version: 'creamino-field-zip-1', session_id: s.session_id, export_utc: iso(now), schema_version: F.SCHEMA_VERSION, processing_version: F.PROCESSING_VERSION,
      change_seq: s.change_seq, records_total: s.records.length, records_current: F.current(s).length,
      documents: docs, raw_files: files,
      summary: { raw_total: files.length, verified: files.length - bad.length, missing: bad.filter(function (f) { return f.verification === 'MISSING'; }).length, corrupted: bad.filter(function (f) { return f.verification === 'CORRUPTED'; }).length, complete: bad.length === 0 },
      note: 'Browser storage is not a backup. This package is the backup only once it is saved outside this device and opened successfully.' };
  };
  F.manifestCSV = function (m) {
    var cols = ['session_id', 'file_id', 'measurement_ids', 'original_filename', 'zip_path', 'size', 'sha256', 'mime', 'export_utc', 'verification'];
    return '﻿' + cols.join(',') + '\n' + m.raw_files.map(function (f) { var o = Object.assign({}, f, { session_id: m.session_id, export_utc: m.export_utc, measurement_ids: f.measurement_ids.join(' ') }); return cols.map(function (k) { return csvCell(o[k]); }).join(','); }).join('\n') + '\n';
  };

  /* restore plan from unzipped entries. hashes: {zip_path: sha256 of entry bytes} computed by the caller.
     Returns the session plus per-file verdicts; only VERIFIED files may be stored. */
  F.planRestore = function (entries, hashes) {
    var by = {}; entries.forEach(function (e) { by[e.name] = e; });
    var mEntry = by['MANIFEST.json'], problems = [], manifest = null;
    if (!mEntry) problems.push('MANIFEST.json is missing – package was not created by this version or is incomplete');
    else if (!mEntry.ok) throw new Error('MANIFEST.json is damaged (' + mEntry.problem + ') – nothing restored');
    else manifest = JSON.parse(utf8dec(mEntry.data));
    var sEntry = entries.filter(function (e) { return /_session\.json$/.test(e.name); })[0];
    if (!sEntry) throw new Error('Session JSON not found in the package – nothing restored');
    if (!sEntry.ok) throw new Error('Session JSON is damaged (' + sEntry.problem + ') – nothing restored');
    if (manifest) {
      var d = (manifest.documents || []).filter(function (x) { return x.zip_path === sEntry.name; })[0];
      if (!d) problems.push('Session JSON is not listed in the manifest');
      else if (d.sha256 !== hashes[sEntry.name]) throw new Error('Session JSON SHA-256 does not match the manifest – nothing restored');
    }
    var s = F.fromJSON(utf8dec(sEntry.data));
    if (manifest && manifest.session_id !== s.session_id) throw new Error('Manifest belongs to session ' + manifest.session_id + ', JSON to ' + s.session_id + ' – nothing restored');
    var mf = {}; if (manifest) manifest.raw_files.forEach(function (f) { mf[f.sha256] = f; });
    var files = s.raw_files.map(function (f) {
      var m = mf[f.sha256], path = m ? m.zip_path : F.rawZipPath(f), e = path ? by[path] : null, v = { file: f, zip_path: path, status: 'VERIFIED', reason: '' };
      if (manifest && !m) { v.status = 'MISSING'; v.reason = 'not listed in MANIFEST.json'; }
      else if (m && m.verification !== 'VERIFIED') { v.status = m.verification; v.reason = 'already ' + m.verification + ' when the package was exported'; }
      else if (!e) { v.status = 'MISSING'; v.reason = 'file not present in the ZIP'; }
      else if (!e.ok) { v.status = 'CORRUPTED'; v.reason = e.problem; }
      else if (e.data.length !== f.size) { v.status = 'CORRUPTED'; v.reason = 'size ' + e.data.length + ' B, expected ' + f.size + ' B'; }
      else if (hashes[path] !== f.sha256) { v.status = 'CORRUPTED'; v.reason = 'SHA-256 does not match'; }
      else v.data = e.data;
      return v;
    });
    entries.forEach(function (e) { if (!e.ok && e !== mEntry && e !== sEntry && !files.some(function (v) { return v.zip_path === e.name; })) problems.push(e.name + ': ' + e.problem); });
    return { session: s, manifest: manifest, files: files, problems: problems,
      ok: !problems.length && files.every(function (v) { return v.status === 'VERIFIED'; }) };
  };
  /* mark files that were not restored so the records show MISSING instead of STORED */
  F.markUnavailable = function (s, verdicts, now) {
    verdicts.forEach(function (v) { if (v.status !== 'VERIFIED') v.file.unavailable = v.status + ' at restore ' + iso(now) + ': ' + v.reason; });
    return s;
  };

  CR.field = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = CR;
})(typeof window !== 'undefined' ? window : globalThis);
