"""VAYSHA QA – regression tests for PR #5 (demo provenance, CRIO, ski labels) and PR #6
(isolated service-worker cache, navigation-only offline fallback), plus credibility labels,
brand, icon geometry, small-phone layout and page health. Headless Chrome.
Run: python3 -m http.server 8765 &  then  python3 test/vaysha_qa_e2e.py   (DEMO_URL overrides the base)"""
import asyncio, os, io, re
import numpy as np
from playwright.async_api import async_playwright
from PIL import Image
BASE = os.environ.get('DEMO_URL', 'http://localhost:8765/')
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok))); print(('PASS' if ok else 'FAIL'), name, detail if detail != '' else '')

TURQ = np.array([0x3f, 0xd3, 0xd8]); BG = (0x0c, 0x27, 0x30)

def omega_geometry(png_bytes):
    """Measure the Ω glyph on the real pixels: width share, hole roundness, open bottom, feet."""
    a = np.array(Image.open(io.BytesIO(png_bytes)).convert('RGB')).astype(int)
    h, w = a.shape[:2]
    m = np.abs(a - TURQ).sum(2) < 60
    ys, xs = np.where(m)
    out = {'corner': tuple(int(v) for v in a[1, 1]), 'width_share': (xs.max() - xs.min() + 1) / w,
           'height_share': (ys.max() - ys.min() + 1) / h}
    cx = (xs.max() + xs.min()) // 2
    col = m[:, cx]; top = np.argmax(col); top_end = top + np.argmax(~col[top:])
    out['centre_column_runs'] = int(np.sum(np.diff(col.astype(int)) == 1) + (1 if col[0] else 0))
    outer_r = (xs.max() - xs.min() + 1) / 2
    cy = top + outer_r  # ring centre if the ring is a circle
    row = m[int(cy), :]; inner = np.where(~row[xs.min():xs.max() + 1])[0]
    inner_w = inner.max() - inner.min() + 1 if len(inner) else 0
    inner_h = int(cy) - top_end  # vertical inner radius above the centre
    out['hole_ratio'] = (inner_w / 2) / inner_h if inner_h else 0
    bottom = m[ys.max() - 2, :]; segs = np.sum(np.diff(bottom.astype(int)) == 1) + (1 if bottom[0] else 0)
    out['feet'] = int(segs)
    return out

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

        # ---------- page health ----------
        for path, wait in [('', 600), ('map/', 2500), ('map/privacy.html', 300), ('me/', 1500), ('me/?app=1', 1200), ('#field', 800)]:
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800}); pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
            r = await pg.goto(BASE + path); await pg.wait_for_timeout(wait)
            check(f'page loads without JS errors: /{path}', r.status == 200 and not errs, errs[:2])
            await ctx.close()

        # ---------- satellite map ----------
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); await pg.goto(BASE + 'map/'); await pg.wait_for_timeout(3500)
        leaf = await pg.evaluate("typeof L!=='undefined'")
        n = await pg.evaluate("(()=>{let c=0;document.querySelectorAll('.leaflet-container').forEach(()=>{});for(const k in window){}return document.querySelectorAll('.leaflet-tile-loaded').length})()")
        canv = await pg.evaluate("(()=>{const c=document.querySelector('.leaflet-overlay-pane canvas');if(!c)return 0;const x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let k=0;for(let i=3;i<x.length;i+=4)if(x[i])k++;return k})()")
        check('map: Leaflet loaded, satellite tiles and terrain markers drawn (canvas)', leaf and n > 0 and canv > 500, f'{n} tiles, {canv} marker px')
        check('map: list of terrains filled', await pg.locator('#list li').count() > 10)
        check('map: no horizontal overflow on phone', await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        foot = await pg.inner_text('#foot')
        check('PR#5 map footer: ski share is approximate, piste safety not verified', 'приблизителен дял със сняг' in foot and 'не са проверени работата и безопасността' in foot)
        src = await (await pg.request.get(BASE + 'map/')).text()
        check('PR#5 ski labels describe snow only, not "Добри" piste conditions', "'Сняг: повече'" in src and "'Добри'" not in src and "'Няма сняг за ски'" not in src)
        await ctx.close()

        # ---------- VAYSHA Me on two iPhone sizes ----------
        for (w, h, nm) in [(375, 667, 'iPhone SE'), (390, 844, 'iPhone 14')]:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
            await pg.goto(BASE + 'me/?app=1'); await pg.wait_for_timeout(1200)
            acts = pg.locator('#screen .start .act')
            check(f'{nm}: three entries Карта / Активности / Анализи', await acts.count() == 3)
            boxes = [await acts.nth(i).bounding_box() for i in range(3)]
            check(f'{nm}: all three entries visible without scrolling', all(bx['y'] + bx['height'] <= h - 52 for bx in boxes), [round(bx['y'] + bx['height']) for bx in boxes])
            sw = pg.locator('#screen .whoSw button')
            check(f'{nm}: athlete/coach switch present', await sw.count() == 4)
            sizes = [await sw.nth(i).bounding_box() for i in range(await sw.count())]
            check(f'{nm}: switch buttons ≥ 44 × 44 px', all(s['height'] >= 44 and s['width'] >= 44 for s in sizes), [(round(s['width']), round(s['height'])) for s in sizes])
            tb = pg.locator('#tabbar button'); tbs = [await tb.nth(i).bounding_box() for i in range(await tb.count())]
            check(f'{nm}: tab bar buttons ≥ 44 × 44 px', all(s['height'] >= 44 and s['width'] >= 44 for s in tbs))
            check(f'{nm}: only one bottom navigation visible', await pg.locator('.tabbar:visible').count() == 1)
            # last content is not hidden behind the tab bar
            await pg.evaluate("document.getElementById('screen').scrollTop = 1e6"); await pg.wait_for_timeout(200)
            last = await pg.evaluate("""(()=>{const s=document.getElementById('screen');const kids=[...s.children].filter(e=>e.offsetHeight);const l=kids[kids.length-1].getBoundingClientRect();const t=document.getElementById('tabbar').getBoundingClientRect();return [l.bottom,t.top]})()""")
            check(f'{nm}: end of the screen not covered by the tab bar', last[0] <= last[1] + 1, last)
            check(f'{nm}: no horizontal overflow', await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            await pg.evaluate("document.getElementById('screen').scrollTop = 0")
            await pg.click('#screen .whoSw button[data-who="coach"]'); await pg.wait_for_timeout(300)
            check(f'{nm}: switching to coach opens the coach view', 'Отбор' in await pg.inner_text('#screen .hdr h2'))
            await pg.click('#screen .whoSw button[data-who="max"]'); await pg.wait_for_timeout(300)
            check(f'{nm}: switching back to an athlete works', await pg.locator('#screen .whoSw button[data-who="max"][aria-pressed="true"]').count() == 1)
            check(f'{nm}: no JS errors', not errs, errs[:2])
            await pg.screenshot(path=f'/tmp/qa_me_{w}x{h}.png'); await ctx.close()

        # ---------- PR#5 + credibility labels inside Me ----------
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); await pg.goto(BASE + 'me/?app=1'); await pg.wait_for_timeout(1000)
        check('PR#5 no CRIO machines plotted', 'const MACHINES=[];' in await (await pg.request.get(BASE + 'me/')).text())
        await pg.click('#tabbar button[data-tab="map"]'); await pg.wait_for_timeout(300)
        mp = await pg.inner_text('#screen')
        check('PR#5 demo sites are labelled "примерни стойности"', mp.count('примерни стойности') >= 5)
        check('PR#5 Ω means demo scenario, not installed equipment', 'не инсталирано оборудване' in mp)
        check('map legend no longer lists CRIO machines', 'CRIO' not in mp)
        await pg.click('#screen [data-site="ber"]'); await pg.wait_for_timeout(300)
        sc = await pg.inner_text('#screen')
        check('PR#5 site card says synthetic, not today', 'ДЕМО · СИНТЕТИЧНИ ДАННИ, НЕ ОТ ДНЕС' in sc.upper() and 'не реални TDR/Clegg или Wi-Fi измервания' in sc)
        src = await (await pg.request.get(BASE + 'me/')).text()
        check('PR#5 cup shows VAYSHA, not CREAMINO', '>VAYSHA</text>' in src and '>CREAMINO</text>' not in src)
        check('CRIO never shown as installed or nearby', all(x not in src for x in ['CRIO Берое', 'Най-близка CRIO', 'на 120 m', 'най-близка CRIO машина: 1.3', 'рецептата е заредена']))
        check('WADA/allergy check not claimed as done', 'проверени ✓' not in src and 'проверка предстои' in src)
        check('home signal for a real stadium says example values', 'Примерни стойности за демонстрация, не измерване на стадиона' in src and 'рискът расте след 60-ата минута' not in src)
        check('tour text matches the demo labels', 'Wi-Fi сензориране и полеви измервания' not in src and 'Златните квадратчета' not in src)
        check('alerts described as planned, not running', 'автоматичните аларми и известия са планирана функция' in src)
        await ctx.close()

        # ---------- brand in Lab / reports ----------
        js = await (await b.new_context()).request.get(BASE + 'js/report.js'); rj = await js.text()
        check('PDF report header and filename use VAYSHA', "doc.text('VAYSHA'" in rj and "'VAYSHA_report_'" in rj and 'accuracy of Creamino' not in rj)
        app = await (await (await b.new_context()).request.get(BASE + 'js/app.js')).text()
        check('PR#5 Lab synthetic note names VAYSHA', 'not the accuracy of VAYSHA' in app)
        fj = await (await (await b.new_context()).request.get(BASE + 'js/field.js')).text()
        check('storage/format identifiers kept for compatibility', "'creamino-field-1.0'" in fj and "'creamino-field-zip-1'" in fj and 'VAYSHA™ Field Session Report' in fj)
        fs = await (await (await b.new_context()).request.get(BASE + 'js/fieldstore.js')).text()
        check('IndexedDB name unchanged (no data loss)', "'creamino-field'" in fs)
        ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True); pg = await ctx.new_page()
        await pg.goto(BASE); await pg.wait_for_timeout(500); await pg.click('#startBtn'); await pg.wait_for_timeout(600)
        await pg.click('button[data-view=report]'); await pg.wait_for_timeout(300)
        async with pg.expect_download(timeout=30000) as dl: await pg.click('#pGo')
        d = await dl.value; data = open(await d.path(), 'rb').read()
        check('PDF downloads as VAYSHA_report_…pdf', d.suggested_filename.startswith('VAYSHA_report_') and data[:4] == b'%PDF', d.suggested_filename)
        await ctx.close()
        pv = await (await (await b.new_context()).request.get(BASE + 'map/privacy.html')).text()
        check('privacy page branded VAYSHA', 'Creamino' not in pv and 'VAYSHA' in pv)

        # ---------- icons: real pixels ----------
        rq = (await b.new_context()).request
        for f, lo, hi in [('icon-180.png', .60, .65), ('icon-192.png', .60, .65), ('icon-512.png', .60, .65), ('favicon-32.png', .55, .70), ('icon-maskable-192.png', .45, .62), ('icon-maskable-512.png', .45, .62)]:
            g = omega_geometry(await (await rq.get(BASE + 'me/' + f)).body())
            ok = (abs(g['corner'][0] - BG[0]) <= 2 and abs(g['corner'][1] - BG[1]) <= 2 and abs(g['corner'][2] - BG[2]) <= 2
                  and lo <= g['width_share'] <= hi and g['feet'] == 2 and g['centre_column_runs'] == 1
                  and (f.startswith('favicon') or 0.9 <= g['hole_ratio'] <= 1.1))
            check(f'icon {f}: Ω on #0C2730, two feet, open bottom, round hole, width in range', ok,
                  {k: (round(v, 3) if isinstance(v, float) else v) for k, v in g.items()})
        big = np.array(Image.open(io.BytesIO(await (await rq.get(BASE + 'me/icon-512.png')).body())).convert('RGB')).astype(int)
        glyph = np.abs(big - TURQ).sum(2) < 12
        check('icon colour is #3FD3D8', glyph.sum() > 20000, int(glyph.sum()))
        from scipy import ndimage
        dist = ndimage.distance_transform_edt(~glyph); diff = np.abs(big - np.array(BG)).sum(2)
        near = diff[(dist > 8) & (dist <= 10)].mean(); far = diff[dist > 26].max()
        check('glow is subtle: faint 8–10 px from the glyph, none beyond 26 px (512 px icon)', near < 40 and far <= 3, f'near {near:.1f}/765, far max {far}')

        # ---------- PR#6 service worker ----------
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        pg = await ctx.new_page()
        await pg.goto(BASE + 'map/privacy.html'); await pg.wait_for_timeout(200)
        # simulate an old installation (v4 cache) and an unrelated app cache on the same origin
        await pg.evaluate("""(async()=>{const o=await caches.open('creamino-me-v4');await o.put('/me/old.txt',new Response('old'));const u=await caches.open('other-app-v1');await u.put('/x.txt',new Response('x'))})()""")
        await pg.goto(BASE + 'me/?app=1')
        ctl = await pg.evaluate("""(async()=>{await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller) await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true})); return !!navigator.serviceWorker.controller})()""")
        check('PR#6 service worker installs and controls the page', ctl)
        await pg.wait_for_timeout(800)
        keys = await pg.evaluate('caches.keys()')
        check('PR#6 cache named vaysha-me-v5', 'vaysha-me-v5' in keys, keys)
        check('PR#6 old creamino-me-v4 cache removed after update', 'creamino-me-v4' not in keys, keys)
        check('PR#6 unrelated caches on the origin are kept', 'other-app-v1' in keys, keys)
        shell = await pg.evaluate("caches.open('vaysha-me-v5').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname))")
        check('PR#6 app shell and icons precached', all(x in shell for x in ['/me/index.html', '/me/manifest.json', '/me/icon-180.png', '/me/icon-maskable-512.png']), len(shell))
        await ctx.set_offline(True)
        await pg.goto(BASE + 'me/?app=1&offline=1'); await pg.wait_for_timeout(800)
        check('PR#6 offline navigation falls back to the app shell', await pg.locator('#screen .start .act').count() == 3)
        miss = await pg.evaluate("fetch('/me/does-not-exist.json').then(r=>'status '+r.status+' '+r.headers.get('content-type')).catch(e=>'network error')")
        check('PR#6 offline missing asset is an error, not index.html', miss == 'network error', miss)
        cached = await pg.evaluate("fetch('/me/manifest.json').then(r=>r.json()).then(j=>j.name).catch(()=>null)")
        check('PR#6 offline cached asset still served', cached == 'VAYSHA Me', cached)
        await ctx.set_offline(False)
        await pg.reload(); await pg.wait_for_timeout(800)
        fresh = await pg.evaluate("fetch('/me/sw.js',{cache:'no-store'}).then(r=>r.ok)")
        check('PR#6 back online: network responses again', fresh and await pg.locator('#screen .start .act').count() == 3)
        await ctx.close()

        # ---------- manifest ----------
        m = await (await (await b.new_context()).request.get(BASE + 'me/manifest.json')).json()
        check('manifest: name, colours, display standalone, id/scope unchanged', m['name'] == 'VAYSHA Me' and m['background_color'].lower() == '#0c2730' and m['theme_color'].lower() == '#0c2730' and m.get('display') == 'standalone' and m['id'] == '/me/')

        # ---------- tablet ----------
        ctx = await b.new_context(viewport={'width': 820, 'height': 1180}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + 'me/?app=1'); await pg.wait_for_timeout(1000)
        check('tablet 820×1180: entries + switch, no overflow, no errors', await pg.locator('#screen .start .act').count() == 3 and await pg.locator('#screen .whoSw button').count() == 4 and await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1') and not errs, errs[:2])
        await pg.screenshot(path='/tmp/qa_me_tablet.png'); await ctx.close()
        await b.close()
    n = sum(1 for r in results if r[1]); print(f'{n} / {len(results)} passed')
    raise SystemExit(0 if n == len(results) else 1)
asyncio.run(main())
