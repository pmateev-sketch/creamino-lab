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
* A raw CSI file is read as bytes and hashed (SHA-256) first; then the raw bytes, the raw-file manifest entry and the record are written in **one IndexedDB transaction** over both stores – all or nothing (since field-qc-1.1). The record references the file as `sha256:<hash> (<file name>)`; the manifest entry carries a unique `file_id` (`RAW-<session>-NNNN`), original file name, size, MIME type, last-modified time and SHA-256.
* Raw bytes are added once and never replaced; a correction cannot change a record's raw file.
* Corrections create a new revision; the original stays in the session and in the CSV/JSON exports (`SUPERSEDED`).
* FAIL records are never deleted; the reason is stored with them.
* Unique IDs per session and record; duplicates (same ID, same raw file, or same type + cell + value within 5 s) are refused unless explicitly saved as a repeat measurement, which is then flagged.
* Every action is written immediately; reopening the page restores the active session, and the half-typed form is restored from a draft. If a write fails (quota, conflict, abort) the page is rolled back to the last committed state and shows **NOT SAVED**; a selected raw file stays selected for the retry.
* Export: CSV (measurements), JSON (full metadata, QC, pairs, matching log), HTML session report, ZIP package (see below). JSON restore brings back records and revisions only; raw files are then marked MISSING.

## Storage durability (field-qc-1.1)
* **Atomic writes.** `fieldStore.commit(session, raws)` writes the session and any new raw blobs in one `readwrite` transaction over `sessions` + `raw`. A crash, closed tab or quota error before `complete` leaves the previous committed state (IndexedDB transaction semantics).
* **Two tabs.** Each committed session has `save_seq`. A write from a page whose `save_seq` is stale is refused with CONFLICT – the second tab cannot silently overwrite the first.
* **Quota.** `QuotaExceededError` is reported as "Browser storage is full … Nothing from this action was saved."
* **Startup scan.** On opening, every raw file listed by a session is checked to exist in storage (MISSING is shown in red); blobs not referenced by any session are counted (not deleted). "Verify stored raw files" re-hashes every blob of the session.
* **Diagnostics.** `navigator.storage.estimate()` usage/quota and `persisted()` are shown in the Storage panel; less than 300 MB free or more than 80 % used gives a red warning; persistent storage can be requested.
* **Tab closing.** While a save, hash or export runs, closing the tab asks for confirmation (`beforeunload`).
* **Backup status.** NOT BACKED UP → ZIP EXPORTED → BACKUP OUTDATED (any change after the export) / BACKUP INCOMPLETE (a raw file missing or corrupted). Shown on the dashboard, in the sessions list and on closing a session. "EXPORTED" means the package was generated, read back and verified in this browser; the app cannot know whether the downloaded file was kept.
* **Browser storage is not a backup.** It can be evicted, cleared or lost with the device.

## ZIP package and restore (field-qc-1.1)
* Contents: `<base>_measurements.csv`, `<base>_session.json`, `<base>_report.html`, `raw/<file_id>_<original name>` (original bytes, store method), `MANIFEST.json`, `MANIFEST.csv`, and `INTEGRITY_PROBLEMS.txt` when something failed.
* At export every raw blob is re-hashed; only files whose size and SHA-256 match are packed. MISSING / CORRUPTED files are listed in the manifest and in `INTEGRITY_PROBLEMS.txt`, and the session becomes BACKUP INCOMPLETE. The finished ZIP is read back (CRC-32 of every entry) before it is offered for download.
* Manifest per raw file: session ID, measurement IDs, file ID, original file name, ZIP path, size, SHA-256, MIME, last modified, stored time, export time, verification. Documents (CSV/JSON/report) are listed with their SHA-256 too.
* Restore from ZIP: every entry's CRC-32 is checked; the session JSON must match its manifest hash or nothing is restored; every raw file is checked for size and SHA-256. Files that fail are **not** stored; they are listed before anything is written, and the operator must confirm a partial restore (records whose file failed then show raw MISSING; session BACKUP INCOMPLETE). An existing session with the same ID is never overwritten. Only uncompressed packages written by this module are read; compressed entries are reported as unsupported.

## Logger / CSI file compatibility
* Accepted: **any file type** – the bytes are stored unchanged and hashed. Tested with random binary files of 4 KB, 8 MB and 25 MB.
* Size limit: the browser quota (see Storage panel). Each file is read fully into memory for hashing and export; files of several hundred MB may exhaust memory on a phone. Not tested above 25 MB per file.
* **No CSI parser is implemented.** No format (Nexmon `.pcap`, ESP32-CSI text/CSV, Intel 5300 `.dat`, Atheros) is decoded or validated; nothing about compatibility with a specific logger is claimed. Packet loss, signal quality, channel, bandwidth, subcarriers and window are **entered manually** from the logger.
* Every CSI record shows three separate states (also CSV columns): `raw_file_status` STORED / EXTERNAL_REFERENCE / MISSING · `metadata_entry` MANUAL · `csi_parse_status` NOT_PARSED.

### Known limitations of the local architecture
* Storage is per browser and device (IndexedDB). Clearing site data, a private window or another browser means the data are not there – export the ZIP after every session and keep two copies. The app requests persistent storage; whether the browser grants it is shown nowhere else, so treat export as mandatory.
* Lab has no backend: no multi-device sync, no server-side audit trail. The event log is local and part of the export.
* The app does not talk to the CSI hardware. CSI is captured by the logger/firmware; the app stores the resulting file unchanged with its hash and metadata. Packet loss and signal quality are entered from the logger output.
* Raw files are held in browser storage; very large captures (hundreds of MB) depend on the browser quota. The ZIP is uncompressed (store) to avoid any transformation of raw bytes.
* JSON restore restores metadata; raw bytes come back only from the ZIP restore (or by re-attaching the same file, which clears MISSING when the SHA-256 matches).

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
| CSI without reference in same cell within 30 min and 2 m (x/y required on both), or reference too far in time/space | WARNING |
| ambiguous CSI–reference match | WARNING |
| raw data only referenced externally | WARNING |
| saved as repeat of a possible duplicate | WARNING |

Overall status = worst check (FAIL > INCOMPLETE > WARNING > PASS). A pair is valid only if neither record is FAIL or INCOMPLETE **and the match is not ambiguous**.

## CSI ↔ reference matching – methodology change in field-qc-1.1
Criteria unchanged: same grid cell, |Δt| ≤ 30 min, distance ≤ 2 m (both editable per session). Changed:
1. **Distance is computed from x/y of both records.** If either record has no coordinates the candidate is rejected ("distance cannot be verified … same cell is not proof of ≤ 2 m"). In field-qc-1.0 such a pair was accepted.
2. **One-to-one per reference type.** All candidates are sorted by Δt, then distance, then measurement IDs, and assigned greedily: a CSI gets at most one TDR and one Clegg, and a reference is given to at most one CSI. In 1.0 each CSI took its nearest reference independently, so one reference could be assigned to several CSI records.
3. **Ambiguity flag.** If the CSI or the reference had more than one candidate, the accepted pair is AMBIGUOUS: a WARNING on both records, excluded from valid pairs until reviewed.
4. **Matching log.** Every candidate is listed with "accepted: …" or "rejected: …" and the reason (time, distance, missing x/y, already paired). Unmatched CSI and reference records are kept and listed.
Processing version raised to `field-qc-1.1`; older sessions are migrated on load (file IDs added, records untouched).

Session status: PLANNED → IN PROGRESS (first record) → CALIBRATION (manual) → close: COMPLETED, or REVIEW REQUIRED if any record FAILS or is INCOMPLETE.

## Tests
`node test/field.test.js` – 16 unit tests; `python3 test/field_e2e.py` – 29 browser tests (server on :8765). Existing tests unchanged: `node test/engine.test.js`, `python3 test/e2e.py`.
