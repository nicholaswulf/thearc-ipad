// TheArc fürs iPad: Musik und Hörbücher abspielen. Nur Hören – sortiert wird weiter am PC.
import { h, icon, fmtTime, plural, openSheet, toast, VList } from './ui.js';
import { lib, user, loadAll, onChange, isFav, toggleFav, savePlaylists, emit } from './state.js';
import { scanFiles, UNSORTED, colorFor } from './scan.js';
import { requestPersistence } from './db.js';
import { maybeImport } from './import.js';
import { coverFor, folderCover } from './covers.js';
import * as player from './player.js';
import { P } from './player.js';

const ROW_H = 64;
const nav = { tab: 'songs', sub: null }; // sub: { type: 'genre'|'playlist', id }
const view = { query: '', favOnly: false, genre: null };
let page = null; // aktuelle Seite { destroy(), refresh(), focus(key) }

// ---------- Grundgerüst ----------
const scroller = h('main', { class: 'content' });
const headerEl = h('header', { class: 'top' });
const miniEl = h('div', { class: 'mini', hidden: true });
const tabsEl = h('nav', { class: 'tabs' });
const picker = h('input', { type: 'file', webkitdirectory: true, multiple: true, class: 'hidden' });
const app = h('div', { class: 'app' }, headerEl, scroller, miniEl, tabsEl, picker);
document.body.append(app);

const TABS = [
  ['songs', 'Lieder', 'music'],
  ['genres', 'Genres', 'grid'],
  ['playlists', 'Playlists', 'list'],
  ['books', 'Hörbücher', 'book'],
];

// ---------- Ordner verbinden ----------
let pending = null;
function ensureConnected(fn) {
  if (lib.connected) return fn();
  pending = fn;
  picker.click(); // muss direkt aus dem Tippen heraus passieren, sonst blockiert Safari
}
player.setNeedFolderHandler((retry) => {
  pending = retry;
  toast('Bitte den Musik-Ordner auf der Platte wählen');
  picker.click();
});
picker.addEventListener('change', async () => {
  const files = picker.files;
  if (!files?.length) return;
  toast('Ordner wird gelesen …');
  const t0 = performance.now();
  const r = await scanFiles(files);
  picker.value = '';
  toast(`${plural(r.tracks, 'Song', 'Songs')} in ${plural(r.genres, 'Genre', 'Genres')} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  requestPersistence();
  await importFromPc();
  const fn = pending;
  pending = null;
  if (fn) fn();
  else player.restoreLast();
  render();
});
const pickFolder = () => picker.click();

// Playlists, Favoriten und Lesezeichen aus der Backup-Datenbank der Platte übernehmen
async function importFromPc({ force = false } = {}) {
  if (!lib.dbFile) {
    if (force) toast('Auf der Platte ist keine Backup-Datenbank (_TheArc) gefunden worden');
    return;
  }
  try {
    const r = await maybeImport(lib.dbFile, { force });
    if (!r) return force && toast('Schon auf dem neuesten Stand');
    const parts = [r.playlists && plural(r.playlists, 'Playlist', 'Playlists'), r.favorites && plural(r.favorites, 'Favorit', 'Favoriten'), r.bookmarks && plural(r.bookmarks, 'Lesezeichen', 'Lesezeichen')].filter(Boolean);
    toast(parts.length ? `Vom PC übernommen: ${parts.join(', ')}` : 'Vom PC: nichts Neues');
  } catch (e) {
    toast('Import vom PC fehlgeschlagen');
    console.warn(e);
  }
}

// ---------- Hilfen ----------
const trackOf = (key) => lib.byKey.get(key);
const sourceLabel = () => (nav.sub?.type === 'genre' ? nav.sub.id : nav.sub?.type === 'playlist' ? playlistOf(nav.sub.id)?.name : 'Alle Lieder');
const playlistOf = (id) => user.playlists.find((p) => p.id === id);

function thumb(item, size = 48) {
  const color = item.genre ? colorFor(item.genre) : '#6b6259';
  const box = h('div', { class: 'thumb', style: `width:${size}px;height:${size}px;--g:${color}` }, icon('music', size * 0.4));
  coverFor(item).then((url) => {
    if (url && box.isConnected) box.replaceChildren(h('img', { src: url, alt: '' }));
  });
  return box;
}

function coverBox(kind, name, color, size) {
  const box = h('div', { class: 'thumb', style: `width:${size}px;height:${size}px;--g:${color}` }, icon(kind === 'book' ? 'book' : 'grid', size * 0.4));
  const p = folderCover(kind, name);
  p?.then((url) => url && box.isConnected && box.replaceChildren(h('img', { src: url, alt: '' })));
  return box;
}

function addToPlaylistSheet(keys) {
  openSheet('Zu Playlist hinzufügen', [
    ...user.playlists.map((pl) => ({
      label: pl.name,
      icon: 'list',
      action: () => {
        for (const k of keys) if (!pl.keys.includes(k)) pl.keys.push(k);
        savePlaylists();
        toast(`Zu „${pl.name}“ hinzugefügt`);
        emit();
      },
    })),
    {
      label: 'Neue Playlist …',
      icon: 'plus',
      action: () => {
        const pl = newPlaylist();
        if (pl) {
          pl.keys.push(...keys);
          savePlaylists();
          toast(`Playlist „${pl.name}“ angelegt`);
          emit();
        }
      },
    },
  ]);
}

function newPlaylist() {
  const name = prompt('Name der Playlist')?.trim();
  if (!name) return null;
  const pl = { id: Date.now(), name, keys: [] };
  user.playlists.push(pl);
  savePlaylists();
  emit();
  return pl;
}

function trackMenu(t, ctx) {
  openSheet(t.name, [
    { label: 'Abspielen', icon: 'play', action: () => ctx.play(t) },
    { label: isFav(t.key) ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: 'heart', action: () => toggleFav(t.key) },
    { label: 'Zu Playlist hinzufügen …', icon: 'list', action: () => addToPlaylistSheet([t.key]) },
    ctx.removeFrom ? { label: 'Aus dieser Playlist entfernen', icon: 'x', danger: true, action: () => ctx.removeFrom(t) } : null,
  ]);
}

// ---------- Song-Liste (Alle Lieder, Genre, Playlist) ----------
function songList({ tracks, source, removeFrom = null, showGenre = true }) {
  const items = tracks();
  const ctx = {
    items,
    removeFrom,
    play(t, i) {
      const idx = i ?? ctx.items.indexOf(t);
      ensureConnected(() => player.playList(ctx.items.map((x) => x.key), { start: Math.max(0, idx), source: source() }));
    },
  };
  const list = new VList({
    scroller,
    rowH: ROW_H,
    render: (t, i) =>
      h(
        'div',
        { class: `row${P.queue[P.index] === t.key && !P.book ? ' playing' : ''}${lib.connected ? '' : ' offline'}`, dataset: { key: t.key } },
        h('span', { class: 'pos' }, String(i + 1)),
        thumb(t),
        h(
          'div',
          { class: 'row-text' },
          h('div', { class: 'row-name' }, t.name),
          showGenre && t.genre ? h('div', { class: 'row-sub' }, h('i', { style: `background:${colorFor(t.genre)}` }), t.genre) : null,
        ),
        h('button', { class: `heart${isFav(t.key) ? ' on' : ''}`, 'aria-label': 'Favorit', onClick: (e) => (e.stopPropagation(), toggleFav(t.key)) }, icon('heart', 20)),
        h('button', { class: 'more', 'aria-label': 'Mehr', onClick: (e) => (e.stopPropagation(), trackMenu(t, ctx)) }, icon('more', 20)),
      ),
  });
  list.el.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const t = trackOf(row.dataset.key);
    if (t) ctx.play(t);
  });
  return {
    el: list.el,
    list,
    ctx,
    set(newItems) {
      ctx.items = newItems;
      list.setItems(newItems);
    },
    destroy: () => list.destroy(),
  };
}

function refreshPlayingRows() {
  const cur = P.book ? null : P.queue[P.index];
  document.querySelectorAll('.vrow.row').forEach((r) => r.classList.toggle('playing', r.dataset.key === cur));
}

function filteredTracks() {
  const q = view.query.trim().toLowerCase();
  return lib.tracks.filter((t) => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (view.favOnly && !isFav(t.key)) return false;
    if (view.genre && t.genre !== view.genre) return false;
    return true;
  });
}

// ---------- Seiten ----------
function emptyState() {
  return h(
    'div',
    { class: 'empty' },
    icon('folder', 44),
    h('h2', {}, 'Musik-Ordner wählen'),
    h('p', {}, 'Schließe die Platte ans iPad an und wähle in „Dateien“ den Ordner mit deiner Musik. Die App liest die Titel einmal ein und merkt sie sich.'),
    h('button', { class: 'btn primary', onClick: pickFolder }, icon('folder', 20), 'Ordner wählen'),
  );
}

function offlineBanner() {
  if (lib.connected || !lib.tracks.length) return null;
  return h(
    'button',
    { class: 'banner', onClick: pickFolder },
    icon('folder', 20),
    h('span', {}, 'Platte nicht verbunden. Zum Abspielen den Ordner wählen.'),
  );
}

function songsPage() {
  const sl = songList({ tracks: filteredTracks, source: () => 'Alle Lieder' });
  const stats = h('p', { class: 'stats' });
  const genreChip = h('button', { class: 'chip', onClick: genreSheet }, 'Alle Genres', icon('down', 14));
  const favChip = h('button', { class: 'chip', onClick: () => ((view.favOnly = !view.favOnly), sync()) }, icon('heart', 15), 'Favoriten');
  const locate = h('button', { class: 'chip', onClick: () => focusCurrent() }, icon('locate', 15), 'Zum Song');
  const shuffleBtn = h('button', { class: 'btn primary small', onClick: () => startShuffle() }, icon('shuffle', 18), 'Zufällig');
  const search = h('input', { class: 'search-input', type: 'search', placeholder: 'Songs suchen …', value: view.query });
  search.addEventListener('input', () => ((view.query = search.value), sync()));
  const toolbar = h('div', { class: 'toolbar' }, shuffleBtn, favChip, genreChip, locate);

  function genreSheet() {
    openSheet('Genre', [
      { label: 'Alle Genres', check: !view.genre, action: () => ((view.genre = null), sync()) },
      ...lib.genres.map((g) => ({ label: `${g.name} · ${g.count}`, check: view.genre === g.name, action: () => ((view.genre = g.name), sync()) })),
      lib.tracks.some((t) => t.unsorted) ? { label: UNSORTED, check: view.genre === UNSORTED, action: () => ((view.genre = UNSORTED), sync()) } : null,
    ]);
  }
  function startShuffle() {
    const items = sl.ctx.items.filter(Boolean);
    if (items.length) ensureConnected(() => player.playList(items.map((t) => t.key), { start: Math.floor(Math.random() * items.length), shuffle: true, source: 'Alle Lieder' }));
  }
  function sync() {
    const items = filteredTracks();
    sl.set(items);
    stats.textContent = `${plural(items.length, 'Song', 'Songs')}${items.length !== lib.tracks.length ? ` von ${lib.tracks.length.toLocaleString('de-DE')}` : ''}`;
    favChip.classList.toggle('active', view.favOnly);
    genreChip.firstChild.textContent = view.genre ?? 'Alle Genres';
    genreChip.classList.toggle('active', !!view.genre);
  }
  function focusCurrent() {
    const key = P.queue[P.index];
    const i = sl.ctx.items.findIndex((t) => t.key === key);
    if (i < 0) return toast('Der laufende Song ist in dieser Ansicht nicht enthalten');
    sl.list.scrollToIndex(i);
  }
  headerEl.replaceChildren(h('h1', {}, 'Lieder'), h('div', { class: 'grow' }), folderBtn());
  const head = h('div', { class: 'page-head' }, search, stats, toolbar, offlineBanner());
  scroller.replaceChildren(head, sl.el);
  sync();
  return { refresh: sync, destroy: sl.destroy, focus: focusCurrent };
}

function genresPage() {
  headerEl.replaceChildren(h('h1', {}, 'Genres'), h('div', { class: 'grow' }), folderBtn());
  const unsorted = lib.tracks.filter((t) => t.unsorted).length;
  const cards = lib.genres.map((g) =>
    h('button', { class: 'card', onClick: () => go('genres', { type: 'genre', id: g.name }) }, coverBox('genre', g.name, g.color, 140), h('div', { class: 'card-title' }, g.name), h('div', { class: 'card-sub' }, plural(g.count, 'Titel', 'Titel'))),
  );
  if (unsorted)
    cards.push(
      h('button', { class: 'card', onClick: () => go('genres', { type: 'genre', id: UNSORTED }) }, coverBox('genre', UNSORTED, '#6b6259', 140), h('div', { class: 'card-title' }, UNSORTED), h('div', { class: 'card-sub' }, plural(unsorted, 'Titel', 'Titel'))),
    );
  scroller.replaceChildren(offlineBanner() ?? '', h('div', { class: 'grid' }, cards));
  return { refresh() {}, destroy() {} };
}

function genrePage(name) {
  const get = () => lib.tracks.filter((t) => (name === UNSORTED ? t.unsorted : t.genre === name && !t.unsorted));
  const sl = songList({ tracks: get, source: () => name, showGenre: false });
  headerEl.replaceChildren(backBtn('genres'), h('h1', {}, name), h('div', { class: 'grow' }), folderBtn());
  const items = get();
  const play = (shuffle) => ensureConnected(() => player.playList(items.map((t) => t.key), { start: shuffle ? Math.floor(Math.random() * items.length) : 0, shuffle, source: name }));
  const head = h(
    'div',
    { class: 'page-head' },
    h('p', { class: 'stats' }, plural(items.length, 'Titel', 'Titel')),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary small', onClick: () => play(false) }, icon('play', 18), 'Abspielen'), h('button', { class: 'btn small', onClick: () => play(true) }, icon('shuffle', 18), 'Zufällig')),
    offlineBanner(),
  );
  scroller.replaceChildren(head, sl.el);
  sl.set(items);
  return { refresh: () => sl.set(get()), destroy: sl.destroy };
}

function playlistsPage() {
  headerEl.replaceChildren(h('h1', {}, 'Playlists'), h('div', { class: 'grow' }), h('button', { class: 'icon-btn', 'aria-label': 'Neue Playlist', onClick: () => newPlaylist() }, icon('plus', 22)), folderBtn());
  const rows = user.playlists.map((pl) =>
    h(
      'button',
      { class: 'list-row', onClick: () => go('playlists', { type: 'playlist', id: pl.id }) },
      h('div', { class: 'thumb', style: `width:52px;height:52px;--g:${colorFor(pl.name)}` }, icon('list', 22)),
      h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, pl.name), h('div', { class: 'row-sub' }, plural(pl.keys.length, 'Titel', 'Titel'))),
    ),
  );
  scroller.replaceChildren(
    rows.length
      ? h('div', { class: 'list' }, rows)
      : h('div', { class: 'empty small' }, h('p', {}, 'Noch keine Playlists. Lege eine an (Plus oben) oder wähle bei einem Song „Zu Playlist hinzufügen“. Playlists liegen nur auf diesem iPad.')),
  );
  return { refresh: playlistsPage, destroy() {} };
}

function playlistPage(id) {
  const pl = playlistOf(id);
  if (!pl) return (nav.sub = null), playlistsPage();
  const get = () => (playlistOf(id)?.keys ?? []).map(trackOf).filter(Boolean);
  const sl = songList({
    tracks: get,
    source: () => pl.name,
    removeFrom: (t) => {
      pl.keys = pl.keys.filter((k) => k !== t.key);
      savePlaylists();
      emit();
    },
  });
  headerEl.replaceChildren(
    backBtn('playlists'),
    h('h1', {}, pl.name),
    h('div', { class: 'grow' }),
    h(
      'button',
      {
        class: 'icon-btn',
        'aria-label': 'Mehr',
        onClick: () =>
          openSheet(pl.name, [
            { label: 'Umbenennen …', action: () => ((pl.name = prompt('Neuer Name', pl.name)?.trim() || pl.name), savePlaylists(), emit()) },
            { label: 'Playlist löschen', danger: true, action: () => (confirm(`„${pl.name}“ löschen? Die Songs bleiben erhalten.`) && ((user.playlists = user.playlists.filter((p) => p.id !== id)), savePlaylists(), go('playlists', null))) },
          ]),
      },
      icon('more', 22),
    ),
  );
  const items = get();
  const play = (shuffle) => ensureConnected(() => player.playList(items.map((t) => t.key), { start: shuffle ? Math.floor(Math.random() * items.length) : 0, shuffle, source: pl.name }));
  scroller.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('p', { class: 'stats' }, plural(items.length, 'Titel', 'Titel')),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary small', onClick: () => play(false) }, icon('play', 18), 'Abspielen'), h('button', { class: 'btn small', onClick: () => play(true) }, icon('shuffle', 18), 'Zufällig')),
      offlineBanner(),
    ),
    sl.el,
  );
  sl.set(items);
  return { refresh: () => sl.set(get()), destroy: sl.destroy };
}

function booksPage() {
  headerEl.replaceChildren(h('h1', {}, 'Hörbücher'), h('div', { class: 'grow' }), folderBtn());
  const rows = lib.books.map((b) => {
    const bm = user.bookmarks[b.name];
    const idx = bm ? b.files.findIndex((f) => f.key === bm.key) : -1;
    const running = P.book === b.name;
    const status = bm && idx >= 0 ? `Weiter bei Teil ${idx + 1} von ${b.files.length} · ${fmtTime(bm.pos)}` : plural(b.files.length, 'Teil', 'Teile');
    const pct = bm && idx >= 0 ? Math.round(((idx + (bm.pos > 0 ? 0.5 : 0)) / b.files.length) * 100) : 0;
    return h(
      'div',
      { class: `list-row${running ? ' playing' : ''}`, onClick: () => ensureConnected(() => (running ? player.toggle() : player.resumeBook(b.name))) },
      coverBox('book', b.name, colorFor(b.name), 64),
      h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, b.name), h('div', { class: 'row-sub' }, status), pct ? h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })) : null),
      h(
        'button',
        {
          class: 'more',
          'aria-label': 'Mehr',
          onClick: (e) => {
            e.stopPropagation();
            openSheet(b.name, [
              { label: bm ? 'Fortsetzen' : 'Abspielen', icon: 'play', action: () => ensureConnected(() => player.resumeBook(b.name)) },
              bm ? { label: 'Status zurücksetzen', icon: 'back15', danger: true, action: () => (player.resetBook(b.name), toast('Lesezeichen zurückgesetzt')) } : null,
            ]);
          },
        },
        icon('more', 20),
      ),
    );
  });
  scroller.replaceChildren(
    offlineBanner() ?? '',
    rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'empty small' }, h('p', {}, 'Keine Hörbücher gefunden. Sie liegen im Ordner „Hörbücher“ (ein Ordner pro Buch).')),
  );
  return { refresh: booksPage, destroy() {} };
}

// ---------- Navigation ----------
function folderBtn() {
  return h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Ordner',
      title: lib.rootName ? `Ordner: ${lib.rootName}` : 'Ordner wählen',
      onClick: () =>
        openSheet(lib.rootName ? `Ordner: ${lib.rootName}` : 'Ordner', [
          { label: 'Ordner neu wählen', icon: 'folder', action: pickFolder },
          { label: 'Playlists & Favoriten vom PC übernehmen', icon: 'list', action: () => (lib.connected ? importFromPc({ force: true }) : toast('Erst den Ordner auf der Platte wählen')) },
        ]),
    },
    icon('folder', 22),
  );
}
function backBtn(tab) {
  return h('button', { class: 'icon-btn back', 'aria-label': 'Zurück', onClick: () => go(tab, null) }, icon('down', 24));
}
function go(tab, sub) {
  nav.tab = tab;
  nav.sub = sub;
  scroller.scrollTop = 0;
  render();
}

function renderTabs() {
  tabsEl.replaceChildren(
    ...TABS.map(([id, label, ic]) =>
      h('button', { class: `tab${nav.tab === id ? ' active' : ''}`, onClick: () => (nav.tab === id && !nav.sub ? (scroller.scrollTop = 0) : go(id, null)) }, icon(ic, 24), h('span', {}, label)),
    ),
  );
}

function render() {
  page?.destroy?.();
  renderTabs();
  if (!lib.tracks.length && !lib.books.length) {
    headerEl.replaceChildren(h('h1', {}, 'TheArc'));
    scroller.replaceChildren(emptyState());
    page = null;
    renderMini();
    return;
  }
  if (nav.tab === 'songs') page = songsPage();
  else if (nav.tab === 'genres') page = nav.sub?.type === 'genre' ? genrePage(nav.sub.id) : genresPage();
  else if (nav.tab === 'playlists') page = nav.sub?.type === 'playlist' ? playlistPage(nav.sub.id) : playlistsPage();
  else page = booksPage();
  renderMini();
}

// ---------- Mini-Player und Vollbild-Player ----------
function renderMini() {
  const t = player.current();
  miniEl.hidden = !t;
  if (!t) return;
  miniEl.replaceChildren(
    thumb(t, 44),
    h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, t.name), h('div', { class: 'row-sub' }, P.book ? t.book : t.genre || P.source)),
    h('button', { class: 'round', 'aria-label': 'Abspielen/Pause', onClick: (e) => (e.stopPropagation(), player.toggle()) }, icon(P.playing ? 'pause' : 'play', 24)),
  );
}
miniEl.addEventListener('click', openFull);

let full = null;
function openFull() {
  if (full || !player.current()) return;
  const cover = h('div', { class: 'full-cover' });
  const title = h('div', { class: 'full-title' });
  const sub = h('div', { class: 'full-sub' });
  const seekBar = h('input', { class: 'seek', type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Position' });
  const cur = h('span', {}, '0:00');
  const dur = h('span', {}, '0:00');
  const playBtn = h('button', { class: 'round big', onClick: () => player.toggle() });
  const favBtn = h('button', { class: 'icon-btn', 'aria-label': 'Favorit' });
  const shuffleBtn = h('button', { class: 'icon-btn', 'aria-label': 'Zufall', onClick: () => player.setShuffle(!P.shuffle) }, icon('shuffle', 22));
  const repeatBtn = h('button', { class: 'icon-btn', 'aria-label': 'Wiederholen', onClick: () => player.cycleRepeat() }, icon('repeat', 22));
  const speedBtn = h('button', { class: 'chip', onClick: speedSheet });
  const prevBtn = h('button', { class: 'icon-btn big', 'aria-label': 'Zurück', onClick: () => player.prev() }, icon('prev', 30));
  const nextBtn = h('button', { class: 'icon-btn big', 'aria-label': 'Weiter', onClick: () => player.next() }, icon('next', 30));
  const backBtn15 = h('button', { class: 'icon-btn big', 'aria-label': '15 Sekunden zurück', onClick: () => player.skip(-15) }, icon('back15', 28));
  const fwdBtn30 = h('button', { class: 'icon-btn big', 'aria-label': '30 Sekunden vor', onClick: () => player.skip(30) }, icon('fwd30', 28));
  const close = h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: closeFull }, icon('down', 28));
  const extras = h('div', { class: 'full-extras' });
  let dragging = false;
  seekBar.addEventListener('pointerdown', () => (dragging = true));
  seekBar.addEventListener('input', () => player.seek((seekBar.value / 1000) * player.length()));
  const endDrag = () => (dragging = false);
  seekBar.addEventListener('pointerup', endDrag);
  seekBar.addEventListener('change', endDrag);

  function speedSheet() {
    openSheet('Geschwindigkeit', [0.8, 1, 1.25, 1.5, 1.75, 2].map((v) => ({ label: `${String(v).replace('.', ',')}×`, check: P.speed === v, action: () => player.setSpeed(v) })));
  }
  function update() {
    const t = player.current();
    if (!t) return closeFull();
    title.textContent = t.name;
    sub.textContent = P.book ? `${t.book} · Teil ${P.index + 1} von ${P.queue.length}` : [t.genre, P.source && P.source !== t.genre ? P.source : ''].filter(Boolean).join(' · ');
    playBtn.replaceChildren(icon(P.playing ? 'pause' : 'play', 40));
    favBtn.replaceChildren(icon('heart', 26));
    favBtn.classList.toggle('on', isFav(t.key));
    favBtn.hidden = !!P.book;
    favBtn.onclick = () => toggleFav(t.key);
    shuffleBtn.hidden = !!P.book;
    shuffleBtn.classList.toggle('on', P.shuffle);
    repeatBtn.hidden = !!P.book;
    repeatBtn.classList.toggle('on', P.repeat !== 'off');
    repeatBtn.title = P.repeat === 'one' ? 'Titel wiederholen' : P.repeat === 'all' ? 'Alles wiederholen' : 'Wiederholen aus';
    speedBtn.hidden = !P.book;
    speedBtn.textContent = `${String(P.speed).replace('.', ',')}×`;
    backBtn15.hidden = fwdBtn30.hidden = !P.book;
    extras.replaceChildren(...(P.book ? [speedBtn] : [shuffleBtn, favBtn, repeatBtn]));
  }
  function updateCover() {
    const t = player.current();
    if (!t) return;
    cover.replaceChildren(icon('music', 80));
    cover.style.setProperty('--g', t.genre ? colorFor(t.genre) : '#6b6259');
    coverFor(t).then((url) => url && player.current()?.key === t.key && cover.replaceChildren(h('img', { src: url, alt: '' })));
  }
  function time() {
    if (!dragging) seekBar.value = player.length() ? String(Math.round((player.elapsed() / player.length()) * 1000)) : '0';
    cur.textContent = fmtTime(player.elapsed());
    dur.textContent = fmtTime(player.length());
  }
  const off = player.onPlayer((what) => {
    if (what === 'track') (update(), updateCover(), time());
    else if (what === 'state') update();
    else if (what === 'time') time();
  });
  full = h(
    'div',
    { class: 'full' },
    h('div', { class: 'full-top' }, close, h('div', { class: 'full-source' }, P.source || ''), h('div', { style: 'width:44px' })),
    cover,
    h('div', { class: 'full-info' }, title, sub),
    h('div', { class: 'full-seek' }, seekBar, h('div', { class: 'full-times' }, cur, dur)),
    h('div', { class: 'full-controls' }, backBtn15, prevBtn, playBtn, nextBtn, fwdBtn30),
    extras,
  );
  full._off = off;
  document.body.append(full);
  requestAnimationFrame(() => full?.classList.add('open'));
  update();
  updateCover();
  time();
}
function closeFull() {
  if (!full) return;
  full._off?.();
  const el = full;
  full = null;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 250);
}

player.onPlayer((what) => {
  if (what === 'track' || what === 'state') {
    renderMini();
    refreshPlayingRows();
    if (nav.tab === 'books' && !nav.sub && !full) render(); // Status und Fortschritt der Bücher aktuell halten
  }
  if (what === 'error') toast('Datei konnte nicht abgespielt werden');
});

// Änderungen an Favoriten, Playlists, Lesezeichen: Seite neu zeichnen
onChange(() => {
  if (nav.tab === 'songs' || nav.sub) page?.refresh?.();
  else render();
  refreshHearts();
});
function refreshHearts() {
  document.querySelectorAll('.vrow.row').forEach((r) => r.querySelector('.heart')?.classList.toggle('on', isFav(r.dataset.key)));
}

// ---------- Start ----------
(async () => {
  await loadAll();
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// Für Tests im Browser
window.__arc = { scanFiles, lib, user, P, player, render };
