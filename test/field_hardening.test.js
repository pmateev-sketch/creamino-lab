/* Pre-Lazur hardening tests (field-qc-1.1): matching, raw states, backup status, manifest, ZIP read/verify, restore planning.
   Run: node test/field_hardening.test.js */
const CR = require('../js/field.js'); const F = CR.field;
const assert = require('assert'); const crypto = require('crypto');
let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok -', n); };
const T0 = new Date('2026-11-24T08:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).toISOString();
const sha = (u8) => crypto.createHash('sha256').update(u8).digest('hex');
const session = () => F.newSession({ operator_id: 'PM', configuration: 'cfg', device: { device_id: 'D', device_model: 'M', firmware_version: 'f', wifi_channel: 6, bandwidth: 20, subcarrier_count: 64, window_duration: 30 } }, T0);
const csi = (o) => Object.assign({ record_type: 'CSI', grid_cell_id: 'C4', timestamp_utc: at(0), packet_loss: 2, signal_quality: -48, raw_data_reference: 'ext.bin', coordinates_x: 25, coordinates_y: 35 }, o || {});
const tdr = (o) => Object.assign({ record_type: 'TDR', grid_cell_id: 'C4', timestamp_utc: at(3), reference_vwc: 22.4, coordinates_x: 25.5, coordinates_y: 35.2 }, o || {});
const ids = (s) => F.current(s).map(r => r.measurement_id);

/* ---------- matching ---------- */
t('one-to-one: a reference is never assigned to two CSI records', () => {
  const s = session();
  F.addRecord(s, csi(), {}, T0); F.addRecord(s, csi({ timestamp_utc: at(1), coordinates_x: 25.3 }), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const ev = F.evaluate(s);
  assert.equal(ev.pairs.length, 1);
  const refs = ev.pairs.map(p => p.ref); assert.equal(new Set(refs).size, refs.length);
  assert.equal(ev.pairs[0].csi, 'LAZUR-20261124-S01-CSI-0002', 'closest in time wins (Δt 2 min vs 3 min)');
  assert.ok(ev.pairs[0].ambiguous, 'two CSI candidates for one reference → AMBIGUOUS');
  const loser = ev.current.find(e => e.rec.measurement_id === 'LAZUR-20261124-S01-CSI-0001');
  assert.ok(loser.qc.checks.some(c => c.code === 'REFERENCE_MISMATCH' && /already paired/.test(c.message)), 'unpaired CSI carries the reason');
});
t('ambiguous pairs are flagged on both records and excluded from valid pairs until reviewed', () => {
  const s = session();
  F.addRecord(s, csi(), {}, T0); F.addRecord(s, csi({ timestamp_utc: at(1), coordinates_x: 25.3 }), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const ev = F.evaluate(s);
  assert.equal(ev.metrics.ambiguous_pairs, 1); assert.equal(ev.validPairs.length, 0);
  ['LAZUR-20261124-S01-CSI-0002', 'LAZUR-20261124-S01-TDR-0001'].forEach(id => assert.ok(ev.current.find(e => e.rec.measurement_id === id).qc.checks.some(c => c.code === 'MATCH_AMBIGUOUS'), id));
});
t('same cell without coordinates is NOT accepted as ≤ 2 m – rejected with a reason', () => {
  const s = session(); F.addRecord(s, csi({ coordinates_x: '', coordinates_y: '' }), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const ev = F.evaluate(s);
  assert.equal(ev.pairs.length, 0);
  assert.equal(ev.matchLog.length, 1); assert.equal(ev.matchLog[0].decision, 'rejected');
  assert.ok(/distance cannot be verified: X\/Y missing on CSI/.test(ev.matchLog[0].reason));
  const s2 = session(); F.addRecord(s2, csi(), {}, T0); F.addRecord(s2, tdr({ coordinates_x: '' }), {}, T0);
  assert.ok(/missing on reference/.test(F.evaluate(s2).matchLog[0].reason));
});
t('same cell but > 2 m apart is rejected with the measured distance', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr({ coordinates_x: 28, coordinates_y: 35 }), {}, T0);
  const ev = F.evaluate(s); assert.equal(ev.pairs.length, 0); assert.ok(/distance 3\.00 m > 2 m/.test(ev.matchLog[0].reason));
});
t('time window rejection keeps its reason; unmatched CSI and references are preserved', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr({ timestamp_utc: at(45) }), {}, T0);
  const ev = F.evaluate(s);
  assert.ok(/time difference 45\.0 min > 30 min/.test(ev.matchLog[0].reason));
  assert.deepEqual(ev.unmatchedCsi, ['LAZUR-20261124-S01-CSI-0001']); assert.deepEqual(ev.unmatchedRefs, ['LAZUR-20261124-S01-TDR-0001']);
  assert.equal(F.current(s).length, 2);
});
t('every accepted pair has a reason; matching is deterministic regardless of record order', () => {
  const build = (order) => {
    const s = session(), recs = [csi(), csi({ timestamp_utc: at(2), coordinates_x: 25.2 }), tdr(), tdr({ timestamp_utc: at(4), coordinates_x: 25.1 })];
    order.forEach(i => F.addRecord(s, recs[i], {}, T0));
    const ev = F.evaluate(s), name = id => { const r = F.current(s).find(x => x.measurement_id === id); return r.record_type + '@' + r.timestamp_utc; };
    ev.pairs.forEach(p => assert.ok(/^accepted:/.test(p.reason)));
    return ev.pairs.map(p => name(p.csi) + '→' + name(p.ref)).sort().join(' ');
  };
  const a = build([0, 1, 2, 3]), b = build([3, 2, 1, 0]), c = build([2, 0, 3, 1]);
  assert.equal(a, b); assert.equal(a, c);
  assert.equal(a.split(' ').length, 2, 'two CSI, two references → two one-to-one pairs');
});
t('CSV carries paired_with and the three CSI states (raw / metadata / parsed)', () => {
  const s = session(); F.addRecord(s, csi(), {}, T0); F.addRecord(s, tdr(), {}, T0);
  const csv = F.toCSV(s), head = csv.split('\n')[0];
  ['raw_file_status', 'metadata_entry', 'csi_parse_status', 'paired_with'].forEach(c => assert.ok(head.includes(c), c));
  assert.ok(csv.includes('EXTERNAL_REFERENCE,MANUAL,NOT_PARSED,LAZUR-20261124-S01-TDR-0001'));
});

/* ---------- raw states ---------- */
t('raw file states: STORED / EXTERNAL_REFERENCE / MISSING; CSI is never reported as parsed', () => {
  const s = session();
  const f = F.addRawFile(s, { sha256: 'ab'.repeat(32), filename: 'a.bin', size: 10 }).file;
  assert.equal(f.file_id, 'RAW-LAZUR-20261124-S01-0001');
  F.addRecord(s, csi({ raw_sha256: f.sha256, raw_stored: true, raw_data_reference: F.rawRef(f) }), {}, T0);
  F.addRecord(s, csi({ timestamp_utc: at(5), grid_cell_id: 'D4', coordinates_x: 35 }), {}, T0);
  F.addRecord(s, csi({ timestamp_utc: at(9), grid_cell_id: 'E4', coordinates_x: 45, raw_data_reference: '' }), {}, T0);
  const m = F.evaluate(s).metrics;
  assert.deepEqual([m.csi_raw_stored, m.csi_raw_external, m.csi_raw_missing, m.csi_parsed], [1, 1, 1, 0]);
  F.current(s).forEach(r => assert.equal(F.rawState(s, r).csi_parse_status, 'NOT_PARSED'));
  f.unavailable = 'CORRUPTED at restore'; assert.equal(F.rawState(s, F.current(s)[0]).raw_file_status, 'MISSING');
});

/* ---------- backup status / migration ---------- */
t('backup status: NOT_BACKED_UP → EXPORTED → OUTDATED after a change; incomplete export is not EXPORTED', () => {
  const s = session(); F.addRecord(s, tdr(), {}, T0);
  assert.equal(F.backupStatus(s).state, 'NOT_BACKED_UP');
  s.backup = { last_zip_utc: at(10), change_seq_at_zip: s.change_seq, files: 0, verified: true };
  assert.equal(F.backupStatus(s).state, 'EXPORTED');
  F.reviseRecord(s, 'LAZUR-20261124-S01-TDR-0001', { reference_vwc: 23 }, 'PM', T0);
  assert.equal(F.backupStatus(s).state, 'OUTDATED'); assert.equal(F.backupStatus(s).changes_since, 1);
  s.backup = { last_zip_utc: at(20), change_seq_at_zip: s.change_seq, files: 0, verified: false };
  assert.equal(F.backupStatus(s).state, 'BACKUP_INCOMPLETE');
});
t('migration of a field-qc-1.0 session adds file IDs and bookkeeping without touching records', () => {
  const s = session(); F.addRecord(s, tdr(), {}, T0);
  const old = JSON.parse(JSON.stringify(s));
  delete old.change_seq; delete old.save_seq; delete old.backup; old.counters = { CSI: 0, TDR: 1, CLEGG: 0 };
  old.raw_files = [{ sha256: 'cd'.repeat(32), filename: 'x.bin', size: 3, type: '', stored_utc: at(0) }];
  const recs = JSON.stringify(old.records);
  F.migrate(old);
  assert.equal(old.raw_files[0].file_id, 'RAW-LAZUR-20261124-S01-0001'); assert.equal(old.counters.RAW, 1);
  assert.equal(F.backupStatus(old).state, 'NOT_BACKED_UP'); assert.equal(JSON.stringify(old.records), recs);
  F.migrate(old); assert.equal(old.raw_files[0].file_id, 'RAW-LAZUR-20261124-S01-0001', 'idempotent');
});

/* ---------- manifest, zip, restore ---------- */
function pkg(opts) {
  opts = opts || {};
  const s = session(), bytes = [crypto.randomBytes(300000), crypto.randomBytes(1024), Buffer.from('same name, other bytes')];
  const names = ['csi_0001.bin', 'csi_0002.pcap', 'csi_0001.bin'];
  bytes.forEach((b, i) => {
    const f = F.addRawFile(s, { sha256: sha(b), filename: names[i], size: b.length, type: 'application/octet-stream', last_modified: 1700000000000 + i }, T0).file;
    F.addRecord(s, csi({ timestamp_utc: at(i * 10), grid_cell_id: 'C' + (4 + i), coordinates_y: 35 + i * 10, raw_sha256: f.sha256, raw_stored: true, raw_data_reference: F.rawRef(f) }), {}, T0);
  });
  F.addRecord(s, tdr(), {}, T0);
  F.reviseRecord(s, 'LAZUR-20261124-S01-TDR-0001', { reference_vwc: 21.9 }, 'PM', T0);
  const verdict = {}; s.raw_files.forEach(f => verdict[f.sha256] = 'VERIFIED'); if (opts.missing) verdict[s.raw_files[1].sha256] = 'MISSING';
  const enc = (x) => new Uint8Array(Buffer.from(x, 'utf8'));
  const docs = [['_measurements.csv', F.toCSV(s)], ['_session.json', F.toJSON(s, T0)], ['_report.html', F.reportHTML(s, [], T0)]].map(([n, d]) => ({ name: F.exportBase(s) + n, data: enc(d) }));
  const man = F.buildManifest(s, verdict, docs.map(d => ({ zip_path: d.name, size: d.data.length, sha256: sha(d.data) })), T0);
  const raws = s.raw_files.map((f, i) => ({ name: F.rawZipPath(f), data: new Uint8Array(bytes[i]) })).filter(e => !(opts.missing && e.name.includes('0002')));
  const files = docs.concat(raws, [{ name: 'MANIFEST.json', data: enc(JSON.stringify(man)) }, { name: 'MANIFEST.csv', data: enc(F.manifestCSV(man)) }]);
  return { s, bytes, man, zip: F.zip(files) };
}
const hashAll = (entries) => { const h = {}; entries.forEach(e => { if (e.data) h[e.name] = sha(e.data); }); return h; };

t('manifest lists session, measurement IDs, file ID, original name, size, SHA-256, MIME, export time, verification', () => {
  const { man, s } = pkg();
  assert.equal(man.session_id, s.session_id); assert.equal(man.raw_files.length, 3); assert.ok(man.summary.complete);
  const f = man.raw_files[0];
  ['file_id', 'measurement_ids', 'original_filename', 'zip_path', 'size', 'sha256', 'mime', 'stored_utc', 'verification'].forEach(k => assert.ok(k in f, k));
  assert.deepEqual(f.measurement_ids, ['LAZUR-20261124-S01-CSI-0001']); assert.equal(man.export_utc, T0.toISOString());
  assert.notEqual(man.raw_files[0].zip_path, man.raw_files[2].zip_path, 'two files with the same original name get distinct paths');
  const csv = F.manifestCSV(man); assert.ok(csv.split('\n')[0].includes('session_id,file_id,measurement_ids,original_filename,zip_path,size,sha256,mime,export_utc,verification'));
});
t('unzip reads the package back with CRC verification; bytes are identical', () => {
  const { zip, bytes, s } = pkg();
  const e = F.unzip(zip); assert.ok(e.every(x => x.ok));
  s.raw_files.forEach((f, i) => assert.equal(sha(e.find(x => x.name === F.rawZipPath(f)).data), sha(bytes[i])));
});
t('restore plan: complete package → all files VERIFIED, session and revisions identical', () => {
  const { zip, s } = pkg();
  const e = F.unzip(zip), plan = F.planRestore(e, hashAll(e));
  assert.ok(plan.ok); assert.ok(plan.files.every(v => v.status === 'VERIFIED'));
  assert.deepEqual(plan.session.records, s.records); assert.deepEqual(plan.session.raw_files, s.raw_files);
  assert.equal(plan.session.records.filter(r => r.superseded_by).length, 1);
});
t('a flipped byte in a raw file → CRC and SHA mismatch → CORRUPTED, never restored', () => {
  const p = pkg(); const e0 = F.unzip(p.zip); const target = e0.find(x => x.name.includes('0002'));
  const off = target.data.byteOffset + 10; p.zip[off] ^= 0xff;
  const e = F.unzip(p.zip), bad = e.find(x => x.name.includes('0002'));
  assert.equal(bad.ok, false); assert.ok(/CRC-32 mismatch/.test(bad.problem));
  const plan = F.planRestore(e, hashAll(e)), v = plan.files.find(x => x.file.file_id.endsWith('0002'));
  assert.equal(plan.ok, false); assert.equal(v.status, 'CORRUPTED'); assert.equal(v.data, undefined);
  assert.equal(plan.files.filter(x => x.status === 'VERIFIED').length, 2);
});
t('a raw file whose bytes were replaced consistently (valid CRC, wrong SHA-256) is still rejected', () => {
  const p = pkg(); const e = F.unzip(p.zip);
  const victim = e.find(x => x.name.includes('0001'));
  const h = hashAll(e); h[victim.name] = '0'.repeat(64);   // stands for "bytes are a valid ZIP entry but not the original file"
  const plan = F.planRestore(e, h); const v = plan.files.find(x => x.zip_path === victim.name);
  assert.equal(v.status, 'CORRUPTED'); assert.ok(/SHA-256/.test(v.reason)); assert.equal(plan.ok, false);
});
t('a file missing from the package → MISSING (export-time verdict carried in the manifest)', () => {
  const p = pkg({ missing: true }); const e = F.unzip(p.zip), plan = F.planRestore(e, hashAll(e));
  assert.equal(p.man.summary.complete, false); assert.equal(p.man.summary.missing, 1);
  const v = plan.files.find(x => x.file.file_id.endsWith('0002')); assert.equal(v.status, 'MISSING'); assert.equal(plan.ok, false);
  F.markUnavailable(plan.session, plan.files, T0);
  const rec = plan.session.records.find(r => r.raw_sha256 === v.file.sha256); assert.equal(F.rawState(plan.session, rec).raw_file_status, 'MISSING');
});
t('a truncated ZIP or a damaged session JSON restores nothing', () => {
  const p = pkg();
  assert.throws(() => F.unzip(p.zip.slice(0, p.zip.length - 100)), /end-of-central-directory|truncated|damaged/);
  const e = F.unzip(p.zip); const sj = e.find(x => /_session\.json$/.test(x.name));
  const h = hashAll(e); h[sj.name] = 'f'.repeat(64);
  assert.throws(() => F.planRestore(e, h), /Session JSON SHA-256 does not match/);
});
t('compressed (deflate) entries are reported, not guessed', () => {
  const p = pkg(); const z = p.zip.slice(); const dv = new DataView(z.buffer);
  for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { const cd = dv.getUint32(i + 16, true); dv.setUint16(cd + 10, 8, true); break; }
  const e = F.unzip(z); assert.equal(e[0].ok, false); assert.ok(/compressed entry/.test(e[0].problem));
});

console.log(pass + ' hardening tests passed');
