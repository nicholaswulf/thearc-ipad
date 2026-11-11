// Liest die Dateiliste, die Safari beim Ordner-Auswählen liefert, in die Bibliotheksstruktur ein.
// Gleiche Regeln wie am PC: Unterordner = Genre, „Hörbücher“ = ein Ordner pro Buch,
// „Unsortiert“ erscheint mit Tag, Archiv/Cinema und Backup-Ordner (_…) bleiben draußen.
import { lib, applyIndex, saveIndex, emit } from './state.js';

const AUDIO = /\.(mp3|flac|wav|m4a|aac)$/i;
const IMAGE = /^(cover|folder|poster)\.(jpe?g|png|webp)$/i;
const SKIP = new Set(['archiv', 'cinema', '$recycle.bin', 'system volume information']);
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
export const UNSORTED = 'Unsortiert';

export function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 58% 46%)`;
}

const isBooksDir = (n) => ['hörbücher', 'hoerbuecher', 'audiobooks'].includes(n.normalize('NFC').toLowerCase());
const stripExt = (n) => n.replace(/\.[^.]+$/, '');

/** Liest eine Dateiliste ein und macht sie zur aktuellen Bibliothek. Gibt eine Kurzfassung zurück. */
export async function scanFiles(fileList) {
  const files = new Map();
  const genreCovers = new Map();
  const bookCovers = new Map();
  const tracks = [];
  const bookMap = new Map();
  let rootName = '';
  let dbFile = null;

  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/').map((p) => p.normalize('NFC'));
    if (parts.length > 1) rootName = parts[0];
    const p = parts.length > 1 ? parts.slice(1) : parts; // ohne den gewählten Wurzelordner
    const top = p[0];
    if (p.length === 2 && top === '_TheArc' && p[1] === 'thearc.sqlite') {
      dbFile = f; // Datenbank-Kopie vom Backup: für den Import von Playlists und Favoriten
      continue;
    }
    if (p.length > 1 && (SKIP.has(top.toLowerCase()) || top.startsWith('_') || top.startsWith('.'))) continue;
    if (p.length === 1 && top.startsWith('.')) continue;

    if (p.length >= 2 && isBooksDir(top)) {
      if (p.length < 3) continue; // Datei direkt im Hörbücher-Ordner gehört zu keinem Buch
      const book = p[1];
      const entry = bookMap.get(book) ?? { name: book, files: [] };
      bookMap.set(book, entry);
      if (p.length === 3 && IMAGE.test(p[2])) bookCovers.set(book, f);
      else if (AUDIO.test(f.name)) {
        const key = `${p.join('/')}|${f.size}`;
        entry.files.push({ key, path: p.join('/'), name: stripExt(f.name), size: f.size });
        files.set(key, f);
      }
      continue;
    }

    if (p.length === 2 && IMAGE.test(p[1])) {
      genreCovers.set(top, f);
      continue;
    }
    if (!AUDIO.test(f.name)) continue;
    const key = `${p.join('/')}|${f.size}`;
    const unsorted = p.length > 1 && top.toLowerCase() === UNSORTED.toLowerCase();
    tracks.push({
      key,
      path: p.join('/'),
      name: stripExt(f.name),
      genre: p.length > 1 ? (unsorted ? UNSORTED : top) : '',
      ext: f.name.split('.').pop().toLowerCase(),
      size: f.size,
      unsorted,
    });
    files.set(key, f);
  }

  tracks.sort((a, b) => collator.compare(a.name, b.name));
  const counts = new Map();
  for (const t of tracks) if (t.genre && !t.unsorted) counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
  const genres = [...counts].map(([name, count]) => ({ name, count, color: colorFor(name) })).sort((a, b) => collator.compare(a.name, b.name));
  const books = [...bookMap.values()].filter((b) => b.files.length).sort((a, b) => collator.compare(a.name, b.name));
  for (const b of books) b.files.sort((x, y) => collator.compare(x.path, y.path));

  applyIndex({ tracks, books, genres, rootName });
  lib.files = files;
  lib.genreCovers = genreCovers;
  lib.bookCovers = bookCovers;
  lib.dbFile = dbFile;
  lib.connected = true;
  await saveIndex();
  emit();
  return { tracks: tracks.length, genres: genres.length, books: books.length, total: fileList.length };
}
