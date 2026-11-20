/* Creamino Field Session – local persistent storage (IndexedDB).
   Durability rules (field-qc-1.1):
   - A record and its raw file are written in ONE IndexedDB transaction over both stores ('sessions', 'raw'):
     either both are committed or neither is. A closed tab, crash or quota error mid-write leaves the previous
     committed state; the UI rolls its in-memory copy back to that state.
   - Optimistic concurrency: every committed session carries save_seq. A write is refused (CONFLICT) if the
     stored save_seq differs from the one the page loaded – e.g. the same session open in two tabs.
   - Raw bytes are keyed by SHA-256, written once and never replaced.
   - Browser storage is NOT a backup. It can be cleared by the browser, the user or a device reset. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var DB_NAME = 'creamino-field', DB_VER = 1, db = null, memory = null;

  function open() {
    return new Promise(function (resolve) {
      if (db || memory) return resolve(true);
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { memory = { sessions: {}, raw: {} }; return resolve(false); }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'session_id' });
        if (!d.objectStoreNames.contains('raw')) d.createObjectStore('raw', { keyPath: 'sha256' });
      };
      req.onsuccess = function () {
        db = req.result;
        db.onversionchange = function () { db.close(); db = null; };   // another tab deletes/upgrades the DB
        resolve(true);
      };
      req.onerror = function () { memory = { sessions: {}, raw: {} }; resolve(false); };
      req.onblocked = function () { };
    });
  }
  /* turn IndexedDB / DOMException errors into explicit field messages */
  function explain(err) {
    var e = err || new Error('Storage transaction failed'), name = e.name || '';
    var out = new Error(e.message || name || 'Storage transaction failed');
    out.code = e.code && typeof e.code === 'string' ? e.code : name;
    if (name === 'QuotaExceededError' || /quota/i.test(e.message || '')) { out.code = 'QUOTA'; out.message = 'Browser storage is full (quota exceeded). Nothing from this action was saved. Export the session ZIP now and free space before continuing.'; }
    if (e.code === 'CONFLICT') { out.code = 'CONFLICT'; out.message = e.message; }
    if (e.code === 'EXISTS') { out.code = 'EXISTS'; out.message = e.message; }
    return out;
  }
  function req2p(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  var S = {
    persistent: false,
    simulateFailure: null,   // test hook: an Error name (e.g. 'QuotaExceededError') fails the next commit before writing;
                             // 'ABORT_AFTER_WRITES' aborts the real transaction after session and raw puts are queued
    usingMemory: function () { return !!memory; },
    open: function () {
      return open().then(function (ok) {
        if (ok && root.navigator && navigator.storage && navigator.storage.persist) return navigator.storage.persist().then(function (p) { S.persistent = p; return ok; }, function () { return ok; });
        return ok;
      });
    },
    /* atomic: session + any new raw blobs in one transaction.
       opts.create = true → refuse if a session with this ID already exists (restore/new). */
    commit: function (session, raws, opts) {
      opts = opts || {}; raws = raws || [];
      var expected = session.save_seq || 0, copy = JSON.parse(JSON.stringify(session));
      copy.save_seq = expected + 1;
      var abortAfter = S.simulateFailure === 'ABORT_AFTER_WRITES'; if (abortAfter) S.simulateFailure = null;
      if (S.simulateFailure) { var n = S.simulateFailure; S.simulateFailure = null; var fe = new Error('Simulated ' + n); fe.name = n; return Promise.reject(explain(fe)); }
      if (memory) {
        var ex = memory.sessions[copy.session_id];
        if (opts.create && ex) return Promise.reject(explain({ code: 'EXISTS', message: 'Session ' + copy.session_id + ' already exists on this device; it was not overwritten.' }));
        if (!opts.create && ex && (ex.save_seq || 0) !== expected) return Promise.reject(explain({ code: 'CONFLICT', message: 'This session was changed in another tab or window. Nothing was saved. Reload the page before continuing.' }));
        raws.forEach(function (o) { if (!memory.raw[o.sha256]) memory.raw[o.sha256] = o; });
        memory.sessions[copy.session_id] = copy; session.save_seq = copy.save_seq;
        return Promise.resolve();
      }
      return new Promise(function (resolve, reject) {
        var t, failure = null;
        try { t = db.transaction(['sessions', 'raw'], 'readwrite'); } catch (e) { return reject(explain(e)); }
        var ss = t.objectStore('sessions'), rs = t.objectStore('raw');
        var g = ss.get(copy.session_id);
        g.onsuccess = function () {
          var ex = g.result;
          if (opts.create && ex) { failure = { code: 'EXISTS', message: 'Session ' + copy.session_id + ' already exists on this device; it was not overwritten.' }; t.abort(); return; }
          if (!opts.create && ex && (ex.save_seq || 0) !== expected) { failure = { code: 'CONFLICT', message: 'This session was changed in another tab or window (stored write #' + (ex.save_seq || 0) + ', this page #' + expected + '). Nothing was saved. Reload the page before continuing.' }; t.abort(); return; }
          raws.forEach(function (o) { var k = rs.getKey ? rs.getKey(o.sha256) : rs.get(o.sha256); k.onsuccess = function () { if (k.result === undefined) rs.add(o); }; });
          ss.put(copy);
          if (abortAfter) { var c = ss.count(); c.onsuccess = function () { failure = { code: 'ABORTED', message: 'Simulated interruption after the writes were queued – transaction aborted.' }; t.abort(); }; }
        };
        t.oncomplete = function () { session.save_seq = copy.save_seq; resolve(); };
        t.onerror = function (ev) { if (ev && ev.preventDefault) { /* let abort carry the error */ } };
        t.onabort = function () { reject(explain(failure || t.error)); };
      });
    },
    /* legacy single-store save (kept for metadata-only changes from older code paths) */
    saveSession: function (s) { return S.commit(s, []); },
    listSessions: function () {
      if (memory) return Promise.resolve(Object.keys(memory.sessions).map(function (k) { return JSON.parse(JSON.stringify(memory.sessions[k])); }));
      return req2p(db.transaction('sessions').objectStore('sessions').getAll()).then(function (r) { return r || []; });
    },
    getSession: function (id) {
      if (memory) return Promise.resolve(memory.sessions[id] ? JSON.parse(JSON.stringify(memory.sessions[id])) : null);
      return req2p(db.transaction('sessions').objectStore('sessions').get(id)).then(function (r) { return r || null; });
    },
    getRaw: function (sha) {
      if (memory) return Promise.resolve(memory.raw[sha] || null);
      return req2p(db.transaction('raw').objectStore('raw').get(sha)).then(function (r) { return r || null; });
    },
    rawKeys: function () {
      if (memory) return Promise.resolve(Object.keys(memory.raw));
      return req2p(db.transaction('raw').objectStore('raw').getAllKeys());
    },
    /* re-hash stored bytes: VERIFIED / MISSING / CORRUPTED (size or SHA-256 differs) */
    verifyRaw: function (f) {
      return S.getRaw(f.sha256).then(function (r) {
        if (!r || !r.data) return { status: 'MISSING', reason: 'bytes not found in browser storage' };
        var size = r.data.byteLength;
        if (size !== f.size) return { status: 'CORRUPTED', reason: 'stored ' + size + ' B, expected ' + f.size + ' B', data: r.data };
        return S.sha256(r.data).then(function (h) { return h === f.sha256 ? { status: 'VERIFIED', data: r.data } : { status: 'CORRUPTED', reason: 'SHA-256 of stored bytes differs', data: r.data }; });
      }, function (e) { return { status: 'MISSING', reason: 'read error: ' + e.message }; });
    },
    /* startup check: every raw file listed by a session exists (no re-hash – fast); blobs not referenced by any session */
    scan: function (sessions) {
      return S.rawKeys().then(function (keys) {
        var have = {}; keys.forEach(function (k) { have[k] = true; });
        var listed = {}, missing = [];
        sessions.forEach(function (s) { (s.raw_files || []).forEach(function (f) { listed[f.sha256] = true; if (!have[f.sha256] && !f.unavailable) missing.push({ session_id: s.session_id, file_id: f.file_id, filename: f.filename, sha256: f.sha256 }); }); });
        return { missing: missing, orphans: keys.filter(function (k) { return !listed[k]; }) };
      });
    },
    diagnostics: function () {
      var d = { indexeddb: !memory, persistent: null, usage: null, quota: null };
      var st = root.navigator && navigator.storage;
      var p1 = st && st.persisted ? st.persisted().then(function (v) { d.persistent = v; }, function () { }) : Promise.resolve();
      var p2 = st && st.estimate ? st.estimate().then(function (e) { d.usage = e.usage; d.quota = e.quota; }, function () { }) : Promise.resolve();
      return Promise.all([p1, p2]).then(function () { return d; });
    },
    requestPersist: function () {
      var st = root.navigator && navigator.storage;
      if (!st || !st.persist) return Promise.resolve(false);
      return st.persist().then(function (v) { S.persistent = v; return v; }, function () { return false; });
    }
  };
  S.estimate = function () { return S.diagnostics(); };
  /* SHA-256 of the original bytes (Web Crypto). The ArrayBuffer is never modified. */
  S.sha256 = function (buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); });
  };
  CR.fieldStore = S;
})(typeof window !== 'undefined' ? window : globalThis);
