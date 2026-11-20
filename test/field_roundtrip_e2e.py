"""Pre-Lazur hardening: full round trip and failure handling of the Field Session module in headless Chrome.
Session with several measurements, raw binaries of 8 MB and 25 MB, TDR/Clegg, a revision →
export ZIP → delete the IndexedDB database → restore from ZIP → compare every record, revision, file and hash.
Plus: corrupted ZIP, simulated quota failure, two-tab conflict, duplicate with raw file, interrupted save, low storage.
Run: python3 -m http.server 8765 &  then  python3 test/field_roundtrip_e2e.py"""
import asyncio, os, json, zipfile, io, tempfile, hashlib, shutil
from playwright.async_api import async_playwright
URL = os.environ.get('DEMO_URL', 'http://localhost:8765/index.html')
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, detail)
sha = lambda b: hashlib.sha256(b).hexdigest()

SNAP = """async () => {
  const db = await new Promise((r, j) => { const q = indexedDB.open('creamino-field'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all = (st) => new Promise((r, j) => { const q = db.transaction(st).objectStore(st).getAll(); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const sessions = await all('sessions'); const raws = await all('raw');
  const hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('');
  const blobs = {}; for (const r of raws) blobs[r.sha256] = { size: r.data.byteLength, rehash: await hex(r.data), filename: r.filename, type: r.type, last_modified: r.last_modified };
  db.close();
  return { sessions, blobs };
}"""
WIPE = """async () => { await new Promise((r) => { const q = indexedDB.deleteDatabase('creamino-field'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); localStorage.clear(); return true; }"""

async def main():
    tmp = tempfile.mkdtemp(prefix='crfield_')
    files = {}
    for name, size in [('csi_big_8MB.bin', 8 * 1024 * 1024), ('csi_big_25MB.pcap', 25 * 1024 * 1024), ('csi_small.dat', 4096)]:
        data = os.urandom(size); path = os.path.join(tmp, name); open(path, 'wb').write(data); files[name] = (path, sha(data), size)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(accept_downloads=True, viewport={'width': 1366, 'height': 900})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#field'); await pg.wait_for_timeout(800)
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(800)
        panel = await pg.evaluate("(document.querySelector('#fStorage')||{}).textContent||''")
        check('storage panel present, says browser storage is not a backup', 'Browser storage is not a backup' in panel and 'Persistent storage' in panel and 'Usage / quota' in panel)

        f = pg.locator('#fNew')
        await f.locator('[name=session_date]').fill('2026-11-24'); await f.locator('[name=operator_id]').fill('PM')
        await f.locator('[name=data_origin]').select_option('test')
        for k, v in {'device_id': 'LOGGER-1', 'device_model': 'unknown', 'firmware_version': 'x', 'wifi_channel': '6', 'subcarrier_count': '64', 'window_duration': '30', 'configuration': 'rehearsal'}.items():
            await f.locator(f'[name={k}]').fill(v)
        await f.locator('[name=bandwidth]').select_option('20')
        await pg.click('#fCreate'); await pg.wait_for_timeout(500)
        SID = 'LAZUR-20261124-T01'
        check('test session created', SID in await pg.inner_text('main'))

        async def rec(tab, vals, file=None, wait=600):
            await pg.click(f'[data-tab={tab}]'); await pg.wait_for_timeout(150)
            fr = pg.locator('#fRec')
            await fr.locator('[name=ts]').fill(vals.pop('ts'))
            for k, v in vals.items(): await fr.locator(f'[name={k}]').fill(str(v))
            if file: await fr.locator('[name=raw]').set_input_files(file)
            await pg.click('#fSave')
            await pg.wait_for_function("() => { const b = document.querySelector('#fSave'); return b && !b.disabled; }", timeout=60000)
            await pg.wait_for_timeout(wait)
        await rec('CSI', {'ts': '2026-11-24T10:00', 'grid_cell_id': 'C4', 'coordinates_x': 25, 'coordinates_y': 35, 'packet_loss': 2, 'signal_quality': '-48'}, files['csi_big_8MB.bin'][0])
        await rec('CSI', {'ts': '2026-11-24T10:20', 'grid_cell_id': 'D4', 'coordinates_x': 35, 'coordinates_y': 35, 'packet_loss': 1, 'signal_quality': '-50'}, files['csi_big_25MB.pcap'][0], 1500)
        await rec('CSI', {'ts': '2026-11-24T10:40', 'grid_cell_id': 'E4', 'coordinates_x': 45, 'coordinates_y': 35, 'packet_loss': 3, 'signal_quality': '-52'}, files['csi_small.dat'][0])
        await rec('TDR', {'ts': '2026-11-24T10:03', 'grid_cell_id': 'C4', 'coordinates_x': 25.5, 'coordinates_y': 35.2, 'reference_vwc': 22.4})
        await rec('CLEGG', {'ts': '2026-11-24T10:22', 'grid_cell_id': 'D4', 'coordinates_x': 35.3, 'coordinates_y': 35.1, 'reference_gmax': 91})
        await rec('TDR', {'ts': '2026-11-24T10:43', 'grid_cell_id': 'E4', 'coordinates_x': '', 'coordinates_y': '', 'reference_vwc': 20.1})
        st = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;const m=CR.field.evaluate(s).metrics;return {n:s.records.length,raw:s.raw_files.length,pairs:m.pairs_total,stored:m.csi_raw_stored,parsed:m.csi_parsed}})()")
        check('3 CSI with 8 MB / 25 MB / 4 KB raw files + 2 TDR + 1 Clegg saved', st['n'] == 6 and st['raw'] == 3 and st['stored'] == 3, st)
        check('TDR without x/y in the same cell is NOT paired (proximity unverifiable)', st['pairs'] == 2, st)
        await pg.click('#fMatchLog summary'); await pg.wait_for_timeout(100)
        check('matching log shows the rejection reason', 'distance cannot be verified' in await pg.inner_text('#fMatchLog'))
        check('records show raw stored / metadata manual / CSI not parsed', 'metadata manual · CSI not parsed' in await pg.inner_text('main') and st['parsed'] == 0)
        # revision
        await pg.click('[data-rev="LAZUR-20261124-T01-TDR-0001"]'); await pg.wait_for_timeout(200)
        await pg.locator('#revF [name=reference_vwc]').fill('22.9'); await pg.locator('#revF [name=_reason]').fill('re-read probe')
        await pg.click('#revF button[type=submit]'); await pg.wait_for_timeout(500)
        check('backup state NOT BACKED UP before any ZIP', await pg.get_attribute('#fBackup', 'data-state') == 'NOT_BACKED_UP')

        # duplicate with raw file must not leave an orphan blob
        before = await pg.evaluate(SNAP)
        await rec('CSI', {'ts': '2026-11-24T10:40', 'grid_cell_id': 'E4', 'coordinates_x': 45, 'coordinates_y': 35, 'packet_loss': 3, 'signal_quality': '-52'}, os.path.join(tmp, 'csi_small.dat'))
        dup_modal = await pg.locator('#modal:not(.hidden) h3:has-text("Possible duplicate")').count()
        if dup_modal: await pg.click('#modal [data-close]')
        after = await pg.evaluate(SNAP)
        # same bytes → same sha; use different bytes to prove no orphan
        other = os.path.join(tmp, 'csi_other.dat'); open(other, 'wb').write(os.urandom(2048))
        await rec('CSI', {'ts': '2026-11-24T10:40', 'grid_cell_id': 'E4', 'coordinates_x': 45, 'coordinates_y': 35, 'packet_loss': 3, 'signal_quality': '-52'}, other)
        if await pg.locator('#modal:not(.hidden) h3:has-text("Possible duplicate")').count(): await pg.click('#modal [data-close]')
        after2 = await pg.evaluate(SNAP)
        check('refused duplicate stores neither record nor raw blob (no orphan)', dup_modal and len(after2['blobs']) == len(before['blobs']) == 3 and len(after2['sessions'][0]['records']) == len(before['sessions'][0]['records']), (len(before['blobs']), len(after2['blobs'])))

        # simulated quota failure
        await pg.evaluate("CR.fieldStore.simulateFailure='QuotaExceededError'")
        await rec('CLEGG', {'ts': '2026-11-24T11:00', 'grid_cell_id': 'F4', 'coordinates_x': 55, 'coordinates_y': 35, 'reference_gmax': 77})
        t = await pg.inner_text('main')
        mem = await pg.evaluate("CR.fieldUI.state().session.records.length"); db1 = await pg.evaluate(SNAP)
        check('quota failure: explicit NOT SAVED message, record not shown, not stored', 'NOT SAVED' in t and 'quota' in t.lower() and await pg.locator('#fFailNote').count() == 1 and mem == 7 and len(db1['sessions'][0]['records']) == 7 and 'CLEGG-0002' not in t, mem)
        await pg.reload(); await pg.wait_for_timeout(800)
        check('after reload the failed record is absent and earlier data intact', await pg.evaluate("CR.fieldUI.state().session.records.length") == 7)

        # two tabs: second writer is refused
        pg2 = await ctx.new_page(); await pg2.goto(URL + '#field'); await pg2.wait_for_timeout(900)
        await pg.click('[data-status="CALIBRATION"]'); await pg.wait_for_timeout(400)
        await pg2.click('[data-status="CALIBRATION"]'); await pg2.wait_for_timeout(400)
        t2 = await pg2.inner_text('main')
        check('two tabs: stale tab is refused (CONFLICT), nothing overwritten', 'changed in another tab' in t2 and 'NOT SAVED' in t2)
        await pg2.close()

        # export ZIP
        async with pg.expect_download(timeout=120000) as dl:
            await pg.click('#xZIP')
        d = await dl.value; zpath = os.path.join(tmp, 'pkg.zip'); await d.save_as(zpath)
        await pg.wait_for_timeout(800)
        check('backup state EXPORTED after verified ZIP', await pg.get_attribute('#fBackup', 'data-state') == 'EXPORTED')
        z = zipfile.ZipFile(zpath)
        check('ZIP passes an independent CRC check (Python zipfile)', z.testzip() is None, z.namelist())
        man = json.loads(z.read('MANIFEST.json'))
        ok_hash = all(sha(z.read(f['zip_path'])) == f['sha256'] and len(z.read(f['zip_path'])) == f['size'] for f in man['raw_files'])
        orig = {v[1] for v in files.values()}
        check('manifest: 3 raw files VERIFIED, hashes match the original files on disk', man['summary']['complete'] and man['summary']['verified'] == 3 and ok_hash and {f['sha256'] for f in man['raw_files']} == orig, man['summary'])
        check('manifest fields: session/measurement/file IDs, filename, size, SHA-256, export time', all(k in man['raw_files'][0] for k in ['file_id', 'measurement_ids', 'original_filename', 'size', 'sha256', 'mime']) and man['session_id'] == SID and man['export_utc'])
        check('documents in manifest hash-verified', all(sha(z.read(x['zip_path'])) == x['sha256'] for x in man['documents']))
        check('MANIFEST.csv present', 'MANIFEST.csv' in z.namelist())
        await pg.click('[data-status="IN PROGRESS"]'); await pg.wait_for_timeout(300)
        check('any change after export → BACKUP OUTDATED', await pg.get_attribute('#fBackup', 'data-state') == 'OUTDATED')
        await pg.click('[data-status="CALIBRATION"]'); await pg.wait_for_timeout(300)
        ref = await pg.evaluate(SNAP)
        # export once more so the package equals the stored state
        async with pg.expect_download(timeout=120000) as dl:
            await pg.click('#xZIP')
        d = await dl.value; await d.save_as(zpath); await pg.wait_for_timeout(800)
        ref = await pg.evaluate(SNAP); ref_s = ref['sessions'][0]

        # wipe the database and restore
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(800)
        empty = await pg.evaluate(SNAP)
        check('database cleared', len(empty['sessions']) == 0 and len(empty['blobs']) == 0)
        await pg.locator('#fImportZip').set_input_files(zpath)
        await pg.wait_for_function("() => CR.fieldUI.state().session", timeout=120000); await pg.wait_for_timeout(800)
        got = await pg.evaluate(SNAP); got_s = got['sessions'][0]
        check('restore: every record identical (incl. superseded revisions)', got_s['records'] == ref_s['records'] and len([r for r in got_s['records'] if r.get('superseded_by')]) == 1, len(got_s['records']))
        check('restore: raw file manifest identical (file IDs, names, sizes, hashes)', got_s['raw_files'] == ref_s['raw_files'])
        check('restore: every blob re-hashes to its SHA-256 and equals the original file', set(got['blobs']) == set(ref['blobs']) == orig and all(v['rehash'] == k and v['size'] == ref['blobs'][k]['size'] for k, v in got['blobs'].items()))
        check('restore: blob metadata (filename, MIME, last_modified) preserved', all({x: got['blobs'][k][x] for x in ['filename', 'type', 'last_modified']} == {x: ref['blobs'][k][x] for x in ['filename', 'type', 'last_modified']} for k in got['blobs']))
        same_keys = {k for k in ref_s if k not in ('events', 'save_seq', 'backup')}
        diff = [k for k in same_keys if got_s.get(k) != ref_s.get(k)]
        check('restore: all other session fields identical (only log, write counter and backup stamp differ)', not diff, diff)
        check('restored session shows EXPORTED (state equals the package)', await pg.get_attribute('#fBackup', 'data-state') == 'EXPORTED')

        # corrupted package
        zb = bytearray(open(zpath, 'rb').read()); zf = zipfile.ZipFile(zpath)
        info = [i for i in zf.infolist() if i.filename.endswith('csi_big_25MB.pcap')][0]
        off = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra) + 1000; zb[off] ^= 0xFF
        bad = os.path.join(tmp, 'pkg_corrupt.zip'); open(bad, 'wb').write(zb)
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.locator('#fImportZip').set_input_files(bad)
        await pg.wait_for_selector('#modal:not(.hidden) #rBad', timeout=120000)
        mt = await pg.inner_text('#modal')
        check('corrupted ZIP: failed file listed as CORRUPTED before anything is restored', 'CORRUPTED' in mt and 'csi_big_25MB.pcap' in mt)
        await pg.click('#modal [data-close]'); await pg.wait_for_timeout(300)
        check('cancel → nothing restored', len((await pg.evaluate(SNAP))['sessions']) == 0)
        await pg.locator('#fImportZip').set_input_files([]); await pg.locator('#fImportZip').set_input_files(bad)
        await pg.wait_for_selector('#modal:not(.hidden) #rGo', timeout=120000); await pg.click('#rGo')
        await pg.wait_for_function("() => CR.fieldUI.state().session", timeout=120000); await pg.wait_for_timeout(800)
        g2 = await pg.evaluate(SNAP)
        check('confirmed partial restore: corrupted file NOT stored, 2 verified files stored', len(g2['blobs']) == 2 and files['csi_big_25MB.pcap'][1] not in g2['blobs'])
        check('partial restore marked BACKUP INCOMPLETE and record shows raw MISSING', await pg.get_attribute('#fBackup', 'data-state') == 'BACKUP_INCOMPLETE' and 'raw MISSING' in await pg.inner_text('main'))
        async with pg.expect_download(timeout=120000) as dl:
            await pg.click('#xZIP')
        d = await dl.value; p3 = os.path.join(tmp, 'pkg3.zip'); await d.save_as(p3); await pg.wait_for_timeout(600)
        z3 = zipfile.ZipFile(p3); m3 = json.loads(z3.read('MANIFEST.json'))
        check('re-export of incomplete session: manifest says incomplete + INTEGRITY_PROBLEMS.txt, state stays INCOMPLETE', not m3['summary']['complete'] and 'INTEGRITY_PROBLEMS.txt' in z3.namelist() and await pg.get_attribute('#fBackup', 'data-state') == 'BACKUP_INCOMPLETE')

        # interrupted save: close the tab right after starting a 25 MB save, then check atomicity
        await pg.evaluate(WIPE); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.locator('#fImportZip').set_input_files(zpath)
        await pg.wait_for_function("() => CR.fieldUI.state().session", timeout=120000); await pg.wait_for_timeout(500)
        big2 = os.path.join(tmp, 'csi_interrupt.bin'); open(big2, 'wb').write(os.urandom(25 * 1024 * 1024)); big2_sha = sha(open(big2, 'rb').read())
        await pg.click('[data-tab=CSI]'); fr = pg.locator('#fRec')
        await fr.locator('[name=ts]').fill('2026-11-24T12:00'); await fr.locator('[name=grid_cell_id]').fill('G4')
        await fr.locator('[name=coordinates_x]').fill('65'); await fr.locator('[name=coordinates_y]').fill('35'); await fr.locator('[name=packet_loss]').fill('1')
        await fr.locator('[name=raw]').set_input_files(big2)
        await pg.click('#fSave'); await pg.wait_for_timeout(40)
        await pg.close(run_before_unload=False)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#field'); await pg.wait_for_timeout(1200)
        s4 = await pg.evaluate(SNAP); recs4 = s4['sessions'][0]['records']
        has_rec = any(r.get('raw_sha256') == big2_sha for r in recs4); has_blob = big2_sha in s4['blobs']
        has_manifest = any(f['sha256'] == big2_sha for f in s4['sessions'][0]['raw_files'])
        check('interrupted 25 MB save: record, manifest and blob are all present or all absent', has_rec == has_blob == has_manifest, {'record': has_rec, 'blob': has_blob, 'manifest': has_manifest})
        check('interrupted save: earlier data intact', len(recs4) >= 7)

        # real IndexedDB transaction aborted after the session + 25 MB blob puts were queued
        await pg.click('[data-tab=CSI]'); fr = pg.locator('#fRec')
        await fr.locator('[name=ts]').fill('2026-11-24T12:05'); await fr.locator('[name=grid_cell_id]').fill('G4')
        await fr.locator('[name=coordinates_x]').fill('65'); await fr.locator('[name=coordinates_y]').fill('35'); await fr.locator('[name=packet_loss]').fill('1')
        await fr.locator('[name=raw]').set_input_files(big2)
        await pg.evaluate("CR.fieldStore.simulateFailure='ABORT_AFTER_WRITES'")
        await pg.click('#fSave'); await pg.wait_for_function("() => { const b = document.querySelector('#fSave'); return b && !b.disabled; }", timeout=60000); await pg.wait_for_timeout(500)
        s5 = await pg.evaluate(SNAP); mem5 = await pg.evaluate("CR.fieldUI.state().session.records.length")
        check('aborted transaction: neither record nor 25 MB blob committed, page rolled back, NOT SAVED shown',
              big2_sha not in s5['blobs'] and not any(r.get('raw_sha256') == big2_sha for r in s5['sessions'][0]['records']) and mem5 == len(s5['sessions'][0]['records']) and 'NOT SAVED' in await pg.inner_text('main'), {'blob': big2_sha in s5['blobs'], 'mem': mem5})
        await pg.click('#fSave'); await pg.wait_for_function("() => { const b = document.querySelector('#fSave'); return b && !b.disabled; }", timeout=60000); await pg.wait_for_timeout(500)
        s6 = await pg.evaluate(SNAP)
        check('retry after abort: record and blob committed together', big2_sha in s6['blobs'] and any(r.get('raw_sha256') == big2_sha for r in s6['sessions'][0]['records']))

        # low storage warning (browser estimate overridden)
        pg5 = await ctx.new_page()
        await pg5.add_init_script("navigator.storage.estimate = () => Promise.resolve({usage: 950*1048576, quota: 1000*1048576});")
        await pg5.goto(URL + '#field'); await pg5.wait_for_timeout(1000)
        check('low storage → explicit warning', await pg5.locator('#fLowSpace').count() == 1 and 'Low browser storage' in await pg5.inner_text('main'))
        await pg5.close()
        check('no JS errors', not errs, errs[:3])
        await b.close()
    shutil.rmtree(tmp, ignore_errors=True)
    n = sum(1 for r in results if r[1]); print(f'{n} / {len(results)} passed')
    json.dump([{'name': a, 'pass': b_, 'detail': str(c)} for a, b_, c in results], open('/tmp/field_roundtrip_results.json', 'w'), indent=1)
asyncio.run(main())
