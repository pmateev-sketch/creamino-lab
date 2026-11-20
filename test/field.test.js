/* Unit tests for the Field Session engine (js/field.js). Run: node test/field.test.js */
const CR = require('../js/field.js'); const F = CR.field;
const assert = require('assert'); let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok -', n); };
const T0 = new Date('2026-11-24T08:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).toISOString();
function session(o) {
  return F.newSession(Object.assign({ operator_id: 'PM', configuration: '2 nodes, 1.5 m apart, 0.3 m height',
    device: { device_id: 'ESP32-A', device_model: 'ESP32-S3', firmware_version: 'csi-1.2', wifi_channel: 6, bandwidth: 20, subcarrier_count: 64, window_duration: 30 } }, o || {}), T0);
}
const csi = (o) => Object.assign({ record_type: 'CSI', grid_cell_id: 'C4', timestamp_utc: at(0), packet_loss: 2, signal_quality: -48, raw_data_reference: 'sha256:aa (a.csv)', raw_sha256: 'aa', raw_stored: true, coordinates_x: 25, coordinates_y: 35 }, o || {});
const tdr = (o) => Object.assign({ record_type: 'TDR', grid_cell_id: 'C4', timestamp_utc: at(3), reference_vwc: 22.4, coordinates_x: 25.5, coordinates_y: 35.2 }, o || {});
const clegg = (o) => Object.assign({ record_type: 'CLEGG', grid_cell_id: 'C4', timestamp_utc: at(5), reference_gmax: 88, coordinates_x: 25.2, coordinates_y: 34.8 }, o || {});

t('create session: LAZUR, ID, origin, planned, calibration mode, no validated model', () => {
  const s = session();
  assert.equal(s.site_id, 'LAZUR'); assert.equal(s.session_id, 'LAZUR-20261124-S01'); assert.equal(s.status, 'PLANNED');
  assert.equal(s.data_origin, 'real'); assert.equal(s.mode, 'INITIAL_CALIBRATION'); assert.equal(s.model_status.validated, false);
  assert.equal(F.newSession({ data_origin: 'test' }, T0).session_id, 'LAZUR-20261124-T01');
});
t('record a measurement (CSI) inherits device config, gets unique ID, session → IN PROGRESS', () => {
  const s = session(); const r = F.addRecord(s, csi(), {}, T0);
  assert.equal(r.measurement_id, 'LAZUR-20261124-S01-CSI-0001'); assert.equal(r.device_id, 'ESP32-A'); assert.equal(r.wifi_channel, 6);
  assert.equal(s.status, 'IN PROGRESS'); const ev = F.evaluate(s); assert.equal(ev.metrics.csi, 1);
});
t('record TDR reference', () => {
  const s = session(); const r = F.addRecord(s, tdr(), {}, T0);
  assert.equal(r.record_type, 'TDR'); assert.equal(r.reference_vwc, 22.4); assert.equal(r.reference_measurement_method, 'TDR probe');
  assert.equal(F.evaluate(s).current[0].qc.status, 'PASS');
});
t('record Clegg reference', () => {
  const s = session(); const r = F.addRecord(s, clegg(), {}, T0);
  assert.equal(r.reference_gmax, 88); assert.equal(F.evaluate(s).current[0].qc.status, 'PASS'); assert.equal(F.evaluate(s).metrics.clegg, 1);
});
t('match CSI with references: same cell, within time and distance', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0); F.addRecord(s, clegg(), {}, T0);
  const ev = F.evaluate(s);
  assert.equal(ev.metrics.pairs_total, 2); assert.equal(ev.metrics.pairs_valid, 2); assert.equal(ev.metrics.csi_with_valid_reference, 1);
  assert.equal(ev.current.find(e => e.rec.record_type === 'CSI').qc.status, 'PASS');
  // reference too late → no pair, CSI gets a mismatch warning
  const s2 = session(); F.addRecord(s2, csi(), {}, T0); F.addRecord(s2, tdr({ timestamp_utc: at(90) }), {}, T0);
  const e2 = F.evaluate(s2); assert.equal(e2.metrics.pairs_total, 0);
  const c2 = e2.current.find(e => e.rec.record_type === 'CSI').qc; assert.equal(c2.status, 'WARNING'); assert(c2.checks.some(c => c.code === 'REFERENCE_MISMATCH'));
  // reference too far → no pair
  const s3 = session(); F.addRecord(s3, csi(), {}, T0); F.addRecord(s3, tdr({ coordinates_x: 29.5 }), {}, T0);
  assert.equal(F.evaluate(s3).metrics.pairs_total, 0);
  // no reference at all → warning REFERENCE_MISSING
  const s4 = session(); F.addRecord(s4, csi(), {}, T0);
  assert(F.evaluate(s4).current[0].qc.checks.some(c => c.code === 'REFERENCE_MISSING'));
});
t('duplicate records are refused, explicit override is kept and flagged', () => {
  const s = session(); F.addRecord(s, tdr(), {}, T0);
  assert.throws(() => F.addRecord(s, tdr(), {}, T0), e => e.code === 'DUPLICATE');
  assert.throws(() => F.addRecord(s, csi({ raw_sha256: 'aa' }), {}, T0) && F.addRecord(s, csi({ raw_sha256: 'aa', timestamp_utc: at(20) }), {}, T0), e => e.code === 'DUPLICATE');
  assert.throws(() => F.addRecord(s, tdr({ measurement_id: s.records[0].measurement_id, timestamp_utc: at(40) }), {}, T0), e => e.code === 'DUPLICATE');
  const d = F.addRecord(s, tdr(), { allowDuplicate: true }, T0);
  assert(d.duplicate_of); const q = F.evaluate(s).current.find(e => e.rec.measurement_id === d.measurement_id).qc;
  assert(q.checks.some(c => c.code === 'POSSIBLE_DUPLICATE'));
  // duplicate measurement IDs that slipped in (e.g. merged files) FAIL
  const s5 = session(); const a = F.addRecord(s5, tdr(), {}, T0); s5.records.push(Object.assign({}, a, { timestamp_utc: at(9) }));
  assert(F.evaluate(s5).current.every(e => e.qc.status === 'FAIL' && e.qc.checks.some(c => c.code === 'DUPLICATE_ID')));
});
t('missing metadata → INCOMPLETE, listed at session level', () => {
  const s = F.newSession({}, T0); const r = F.addRecord(s, { record_type: 'CSI', grid_cell_id: 'C4', timestamp_utc: at(0) }, {}, T0);
  const ev = F.evaluate(s); const q = ev.current[0].qc;
  assert.equal(q.status, 'INCOMPLETE'); assert(q.checks.some(c => c.code === 'CONFIG_INCOMPLETE')); assert(q.checks.some(c => c.code === 'METADATA_MISSING'));
  assert(ev.metrics.session_missing.includes('operator')); assert(ev.metrics.session_missing.includes('device_id'));
  assert(ev.metrics.completeness < 0.5);
  const t2 = F.addRecord(s, { record_type: 'TDR', grid_cell_id: 'D4', timestamp_utc: at(1), operator_id: 'PM', coordinates_x: 35, coordinates_y: 35 }, {}, T0);
  assert(F.evaluate(s).current.find(e => e.rec === t2).qc.checks.some(c => c.code === 'REFERENCE_MISSING' && c.level === 'INCOMPLETE'));
});
t('QC FAIL cases are kept with reasons (not deleted)', () => {
  const s = session();
  F.addRecord(s, csi({ packet_loss: 25, raw_sha256: 'b1' }), {}, T0);                                   // packet loss
  F.addRecord(s, csi({ window_duration: 4, raw_sha256: 'b2', timestamp_utc: at(1) }), {}, T0);          // short window
  F.addRecord(s, tdr({ reference_vwc: 85 }), {}, T0);                                                   // invalid VWC
  F.addRecord(s, clegg({ reference_gmax: -3 }), {}, T0);                                                // invalid Gmax
  F.addRecord(s, tdr({ grid_cell_id: 'Z99', timestamp_utc: at(7) }), {}, T0);                           // grid cell does not exist
  F.addRecord(s, clegg({ grid_cell_id: 'A1', timestamp_utc: at(8) }), {}, T0);                          // coords not in A1
  F.addRecord(s, tdr({ timestamp_utc: '', reference_vwc: 20 }), {}, T0);                                // missing timestamp
  const ev = F.evaluate(s); const codes = ev.current.map(e => e.qc.checks.map(c => c.code).join(','));
  ['PACKET_LOSS_HIGH', 'WINDOW_SHORT', 'VWC_INVALID', 'GMAX_INVALID', 'GRID_INVALID', 'GRID_MISMATCH', 'TIMESTAMP_MISSING'].forEach(c => assert(codes.some(x => x.includes(c)), c));
  assert.equal(ev.current.length, 7); assert(ev.current.every(e => e.qc.status === 'FAIL'));
  assert.equal(ev.metrics.qc.FAIL, 7); assert.equal(ev.metrics.qc_pass_rate, 0);
  F.closeSession(s, 'PM', T0); assert.equal(s.status, 'REVIEW REQUIRED');
});
t('revision keeps the original record (append-only) and raw data cannot be replaced', () => {
  const s = session(); const r = F.addRecord(s, tdr({ reference_vwc: 85 }), {}, T0);
  F.reviseRecord(s, r.measurement_id, { reference_vwc: 25 }, 'PM', T0);
  assert.equal(s.records.length, 2); assert(s.records[0].superseded_by); assert.equal(s.records[0].reference_vwc, 85);
  assert.equal(F.current(s).length, 1); assert.equal(F.current(s)[0].revision, 2); assert.equal(F.evaluate(s).current[0].qc.status, 'PASS');
  const c = F.addRecord(s, csi(), {}, T0); assert.throws(() => F.reviseRecord(s, c.measurement_id, { raw_sha256: 'zz' }, 'PM', T0));
});
t('export CSV: all 25 fields, QC column, revisions kept, quoting', () => {
  const s = session(); F.addRecord(s, csi({ notes: 'wind, light "gusts"' }), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const r = F.addRecord(s, clegg({ reference_gmax: 500 }), {}, T0); F.reviseRecord(s, r.measurement_id, { reference_gmax: 95 }, 'PM', T0);
  const csv = F.toCSV(s); const lines = csv.replace('﻿', '').trim().split('\n');
  const head = lines[0].split(','); F.FIELDS.forEach(k => assert(head.includes(k), k));
  assert.equal(lines.length, 1 + 4); assert(csv.includes('"wind, light ""gusts"""')); assert(csv.includes('SUPERSEDED'));
  assert.equal(F.toCSV(s, { includeRevisions: false }).trim().split('\n').length, 4);
});
t('export JSON: full metadata, QC, pairs, model status; restore from JSON', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0);
  F.addRawFile(s, { sha256: 'aa', filename: 'a.csv', size: 12 }, T0);
  const js = JSON.parse(F.toJSON(s, T0));
  assert.equal(js.session_id, s.session_id); assert.equal(js.records.length, 2); assert.equal(js.qc.length, 2); assert.equal(js.pairs.length, 1);
  assert.equal(js.model.predictions_active, false); assert.equal(js.raw_files[0].sha256, 'aa'); assert.equal(js.device.wifi_channel, 6);
  const back = F.fromJSON(F.toJSON(s, T0)); assert.equal(F.current(back).length, 2); assert.equal(F.evaluate(back).metrics.pairs_valid, 1);
});
t('recovery after interruption: session survives serialisation mid-work and continues numbering', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const stored = JSON.stringify(s);              // what IndexedDB keeps after each write
  const resumed = JSON.parse(stored);            // browser closed / crashed → reopened
  const r = F.addRecord(resumed, tdr({ grid_cell_id: 'D4', coordinates_x: 35, timestamp_utc: at(30) }), {}, T0);
  assert.equal(r.measurement_id, 'LAZUR-20261124-S01-TDR-0002'); assert.equal(F.current(resumed).length, 3);
  assert.equal(resumed.status, 'IN PROGRESS');
});
t('synthetic data is never accepted as real or test data', () => {
  assert.throws(() => F.newSession({ data_origin: 'synthetic' }, T0));
  const s = session(); assert.throws(() => F.addRecord(s, tdr({ data_origin: 'synthetic' }), {}, T0));
  const ts = F.newSession({ data_origin: 'test' }, T0); assert.throws(() => F.addRecord(ts, tdr({ data_origin: 'real' }), {}, T0));
  const bad = JSON.parse(F.toJSON(s, T0)); bad.data_origin = 'synthetic'; assert.throws(() => F.fromJSON(JSON.stringify(bad)));
  F.addRecord(ts, tdr(), {}, T0); assert(F.toCSV(ts).includes('TDR,test,')); assert.equal(F.exportBase(ts), 'LAZUR-20261124-T01_TEST');
});
t('calibration mode without validated model: no predictions, exact message, no operational status', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const ev = F.evaluate(s);
  assert.equal(ev.model.validated, false); assert.equal(ev.model.predictions_active, false);
  assert.equal(ev.model.message, 'Локалната калибрация е в процес. CSI данните се събират и проверяват. Прогнозните стойности и оперативните препоръки не са активни.');
  assert.equal(F.predict(s).available, false);
  const json = F.toJSON(s, T0); ['vwc_pred', 'gmax_pred', '"srs"', 'Operational', 'OPERATIONAL'].forEach(k => assert(!json.includes(k), k));
  assert(!F.STATUS.includes('OPERATIONAL'));
  const rep = F.reportHTML(s, [], T0); assert(rep.includes('INITIAL CALIBRATION — LAZUR')); assert(!/operational status/i.test(rep.replace('no operational recommendations', '')));
});
t('session close → COMPLETED only when nothing fails or is incomplete', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0); F.addRecord(s, clegg(), {}, T0);
  F.closeSession(s, 'PM', T0); assert.equal(s.status, 'COMPLETED');
  assert.throws(() => F.setStatus(s, 'OPERATIONAL'));
});
t('ZIP package is valid (store) with correct CRC', () => {
  const z = F.zip([{ name: 'a.txt', data: 'hello' }, { name: 'raw/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(z.buffer); assert.equal(dv.getUint32(0, true), 0x04034b50); assert.equal(dv.getUint32(14, true), F.crc32(new TextEncoder().encode('hello')));
  assert.equal(F.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  require('fs').writeFileSync('/tmp/field_test.zip', z);
  const out = require('child_process').execSync('python3 -c "import zipfile;z=zipfile.ZipFile(\'/tmp/field_test.zip\');print(z.testzip(),z.read(\'a.txt\').decode(),list(z.read(\'raw/b.bin\')))"').toString().trim();
  assert.equal(out, 'None hello [1, 2, 3]');
});
console.log(pass, 'field tests passed');
