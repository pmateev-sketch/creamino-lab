/* Creamino Field Session – local persistent storage (IndexedDB).
   Every change is written immediately (one transaction per action), so a closed tab, a crash or a dead
   battery loses at most the form that was being typed. Raw CSI files are stored as the original bytes,
   keyed by SHA-256, before the record that references them is saved. Nothing is ever overwritten. */
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
      req.onsuccess = function () { db = req.result; resolve(true); };
      req.onerror = function () { memory = { sessions: {}, raw: {} }; resolve(false); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      if (memory) { try { resolve(fn(null)); } catch (e) { reject(e); } return; }
      var t = db.transaction(store, mode), s = t.objectStore(store), out;
      out = fn(s);
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      t.onerror = t.onabort = function () { reject(t.error || new Error('Storage transaction failed')); };
    });
  }
  var S = {
    persistent: false,
    usingMemory: function () { return !!memory; },
    open: function () {
      return open().then(function (ok) {
        if (ok && navigator.storage && navigator.storage.persist) return navigator.storage.persist().then(function (p) { S.persistent = p; return ok; }, function () { return ok; });
        return ok;
      });
    },
    saveSession: function (s) {
      var copy = JSON.parse(JSON.stringify(s));
      if (memory) { memory.sessions[copy.session_id] = copy; return Promise.resolve(); }
      return tx('sessions', 'readwrite', function (st) { st.put(copy); });
    },
    listSessions: function () {
      if (memory) return Promise.resolve(Object.keys(memory.sessions).map(function (k) { return memory.sessions[k]; }));
      return new Promise(function (resolve, reject) {
        var r = db.transaction('sessions').objectStore('sessions').getAll();
        r.onsuccess = function () { resolve(r.result || []); }; r.onerror = function () { reject(r.error); };
      });
    },
    getSession: function (id) {
      if (memory) return Promise.resolve(memory.sessions[id] ? JSON.parse(JSON.stringify(memory.sessions[id])) : null);
      return new Promise(function (resolve, reject) {
        var r = db.transaction('sessions').objectStore('sessions').get(id);
        r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { reject(r.error); };
      });
    },
    /* raw bytes are written once and never replaced */
    putRaw: function (o) {
      if (memory) { if (!memory.raw[o.sha256]) memory.raw[o.sha256] = o; return Promise.resolve(); }
      return new Promise(function (resolve, reject) {
        var t = db.transaction('raw', 'readwrite'), st = t.objectStore('raw'), g = st.get(o.sha256);
        g.onsuccess = function () { if (!g.result) st.add(o); };
        t.oncomplete = function () { resolve(); }; t.onerror = t.onabort = function () { reject(t.error); };
      });
    },
    getRaw: function (sha) {
      if (memory) return Promise.resolve(memory.raw[sha] || null);
      return new Promise(function (resolve, reject) {
        var r = db.transaction('raw').objectStore('raw').get(sha);
        r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { reject(r.error); };
      });
    },
    estimate: function () { return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null); }
  };
  /* SHA-256 of the original bytes (Web Crypto) */
  S.sha256 = function (buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); });
  };
  CR.fieldStore = S;
})(typeof window !== 'undefined' ? window : globalThis);
