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
