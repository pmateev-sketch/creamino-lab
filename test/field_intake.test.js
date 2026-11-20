/* Logger intake tests: container inspection (standard signatures only), intake states, traceability.
   The pcap files here are generic libpcap containers built from the published libpcap header layout –
   they are NOT Nexmon or any other logger output, and no CSI is decoded. Run: node test/field_intake.test.js */
const CR = require('../js/field.js'); const F = CR.field;
const assert = require('assert'); const crypto = require('crypto');
let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok -', n); };
const T0 = new Date('2026-11-24T08:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).toISOString();

function pcap({ le = true, ns = false, packets = 3, payload = 60, truncate = 0, snaplen = 65535, backwards = false } = {}) {
  const parts = []; const hdr = Buffer.alloc(24);
  const w32 = (b, o, v) => le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o), w16 = (b, o, v) => le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o);
  w32(hdr, 0, ns ? 0xa1b23c4d : 0xa1b2c3d4); w16(hdr, 4, 2); w16(hdr, 6, 4); w32(hdr, 16, snaplen); w32(hdr, 20, 1); parts.push(hdr);
  for (let i = 0; i < packets; i++) {
    const r = Buffer.alloc(16); const sec = 1795939200 + (backwards ? -i : i);
    w32(r, 0, sec); w32(r, 4, ns ? 500000000 : 500000); w32(r, 8, payload); w32(r, 12, payload); parts.push(r, crypto.randomBytes(payload));
  }
  const b = Buffer.concat(parts); return new Uint8Array(truncate ? b.subarray(0, b.length - truncate) : b);
}

t('libpcap little-endian µs: packets, timestamps, linktype, structure OK', () => {
  const r = F.inspectContainer(pcap());
  assert.equal(r.format, 'PCAP'); assert.equal(r.byte_order, 'little-endian'); assert.equal(r.ts_resolution, 'us');
  assert.equal(r.packets, 3); assert.equal(r.linktype, 1); assert.equal(r.version, '2.4'); assert.ok(r.structure_ok);
  assert.equal(r.first_ts_utc, '2026-11-29T08:00:00.500Z'); assert.equal(r.last_ts_utc, '2026-11-29T08:00:02.500Z');
});
t('libpcap big-endian ns is read with the right byte order and resolution', () => {
  const r = F.inspectContainer(pcap({ le: false, ns: true, packets: 2 }));
  assert.equal(r.format, 'PCAP'); assert.equal(r.byte_order, 'big-endian'); assert.equal(r.ts_resolution, 'ns'); assert.equal(r.packets, 2); assert.ok(r.structure_ok);
});
t('truncated last record is reported, never counted as a packet', () => {
  const r = F.inspectContainer(pcap({ packets: 4, truncate: 10 }));
  assert.equal(r.packets, 3); assert.ok(r.truncated_tail_bytes > 0); assert.equal(r.structure_ok, false); assert.ok(/TRUNCATED/.test(r.evidence));
});
t('records larger than snaplen and backwards timestamps are flagged', () => {
  const r = F.inspectContainer(pcap({ snaplen: 40, payload: 60, backwards: true }));
  assert.equal(r.oversize_packets, 3); assert.equal(r.structure_ok, false); assert.equal(r.non_monotonic, 2);
});
t('pcapng, gzip, zip, delimited text, plain text, unknown binary, empty', () => {
  assert.equal(F.inspectContainer(new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0])).format, 'PCAPNG');
  assert.equal(F.inspectContainer(new Uint8Array([0x1f, 0x8b, 8, 0])).format, 'GZIP');
  assert.equal(F.inspectContainer(new Uint8Array([0x50, 0x4b, 3, 4, 0])).format, 'ZIP');
  const csv = F.inspectContainer(new Uint8Array(Buffer.from('ts,mac,rssi,csi\n1,aa,-40,"[1,2]"\n')));
  assert.equal(csv.format, 'TEXT_DELIMITED'); assert.ok(/first line/.test(csv.evidence));
  assert.equal(F.inspectContainer(new Uint8Array(Buffer.from('logger started\nok\n'))).format, 'TEXT');
  const rnd = new Uint8Array(crypto.randomBytes(4096)); rnd[0] = 0x00; rnd[1] = 0x01;
  assert.equal(F.inspectContainer(rnd).format, 'UNKNOWN');
  assert.equal(F.inspectContainer(new Uint8Array(0)).format, 'EMPTY');
});
t('inspection never claims a CSI format or a parse', () => {
  const s = F.newSession({ operator_id: 'PM' }, T0);
  const f = F.addRawFile(s, { sha256: 'ab'.repeat(32), filename: 'cap.pcap', size: 10, received_utc: at(0), container: F.inspectContainer(pcap()), source: 'logger-intake' }, T0).file;
  const st = F.intakeState(s, f);
  assert.equal(st.container_format, 'PCAP'); assert.equal(st.csi_format, 'NOT_IDENTIFIED'); assert.equal(st.csi_parse_status, 'NOT_PARSED');
  assert.ok(/NOT ENTERED/.test(st.metadata)); assert.equal(st.sha256_verified, 'NOT YET RE-HASHED'); assert.equal(st.file_received, at(0));
  f.verify = { status: 'VERIFIED', utc: at(1) }; assert.ok(/^VERIFIED/.test(F.intakeState(s, f).sha256_verified));
});
t('traceability: file → SHA → measurement → session → logger config → TDR → Clegg → QC → archive', () => {
  const s = F.newSession({ operator_id: 'PM', configuration: 'c', device: { device_id: 'PI4-01', device_model: 'unverified', firmware_version: '?', wifi_channel: 36, bandwidth: 80, subcarrier_count: 256, window_duration: 30 } }, T0);
  const f = F.addRawFile(s, { sha256: 'cd'.repeat(32), filename: 'short.pcap', size: 10, received_utc: at(0), source: 'logger-intake' }, T0).file;
  const base = { grid_cell_id: 'C4', coordinates_x: 25, coordinates_y: 35 };
  F.addRecord(s, Object.assign({ record_type: 'CSI', timestamp_utc: at(0), packet_loss: 1, raw_sha256: f.sha256, raw_stored: true, raw_data_reference: F.rawRef(f) }, base), {}, T0);
  F.addRecord(s, Object.assign({ record_type: 'TDR', timestamp_utc: at(2), reference_vwc: 22 }, base, { coordinates_x: 25.4 }), {}, T0);
  F.addRecord(s, Object.assign({ record_type: 'CLEGG', timestamp_utc: at(4), reference_gmax: 90 }, base, { coordinates_y: 35.5 }), {}, T0);
  F.addRawFile(s, { sha256: 'ef'.repeat(32), filename: 'long.pcap', size: 20, source: 'logger-intake' }, T0);
  let tr = F.trace(s);
  assert.equal(tr.length, 2);
  const r = tr[0];
  assert.equal(r.file_id, f.file_id); assert.equal(r.sha256, f.sha256); assert.equal(r.measurement_id, 'LAZUR-20261124-S01-CSI-0001'); assert.equal(r.session_id, s.session_id);
  assert.ok(/device_id=PI4-01/.test(r.logger) && /subcarrier_count=256/.test(r.logger));
  assert.equal(r.tdr_id, 'LAZUR-20261124-S01-TDR-0001'); assert.equal(r.clegg_id, 'LAZUR-20261124-S01-CLEGG-0001');
  assert.ok(r.qc_status); assert.equal(r.csi_parse_status, 'NOT_PARSED'); assert.equal(r.archive, 'NOT ARCHIVED');
  assert.equal(tr[1].measurement_id, '(unassigned)');
  s.backup = { last_zip_utc: at(10), change_seq_at_zip: s.change_seq, files: 2, verified: true };
  assert.equal(F.trace(s)[0].archive, at(10));
  F.setStatus(s, 'CALIBRATION', 'PM'); assert.ok(/outdated/.test(F.trace(s)[0].archive));
  const csv = F.traceCSV(s); assert.ok(csv.split('\n')[0].includes('file_id,original_filename,sha256,sha256_verified,container_format,measurement_id,session_id'));
  assert.ok(!/predict|calibrat/i.test(csv.split('\n')[0]), 'no prediction / calibration columns');
});

console.log(pass + ' intake tests passed');
