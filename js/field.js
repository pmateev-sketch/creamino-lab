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
  F.PROCESSING_VERSION = 'field-qc-1.0';
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
      counters: { CSI: 0, TDR: 0, CLEGG: 0 }
    };
  };

  F.setStatus = function (s, status, by, now) {
    if (F.STATUS.indexOf(status) < 0) throw new Error('Unknown status ' + status);
    if (s.status === status) return s;
    s.events.push({ time_utc: iso(now), action: 'status ' + s.status + ' → ' + status, by: by || s.operator_id || '' });
    s.status = status; return s;
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
    s.records.push(rec);
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
    s.records.push(rec);
    s.events.push({ time_utc: iso(now), action: 'revised ' + measurement_id + ' to r' + rec.revision, by: by || '' });
    return rec;
  };

  F.addRawFile = function (s, meta, now) {
    if (!meta || !meta.sha256) throw new Error('Raw file needs a SHA-256');
    var ex = s.raw_files.filter(function (f) { return f.sha256 === meta.sha256; })[0];
    if (ex) return { file: ex, duplicate: true };
    var f = { sha256: meta.sha256, filename: meta.filename || 'raw.bin', size: meta.size || 0, type: meta.type || '', stored_utc: iso(now) };
    s.raw_files.push(f);
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
        if (!m.tdr && !m.clegg) add(m.nearMiss ? 'WARNING' : 'WARNING', m.nearMiss ? 'REFERENCE_MISMATCH' : 'REFERENCE_MISSING', m.nearMiss || 'No matching TDR/Clegg reference in the same cell and time window');
      }
    } else if (rec.record_type === 'TDR') {
      if (blank(rec.reference_vwc)) add('INCOMPLETE', 'REFERENCE_MISSING', 'Missing reference VWC');
      else if (!isNum(rec.reference_vwc) || Number(rec.reference_vwc) < T.vwc_range[0] || Number(rec.reference_vwc) > T.vwc_range[1]) add('FAIL', 'VWC_INVALID', 'Invalid VWC ' + rec.reference_vwc + ' (allowed ' + T.vwc_range.join('–') + ' % vol)');
    } else {
      if (blank(rec.reference_gmax)) add('INCOMPLETE', 'REFERENCE_MISSING', 'Missing reference Gmax');
      else if (!isNum(rec.reference_gmax) || Number(rec.reference_gmax) < T.gmax_range[0] || Number(rec.reference_gmax) > T.gmax_range[1]) add('FAIL', 'GMAX_INVALID', 'Invalid Gmax ' + rec.reference_gmax + ' (allowed ' + T.gmax_range.join('–') + ' G)');
    }
    return { status: worst(checks.map(function (c) { return c.level; })), checks: checks };
  };

  /* ---------- CSI ↔ reference matching ---------- */
  F.match = function (s) {
    var T = s.qc_thresholds, cur = F.current(s), out = {}, pairs = [];
    var refs = cur.filter(function (r) { return r.record_type !== 'CSI'; });
    cur.filter(function (r) { return r.record_type === 'CSI'; }).forEach(function (c) {
      var tc = parseTime(c.timestamp_utc), best = { TDR: null, CLEGG: null }, near = null;
      refs.forEach(function (r) {
        if (r.grid_cell_id !== c.grid_cell_id || blank(c.grid_cell_id)) return;
        var dt = Math.abs(parseTime(r.timestamp_utc) - tc) / 60000;
        var dist = (isNum(c.coordinates_x) && isNum(c.coordinates_y) && isNum(r.coordinates_x) && isNum(r.coordinates_y))
          ? Math.hypot(Number(c.coordinates_x) - Number(r.coordinates_x), Number(c.coordinates_y) - Number(r.coordinates_y)) : NaN;
        if (!isFinite(dt)) { near = 'Reference ' + r.measurement_id + ' has no valid time'; return; }
        if (dt > T.match_max_dt_min) { near = near || ('Reference ' + r.measurement_id + ' is ' + Math.round(dt) + ' min away (limit ' + T.match_max_dt_min + ' min)'); return; }
        if (isFinite(dist) && dist > T.match_max_dist_m) { near = near || ('Reference ' + r.measurement_id + ' is ' + dist.toFixed(1) + ' m away (limit ' + T.match_max_dist_m + ' m)'); return; }
        var cand = { id: r.measurement_id, dt_min: dt, dist_m: isFinite(dist) ? dist : null };
        if (!best[r.record_type] || dt < best[r.record_type].dt_min) best[r.record_type] = cand;
      });
      out[c.measurement_id] = { tdr: best.TDR, clegg: best.CLEGG, nearMiss: (!best.TDR && !best.CLEGG) ? near : null };
      if (best.TDR) pairs.push({ csi: c.measurement_id, ref: best.TDR.id, type: 'TDR', dt_min: best.TDR.dt_min, dist_m: best.TDR.dist_m });
      if (best.CLEGG) pairs.push({ csi: c.measurement_id, ref: best.CLEGG.id, type: 'CLEGG', dt_min: best.CLEGG.dt_min, dist_m: best.CLEGG.dist_m });
    });
    return { byCsi: out, pairs: pairs };
  };

  /* full evaluation: QC for every current record + pairs + dashboard metrics */
  F.evaluate = function (s) {
    var cur = F.current(s), idCount = {};
    s.records.forEach(function (r) { if (!r.superseded_by) idCount[r.measurement_id] = (idCount[r.measurement_id] || 0) + 1; });
    var m = F.match(s);
    var ctx = { idCount: idCount, match: m.byCsi };
    var evald = cur.map(function (r) { return { rec: r, qc: F.qcRecord(s, r, ctx) }; });
    var qcById = {}; evald.forEach(function (e) { qcById[e.rec.measurement_id] = e.qc.status; });
    var validPairs = m.pairs.filter(function (p) { var a = qcById[p.csi], b = qcById[p.ref]; return a !== 'FAIL' && a !== 'INCOMPLETE' && b !== 'FAIL' && b !== 'INCOMPLETE'; });
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
    return {
      current: evald,
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
        raw_files: s.raw_files.length,
        revisions: s.records.length - cur.length
      },
      model: { validated: !!(s.model_status && s.model_status.validated), predictions_active: false, message: F.CALIBRATION_MESSAGE }
    };
  };
  /* there is no predictor in Field Session: asking for one is an explicit refusal */
  F.predict = function () { return { available: false, reason: F.CALIBRATION_MESSAGE }; };

  /* ---------- export ---------- */
  var CSV_COLS = ['record_type', 'data_origin'].concat(F.FIELDS).concat(['qc_checks', 'revision', 'supersedes', 'superseded_by', 'raw_sha256', 'raw_stored', 'entered_utc', 'duplicate_of']);
  F.CSV_COLUMNS = CSV_COLS;
  function csvCell(v) { if (v === null || v === undefined) return ''; v = String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  F.toCSV = function (s, opts) {
    opts = opts || {};
    var ev = F.evaluate(s), qc = {}; ev.current.forEach(function (e) { qc[e.rec.measurement_id] = e.qc; });
    var rows = (opts.includeRevisions === false ? F.current(s) : s.records).map(function (r) {
      var q = r.superseded_by ? { status: 'SUPERSEDED', checks: [] } : qc[r.measurement_id];
      var o = Object.assign({}, r, { quality_status: q.status, qc_checks: q.checks.map(function (c) { return c.level + ':' + c.code; }).join(' | ') });
      return CSV_COLS.map(function (k) { return csvCell(o[k]); }).join(',');
    });
    return '﻿' + CSV_COLS.join(',') + '\n' + rows.join('\n') + '\n';
  };
  F.toJSON = function (s, now) {
    var ev = F.evaluate(s);
    var out = JSON.parse(JSON.stringify(s));
    out.export = { exported_utc: iso(now), schema_version: F.SCHEMA_VERSION, processing_version: F.PROCESSING_VERSION, note: 'Raw CSI files are listed by SHA-256 in raw_files; their bytes are in the ZIP package, not in this JSON.' };
    out.qc = ev.current.map(function (e) { return { measurement_id: e.rec.measurement_id, status: e.qc.status, checks: e.qc.checks }; });
    out.pairs = ev.pairs; out.valid_pairs = ev.validPairs; out.metrics = ev.metrics; out.model = ev.model;
    return JSON.stringify(out, null, 2);
  };
  F.fromJSON = function (text) {
    var o = JSON.parse(text);
    if (!o || !o.session_id || !Array.isArray(o.records)) throw new Error('Not a Creamino field session file');
    if (F.ORIGINS.indexOf(o.data_origin) < 0) throw new Error('Session origin "' + o.data_origin + '" is not accepted (only real or test)');
    ['export', 'qc', 'pairs', 'valid_pairs', 'metrics', 'model'].forEach(function (k) { delete o[k]; });
    o.events = o.events || []; o.events.push({ time_utc: iso(), action: 'restored from JSON export', by: '' });
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
    h += '<h2>Limitations</h2><ul><li>No locally validated CSI model exists for this site: no CSI-derived VWC, Gmax or SRS values are produced, and no operational recommendations are given.</li><li>Records flagged FAIL are kept unchanged with their reason; they must be reviewed before any use.</li><li>Data are stored locally in this browser (IndexedDB) until exported; export after every session.</li><li>Pairing uses the same grid cell, ≤ ' + s.qc_thresholds.match_max_dt_min + ' min and ≤ ' + s.qc_thresholds.match_max_dist_m + ' m between CSI and reference.</li></ul>';
    h += '<h2>Files and data</h2><ul>' + (files || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><table><tr><th>Raw file</th><th>Size</th><th>SHA-256</th></tr>' + (s.raw_files.length ? s.raw_files.map(function (f) { return '<tr><td>' + esc(f.filename) + '</td><td>' + f.size + ' B</td><td style="font-family:monospace;font-size:11px">' + esc(f.sha256) + '</td></tr>'; }).join('') : '<tr><td colspan="3">No raw files stored</td></tr>') + '</table>';
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

  CR.field = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = CR;
})(typeof window !== 'undefined' ? window : globalThis);
