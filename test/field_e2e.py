"""End-to-end tests of the Field Session module in headless Chrome.
Run: python3 -m http.server 8765 &  then  python3 test/field_e2e.py"""
import asyncio, os, json, zipfile, io, tempfile
from playwright.async_api import async_playwright
URL = os.environ.get('DEMO_URL', 'http://localhost:8765/index.html')
MSG = 'Локалната калибрация е в процес. CSI данните се събират и проверяват. Прогнозните стойности и оперативните препоръки не са активни.'
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, detail)

async def main():
    raw = tempfile.NamedTemporaryFile(delete=False, suffix='.csv'); raw.write(b'ts,sub,amp,phase\n0,1,0.52,1.1\n0,2,0.49,1.3\n'); raw.close()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(accept_downloads=True, viewport={'width': 1366, 'height': 900})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#field'); await pg.wait_for_timeout(800)
        check('field view opens from #field', await pg.locator('h1:has-text("Field Session")').count() > 0)
        check('banner: real data only, no synthetic', 'REAL MEASUREMENTS ONLY' in await pg.inner_text('#banner'))
        # create session
        f = pg.locator('#fNew')
        await f.locator('[name=session_date]').fill('2026-11-24')
        await f.locator('[name=operator_id]').fill('PM')
        for k, v in {'device_id': 'ESP32-A', 'device_model': 'ESP32-S3', 'firmware_version': 'csi-1.2', 'wifi_channel': '6', 'subcarrier_count': '64', 'window_duration': '30', 'configuration': 'TX/RX 1.5 m apart, 0.3 m height'}.items():
            await f.locator(f'[name={k}]').fill(v)
        await f.locator('[name=bandwidth]').select_option('20')
        await pg.click('#fCreate'); await pg.wait_for_timeout(500)
        check('session created with ID', 'LAZUR-20261124-S01' in await pg.inner_text('main'))
        check('calibration mode message shown verbatim', MSG in await pg.inner_text('main'))
        check('status PLANNED before records', 'PLANNED' in await pg.inner_text('main'))
        mt = await pg.inner_text('main'); check('no operational status / predictions in UI', not any(w in mt for w in ['OPERATIONAL', 'Predicted', 'predicted VWC']))
        async def rec(tab, vals, file=None):
            await pg.click(f'[data-tab={tab}]'); await pg.wait_for_timeout(200)
            fr = pg.locator('#fRec')
            await fr.locator('[name=ts]').fill(vals.pop('ts'))
            for k, v in vals.items(): await fr.locator(f'[name={k}]').fill(str(v))
            if file: await fr.locator('[name=raw]').set_input_files(file)
            await pg.click('#fSave'); await pg.wait_for_timeout(600)
        await rec('CSI', {'ts': '2026-11-24T10:00', 'grid_cell_id': 'C4', 'coordinates_x': 25, 'coordinates_y': 35, 'packet_loss': 2, 'signal_quality': '-48'}, raw.name)
        t = await pg.inner_text('main')
        check('CSI saved with raw file stored', 'LAZUR-20261124-S01-CSI-0001' in t and 'raw ✓' in t)
        check('status → IN PROGRESS', 'IN PROGRESS' in t)
        await rec('TDR', {'ts': '2026-11-24T10:04', 'grid_cell_id': 'C4', 'coordinates_x': 25.5, 'coordinates_y': 35.2, 'reference_vwc': 22.4})
        await rec('CLEGG', {'ts': '2026-11-24T10:06', 'grid_cell_id': 'C4', 'coordinates_x': 25.2, 'coordinates_y': 34.8, 'reference_gmax': 88})
        st = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;return CR.field.evaluate(s).metrics})()")
        check('TDR + Clegg recorded', st['tdr'] == 1 and st['clegg'] == 1, json.dumps(st))
        check('CSI–reference pairs matched (2 valid)', st['pairs_valid'] == 2 and st['csi_with_valid_reference'] == 1)
        # QC fail record kept
        await rec('TDR', {'ts': '2026-11-24T10:10', 'grid_cell_id': 'D4', 'coordinates_x': 35, 'coordinates_y': 35, 'reference_vwc': 85})
        t = await pg.inner_text('main')
        check('QC FAIL record kept with reason', 'FAIL' in t and 'Invalid VWC 85' in t)
        # duplicate refused
        await rec('TDR', {'ts': '2026-11-24T10:04', 'grid_cell_id': 'C4', 'coordinates_x': 25.5, 'coordinates_y': 35.2, 'reference_vwc': 22.4})
        check('duplicate detected and not saved', await pg.locator('#modal:not(.hidden) h3:has-text("Possible duplicate")').count() == 1)
        await pg.click('#modal [data-close]')
        n = await pg.evaluate("CR.fieldUI.state().session.records.length")
        check('record count unchanged after refused duplicate', n == 4, str(n))
        # missing metadata → INCOMPLETE
        await rec('CLEGG', {'ts': '2026-11-24T10:20', 'grid_cell_id': 'E4', 'coordinates_x': '', 'coordinates_y': ''})
        q = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;const e=CR.field.evaluate(s).current;return e[e.length-1].qc.status})()")
        check('missing reference/coords → INCOMPLETE', q == 'INCOMPLETE', q)
        # correction creates revision
        await pg.click('[data-rev="LAZUR-20261124-S01-TDR-0002"]'); await pg.wait_for_timeout(200)
        await pg.fill('#revF [name=reference_vwc]', '25'); await pg.fill('#revF [name=_reason]', 'typo, 25 not 85'); await pg.click('#revF button[type=submit]'); await pg.wait_for_timeout(500)
        r = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;return {all:s.records.length,cur:CR.field.current(s).length,old:s.records.find(x=>x.measurement_id==='LAZUR-20261124-S01-TDR-0002'&&x.superseded_by).reference_vwc}})()")
        check('correction keeps original as revision', r['all'] == 6 and r['cur'] == 5 and str(r['old']) == '85', json.dumps(r))
        # draft autosave + recovery after reload
        await pg.click('[data-tab=TDR]'); await pg.fill('#fRec [name=notes]', 'half-typed note'); await pg.dispatch_event('#fRec', 'input')
        await pg.reload(); await pg.wait_for_timeout(1200)
        t = await pg.inner_text('main')
        r2 = await pg.evaluate("(()=>{const s=CR.fieldUI.state().session;return s?{id:s.session_id,n:s.records.length,raw:s.raw_files.length}:null})()")
        check('session restored after reload (interruption)', r2 and r2['id'] == 'LAZUR-20261124-S01' and r2['n'] == 6, json.dumps(r2))
        await pg.click('[data-tab=TDR]'); await pg.wait_for_timeout(200)
        check('typed draft restored after reload', await pg.input_value('#fRec [name=notes]') == 'half-typed note')
        rawok = await pg.evaluate("(async()=>{const s=CR.fieldUI.state().session;const r=await CR.fieldStore.getRaw(s.raw_files[0].sha256);return r&&r.data.byteLength})()")
        check('raw CSI bytes persisted in IndexedDB', rawok == os.path.getsize(raw.name), str(rawok))
        # exports
        async def dl(btn):
            async with pg.expect_download() as d: await pg.click(btn)
            dd = await d.value; path = await dd.path(); return dd.suggested_filename, open(path, 'rb').read()
        name, data = await dl('#xCSV'); csv = data.decode('utf-8-sig')
        head = csv.splitlines()[0].split(',')
        check('CSV export: name and all required fields', name == 'LAZUR-20261124-S01_measurements.csv' and all(k in head for k in ['measurement_id', 'session_id', 'site_id', 'field_id', 'grid_cell_id', 'timestamp_utc', 'operator_id', 'device_id', 'device_model', 'firmware_version', 'wifi_channel', 'bandwidth', 'subcarrier_count', 'window_duration', 'packet_loss', 'signal_quality', 'raw_data_reference', 'reference_vwc', 'reference_gmax', 'reference_measurement_method', 'coordinates_x', 'coordinates_y', 'notes', 'quality_status', 'processing_version']), name)
        check('CSV keeps superseded + FAIL info', 'SUPERSEDED' in csv and len(csv.strip().splitlines()) == 7)
        name, data = await dl('#xJSON'); js = json.loads(data)
        check('JSON export: metadata, QC, pairs, raw manifest', js['session_id'] == 'LAZUR-20261124-S01' and len(js['qc']) == 5 and len(js['valid_pairs']) == 2 and len(js['raw_files']) == 1 and js['model']['predictions_active'] is False)
        name, data = await dl('#xRep'); rep = data.decode()
        check('session report contents', all(k in rep for k in ['INITIAL CALIBRATION — LAZUR', 'Configuration', 'QC statistics', 'Limitations', 'Files and data', 'ESP32-A']))
        name, data = await dl('#xZIP'); z = zipfile.ZipFile(io.BytesIO(data))
        nm = z.namelist()
        check('ZIP package: csv, json, report, raw file intact', z.testzip() is None and any(n.endswith('.csv') for n in nm) and any(n.startswith('raw/') for n in nm) and z.read([n for n in nm if n.startswith('raw/')][0]) == open(raw.name, 'rb').read(), ', '.join(nm))
        # close → review required (FAIL fixed, but INCOMPLETE remains)
        await pg.click('#fFinish'); await pg.wait_for_timeout(400)
        check('close with incomplete record → REVIEW REQUIRED', 'REVIEW REQUIRED' in await pg.inner_text('main'))
        # synthetic demo untouched
        demo = await pg.evaluate("CreaminoApp.state().datasets.map(d=>d.id+':'+d.rows.length).join(',')")
        check('synthetic demo dataset unchanged and separate', demo == 'CREAMINO_SYNTHETIC_DEMO_V1:56', demo)
        # test-origin session is labelled
        await pg.click('#fClose'); await pg.wait_for_timeout(400)
        await pg.locator('#fNew [name=data_origin]').select_option('test'); await pg.locator('#fNew [name=session_date]').fill('2026-11-24'); await pg.click('#fCreate'); await pg.wait_for_timeout(500)
        check('test session labelled TEST, separate ID', 'LAZUR-20261124-T02' in await pg.inner_text('main') and 'TEST DATA' in await pg.inner_text('#banner'))
        # existing modules still work
        await pg.goto(URL + '#dashboard'); await pg.wait_for_timeout(800)
        check('demo modules unaffected (dashboard)', 'SYNTHETIC DEMONSTRATION DATA' in await pg.inner_text('#banner'))
        check('no JS errors', not errs, '; '.join(errs))
        # mobile layout
        m = await b.new_page(viewport={'width': 390, 'height': 844}); await m.goto(URL + '#field'); await m.wait_for_timeout(1000)
        ov = await m.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1")
        check('field view fits a phone screen', ov)
        await b.close()
    os.unlink(raw.name)
    passed = sum(1 for r in results if r[1]); print(f'{passed} / {len(results)} passed')
    return passed == len(results)

ok = asyncio.run(main()); raise SystemExit(0 if ok else 1)
