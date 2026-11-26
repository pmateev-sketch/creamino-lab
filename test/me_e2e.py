"""VAYSHA Me – home screen, touch targets, demo warnings, icons and manifest, in headless Chrome.
Run: python3 -m http.server 8765 &  then  python3 test/me_e2e.py   (DEMO_URL overrides the base)"""
import asyncio, os, json, io
from playwright.async_api import async_playwright
from PIL import Image
BASE = os.environ.get('DEMO_URL', 'http://localhost:8765/')
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok))); print(('PASS' if ok else 'FAIL'), name, detail)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        # iPhone, installed-app mode
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + 'me/?app=1'); await pg.wait_for_timeout(1200)
        acts = pg.locator('#screen .start .act')
        check('three main actions on the home screen', await acts.count() == 3)
        labels = [await acts.nth(i).locator('b').inner_text() for i in range(await acts.count())]
        check('action labels', labels == ['Карта на терените', 'Моите активности', 'Данни и анализи'], labels)
        hs = [(await acts.nth(i).bounding_box())['height'] for i in range(3)]
        check('actions are large touch targets (≥ 56 px)', min(hs) >= 56, hs)
        check('map action keeps the existing URL ../map/', await acts.nth(0).get_attribute('href') == '../map/')
        check('analyses action opens VAYSHA Lab ../', await acts.nth(2).get_attribute('href') == '../')
        tb = pg.locator('#tabbar button'); th = [(await tb.nth(i).bounding_box())['height'] for i in range(await tb.count())]
        check('tab bar buttons ≥ 44 px in app mode', min(th) >= 44, th)
        demo = await pg.inner_text('.demo')
        check('synthetic-data warning stays visible', 'примерни данни' in demo.lower() and await pg.locator('.demo').is_visible(), demo[:60])
        check('home states values are examples, not measurements', 'не реални измервания' in await pg.inner_text('#screen .start'))
        check('no automatic pop-up in the installed app', not await pg.locator('#toast.on').count())
        check('no horizontal overflow on iPhone', await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        await acts.nth(1).click(); await pg.wait_for_timeout(300)
        check('"Моите активности" opens the activity screen', await pg.locator('#tabbar button[data-tab="run"][aria-current="true"]').count() == 1)
        await pg.screenshot(path='/tmp/me_iphone_run.png')
        await pg.click('#tabbar button[data-tab="home"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/me_iphone.png')
        check('no JS errors (iPhone)', not errs, errs[:2])
        # manifest and icons
        m = await pg.evaluate("fetch('manifest.json?v=ps3').then(r=>r.json())")
        check('manifest keeps id /me/, start_url and scope (installed apps stay compatible)', m['id'] == '/me/' and m['start_url'] == '/me/?app=1' and m['scope'] == '/')
        check('manifest name VAYSHA Me', m['name'] == 'VAYSHA Me')
        sizes = {}
        for ic in m['icons']:
            r = await pg.request.get(BASE + 'me/' + ic['src'])
            im = Image.open(io.BytesIO(await r.body())); sizes[ic['src']] = (r.status, im.size, ic['sizes'], ic['purpose'])
        check('all manifest icons load and match their declared size', all(v[0] == 200 and '%dx%d' % v[1] == v[2] for v in sizes.values()), sizes)
        check('maskable icons present', sum(1 for v in sizes.values() if v[3] == 'maskable') == 2)
        at = await pg.get_attribute('link[rel="apple-touch-icon"]', 'href'); r = await pg.request.get(BASE + 'me/' + at)
        check('apple-touch-icon 180×180, opaque', Image.open(io.BytesIO(await r.body())).size == (180, 180) and Image.open(io.BytesIO(await r.body())).mode == 'RGB')
        fv = await pg.get_attribute('link[rel="icon"][sizes="32x32"]', 'href'); r = await pg.request.get(BASE + 'me/' + fv)
        check('favicon 32×32', r.status == 200 and Image.open(io.BytesIO(await r.body())).size == (32, 32))
        await ctx.close()
        # tablet
        ctx = await b.new_context(viewport={'width': 1024, 'height': 1366}, device_scale_factor=2, has_touch=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + 'me/?device=tablet'); await pg.wait_for_timeout(1200)
        check('tablet mode shows the three actions', await pg.locator('#screen2 .start .act').count() == 3)
        check('tablet: no horizontal overflow, no JS errors', await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1') and not errs, errs[:2])
        await pg.screenshot(path='/tmp/me_tablet.png'); await ctx.close()
        # desktop presentation page
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + 'me/'); await pg.wait_for_timeout(1500)
        check('desktop: warning banner, phone with actions, no JS errors', 'SYNTHETIC' in await pg.inner_text('.demo') and await pg.locator('#screen .start .act').count() == 3 and not errs, errs[:2])
        await pg.screenshot(path='/tmp/me_desktop.png'); await ctx.close()
        # other URLs still respond
        for u in ['', 'map/', 'me/sw.js', '#field']:
            r = await (await b.new_context()).request.get(BASE + u)
            check('URL still served: /' + u, r.status == 200)
        await b.close()
    n = sum(1 for r in results if r[1]); print(f'{n} / {len(results)} passed')
asyncio.run(main())
