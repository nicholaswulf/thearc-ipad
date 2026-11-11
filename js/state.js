// Zentrale Daten: die eingelesene Bibliothek (lib) und alles, was nur auf dem iPad liegt (user).
import { get, set } from './db.js';

export const lib = {
  tracks: [], // Musik: { key, path, name, genre, ext, size, unsorted }
  books: [], // Hörbücher: { name, files: [{ key, path, name, size }] }
  genres: [], // { name, color, count }
  byKey: new Map(), // Musik und Hörbuch-Dateien
  files: new Map(), // key → File (nur solange der Ordner verbunden ist)
  genreCovers: new Map(), // Genre → File (cover.jpg)
  bookCovers: new Map(), // Buchname → File
  connected: false,
  rootName: '',
};

export const user = {
  favs: new Set(),
  playlists: [], // { id, name, keys: [] }
  bookmarks: {}, // Buchname → { key, pos, speed, at }
  last: null, // { keys, index, pos, source, book }
};

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () => listeners.forEach((f) => f());

export function applyIndex({ tracks, books, genres, rootName }) {
  lib.tracks = tracks;
  lib.books = books;
  lib.genres = genres;
  lib.rootName = rootName ?? '';
  lib.byKey = new Map(tracks.map((t) => [t.key, t]));
  for (const b of books) for (const f of b.files) lib.byKey.set(f.key, { ...f, book: b.name });
}

export async function loadAll() {
  const idx = await get('index');
  if (idx) applyIndex(idx);
  user.favs = new Set(await get('favs', []));
  user.playlists = await get('playlists', []);
  user.bookmarks = await get('bookmarks', {});
  user.last = await get('last', null);
}

export const saveIndex = () => set('index', { tracks: lib.tracks, books: lib.books, genres: lib.genres, rootName: lib.rootName });
export const saveFavs = () => set('favs', [...user.favs]);
export const savePlaylists = () => set('playlists', user.playlists);
export const saveBookmarks = () => set('bookmarks', user.bookmarks);
export const saveLast = () => set('last', user.last);

export const isFav = (key) => user.favs.has(key);
export function toggleFav(key) {
  user.favs.has(key) ? user.favs.delete(key) : user.favs.add(key);
  saveFavs();
  emit();
}
