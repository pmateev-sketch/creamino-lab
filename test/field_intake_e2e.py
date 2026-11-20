"""Logger intake workflow in headless Chrome – rehearsal of protocol steps D–I with STAND-IN files.
The files are generic libpcap containers and a text file generated here; they are NOT output of the Lazur logger
and prove nothing about hardware compatibility. Run: python3 -m http.server 8765 &  then  python3 test/field_intake_e2e.py"""
import asyncio, os, json, zipfile, tempfile, hashlib, shutil, struct, re
from playwright.async_api import async_playwright
URL = os.environ.get('DEMO_URL', 'http://localhost:8765/index.html')
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, detail)
sha = lambda b: hashlib.sha256(b).hexdigest()
SNAP = open(os.path.join(os.path.dirname(__file__), 'field_roundtrip_e2e.py')).read().split('SNAP = """', 1)[1].split('"""', 1)[0]
WIPE = """async () => { await new Promise((r) => { const q = indexedDB.deleteDatabase('creamino-field'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); localStorage.clear(); return true; }"""

def generic_pcap(n, payload):
    out = [struct.pack('<IHHiIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)]
    for i in range(n):
        out.append(struct.pack('<IIII', 1795939200 + i // 100, (i % 100) * 10000, payload, payload)); out.append(os.urandom(payload))
    return b''.join(out)

async def main():
    tmp = tempfile.mkdtemp(prefix='crintake_')
    files = {'short_capture.pcap': generic_pcap(200, 1100), 'long_capture.pcap': generic_pcap(18000, 1100), 'logger_notes.txt': b'logger,channel,bw\nunverified,?,?\n'}
    paths = {}
    for k, v in files.items():
        paths[k] = os.path.join(tmp, k); open(paths[k], 'wb').write(v)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(accept_downloads=True, viewport={'width': 1366, 'height': 900})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#field'); await pg.wait_for_timeout(700)
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(700)
        f = pg.locator('#fNew')
        await f.locator('[name=session_date]').fill('2026-11-24'); await f.locator('[name=operator_id]').fill('PM'); await f.locator('[name=data_origin]').select_option('test')
        for k, v in {'device_id': 'LOGGER-UNVERIFIED', 'device_model': 'unverified', 'firmware_version': 'unverified', 'wifi_channel': '36', 'subcarrier_count': '256', 'window_duration': '30', 'configuration': 'intake rehearsal with stand-in files'}.items():
            await f.locator(f'[name={k}]').fill(v)
        await f.locator('[name=bandwidth]').select_option('80')
        await pg.click('#fCreate'); await pg.wait_for_timeout(500)

        # D. import
        await pg.locator('#fIntake').set_input_files([paths[k] for k in files])
        await pg.wait_for_function("() => (document.querySelectorAll('#fIntakeTable tbody tr')||[]).length === 3", timeout=60000); await pg.wait_for_timeout(300)
        tab = await pg.inner_text('#fIntakeTable')
        check('D. three logger files imported in a separate intake step', tab.count('RAW-LAZUR-20261124-T01-') == 3)
        st = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;return s.raw_files.map(f=>Object.assign({id:f.file_id,name:f.filename,size:f.size,sha:f.sha256},CR.field.intakeState(s,f)))})()")
        check('E. size and SHA-256 equal the files on disk', all(x['size'] == len(files[x['name']]) and x['sha'] == sha(files[x['name']]) for x in st))
        check('stage 1–3: received time set, raw stored, SHA-256 re-hash VERIFIED', all(x['file_received'] and x['raw_stored'] == 'YES' and x['sha256_verified'].startswith('VERIFIED') for x in st), [x['sha256_verified'][:8] for x in st])
        check('stage 4: metadata NOT ENTERED until linked', all('NOT ENTERED' in x['metadata'] for x in st))
        fmt = {x['name']: x['container_format'] for x in st}
        check('stage 5: container identified from signatures (PCAP / TEXT_DELIMITED); CSI format NOT_IDENTIFIED', fmt == {'short_capture.pcap': 'PCAP', 'long_capture.pcap': 'PCAP', 'logger_notes.txt': 'TEXT_DELIMITED'} and all(x['csi_format'] == 'NOT_IDENTIFIED' for x in st), fmt)
        check('stage 6: every file NOT_PARSED', all(x['csi_parse_status'] == 'NOT_PARSED' for x in st))
        cont = await pg.evaluate("CR.fieldUI.state().session.raw_files.find(f=>f.filename==='long_capture.pcap').container")
        check('pcap evidence: 18000 packet records, structure OK, first/last capture time', cont['packets'] == 18000 and cont['structure_ok'] and cont['first_ts_utc'] == '2026-11-29T08:00:00.000Z', cont['evidence'])
        text = await pg.inner_text('main')
        occ = [text[max(0, m.start() - 12):m.end() + 3] for m in re.finditer(r'parsed', text, re.I)]
        bad = [o for o in occ if not re.search(r'not[ _]parsed|parsed 0|parsed\)?$', o, re.I) or re.search(r'successfully parsed', o, re.I)]
        check('UI never says a file is parsed (every "parsed" is "not parsed" / "parsed 0")', occ and not bad, bad[:5])
        # same file again → not stored twice
        await pg.locator('#fIntake').set_input_files([]); await pg.locator('#fIntake').set_input_files(paths['short_capture.pcap']); await pg.wait_for_timeout(1500)
        check('re-importing identical bytes is refused (no second copy)', 'already in this session' in await pg.inner_text('main') and await pg.evaluate("CR.fieldUI.state().session.raw_files.length") == 3)

        # link file → CSI record, then TDR + Clegg
        sid = [x for x in st if x['name'] == 'short_capture.pcap'][0]
        await pg.click(f'[data-link="{sid["sha"]}"]'); await pg.wait_for_timeout(300)
        check('"Create CSI record" pre-selects the intake file', await pg.locator('#fIntakeSel').input_value() == sid['sha'])
        fr = pg.locator('#fRec')
        for k, v in {'ts': '2026-11-24T10:00', 'grid_cell_id': 'C4', 'coordinates_x': '25', 'coordinates_y': '35', 'packet_loss': '0.5', 'signal_quality': '-45'}.items():
            await fr.locator(f'[name={k}]').fill(v)
        await pg.click('#fSave'); await pg.wait_for_timeout(700)
        async def rec(tab_, vals):
            await pg.click(f'[data-tab={tab_}]'); await pg.wait_for_timeout(150); fr = pg.locator('#fRec')
            for k, v in vals.items(): await fr.locator(f'[name={k}]').fill(v)
            await pg.click('#fSave'); await pg.wait_for_timeout(600)
        await rec('TDR', {'ts': '2026-11-24T10:04', 'grid_cell_id': 'C4', 'coordinates_x': '25.4', 'coordinates_y': '35.1', 'reference_vwc': '23.1'})
        await rec('CLEGG', {'ts': '2026-11-24T10:06', 'grid_cell_id': 'C4', 'coordinates_x': '25.1', 'coordinates_y': '35.6', 'reference_gmax': '88'})
        tr = await pg.evaluate("CR.field.trace(CR.fieldUI.state().session)")
        r0 = [r for r in tr if r['measurement_id'] != '(unassigned)']
        check('linked record: metadata MANUAL, raw from intake, nothing parsed', len(r0) == 1 and r0[0]['sha256'] == sid['sha'] and r0[0]['csi_parse_status'] == 'NOT_PARSED')
        check('traceability chain complete: file → SHA → measurement → session → logger → TDR → Clegg → QC', r0[0]['file_id'] and r0[0]['tdr_id'].endswith('TDR-0001') and r0[0]['clegg_id'].endswith('CLEGG-0001') and 'subcarrier_count=256' in r0[0]['logger'] and r0[0]['qc_status'] and r0[0]['session_id'] == 'LAZUR-20261124-T01', r0[0])
        check('unlinked files stay listed as (unassigned)', sum(1 for r in tr if r['measurement_id'] == '(unassigned)') == 2)
        check('traceability table shown in the session view', await pg.locator('#fTrace tbody tr').count() == 3)

        # F. export
        async with pg.expect_download(timeout=120000) as dl: await pg.click('#xZIP')
        d = await dl.value; zp = os.path.join(tmp, 'intake.zip'); await d.save_as(zp); await pg.wait_for_timeout(700)
        z = zipfile.ZipFile(zp); nm = z.namelist(); man = json.loads(z.read('MANIFEST.json'))
        check('F. ZIP: CRC OK, traceability CSV included and hash-listed, container format in manifest', z.testzip() is None and any(n.endswith('_traceability.csv') for n in nm) and any(x['zip_path'].endswith('_traceability.csv') for x in man['documents']) and all(x['container_format'] for x in man['raw_files']))
        trace_csv = z.read([n for n in nm if n.endswith('_traceability.csv')][0]).decode('utf-8-sig')
        check('archive column of the exported traceability CSV says NOT ARCHIVED (written before the export completes)', 'NOT ARCHIVED' in trace_csv)
        check('archive column in the app now shows the export time', (await pg.evaluate("CR.field.trace(CR.fieldUI.state().session)[0].archive")) not in ('', 'NOT ARCHIVED'))
        ref = await pg.evaluate(SNAP); ref_s = ref['sessions'][0]

        # G. restore into a clean database
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(700)
        await pg.locator('#fImportZip').set_input_files(zp)
        await pg.wait_for_function("() => CR.fieldUI.state().session", timeout=120000); await pg.wait_for_timeout(700)
        got = await pg.evaluate(SNAP); got_s = got['sessions'][0]
        # H. byte-for-byte identity: compare with the original files on disk via re-hash in the browser + ZIP bytes
        disk = {sha(v): (k, len(v)) for k, v in files.items()}
        check('H. every restored raw file re-hashes to the SHA-256 of the original file on disk', set(got['blobs']) == set(disk) and all(v['rehash'] == k and v['size'] == disk[k][1] and v['filename'] == disk[k][0] for k, v in got['blobs'].items()))
        check('H. ZIP raw entries are byte-identical to the original files', all(z.read(x['zip_path']) == files[x['original_filename']] for x in man['raw_files']))
        # I. timestamps and manually entered configuration
        check('I. record timestamps, logger configuration and intake metadata identical after restore', got_s['records'] == ref_s['records'] and got_s['device'] == ref_s['device'] and got_s['raw_files'] == ref_s['raw_files'] and got_s['configuration'] == ref_s['configuration'])
        check('I. intake received time, container evidence and re-hash result preserved', all(f.get('received_utc') and f.get('container') and f.get('verify') for f in got_s['raw_files']))
        check('no JS errors', not errs, errs[:3])
        await b.close()
    shutil.rmtree(tmp, ignore_errors=True)
    n = sum(1 for r in results if r[1]); print(f'{n} / {len(results)} passed')
asyncio.run(main())
