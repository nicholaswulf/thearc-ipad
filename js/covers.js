// Cover: zuerst das eingebettete Bild (MP3/FLAC), sonst cover.jpg aus dem Genre- bzw. Buchordner.
// Es wird immer nur der Anfang der Datei gelesen, und höchstens zwei Dateien gleichzeitig.
import { lib } from './state.js';

const cache = new Map(); // key → Promise<url|null>
const MAX_CACHE = 400;
let running = 0;
const waiting = [];

function limit(fn) {
  return new Promise((resolve) => {
    const run = async () => {
      running++;
      try {
        resolve(await fn());
      } catch {
        resolve(null);
      } finally {
        running--;
        waiting.shift()?.();
      }
    };
    running < 2 ? run() : waiting.push(run);
  });
}

const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const read = async (file, from, to) => new Uint8Array(await file.slice(from, to).arrayBuffer());

async function id3Picture(file) {
  const head = await read(file, 0, 10);
  if (String.fromCharCode(head[0], head[1], head[2]) !== 'ID3') return null;
  const ver = head[3];
  const size = Math.min(syncsafe(head, 6), 6 * 1024 * 1024);
  const tag = await read(file, 10, 10 + size);
  let o = 0;
  while (o + 10 < tag.length) {
    const id = String.fromCharCode(tag[o], tag[o + 1], tag[o + 2], tag[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? syncsafe(tag, o + 4) : be32(tag, o + 4);
    if (id === 'APIC') {
      let p = o + 10;
      const enc = tag[p++];
      let mimeEnd = p;
      while (mimeEnd < tag.length && tag[mimeEnd] !== 0) mimeEnd++;
      const mime = String.fromCharCode(...tag.slice(p, mimeEnd)) || 'image/jpeg';
      p = mimeEnd + 2; // Nullbyte + Bildtyp
      if (enc === 1 || enc === 2) {
        while (p + 1 < tag.length && !(tag[p] === 0 && tag[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < tag.length && tag[p] !== 0) p++;
        p++;
      }
      const data = tag.slice(p, o + 10 + len);
      return data.length ? new Blob([data], { type: mime.includes('/') ? mime : 'image/' + mime }) : null;
    }
    if (len <= 0) break;
    o += 10 + len;
  }
  return null;
}

async function flacPicture(file) {
  const chunk = await read(file, 0, 8 * 1024 * 1024);
  if (String.fromCharCode(chunk[0], chunk[1], chunk[2], chunk[3]) !== 'fLaC') return null;
  let o = 4;
  while (o + 4 < chunk.length) {
    const last = chunk[o] & 0x80;
    const type = chunk[o] & 0x7f;
    const len = (chunk[o + 1] << 16) | (chunk[o + 2] << 8) | chunk[o + 3];
    if (type === 6) {
      let p = o + 4 + 4;
      const mimeLen = be32(chunk, p);
      p += 4;
      const mime = String.fromCharCode(...chunk.slice(p, p + mimeLen));
      p += mimeLen;
      p += 4 + be32(chunk, p); // Beschreibung
      p += 16; // Breite, Höhe, Tiefe, Farben
      const dataLen = be32(chunk, p);
      p += 4;
      const data = chunk.slice(p, p + dataLen);
      return data.length === dataLen ? new Blob([data], { type: mime }) : null;
    }
    o += 4 + len;
    if (last) break;
  }
  return null;
}

async function embedded(file, ext) {
  if (ext === 'mp3') return id3Picture(file);
  if (ext === 'flac') return flacPicture(file);
  return null;
}

function fallbackFile(item) {
  if (item.book) return lib.bookCovers.get(item.book);
  return item.genre ? lib.genreCovers.get(item.genre) : null;
}

/** Liefert eine Bild-URL für den Titel (oder null). Ergebnisse werden zwischengespeichert. */
export function coverFor(item) {
  if (!item) return Promise.resolve(null);
  const k = item.key;
  if (cache.has(k)) return cache.get(k);
  const file = lib.files.get(k);
  const p = limit(async () => {
    let blob = null;
    if (file) blob = await embedded(file, (item.ext || file.name.split('.').pop() || '').toLowerCase());
    if (!blob) blob = fallbackFile(item);
    return blob ? URL.createObjectURL(blob) : null;
  });
  cache.set(k, p);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.get(oldest)?.then((u) => u && URL.revokeObjectURL(u));
    cache.delete(oldest);
  }
  return p;
}

/** Bild für ein Genre oder Buch (cover.jpg im Ordner). */
export function folderCover(kind, name) {
  const f = (kind === 'book' ? lib.bookCovers : lib.genreCovers).get(name);
  if (!f) return null;
  const k = `${kind}:${name}`;
  if (!cache.has(k)) cache.set(k, Promise.resolve(URL.createObjectURL(f)));
  return cache.get(k);
}

export function clearCovers() {
  for (const p of cache.values()) p.then((u) => u && URL.revokeObjectURL(u));
  cache.clear();
}
