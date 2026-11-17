# Creamino Software Demo · v1.0

**CREAMINO — Every Athlete. Every Surface.** Smart Sports Surface Intelligence Platform by Point Surface.
Interactive, fully client-side software demo intended for `https://lab.pointsurface.com/`.

> The demo runs on **CREAMINO_SYNTHETIC_DEMO_V1**, a programmatically generated dataset (fixed seed 20261117).
> **SYNTHETIC DEMONSTRATION DATA — NOT EXPERIMENTALLY VALIDATED.** Nothing in the demo is evidence of Creamino's accuracy.
> The experimental Terrain 1 file (N = 56) is **not** included and no values from it are used.

## Modules
| Module | What works |
|---|---|
| Home | START DEMO, LOAD SAMPLE SESSION, guided walkthrough (6 steps) |
| Dashboard | KPIs from the active dataset and session, IDW field map (VWC / Gmax / SRS) with click read-out, session means |
| A · Data Explorer | sort, filter by session and point, search, pagination, CSV export, CSV import with validation, dataset switch |
| B · Analytics Engine | RMSE, MAE, R², bias, residual SD, Pearson r; scatter with y = x and fitted line, residual plot, histogram, per-session comparison |
| C · Validation Lab | K-fold, grouped CV by session and Leave-One-Session-Out; three models (linear regression on F1+F4+F7, on F1 only, mean baseline); per-fold table and chart |
| D · Spatial Intelligence | IDW with adjustable power p, resolution, coverage radius; measured points vs interpolated vs not-covered cells; compare two sessions (A − B) |
| E · Surface Risk Engine | SRS = 0.4·Moist_dev + 0.6·Hard_dev with the documented definition (VWC_opt 23 % vol, G_opt 80 G) and thresholds 0.35 / 0.65 |
| F · Report Generator | A4 PDF technical report (jsPDF), synthetic-data label on every page |
| Data Provenance | dataset metadata, three status levels, logged status changes (synthetic dataset locked), log export |

## Why this architecture
Plain HTML, CSS and JavaScript, no framework and no build step: the app is a static site that opens instantly, can be hosted anywhere (GitHub Pages, any web server, a USB stick), has nothing to update and keeps every calculation inspectable in `js/core.js`. The only third-party file is jsPDF (MIT) in `vendor/` for the PDF export. No backend, no accounts, no external API calls.

## Project structure
```
index.html              app shell
css/app.css             design (Point Surface colours #69D0E6 / #1E2A38 / #F8F9FA)
js/core.js              engine: seeded RNG, statistics, OLS, CV/grouped CV/LOSO, IDW, SRS, CSV parsing + validation
js/synthetic.js         CREAMINO_SYNTHETIC_DEMO_V1 generator and its documented rules
js/charts.js            dependency-free SVG charts
js/report.js            PDF report
js/app.js               UI, state, modules
vendor/jspdf.umd.min.js jsPDF 2.5.2 (MIT, see vendor/jspdf.LICENSE)
data/                   the synthetic dataset as CSV and JSON (identical to what the app generates)
tools/export-data.js    regenerates data/ from the generator
test/engine.test.js     Node unit tests of the engine
test/e2e.py             Playwright end-to-end tests
CNAME                   lab.pointsurface.com (for GitHub Pages)
TESTS.md                latest test results
```

## Run locally
Open `index.html` directly in a browser, or serve the folder:
```
python3 -m http.server 8080      # then open http://localhost:8080
```
Tests:
```
node test/engine.test.js
pip install playwright && python3 -m playwright install chromium
DEMO_URL=http://localhost:8080/index.html python3 test/e2e.py
```

## CSV import format
Required columns: `session, point, x, y, vwc_ref, gmax_ref` (VWC in % vol, Gmax in G, coordinates in metres).
Optional: `obs_id, f1, f4, f7` (CSI features). Without the features the dataset is shown as reference data only and no predictions or model metrics are computed. Rows with missing, non-numeric, duplicate or out-of-range values are excluded and listed; the user must confirm before import. Use “CSV template” in the Data Explorer.

## Deploy to lab.pointsurface.com (GitHub Pages, free)
1. Create a public GitHub repository, e.g. `pointsurface/creamino-lab`, and upload the contents of this folder (keep `CNAME`).
2. Repository → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
3. At GoDaddy (DNS for pointsurface.com) add a record: **Type CNAME · Name `lab` · Value `<github-user>.github.io` · TTL 1 hour**.
4. Back in Settings → Pages, enter `lab.pointsurface.com` as custom domain, wait for the DNS check, then tick **Enforce HTTPS**.
5. Open `https://lab.pointsurface.com/` and run the walkthrough.

The main site stays on WordPress.com: link to the lab from a normal button. WordPress.com (Personal plan) strips JavaScript from page content, so the demo cannot be embedded inside a WordPress page.

## Known limitations
- Synthetic data only; the CSI features are simulated and simplified (three features, linear relations plus noise).
- Linear regression is the only trained model; the baseline exists to show what “no skill” looks like.
- With 7 observations per session, per-fold R² is unstable and is hidden for folds with fewer than 3 test points.
- IDW uses straight-line distance and ignores barriers; the demo field and coordinates are invented.
- TR-1 and TR-2 classes are not defined in the methodology and are not implemented; TR-3 (cluster rule with the Confidence Gate τ) is documented but not applied.
- PDF uses standard fonts, so the report is in English (Cyrillic would need an embedded font).
- Imported datasets and the provenance log are kept in the browser’s local storage only; they are not shared between devices.
