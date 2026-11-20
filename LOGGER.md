# Lazur – real CSI logger integration readiness

Status 2026-11-21: **no real logger file has been received and the logger configuration is not documented in the project.**
Every hardware parameter below is therefore UNVERIFIED. No hardware compatibility is claimed. No CSI parser exists.

Field Session storage, integrity, backup and restore (field-qc-1.1) are unchanged by this work; see FIELD.md.

## 1. Logger identification

Sources inspected: this repository (README, FIELD.md, TESTS.md, all code and data), the Lab synthetic demo data, and the project's earlier discussions. None of them names the logger hardware or its configuration. The values `ESP32-A / ESP32-S3 / csi-1.2` that appear in `test/field.test.js` are invented test fixtures, not documentation.

| Parameter | Project documentation | Status | How to verify on the logger |
|---|---|---|---|
| Hardware model | not documented | **UNVERIFIED** | label on the device; photo for the record |
| Raspberry Pi model (if applicable) | not documented | **UNVERIFIED** | `cat /proc/device-tree/model` |
| CSI capture method | not documented | **UNVERIFIED** | exact capture command line(s) used, e.g. the tcpdump / logger script |
| Nexmon version (if applicable) | not documented | **UNVERIFIED** | nexmon_csi repository and commit: `git -C <nexmon_csi dir> rev-parse HEAD`; branch / fork name |
| Wi-Fi chipset | not documented | **UNVERIFIED** | `dmesg \| grep -i brcmfmac` (chip and firmware line) |
| Firmware / software versions | not documented | **UNVERIFIED** | firmware line from dmesg; `uname -r` (kernel); OS release `cat /etc/os-release`; logger script version |
| Channel and bandwidth | not documented | **UNVERIFIED** | the parameters passed to the CSI configuration tool (for Nexmon: the `makecsiparams`/`mcp` command and its output) |
| Subcarrier count | not documented | **UNVERIFIED** | follows from bandwidth and chip; must be confirmed from a real file |
| Capture window duration | not documented | **UNVERIFIED** | capture start/stop times; from the file: first/last packet time |
| Expected output file format | not documented | **UNVERIFIED** | file extension and the container the app identifies on intake |
| Expected metadata | not documented | **UNVERIFIED** | what the logger writes besides the capture (log file, config dump, file names) |
| Transmitter (frame source) | not documented | **UNVERIFIED** | device model, MAC address, frame rate / ping interval |
| Clock / time sync of the logger | not documented | **UNVERIFIED** | `timedatectl`; compare logger time with the laptop time before and after capture |

Field Session already stores the entered configuration with every CSI record (device_id, device_model, firmware_version, wifi_channel, bandwidth, subcarrier_count, window_duration, measurement configuration).

## 2. Real logger compatibility matrix

"Tested" means tested in this app with **stand-in files** generated here (random binaries, generic libpcap files, text). No row is tested with output of the Lazur logger.

| Source / format | Store raw bytes unchanged | SHA-256 + re-hash | Container identified | Metadata | CSI format identified | CSI parsed | Packet loss computed |
|---|---|---|---|---|---|---|---|
| **Lazur logger (actual)** | expected (any file type is stored) – **no file yet** | expected – **no file yet** | **unknown** | manual | **no** | **no** | **no** |
| Any file (binary) | tested 4 KB – 25 MB | tested | UNKNOWN if no known signature | manual | no | no | no |
| libpcap (`.pcap`, e.g. tcpdump output) | tested (generic pcap) | tested | **PCAP** – header, packet count, first/last time, truncation, snaplen checked | manual | no | no | no |
| Nexmon CSI in pcap | not tested – no Nexmon file available | – | would show PCAP (container only) | manual | no | no | not determined (see §3.3) |
| pcapng | not tested | – | PCAPNG (signature only, blocks not walked) | manual | no | no | no |
| Text / CSV (e.g. ESP32-CSI serial logs) | tested (generic text) | tested | TEXT / TEXT_DELIMITED (first line shown) | manual | no | no | no |
| gzip / zip archives | not tested | – | GZIP / ZIP (signature only) | manual | no | no | no |
| Intel 5300 `.dat`, Atheros, PicoScenes `.csi` | not tested | – | UNKNOWN (no signature check) | manual | no | no | no |

## 3. File format specification

### 3.1 What the app checks today (container level only)
On intake every file is read fully, hashed, stored, re-read and re-hashed. The container is identified only from standard signatures:
* **libpcap** (magic `a1b2c3d4` / `d4c3b2a1` µs, `a1b23c4d` / `4d3cb2a1` ns): byte order, version, snaplen, link type; each 16-byte record header is walked: packet count, first and last capture time (UTC), records cut off at the end of the file, records shorter than on the wire (`incl_len < orig_len`), records longer than snaplen, timestamps going backwards. `structure_ok` is true only with no truncation and no oversize record.
* **pcapng** (`0a0d0d0a`), **gzip** (`1f8b`), **zip** (`504b0304`): identified, contents not inspected.
* **Text**: no NUL bytes and < 1 % control characters in the first 64 KB; the first line and its delimiter are recorded.
* Anything else: UNKNOWN, first 8 bytes recorded.

The packet payloads are never interpreted. CSI format stays `NOT_IDENTIFIED`, parse status `NOT_PARSED`.

### 3.2 Nexmon CSI – reference description, NOT verified against Lazur files
From the published nexmon_csi documentation (github.com/seemoo-lab/nexmon_csi) and independent decoders:
* CSI is sent by the patched firmware as UDP packets from 10.10.10.10 to 255.255.255.255, port 5500, and is normally recorded with tcpdump into a pcap file. One UDP packet per configured core and spatial stream for each received frame that matches the filter.
* Payload (current upstream version): magic `0x1111` (2 bytes; older versions used 4 bytes `0x11111111`), source MAC (6), 802.11 sequence number of the triggering frame (2), core / spatial stream (2), chanspec (2), chip version (2), then CSI as int16 I/Q values. A widely used fork for the BCM43455c0 (Raspberry Pi 3B+/4) adds RSSI (1 byte) and frame control (1 byte) after the magic. One decoder documents 512 int16 values for an 80 MHz capture.
* The header layout differs between versions, forks and chips. A parser must detect the variant from the data and refuse unknown variants; it must not be assumed.

To be confirmed on a real Lazur file before any parser is written: link type of the pcap; UDP ports and addresses; exact header variant and length; byte order; CSI value type; number of values per packet for the configured bandwidth; chip version value; chanspec value against the configured channel/bandwidth.

### 3.3 Timestamps, packet loss, malformed packets (Nexmon case)
* **Timestamps:** no timestamp field is documented in the CSI payload. The only time is the pcap record time, written by the capture host's clock. Its accuracy depends on the logger's time sync. Raspberry Pi 3B+/4 have no battery-backed clock; without network time the clock can be wrong after boot. → Record logger time against the laptop at every capture (protocol step A/B).
* **Packet loss:** can only be computed if (a) the frames come from one known transmitter with consecutive 802.11 sequence numbers, (b) every transmitted frame is meant to match the CSI filter, and (c) the sequence-number wrap and fragment bits are handled. Missing UDP packets alone do not prove loss (filtering, other stations, cores/streams). **Until a real file and the transmitter set-up confirm (a)–(c), packet loss is not computed and stays a manual entry.**
* **Malformed / incomplete packets** a parser would flag: wrong magic; UDP payload length not matching the header plus the expected CSI length for the bandwidth; truncated pcap record (already detected); `incl_len < orig_len` (capture with too small snaplen – use `tcpdump -s 0`); duplicate sequence number for the same core/stream; non-monotonic timestamps (already detected); chanspec different from the configured channel/bandwidth.

### 3.4 Parser decision
**No parser is implemented.** A parser can be built safely only when all of these are available:
1. a short and a long original file from the Lazur logger (protocol A and B);
2. the exact capture command, nexmon_csi (or other tool) version/commit, chip, firmware and CSI configuration parameters;
3. an independent decode of the same files by the operator with an established tool (e.g. CSIKit or nexcsi), as a cross-check;
4. agreement between §3.2 and what the real files contain.
The parser's tests must then be built from those real files. Until then: stop at this specification.

## 4. Import test protocol (logger integration test)

Use a TEST session (origin TEST, ID `LAZUR-YYYYMMDD-Tnn`) on the laptop and browser that will be used at Lazur. Record every result in the table in §4.1.

| Step | Action | Pass criterion |
|---|---|---|
| **0** | Photograph the logger and transmitter. Record the §1 parameters from the device (commands in §1). Note logger time vs laptop time. | every §1 row filled or explicitly "not available" |
| **A** | Capture one **short** CSI session (≈ 30 s). Note start/stop time on the laptop clock and the exact command. | file exists on the logger, size > 0 |
| **B** | Capture one **longer** CSI session (≈ 10 min). Same notes. | file exists, size noted |
| **C** | Copy the original files to the laptop without opening or converting them. On the logger compute `sha256sum <file>` and note the values. | sizes on laptop = sizes on logger |
| **D** | Field Session → open the TEST session → **Logger file intake** → select both files (plus any logger log/config file). | each file gets a file ID; no "NOT STORED" |
| **E** | In the intake table check: Raw stored YES; SHA-256 verified VERIFIED; compare the SHA-256 with the logger's `sha256sum`; size equal. Note the container shown (PCAP / TEXT / UNKNOWN …) and its evidence line (packets, first/last time, truncation). | hashes identical to the logger's; structure_ok for pcap |
| **E2** | For each capture press **Create CSI record**; enter cell, x/y, packet loss and signal quality **as reported by the logger** (leave empty if the logger gives none), configuration as recorded in step 0. Record TDR and Clegg next to it. | records saved; traceability row complete |
| **F** | Export the **ZIP package**. Copy it to a second place (USB stick / cloud). | message "all raw files verified"; state ZIP EXPORTED |
| **G** | Restore into a clean test database: use a second browser profile (or another laptop) and **Restore a session → From the ZIP package**. Do not clear the original. | session restored, no integrity problems |
| **H** | In the restored session press **Verify stored raw files**; compare each SHA-256 in the intake table with the logger's `sha256sum`. Optionally on the laptop: `sha256sum` of the files inside the ZIP `raw/` folder. | every file VERIFIED and byte-identical (same SHA-256 and size) |
| **I** | Compare in the restored session: record timestamps, entered configuration, first/last packet time shown in the container evidence vs the times noted in A/B (difference = logger clock offset). | identical records; clock offset known and noted |
| **J** | Record every failure, warning and deviation in §4.1, with screenshots. Send the two original files, the ZIP and the notes for the parser assessment (§3.4). | table complete |

### 4.1 Result record (fill in on site)
| Step | Date/time | Result (PASS/FAIL) | Values (size, SHA-256, container, offset…) | Failure / note |
|---|---|---|---|---|
| 0 | | | | |
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| E2 | | | | |
| F | | | | |
| G | | | | |
| H | | | | |
| I | | | | |
| J | | | | |

## 5. Data traceability
For every CSI record the app shows and exports (`<session>_traceability.csv` in the ZIP, "Traceability" table in the app and in the session report):
original file (file ID, original name) → SHA-256 and its last re-hash result → container format → measurement ID → session ID → logger configuration as entered → paired TDR (ID, Δt, distance, match unique/ambiguous, QC) → paired Clegg (same) → QC status of the CSI record → CSI parse status (NOT_PARSED) → archive (last verified ZIP time; "outdated" if changed since; "incomplete" if a file failed).
Intake files not yet linked to a record are listed as "(unassigned)". No prediction or calibration is produced.
Note: the traceability CSV inside a ZIP is written before that export completes, so its archive column shows the previous archive; the manifest of the same ZIP carries the export time.

## 6. Integration test results
**With real logger files: none – no file available.**
Rehearsal of steps D–I with stand-in files (generic libpcap files of 200 and 18 000 packets, a text file) in headless Chrome: `test/field_intake_e2e.py` 22 / 22 passed. This shows the intake, verification, export, restore and traceability path works; it says nothing about the Lazur logger.

## 7. Blockers before the first Lazur session
1. **Logger not identified** – every §1 parameter is unverified.
2. **No real logger file** – no evidence of format, size, timestamps or structure.
3. **No CSI parser** – by design until §3.4 conditions are met; CSI metadata (packet loss, signal quality) must be entered manually from the logger.
4. **Packet loss method undefined** – depends on the transmitter set-up (§3.3).
5. **Logger clock** – time sync not defined; needed for CSI ↔ TDR/Clegg matching (30-min window, but timestamps should be right to the minute).
6. **Hardware rehearsal not done** – protocol §4 must pass once (TEST session) before a REAL session.
7. Browsers other than Chrome (Safari/iPhone, Firefox) not tested; files above 25 MB not tested.
