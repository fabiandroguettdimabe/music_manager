const DB_NAME = 'rsp-cache';
const STORE = 'playlists';
const VERSION = 1;

let db = null;

const openDB = () => new Promise((resolve, reject) => {
  if (db) { resolve(db); return; }
  const req = indexedDB.open(DB_NAME, VERSION);
  req.onupgradeneeded = e => {
    e.target.result.createObjectStore(STORE, { keyPath: 'id' });
  };
  req.onsuccess = e => {
    db = e.target.result;
    // Drop the cached handle if the connection closes (e.g. a version change in
    // another tab) so the next call reopens instead of throwing InvalidStateError.
    db.onclose = () => { db = null; };
    db.onversionchange = () => { try { db.close(); } catch {} db = null; };
    resolve(db);
  };
  req.onerror = () => reject(req.error);
});

export const cachePlaylist = async (id, title, tracks) => {
  try {
    const database = await openDB();
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, title, tracks, cachedAt: Date.now() });
  } catch {}
};

export const getCachedPlaylist = async (id, maxAgeMs = 86400000) => {
  try {
    const database = await openDB();
    return new Promise((resolve) => {
      const tx = database.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const r = req.result;
        if (r && Date.now() - r.cachedAt < maxAgeMs) resolve(r);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
};
