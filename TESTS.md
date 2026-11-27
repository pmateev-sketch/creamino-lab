# Test report – Creamino Software Demo v1.0

Run on 2026-11-17 in headless Chrome (Playwright) against the local static build, plus Node unit tests of the engine.

## Engine unit tests (`node test/engine.test.js`)

14 of 14 passed: synthetic dataset size and reproducibility, demo ranges, RMSE/MAE/R²/bias against hand calculations, OLS on an exact linear relation, LOSO and grouped CV split integrity (no session in both train and test), K-fold coverage, no leakage (each LOSO fold refits; fold-1 predictions equal an independent refit without S1), SRS definition and class boundaries, IDW exactness and bounds, CSV round trip and import validation, warning instead of results for tiny datasets, data/ JSON identical to the generator.

## End-to-end UI tests (`python3 test/e2e.py`)

| # | Test | Result | Detail |
|---|---|---|---|
| 1 | home renders | PASS |  |
| 2 | dashboard after START DEMO | PASS |  |
| 3 | KPI all = 56 | PASS | 56 |
| 4 | session filter changes KPI | PASS | 7 13.8 % vol |
| 5 | map click info | PASS | x = 48.4 m · y = 33.0 m · SRS = 0.62 · interpolated value · distance to nearest point 1.9  |
| 6 | explorer pagination 15/page | PASS | 15 |
| 7 | point filter | PASS |  |
| 8 | search | PASS |  |
| 9 | sort desc by SRS | PASS | 0.629 |
| 10 | next page | PASS |  |
| 11 | CSV export | PASS | CREAMINO_SYNTHETIC_DEMO_V1.csv |
| 12 | import validation report | PASS | Import imp.csv  56 valid rows · 8 sessions · CSI features: yes – predictions will be compu |
| 13 | import blocked until ack | PASS |  |
| 14 | imported dataset active | PASS |  |
| 15 | analytics KPIs | PASS |  |
| 16 | method changes metrics | PASS | 1.80 vs 1.38 |
| 17 | charts render | PASS |  |
| 18 | session subset scatter | PASS |  |
| 19 | LOSO 8 folds | PASS | 8 |
| 20 | grouped 4 folds | PASS |  |
| 21 | kfold 10 folds | PASS |  |
| 22 | IDW map reacts to p | PASS | 157014 vs 154630 |
| 23 | compare 3 maps | PASS |  |
| 24 | spatial click info | PASS | Session S1 · x = 5.6 m · y = 8.6 m · VWC = 24.5 % vol · interpolated value · distance to n |
| 25 | SRS calc 0.500 M | PASS |  |
| 26 | SRS high | PASS |  |
| 27 | PDF export | PASS | Creamino_report_CREAMINO_SYNTHETIC_DEMO_V1_all_2026-11-17.pdf 312998 bytes |
| 28 | PDF session S6 | PASS | Creamino_report_CREAMINO_SYNTHETIC_DEMO_V1_S6_2026-11-17.pdf |
| 29 | synthetic locked | PASS |  |
| 30 | validated needs reviewer+ref | PASS |  |
| 31 | status change logged | PASS |  |
| 32 | walkthrough reaches report | PASS |  |
| 33 | imported dataset persists after reload | PASS |  |
| 34 | reference-only dataset: no-feature note | PASS |  |
| 35 | analytics refuses to invent results | PASS |  |
| 36 | spatial works on imported coords | PASS |  |
| 37 | reset removes imports | PASS |  |
| 38 | no JS errors | PASS |  |
| 39 | mobile no horizontal overflow (page) | PASS | 390 |
| 40 | mobile explorer fits | PASS | 390 |
| 41 | mobile analytics fits | PASS | 390 |
| 42 | mobile spatial fits | PASS | 390 |
| 43 | mobile srs fits | PASS | 390 |
| 44 | mobile report fits | PASS | 390 |
| 45 | mobile no errors | PASS |  |

**45 of 45 passed.**

Mobile checks use a 390 × 844 viewport; "fits" means the page does not scroll sideways (wide tables scroll inside their own frame).


## Field Session (2026-11-21)

* `node test/field.test.js` – 16 / 16 passed (session, CSI/TDR/Clegg records, matching, duplicates, missing metadata, QC FAIL, revisions, CSV, JSON + restore, recovery, synthetic vs real, calibration mode, close status, ZIP).
* `python3 test/field_e2e.py` – 29 / 29 passed in headless Chrome (UI flow, raw file stored in IndexedDB, duplicate refused, reload restores session and draft, all four exports, demo modules unaffected, phone width).
* Existing tests after the change: engine 13 / 13 + data file identical; `test/e2e.py` 45 / 45.


## Pre-Lazur hardening audit (2026-11-21, field-qc-1.1)

* `node test/field_hardening.test.js` – 18 / 18 passed: one-to-one matching, ambiguity flag, missing x/y rejected, > 2 m rejected, reasons, determinism under record order, CSV states, raw STORED/EXTERNAL/MISSING, backup status, 1.0→1.1 migration, manifest fields, unzip CRC, restore plan (complete / flipped byte / wrong SHA with valid CRC / missing file / truncated ZIP / damaged session JSON / compressed entry).
* `python3 test/field_roundtrip_e2e.py` – 36 / 36 passed in headless Chrome: 3 CSI with 8 MB, 25 MB and 4 KB random binaries + TDR + Clegg + a revision → ZIP export (Python `zipfile.testzip` OK, every SHA-256 equals the original file on disk) → IndexedDB database deleted → restore from ZIP → every record, revision, raw-file manifest entry, blob hash and blob metadata identical (only the session log, write counter and backup stamp differ, by design). Also: corrupted ZIP (file listed CORRUPTED, cancel restores nothing, confirmed partial restore stores only verified files and marks BACKUP INCOMPLETE), simulated quota error (NOT SAVED, nothing stored, page rolled back), real IndexedDB transaction aborted after the session + 25 MB blob writes were queued (neither committed), tab closed during a 25 MB save (record, manifest, blob all absent – the close came before the commit), two tabs (stale tab refused), refused duplicate leaves no orphan blob, low-storage warning.
* Existing tests re-run without changing any expected result: `test/engine.test.js` 13 / 13 + data identical, `test/field.test.js` 16 / 16, `test/field_e2e.py` 29 / 29, `test/e2e.py` 45 / 45.
* Not tested: real CSI logger hardware or real logger files; files above 25 MB; Safari / iOS and Firefox (tests run in Chrome only); actual browser eviction; `beforeunload` prompt (browsers suppress it in automation).


## Logger intake readiness (2026-11-21)

* `node test/field_intake.test.js` – 7 / 7 passed: libpcap LE/µs and BE/ns, truncated record, oversize and backwards timestamps, pcapng/gzip/zip/text/unknown/empty, intake states never claim a CSI format or parse, traceability chain and CSV.
* `python3 test/field_intake_e2e.py` – 22 / 22 passed: protocol steps D–I rehearsed with **stand-in files** (generic pcap 200 and 18 000 packets, text) – intake stages, re-hash, duplicate refused, linking to a CSI record, TDR/Clegg traceability, ZIP with traceability CSV, restore into a wiped database, byte identity with the files on disk, timestamps/configuration identical. Not evidence about the Lazur logger.
* All earlier suites re-run unchanged: engine 13 / 13 + data identical, field 16 / 16, hardening 18 / 18, field e2e 29 / 29, round trip 36 / 36, Lab e2e 45 / 45. Storage layer (`js/fieldstore.js`) not modified.

## VAYSHA Me – icon and home screen (2026-11-26)

* `python3 test/me_e2e.py` – 25 / 25 passed in headless Chrome: three main actions („Карта на терените“, „Моите активности“, „Данни и анализи“) at ≥ 56 px on iPhone 390×844 (app mode), tab bar ≥ 44 px, synthetic-data warnings visible, no auto pop-up in the installed app, no horizontal overflow, tablet (1024×1366) and desktop views, manifest id/start_url/scope unchanged, every manifest icon loads at its declared size (any + maskable), apple-touch-icon 180×180 opaque, favicon 32×32, /, /map/, /#field still served.
* Icon: geometric Ω matched to the Viber reference (stroke 0.27 R, gap 0.23 R, feet flush with the ring, foot height 0.8 of the stroke), 62 % of the width, #3FD3D8 on #0C2730, faint glow; maskable variants at 80 % for the Android safe zone. Checked visually at 180, 192, 512 and 32 px.
* All earlier suites re-run unchanged and passing: engine 13 + data identical, field 16, hardening 18, intake 7, Lab e2e 45, field e2e 29, round trip 36, intake e2e 22.
* Not tested: a real iPhone / iPad / Android home screen (Chrome emulation only), Safari rendering, how long installed apps take to pick up the new icon.


## VAYSHA QA after PR #5 / #6 (2026-11-27)

New suite `python3 test/vaysha_qa_e2e.py` – 69 / 69 passed in headless Chrome:

* Page health: `/`, `/map/`, `/map/privacy.html`, `/me/`, `/me/?app=1`, `/#field` load without JS errors.
* Satellite map: Leaflet loaded, satellite tiles and canvas markers drawn, terrain list filled, no sideways scroll on a phone.
* PR #5: approximate ski snow share and "piste safety not verified" footer; snow-only ski labels; no CRIO machines plotted; demo sites labelled "примерни стойности"; Ω = demo scenario; site card "ДЕМО · синтетични данни"; cup shows VAYSHA; Lab note names VAYSHA.
* Credibility: CRIO only as a concept (no "nearby / 120 m / recipe loaded"), WADA/allergy check not claimed, real-stadium home signal marked as example values, tour text matches labels, alerts described as planned.
* Brand: PDF header and file name VAYSHA (download checked), privacy page VAYSHA; storage and format identifiers (`creamino-field`, `creamino-field-1.0`, `creamino-field-zip-1`, `creamino-demo-v1`) unchanged.
* Icons (real pixels): Ω on #0C2730 in #3FD3D8, two feet, open bottom, round hole (ratio 0.9–1.1), width 60–65 % (maskable 45–62 %), faint glow that ends within 26 px on the 512 px icon.
* PR #6 service worker: installs and controls `/me/`; cache `vaysha-me-v5`; an old `creamino-me-v4` cache is removed on update; an unrelated cache on the same origin is kept; shell and icons precached; offline navigation falls back to the shell; an offline missing asset is a network error, not index.html; cached asset served offline; back online serves the network again.
* iPhone SE 375 × 667 and iPhone 14 390 × 844 (installed-app mode): three entries visible without scrolling, demo profile switch (athletes + coach) with 44 × 44 px targets, tab bar ≥ 44 px, one bottom navigation, end of screen not covered by the tab bar, no overflow, no errors. Tablet 820 × 1180 also checked.

All earlier suites re-run without changing expected results: engine 13 / 13 + data identical, field 16 / 16, hardening 18 / 18, intake 7 / 7, `e2e.py` 45 / 45, `field_e2e.py` 29 / 29, `field_intake_e2e.py` 22 / 22, `field_roundtrip_e2e.py` 36 / 36, `me_e2e.py` 25 / 25.

Not tested: a real iPhone or Android device (Safari / iOS PWA install and home-screen icon rendering), Firefox, real CRIO hardware, real CSI logger files.
