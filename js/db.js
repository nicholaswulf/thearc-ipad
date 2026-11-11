// Einfacher Speicher in IndexedDB (Schlüssel → Wert). Hält Index, Favoriten, Playlists und Lesezeichen.
const NAME = 'thearc-ipad';
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

export async function get(key, fallback = null) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result ?? fallback);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', key, e);
  }
}

/** Bittet iOS, die Daten nicht automatisch zu löschen. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
