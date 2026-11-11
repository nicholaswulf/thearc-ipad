// Kleine UI-Helfer: Elemente bauen, Symbole, Menü von unten, Hinweise und die virtualisierte Liste.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 5v14L9 12z" fill="currentColor" stroke="none"/><path d="M6 5v14" stroke-width="2.4"/>',
  next: '<path d="M5 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14" stroke-width="2.4"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 12H3M16 6H3M12 18H3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  back15: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  fwd30: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};

export function icon(name, size = 22, cls = '') {
  const s = document.createElement('span');
  s.className = `icon ${cls}`;
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`;
  return s;
}

export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function plural(n, one, many) {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
}

// ---------- Menü von unten ----------
let sheetEl = null;
export function closeSheet() {
  sheetEl?.remove();
  sheetEl = null;
}
/** items: { label, icon?, action, danger?, check? } | { header } */
export function openSheet(title, items) {
  closeSheet();
  const list = h(
    'div',
    { class: 'sheet-list' },
    items.filter(Boolean).map((it) =>
      it.header
        ? h('div', { class: 'sheet-head' }, it.header)
        : h(
            'button',
            { class: `sheet-item${it.danger ? ' danger' : ''}`, onClick: () => (closeSheet(), it.action?.()) },
            it.icon ? icon(it.icon, 20) : h('span', { class: 'icon-gap' }),
            h('span', { class: 'sheet-label' }, it.label),
            it.check ? icon('check', 18, 'on') : null,
          ),
    ),
  );
  sheetEl = h(
    'div',
    { class: 'sheet-wrap', onClick: (e) => e.target === sheetEl && closeSheet() },
    h('div', { class: 'sheet' }, title ? h('div', { class: 'sheet-title' }, title) : null, list),
  );
  document.body.append(sheetEl);
}

// ---------- Hinweis ----------
let toastTimer;
export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

// ---------- Virtualisierte Liste ----------
export class VList {
  /** opts: { scroller, rowH, render(item, index) → Element } */
  constructor({ scroller, rowH = 64, render }) {
    this.scroller = scroller;
    this.rowH = rowH;
    this.render = render;
    this.items = [];
    this.rows = new Map();
    this.el = h('div', { class: 'vlist' });
    this.onScroll = () => this.draw();
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(scroller);
  }
  destroy() {
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.ro.disconnect();
  }
  setItems(items) {
    this.items = items;
    this.el.style.height = `${items.length * this.rowH}px`;
    this.redraw();
  }
  redraw() {
    for (const r of this.rows.values()) r.remove();
    this.rows.clear();
    this.draw();
  }
  top() {
    return this.el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
  }
  draw() {
    const top = this.top();
    const first = Math.max(0, Math.floor(-top / this.rowH) - 6);
    const last = Math.min(this.items.length, Math.ceil((this.scroller.clientHeight - top) / this.rowH) + 6);
    const keep = new Set();
    for (let i = first; i < last; i++) {
      keep.add(i);
      if (!this.rows.has(i)) {
        const row = this.render(this.items[i], i);
        row.style.transform = `translateY(${i * this.rowH}px)`;
        row.style.height = `${this.rowH}px`;
        row.classList.add('vrow');
        this.rows.set(i, row);
        this.el.append(row);
      }
    }
    for (const [i, row] of this.rows) {
      if (!keep.has(i)) {
        row.remove();
        this.rows.delete(i);
      }
    }
  }
  scrollToIndex(i) {
    const y = this.top() + this.scroller.scrollTop + i * this.rowH;
    this.scroller.scrollTop = y - this.scroller.clientHeight / 3;
    this.draw();
  }
}
