/* ════════════════════════════════════════════════════════════════════
   shared.js — Universal persistence layer for the Mada & Darius apps
   ════════════════════════════════════════════════════════════════════
   Why: localStorage caps at ~5MB total. Photos as base64 blow past it
   and setItem() throws → app LOOKS like it saves but nothing persists.

   Solution: IndexedDB (hundreds of MB+) with localStorage fallback,
   plus a photo compression helper that shrinks images before storing.

   API:
     DB.get(key)              -> Promise<any|null>
     DB.set(key, value)       -> Promise<boolean>   (true = stored)
     DB.del(key)              -> Promise<boolean>
     DB.saveImage(key, file)  -> Promise<string>    (compressed dataURL)
   ──────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var DB_NAME = 'mada_love_db';
  var STORE = 'kv';
  var _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // keyPath default (key = record key)
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(mode) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var s = t.objectStore(STORE);
        t.oncomplete = function () { resolve(s); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function get(key) {
    // IndexedDB path
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var r = db.transaction(STORE).objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () {
      // fallback: localStorage
      try { return JSON.parse(localStorage.getItem('__db_' + key)) || null; }
      catch (e) { return null; }
    });
  }

  function set(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(value, key);
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { resolve(false); };
        t.onabort = function () { resolve(false); };
      });
    }).catch(function () {
      // fallback: localStorage (best effort)
      try { localStorage.setItem('__db_' + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    });
  }

  function del(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(key);
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { resolve(false); };
        t.onabort = function () { resolve(false); };
      });
    }).catch(function () {
      try { localStorage.removeItem('__db_' + key); return true; }
      catch (e) { return false; }
    });
  }

  /* Compress an image File → small JPEG dataURL.
     maxW default 1000px, quality 0.72 → ~150-300KB instead of 3-8MB. */
  function saveImage(key, file, maxW, quality) {
    maxW = maxW || 1000;
    quality = quality || 0.72;
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('Not an image file'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxW / img.width);
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          var out;
          try { out = canvas.toDataURL('image/jpeg', quality); }
          catch (e) { out = reader.result; } // safety net
          if (key) set(key, out).then(function () { resolve(out); });
          else resolve(out);
        };
        img.onerror = function () { reject(new Error('Image decode failed')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('File read failed')); };
      reader.readAsDataURL(file);
    });
  }

  global.DB = {
    get: get,
    set: set,
    del: del,
    saveImage: saveImage
  };
})(window);
