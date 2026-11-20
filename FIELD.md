# Field Session – pre-Lazur field deployment

Module **9 · Field Session** in Creamino Lab (`https://lab.pointsurface.com/#field`).
Purpose: collect real CSI, TDR and Clegg measurements, with grid positions and technical metadata, for the first measurement session at стадион „Лазур“, Бургас. Mode: **INITIAL CALIBRATION — LAZUR**. No locally validated CSI model exists, so the module produces **no** CSI-derived VWC, Gmax or SRS values and shows no operational status:

> Локалната калибрация е в процес. CSI данните се събират и проверяват. Прогнозните стойности и оперативните препоръки не са активни.

## Files
| File | Role |
|---|---|
| `js/field.js` | Engine (no DOM, Node-testable): session and record schema, IDs, append-only revisions, QC, CSI↔reference matching, dashboard metrics, CSV / JSON / HTML report, ZIP (store) |
| `js/fieldstore.js` | IndexedDB storage: sessions + raw CSI bytes keyed by SHA-256, persistent-storage request, memory fallback with a visible warning |
| `js/fieldui.js` | Field Session view: session list, new session, dashboard, CSI/TDR/Clegg entry, records + QC, pairs, corrections, exports, JSON restore |
| `js/app.js`, `index.html`, `css/app.css` | Navigation entry, field banner/tag, script includes (minimal changes) |
| `test/field.test.js` | 16 unit tests |
| `test/field_e2e.py` | 29 end-to-end tests in headless Chrome |

## Data model
Session: `session_id` (e.g. `LAZUR-20261124-S01`, test sessions `…-T01`), `site_id`, `site_name`, `field_id`, `data_origin` (`real` | `test` – synthetic is rejected), `mode = INITIAL_CALIBRATION`, `model_status.validated = false`, date, operator, device defaults, measurement configuration, grid (length × width, cell size), QC thresholds, status, event log, raw-file manifest.

Measurement record (one per CSI capture, TDR reading or Clegg drop): the 25 fields `measurement_id, session_id, site_id, field_id, grid_cell_id, timestamp_utc, operator_id, device_id, device_model, firmware_version, wifi_channel, bandwidth, subcarrier_count, window_duration, packet_loss, signal_quality, raw_data_reference, reference_vwc, reference_gmax, reference_measurement_method, coordinates_x, coordinates_y, notes, quality_status, processing_version`, plus `record_type`, `data_origin`, `revision`, `supersedes`, `superseded_by`, `raw_sha256`, `raw_stored`, `entered_utc`, `duplicate_of`.

Missing / unverified / valid: an empty field is exported empty and listed by QC (`INCOMPLETE`); a record with QC `WARNING` is unverified; `PASS` is valid. `quality_status` is always computed, never typed in.

## Raw data preservation
* A raw CSI file is read as bytes, hashed (SHA-256) and written to IndexedDB **before** the record is saved; the record references it as `sha256:<hash> (<file name>)`.
* Raw bytes are added once and never replaced; a correction cannot change a record's raw file.
* Corrections create a new revision; the original stays in the session and in the CSV/JSON exports (`SUPERSEDED`).
* FAIL records are never deleted; the reason is stored with them.
* Unique IDs per session and record; duplicates (same ID, same raw file, or same type + cell + value within 5 s) are refused unless explicitly saved as a repeat measurement, which is then flagged.
* Every action is written immediately; reopening the page restores the active session, and the half-typed form is restored from a draft.
* Export: CSV (measurements), JSON (full metadata, QC, pairs), HTML session report, ZIP package with all of these plus the raw files. JSON can be restored on another device.

### Known limitations of the local architecture
* Storage is per browser and device (IndexedDB). Clearing site data, a private window or another browser means the data are not there – export the ZIP after every session and keep two copies. The app requests persistent storage; whether the browser grants it is shown nowhere else, so treat export as mandatory.
* Lab has no backend: no multi-device sync, no server-side audit trail. The event log is local and part of the export.
* The app does not talk to the CSI hardware. CSI is captured by the logger/firmware; the app stores the resulting file unchanged with its hash and metadata. Packet loss and signal quality are entered from the logger output.
* Raw files are held in browser storage; very large captures (hundreds of MB) depend on the browser quota. The ZIP is uncompressed (store) to avoid any transformation of raw bytes.
* JSON restore restores metadata; raw bytes come back only from the ZIP (re-attach by file).

## QC rules (defaults, editable per session)
| Check | Result |
|---|---|
| missing / invalid timestamp | FAIL |
| duplicate measurement ID | FAIL |
| packet loss > 10 % (> 5 % warning) | FAIL / WARNING |
| CSI window < 10 s | FAIL |
| incomplete device configuration, other missing metadata | INCOMPLETE |
| missing reference value | INCOMPLETE |
| VWC outside 0–60 % vol, Gmax outside 1–300 G | FAIL |
| grid cell not in the session grid, coordinates not in the declared cell (±1 m), outside the field | FAIL |
| CSI without reference in same cell within 30 min and 2 m, or reference too far in time/space | WARNING |
| raw data only referenced externally | WARNING |
| saved as repeat of a possible duplicate | WARNING |

Overall status = worst check (FAIL > INCOMPLETE > WARNING > PASS). A pair is valid only if neither record is FAIL or INCOMPLETE.

Session status: PLANNED → IN PROGRESS (first record) → CALIBRATION (manual) → close: COMPLETED, or REVIEW REQUIRED if any record FAILS or is INCOMPLETE.

## Tests
`node test/field.test.js` – 16 unit tests; `python3 test/field_e2e.py` – 29 browser tests (server on :8765). Existing tests unchanged: `node test/engine.test.js`, `python3 test/e2e.py`.
