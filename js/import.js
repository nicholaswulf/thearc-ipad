// Übernimmt Playlists, Favoriten und Hörbuch-Lesezeichen aus der Desktop-App.
// Quelle ist die Kopie der Datenbank, die das Backup auf die Platte legt: _TheArc/thearc.sqlite.
// Es wird nur gelesen; vorhandene Daten auf dem iPad bleiben, Neues wird ergänzt.
import { lib, user, savePlaylists, saveFavs, saveBookmarks, emit } from './state.js';
import { get, set } from './db.js';

let sqlReady;
function loadSql() {
  sqlReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/sql-wasm.js';
    s.onload = () => window.initSqlJs({ locateFile: (f) => `vendor/${f}` }).then(resolve, reject);
    s.onerror = () => reject(new Error('sql.js konnte nicht geladen werden'));
    document.head.append(s);
  });
  return sqlReady;
}

const norm = (p) => p.replace(/\\/g, '/').normalize('NFC');
const keyOf = (t) => `${norm(t.rel_path)}|${t.size}`;

function rows(db, sql) {
  const res = db.exec(sql)[0];
  if (!res) return [];
  return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
}

/** Liest die Datenbank-Datei und ergänzt Playlists, Favoriten und Lesezeichen. Gibt eine Zusammenfassung zurück. */
export async function importFromDb(file) {
  const SQL = await loadSql();
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const tracks = rows(db, 'SELECT id, rel_path, size FROM tracks WHERE missing = 0');
    const keyById = new Map(tracks.map((t) => [t.id, keyOf(t)]));
    const valid = (key) => key && lib.byKey.has(key);
    const result = { playlists: 0, playlistSongs: 0, favorites: 0, bookmarks: 0 };

    // Favoriten
    for (const f of rows(db, 'SELECT track_id FROM favorites')) {
      const key = keyById.get(f.track_id);
      if (valid(key) && !user.favs.has(key)) {
        user.favs.add(key);
        result.favorites++;
      }
    }

    // Playlists: gleicher Name = zusammenführen
    const items = rows(db, 'SELECT playlist_id, track_id, pos FROM playlist_items ORDER BY pos');
    for (const p of rows(db, 'SELECT id, name FROM playlists ORDER BY id')) {
      const keys = items.filter((i) => i.playlist_id === p.id).map((i) => keyById.get(i.track_id)).filter(valid);
      if (!keys.length) continue;
      let pl = user.playlists.find((x) => x.name === p.name);
      if (!pl) {
        pl = { id: Date.now() + result.playlists, name: p.name, keys: [] };
        user.playlists.push(pl);
        result.playlists++;
      }
      for (const k of keys)
        if (!pl.keys.includes(k)) {
          pl.keys.push(k);
          result.playlistSongs++;
        }
    }

    // Hörbuch-Lesezeichen: nur übernehmen, wenn neuer als das lokale
    for (const b of rows(db, 'SELECT book, track_id, position, speed, updated_at FROM bookmarks')) {
      const key = keyById.get(b.track_id);
      if (!valid(key) || !lib.books.some((x) => x.name === b.book)) continue;
      const at = Number(b.updated_at) || 0;
      const local = user.bookmarks[b.book];
      if (!local || at > local.at) {
        user.bookmarks[b.book] = { key, pos: Number(b.position) || 0, speed: Number(b.speed) || 1, at };
        result.bookmarks++;
      }
    }

    await Promise.all([savePlaylists(), saveFavs(), saveBookmarks()]);
    emit();
    return result;
  } finally {
    db.close();
  }
}

/** Importiert nur, wenn die Datenbank-Datei neuer ist als beim letzten Mal (Standard) oder wenn force gesetzt ist. */
export async function maybeImport(file, { force = false } = {}) {
  const stamp = file.lastModified;
  const last = await get('importStamp', 0);
  if (!force && stamp === last) return null;
  const r = await importFromDb(file);
  await set('importStamp', stamp);
  return r;
}
