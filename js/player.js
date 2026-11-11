// Player: ein einziges Audio-Element (nötig, damit iOS im Hintergrund weiterspielt), Warteschlange,
// Hörbuch-Lesezeichen und Sperrbildschirm-Steuerung über die Media Session.
import { lib, user, saveBookmarks, saveLast, emit as emitState } from './state.js';
import { coverFor } from './covers.js';

const audio = new Audio();
audio.preload = 'auto';

export const P = {
  queue: [],
  orig: [],
  index: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  source: '',
  book: null, // Name des laufenden Hörbuchs
  speed: 1,
  playing: false,
};

const listeners = new Set();
export const onPlayer = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (what) => listeners.forEach((f) => f(what));

let needFolder = null;
export const setNeedFolderHandler = (fn) => (needFolder = fn);

export const current = () => lib.byKey.get(P.queue[P.index]) ?? null;
export const elapsed = () => audio.currentTime || 0;
export const length = () => (isFinite(audio.duration) ? audio.duration : 0);

let url = null;
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Startet eine Liste. opts: { start (Index), shuffle, source, book } */
export function playList(keys, { start = 0, shuffle = false, source = '', book = null, pos = 0 } = {}) {
  if (!keys.length) return;
  saveBook(); // bisheriges Hörbuch an der aktuellen Stelle merken
  P.book = book;
  P.source = source;
  P.orig = keys.slice();
  P.shuffle = !book && shuffle;
  if (P.shuffle) {
    const first = keys[start];
    P.queue = [first, ...shuffled(keys.filter((_, i) => i !== start))];
    P.index = 0;
  } else {
    P.queue = keys.slice();
    P.index = start;
  }
  if (book) P.speed = user.bookmarks[book]?.speed ?? 1;
  load(P.queue[P.index], { pos });
}

async function load(key, { pos = 0, autoplay = true } = {}) {
  const file = lib.files.get(key);
  if (!file) {
    needFolder?.(() => load(key, { pos, autoplay }));
    emit('needfolder');
    return false;
  }
  const old = url;
  url = URL.createObjectURL(file);
  audio.src = url;
  if (old) setTimeout(() => URL.revokeObjectURL(old), 4000);
  audio.playbackRate = P.book ? P.speed : 1;
  if (P.book) {
    // Lesezeichen sofort auf den neuen Teil setzen (Position folgt alle 5 s und beim Pausieren)
    user.bookmarks[P.book] = { key, pos, speed: P.speed, at: Date.now() };
    saveBookmarks();
  }
  if (pos > 0) audio.addEventListener('loadedmetadata', () => (audio.currentTime = Math.min(pos, (audio.duration || pos) - 1)), { once: true });
  if (autoplay) {
    try {
      await audio.play();
    } catch (e) {
      if (e.name !== 'AbortError') emit('error');
    }
  }
  updateSession();
  persistLast();
  emit('track');
  return true;
}

export function toggle() {
  if (!audio.src) return;
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}
export function pause() {
  audio.pause();
}
export function seek(t) {
  audio.currentTime = Math.max(0, Math.min(t, length() || t));
}
export function skip(sec) {
  seek(elapsed() + sec);
}

export function next({ auto = false } = {}) {
  if (!P.queue.length) return;
  if (!auto) saveBook();
  if (auto && P.repeat === 'one') return load(P.queue[P.index]);
  let i = P.index + 1;
  if (i >= P.queue.length) {
    if (P.book) return finishBook();
    if (P.repeat === 'all' || !auto) i = 0;
    else {
      audio.pause();
      emit('state');
      return;
    }
  }
  P.index = i;
  load(P.queue[i]);
}

export function prev() {
  if (!P.queue.length) return;
  if (elapsed() > 3 || P.index === 0) return seek(0);
  saveBook();
  P.index--;
  load(P.queue[P.index]);
}

export function setShuffle(on) {
  if (P.book) return;
  const cur = P.queue[P.index];
  P.shuffle = on;
  if (on) {
    P.queue = [cur, ...shuffled(P.orig.filter((k) => k !== cur))];
    P.index = 0;
  } else {
    P.queue = P.orig.slice();
    P.index = Math.max(0, P.queue.indexOf(cur));
  }
  emit('state');
}
export function cycleRepeat() {
  P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off';
  emit('state');
}
export function setSpeed(v) {
  P.speed = v;
  if (P.book) audio.playbackRate = v;
  saveBook();
  emit('state');
}

// ---------- Hörbuch-Lesezeichen ----------
function saveBook() {
  if (!P.book || !audio.src) return;
  const key = P.queue[P.index];
  if (!key) return;
  user.bookmarks[P.book] = { key, pos: elapsed(), speed: P.speed, at: Date.now() };
  saveBookmarks();
}
function finishBook() {
  audio.pause();
  delete user.bookmarks[P.book];
  saveBookmarks();
  P.book = null;
  emit('state');
  emitState();
}

export function resumeBook(book) {
  const b = lib.books.find((x) => x.name === book);
  if (!b) return;
  const keys = b.files.map((f) => f.key);
  const bm = user.bookmarks[book];
  const idx = bm ? Math.max(0, keys.indexOf(bm.key)) : 0;
  playList(keys, { start: idx, book, source: book, pos: bm ? Math.max(0, bm.pos - 15) : 0 });
}

export function resetBook(book) {
  delete user.bookmarks[book];
  saveBookmarks();
  emitState();
}

function persistLast() {
  user.last = { keys: P.orig, queue: P.queue, index: P.index, source: P.source, book: P.book, shuffle: P.shuffle, pos: elapsed() };
  saveLast();
}

/** Stellt die zuletzt gespielte Warteschlange wieder her (pausiert, sobald der Ordner verbunden ist). */
export function restoreLast() {
  const l = user.last;
  if (!l?.queue?.length || audio.src || !lib.files.get(l.queue[Math.min(l.index ?? 0, l.queue.length - 1)])) return false;
  P.orig = l.keys ?? l.queue;
  P.queue = l.queue;
  P.index = Math.min(l.index ?? 0, l.queue.length - 1);
  P.source = l.source ?? '';
  P.book = l.book ?? null;
  P.shuffle = !!l.shuffle;
  if (P.book) P.speed = user.bookmarks[P.book]?.speed ?? 1;
  load(P.queue[P.index], { pos: l.pos ?? 0, autoplay: false });
  return true;
}

// ---------- Audio-Ereignisse ----------
audio.addEventListener('play', () => ((P.playing = true), emit('state'), updateState()));
audio.addEventListener('pause', () => ((P.playing = false), saveBook(), persistLast(), emit('state'), updateState()));
audio.addEventListener('ended', () => next({ auto: true }));
audio.addEventListener('timeupdate', () => emit('time'));
audio.addEventListener('loadedmetadata', () => emit('time'));
audio.addEventListener('error', () => {
  emit('error');
  if (P.queue.length > 1) setTimeout(() => next({ auto: true }), 600);
});
setInterval(() => {
  if (!P.playing) return;
  saveBook();
  persistLast();
}, 5000);
window.addEventListener('pagehide', () => (saveBook(), persistLast()));

// ---------- Sperrbildschirm ----------
const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
function updateState() {
  if (ms) ms.playbackState = P.playing ? 'playing' : 'paused';
}
async function updateSession() {
  const t = current();
  if (!ms || !t) return;
  ms.metadata = new MediaMetadata({ title: t.name, artist: P.book ? t.book : t.genre || 'TheArc', album: P.source || '' });
  const cover = await coverFor(t);
  if (cover && current()?.key === t.key) ms.metadata = new MediaMetadata({ title: t.name, artist: P.book ? t.book : t.genre || 'TheArc', album: P.source || '', artwork: [{ src: cover }] });
}
if (ms) {
  const set = (a, f) => {
    try {
      ms.setActionHandler(a, f);
    } catch {}
  };
  set('play', () => toggle());
  set('pause', () => pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekbackward', () => skip(P.book ? -15 : -10));
  set('seekforward', () => skip(P.book ? 30 : 10));
  set('seekto', (d) => d.seekTime != null && seek(d.seekTime));
}

export { audio };
