import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const MIN_DELAY = 500;
const MAX_DELAY = 5000;
const MIN_FONT = 8;
const MAX_FONT = 28;
const KEYBAR_HEIGHT = 48;

let touchSelectMode = false;
const IME_DEDUP_MS = 300;
const MAX_PENDING_SEQ = 64 * 1024;
const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

const params = new URLSearchParams(window.location.search);
const IME_DEBUG = (params.get('debug') ?? '').includes('ime');
const VV_DEBUG = (params.get('debug') ?? '').includes('vv');
const PASTE_DEBUG = (params.get('debug') ?? '').includes('paste');
const WEBGL_ENABLED = params.get('webgl') !== '0' && !params.has('nowebgl');
const encoder = new TextEncoder();
const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';

function sanitizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned.length ? cleaned : null;
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function pasteFromClipboard(): void {
  const clip = navigator.clipboard;
  if (clip && typeof clip.readText === 'function' && window.isSecureContext) {
    clip.readText().then((t) => { if (t) activeSession?.sendSeq(t); else openPasteBox(); }).catch(() => openPasteBox());
  } else {
    openPasteBox();
  }
}

async function pasteRich(): Promise<void> {
  const clip = navigator.clipboard;
  if (clip && typeof clip.read === 'function' && window.isSecureContext) {
    try {
      const items = await clip.read();
      let handled = false;
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await it.getType(imgType);
          const ext = (imgType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
          void uploadFile(blob, `pasted-image.${ext}`);
          handled = true;
        } else if (it.types.includes('text/plain')) {
          const text = await (await it.getType('text/plain')).text();
          if (text) activeSession?.sendSeq(text);
          handled = true;
        }
      }
      if (handled) return;
    } catch { /* permission denied / not focused */ }
  }
  pasteFromClipboard();
}

function openPasteBox(): void {
  if (document.querySelector('.paste-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'paste-overlay';
  const box = document.createElement('div');
  box.className = 'paste-box';
  const label = document.createElement('div');
  label.className = 'paste-label';
  label.textContent = `Paste here (${isMac ? '⌘V' : 'Ctrl+V'}) — sends automatically`;
  const ta = document.createElement('textarea');
  ta.className = 'paste-ta';
  ta.autocapitalize = 'off';
  ta.autocomplete = 'off';
  ta.spellcheck = false;
  const row = document.createElement('div');
  row.className = 'paste-row';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const send = document.createElement('button');
  send.className = 'btn btn-primary';
  send.type = 'button';
  send.textContent = 'Send';
  row.append(cancel, send);
  box.append(label, ta, row);
  overlay.append(box);
  document.body.append(overlay);
  window.setTimeout(() => ta.focus(), 0);
  const close = (): void => { overlay.remove(); activeSession?.focus(); };
  const submit = (): void => { const t = ta.value; if (t) activeSession?.sendSeq(t); close(); };
  send.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  ta.addEventListener('paste', () => window.setTimeout(submit, 0));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function openHelp(): void {
  if (document.querySelector('.paste-overlay')) return;
  const selKey = isMac ? '⌥ Option' : 'Shift';
  const pasteKey = isMac ? '⌘V' : 'Ctrl+Shift+V';
  const copyKey = isMac ? '⌘C' : 'Ctrl+Shift+C';
  const overlay = document.createElement('div');
  overlay.className = 'paste-overlay help-overlay';
  const box = document.createElement('div');
  box.className = 'paste-box help-box';
  box.innerHTML =
    '<div class="help-title">How to copy / paste / files</div>' +
    '<ul class="help-list">' +
    `<li><b>Copy</b> — hold <b>${selKey}</b> and drag to select; it copies automatically. (Or select, then <b>${copyKey}</b>.)</li>` +
    `<li><b>Paste</b> — click the terminal, then <b>${pasteKey}</b>. On a phone/tablet, tap <b>Paste</b> and paste into the box.</li>` +
    '<li><b>Attach a file</b> — tap the 📎 button, or paste / drag any file: it uploads and inserts the file path.</li>' +
    '<li><b>Download a file</b> — tap the ⬇ button and enter a path on the host.</li>' +
    '<li><b>Scroll</b> — mouse wheel or two-finger swipe scrolls the history.</li>' +
    '<li><b>Tabs</b> — <b>+</b> new session, drag to reorder, <b>×</b> closes the tab and kills its session.</li>' +
    '</ul>' +
    '<div class="paste-row"><button class="btn btn-ghost" type="button" data-help-close>Got it</button></div>';
  overlay.append(box);
  document.body.append(overlay);
  const close = (): void => { overlay.remove(); activeSession?.focus(); };
  box.querySelector('[data-help-close]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  try { localStorage.setItem('tw.helpSeen', '1'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Theme system
// ---------------------------------------------------------------------------
interface ThemeDef { name: string; bg: string; panel: string; pane: string; paneAlt: string; border: string; borderSoft: string; text: string; muted: string; dim: string; accent: string; accent2: string; }
const THEMES: Record<string, ThemeDef> = {
  aurora:  { name: 'Graphite Aurora', bg: '#14161b', panel: '#1a1d24', pane: '#101217', paneAlt: '#0d0f13', border: '#262b34', borderSoft: '#1f232b', text: '#e7e9ee', muted: '#8a90a0', dim: '#565c6a', accent: '#5eead4', accent2: '#a78bfa' },
  nord:    { name: 'Nord Mist',       bg: '#1b2028', panel: '#212734', pane: '#171b22', paneAlt: '#141820', border: '#2c3341', borderSoft: '#242a36', text: '#e3e8f0', muted: '#7f8ba1', dim: '#565f70', accent: '#7fb2f0', accent2: '#f0a37f' },
  solaris: { name: 'Solaris Light',   bg: '#f6f5f1', panel: '#ffffff', pane: '#fbfaf7', paneAlt: '#f1efe9', border: '#e2e0d8', borderSoft: '#ebe9e2', text: '#2a2b28', muted: '#7a7972', dim: '#a4a297', accent: '#1f8a70', accent2: '#b5533c' },
  ink:     { name: 'Mono Ink',        bg: '#121212', panel: '#181818', pane: '#0e0e0e', paneAlt: '#0a0a0a', border: '#262626', borderSoft: '#1e1e1e', text: '#eaeaea', muted: '#8f8f8f', dim: '#5a5a5a', accent: '#f5f5f5', accent2: '#9a9a9a' },
  custom:  { name: 'Custom',          bg: '#171a20', panel: '#1d212a', pane: '#12151b', paneAlt: '#0d1017', border: '#2a3140', borderSoft: '#222838', text: '#e8ebf0', muted: '#8890a0', dim: '#5c6370', accent: '#f2a65a', accent2: '#7fb2f0' },
};
let currentTheme = 'aurora';
function splitPaneId(td: TabData, paneId: number, dir: 'row' | 'col'): void {
  const holder: { newId: number | null } = { newId: null };
  td.root = insertSplit(td.root, paneId, dir, holder);
  if (holder.newId) td.focused = holder.newId;
  renderPanes();
}

function closePane(td: TabData, paneId: number): void {
  if (countLeaves(td.root) <= 1) { confirmCloseSession(activeSession!); return; }
  const leaf = findLeaf(td.root, paneId);
  if (leaf?.session) { leaf.session.kill(); sessions.splice(sessions.indexOf(leaf.session), 1); leaf.session.dispose(); }
  td.root = removeLeaf(td.root, paneId)!;
  if (td.focused === paneId) td.focused = firstLeafId(td.root);
  renderTabs();
  renderPanes();
}

function setSingleLayout(td: TabData): void {
  // Kill all sessions except focused
  const focusedId = td.focused;
  const killIds: number[] = [];
  const collectIds = (node: SplitTree): void => {
    if (node.type === 'leaf') { if ((node as SplitLeaf).id !== focusedId) killIds.push((node as SplitLeaf).id); }
    else { for (const c of (node as SplitNode).children) collectIds(c); }
  };
  collectIds(td.root);
  for (const id of killIds) {
    const leaf = findLeaf(td.root, id);
    if (leaf?.session) { leaf.session.kill(); sessions.splice(sessions.indexOf(leaf.session), 1); leaf.session.dispose(); }
  }
  const focusedLeaf = findLeaf(td.root, focusedId);
  td.root = { type: 'leaf', id: focusedId, session: focusedLeaf?.session ?? null };
  renderTabs();
  renderPanes();
}

function setGridLayout(td: TabData): void {
  // Kill existing sessions (keep active)
  const existingSessions = new Map<number, Session>();
  const collectAll = (node: SplitTree): void => {
    if (node.type === 'leaf') { const l = node as SplitLeaf; if (l.session) existingSessions.set(l.id, l.session); }
    else { for (const c of (node as SplitNode).children) collectAll(c); }
  };
  collectAll(td.root);
  const ids = [paneSeq++, paneSeq++, paneSeq++, paneSeq++];
  td.root = {
    type: 'split', dir: 'col', ratio: [0.5, 0.5], children: [
      { type: 'split', dir: 'row', ratio: [0.5, 0.5], children: [{ type: 'leaf', id: ids[0], session: null }, { type: 'leaf', id: ids[1], session: null }] },
      { type: 'split', dir: 'row', ratio: [0.5, 0.5], children: [{ type: 'leaf', id: ids[2], session: null }, { type: 'leaf', id: ids[3], session: null }] },
    ],
  };
  // Reuse existing session for first pane, kill the rest
  if (activeSession) {
    const firstLeaf = findLeaf(td.root, ids[0]);
    if (firstLeaf) firstLeaf.session = activeSession;
    for (const [, s] of existingSessions) {
      if (s !== activeSession) { s.kill(); sessions.splice(sessions.indexOf(s), 1); s.dispose(); }
    }
  }
  td.focused = ids[0];
  renderTabs();
  renderPanes();
}

function clearFocusedPane(td: TabData): void {
  const leaf = findLeaf(td.root, td.focused);
  if (leaf) leaf.cleared = true;
  renderPanes();
  showToast('Panel cleared');
}

// ---------------------------------------------------------------------------
// Tree rendering (builds DOM from split-tree)
// ---------------------------------------------------------------------------
const mql = window.matchMedia('(max-width: 700px)');
function effectiveDir(dir: string): string { return mql.matches ? 'col' : dir; }
mql.addEventListener('change', renderPanes);

function renderTree(node: SplitTree, td: TabData): HTMLElement {
  if (node.type === 'leaf') {
    const leaf = node as SplitLeaf;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'flex:1;min-width:0;min-height:0;display:flex;';
    if (!leaf.session) {
      // Create a new session for this pane
      const name = nextSessionName();
      leaf.session = addSession(name, false);
    }
    const s = leaf.session;
    s.attachTo(wrapper, leaf.id);
    s.setActive(leaf.id === td.focused);
    // Store paneId on the paneEl for split/close button handlers
    wrapper.addEventListener('click', () => {
      if (td.focused !== leaf.id) { td.focused = leaf.id; renderPanes(); }
    });
    return wrapper;
  }
  const sn = node as SplitNode;
  const dir = effectiveDir(sn.dir);
  const wrap = document.createElement('div');
  wrap.className = 'split-container ' + (dir === 'row' ? 'split-row' : 'split-col');
  const childWraps = sn.children.map((child, i) => {
    const cw = document.createElement('div');
    cw.className = 'split-child';
    cw.style.flexBasis = (sn.ratio[i] * 100) + '%';
    cw.appendChild(renderTree(child, td));
    return cw;
  });
  childWraps.forEach((cw, i) => {
    wrap.appendChild(cw);
    if (i < childWraps.length - 1) {
      const divider = document.createElement('div');
      divider.className = 'divider ' + (dir === 'row' ? 'divider-row' : 'divider-col');
      attachDividerDrag(divider, sn, i, dir, wrap, childWraps[i], childWraps[i + 1]);
      wrap.appendChild(divider);
    }
  });
  return wrap;
}

function renderPanes(): void {
  const td = activeTabData();
  if (!td) return;
  paneGrid.innerHTML = '';
  paneGrid.appendChild(renderTree(td.root, td));
  updateLayoutLabel();
  // Double rAF: first lets browser compute layout, second ensures dimensions settled
  requestAnimationFrame(() => requestAnimationFrame(() => fitActive()));
  // Safety-net: re-fit after 150ms in case layout wasn't fully settled on first rAF
  window.setTimeout(() => fitActive(), 150);
}

function updateLayoutLabel(): void {
  const td = activeTabData();
  if (!td) return;
  const n = countLeaves(td.root);
  layoutLabel.textContent = n === 1 ? '1 panel' : n + ' panels';
}

function pushCssVars(t: ThemeDef): void {
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--panel', t.panel);
  r.setProperty('--pane', t.pane);
  r.setProperty('--pane-alt', t.paneAlt);
  r.setProperty('--border', t.border);
  r.setProperty('--border-soft', t.borderSoft);
  r.setProperty('--text', t.text);
  r.setProperty('--muted', t.muted);
  r.setProperty('--dim', t.dim);
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent2', t.accent2);
  r.setProperty('--accent-soft', t.accent + '26');
  // Update xterm theme
  XTERM_THEME.background = t.pane;
  XTERM_THEME.foreground = t.text;
  XTERM_THEME.cursor = t.accent;
  XTERM_THEME.cursorAccent = t.pane;
  XTERM_THEME.selectionBackground = t.accent;
}

const XTERM_THEME: Record<string, string> = {
  background: '#101217', foreground: '#e7e9ee', cursor: '#5eead4', cursorAccent: '#101217',
  selectionBackground: '#5eead4',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
  brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
  brightCyan: '#29b8db', brightWhite: '#ffffff',
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const root = document.documentElement;
const paneGrid = document.getElementById('paneGrid')!;

// ---------------------------------------------------------------------------
// Split-tree pane system
// ---------------------------------------------------------------------------
interface SplitLeaf {
  type: 'leaf';
  id: number;
  session: Session | null;
  cleared?: boolean;
}
interface SplitNode {
  type: 'split';
  dir: 'row' | 'col';
  ratio: number[];
  children: (SplitLeaf | SplitNode)[];
}
type SplitTree = SplitLeaf | SplitNode;

interface TabData {
  id: number;
  title: string;
  root: SplitTree;
  focused: number; // pane id
}

let paneSeq = 30;
let tabIdSeq = 1;
const tabDataList: TabData[] = [];
let activeTabId = 1;

function activeTabData(): TabData | undefined { return tabDataList.find((t) => t.id === activeTabId); }

function findTabDataForSession(s: Session): TabData | undefined {
  for (const td of tabDataList) {
    const leaf = findLeafBySession(td.root, s);
    if (leaf) return td;
  }
  return undefined;
}

function findLeafBySession(node: SplitTree, s: Session): SplitLeaf | null {
  if (node.type === 'leaf') return (node as SplitLeaf).session === s ? (node as SplitLeaf) : null;
  for (const c of (node as SplitNode).children) {
    const found = findLeafBySession(c, s);
    if (found) return found;
  }
  return null;
}

function hasAnySession(node: SplitTree): boolean {
  if (node.type === 'leaf') return (node as SplitLeaf).session !== null;
  return (node as SplitNode).children.some(hasAnySession);
}

function countLeaves(node: SplitTree): number { return node.type === 'leaf' ? 1 : (node as SplitNode).children.reduce((s, c) => s + countLeaves(c), 0); }
function firstLeafId(node: SplitTree): number { return node.type === 'leaf' ? (node as SplitLeaf).id : firstLeafId((node as SplitNode).children[0]); }
function findLeaf(node: SplitTree, id: number): SplitLeaf | null {
  if (node.type === 'leaf') return (node as SplitLeaf).id === id ? node as SplitLeaf : null;
  for (const c of (node as SplitNode).children) { const r = findLeaf(c, id); if (r) return r; }
  return null;
}
function insertSplit(node: SplitTree, id: number, dir: 'row' | 'col', holder: { newId: number | null }): SplitTree {
  if (node.type === 'leaf') {
    if ((node as SplitLeaf).id === id) {
      const newId = paneSeq++;
      holder.newId = newId;
      return { type: 'split', dir, ratio: [0.5, 0.5], children: [{ type: 'leaf', id: (node as SplitLeaf).id, session: (node as SplitLeaf).session }, { type: 'leaf', id: newId, session: null }] };
    }
    return node;
  }
  return { ...(node as SplitNode), children: (node as SplitNode).children.map((c) => insertSplit(c, id, dir, holder)) };
}
function removeLeaf(node: SplitTree, id: number): SplitTree | null {
  if (node.type === 'leaf') return (node as SplitLeaf).id === id ? null : node;
  const sn = node as SplitNode;
  const newChildren: SplitTree[] = [];
  const newRatio: number[] = [];
  sn.children.forEach((c, i) => {
    const res = removeLeaf(c, id);
    if (res !== null) { newChildren.push(res); newRatio.push(sn.ratio[i]); }
  });
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  const sum = newRatio.reduce((a, b) => a + b, 0) || 1;
  return { type: 'split', dir: sn.dir, children: newChildren, ratio: newRatio.map((r) => r / sum) };
}

function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }

// ---------------------------------------------------------------------------
// Divider drag-to-resize
// ---------------------------------------------------------------------------
function attachDividerDrag(divider: HTMLElement, node: SplitNode, i: number, dir: string, containerEl: HTMLElement, leftEl: HTMLElement, rightEl: HTMLElement): void {
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { divider.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    divider.classList.add('active');
    document.body.style.userSelect = 'none';
    const rect = containerEl.getBoundingClientRect();
    const total = dir === 'row' ? rect.width : rect.height;
    const startPos = dir === 'row' ? e.clientX : e.clientY;
    const baseA = node.ratio[i], baseB = node.ratio[i + 1];
    const pairTotal = baseA + baseB;
    let pendingA: number | null = null, pendingB: number | null = null;
    const onMove = (ev: PointerEvent) => {
      const pos = dir === 'row' ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / total;
      let newA = clamp(baseA + delta, pairTotal * 0.15, pairTotal * 0.85);
      let newB = pairTotal - newA;
      leftEl.style.flexBasis = (newA * 100) + '%';
      rightEl.style.flexBasis = (newB * 100) + '%';
      pendingA = newA; pendingB = newB;
    };
    const onUp = () => {
      if (pendingA !== null) { node.ratio[i] = pendingA; node.ratio[i + 1] = pendingB!; }
      divider.classList.remove('active');
      document.body.style.userSelect = '';
      divider.removeEventListener('pointermove', onMove);
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp, { once: true });
  });
}
const keybarEl = document.getElementById('keybar')!;
const statusEl = document.getElementById('status');
const tabsEl = document.getElementById('tabs')!;
const overlayEl = document.getElementById('overlay')!;
const drawerEl = document.getElementById('drawer')!;
const drawerBody = document.getElementById('drawerBody')!;
const drawerTabsEl = document.getElementById('drawerTabs')!;
const connDot = document.getElementById('connDot')!;
const connLabel = document.getElementById('connLabel')!;
const layoutLabel = document.getElementById('layoutLabel')!;
const toastEl = document.getElementById('toast')!;
const modalOverlay = document.getElementById('modalOverlay')!;
const newTabInput = document.getElementById('newTabInput') as HTMLInputElement;


let currentFont = (() => {
  try {
    const n = parseInt(localStorage.getItem('tw.fontSize') ?? '', 10);
    if (!Number.isNaN(n)) return Math.min(MAX_FONT, Math.max(MIN_FONT, n));
  } catch { /* ignore */ }
  return 14;
})();

// Settings state
const settings = {
  font: 'JetBrains Mono',
  fontSize: currentFont,
  lineHeight: 1.6,
  cursorStyle: 'bar' as 'bar' | 'block' | 'underline',
  cursorBlink: true,
  confirmClose: true,
  bellSound: false,
};

function showStatus(text: string): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.add('visible');
}
function hideStatus(): void { statusEl?.classList.remove('visible'); }
function flashStatus(text: string, ms: number): void {
  showStatus(text);
  window.setTimeout(() => { if (statusEl?.textContent === text) hideStatus(); }, ms);
}
function fmtMB(bytes: number): string { return (bytes / (1024 * 1024)).toFixed(1); }

// Toast
let toastTimer: ReturnType<typeof setTimeout>;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------------
// Session class — one real terminal per tmux session
// ---------------------------------------------------------------------------
class Session {
  readonly name: string;
  displayName: string;
  readonly term: Terminal;
  readonly el: HTMLElement;          // xterm container
  paneEl: HTMLElement | null = null; // .pane wrapper
  paneHead: HTMLElement | null = null;
  panePath: HTMLElement | null = null;
  tabEl: HTMLElement | null = null;
  tabLabel: HTMLElement | null = null;
  tabDot: HTMLElement | null = null;
  connected = false;
  everConnected = false;

  private readonly fitAddon = new FitAddon();
  readonly searchAddon = new SearchAddon();
  private ws: WebSocket | null = null;
  private reconnectDelay = MIN_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private lastData = '';
  private lastDataAt = 0;
  private composing = false;
  private reattachAfterCompose = false;
  private pendingSeq: string[] = [];
  private _paneBodyObserved = false;
  private _paneBodyObserver: ResizeObserver | null = null;

  constructor(name: string, displayName?: string) {
    this.name = name;
    this.displayName = displayName?.trim() || name;
    this.term = new Terminal({
      cursorBlink: settings.cursorBlink,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: settings.fontSize,
      scrollback: 100000,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      theme: XTERM_THEME as never,
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.term.loadAddon(this.searchAddon);

    // Build pane wrapper: .pane > .pane-head + .pane-body > xterm el
    this.paneEl = document.createElement('div');
    this.paneEl.className = 'pane';

    this.paneHead = document.createElement('div');
    this.paneHead.className = 'pane-head';
    this.panePath = document.createElement('span');
    this.panePath.className = 'pane-path';
    this.panePath.textContent = `◦ zsh — ${this.displayName}`;
    const paneActions = document.createElement('div');
    paneActions.className = 'pane-actions';
    paneActions.innerHTML = `
      <button class="mini-btn" data-act="split-row" title="Split right" aria-label="Split right">⬒</button>
      <button class="mini-btn" data-act="split-col" title="Split bottom" aria-label="Split bottom">⬓</button>
      <button class="mini-btn danger" data-act="close" title="Close panel" aria-label="Close panel">✕</button>`;
    paneActions.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (e.target as HTMLElement).closest('.mini-btn')?.getAttribute('data-act');
      if (!act) return;
      const td = activeTabData();
      if (!td) return;
      const paneId = (this.paneEl as unknown as { _paneId?: number })._paneId;
      if (paneId === undefined) return;
      if (act === 'split-row') { splitPaneId(td, paneId, 'row'); showToast('Split right'); }
      if (act === 'split-col') { splitPaneId(td, paneId, 'col'); showToast('Split bottom'); }
      if (act === 'close') { closePane(td, paneId); }
    });
    this.paneHead.append(this.panePath, paneActions);

    this.el = document.createElement('div');
    this.el.className = 'pane-body';

    this.paneEl.append(this.paneHead, this.el);
    // NOTE: paneEl is NOT appended to paneGrid here; tree rendering places it

    this.term.open(this.el);
    if (WEBGL_ENABLED) {
      try { const webgl = new WebglAddon(); webgl.onContextLoss(() => webgl.dispose()); this.term.loadAddon(webgl); } catch { /* fallback */ }
    }
    if (!isMac) {
      this.term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return true;
        if (e.code === 'KeyC') {
          const sel = this.term.getSelection();
          if (sel) void copyText(sel).then((ok) => flashStatus(ok ? 'copied' : 'copy failed', 1200));
          else flashStatus('nothing selected', 1200);
          e.preventDefault();
          return false;
        }
        if (e.code === 'KeyV') { e.preventDefault(); void pasteRich(); return false; }
        return true;
      });
    }
    const copySelection = (): void => {
      const sel = this.term.getSelection();
      if (sel) void copyText(sel).then((ok) => { if (ok) flashStatus('copied', 1200); });
    };
    this.el.addEventListener('mouseup', copySelection);
    this.el.addEventListener('touchend', copySelection);
    this.wireInput();
    this.wireTouchScroll();
    this.connect();
  }

  private debug(event: string, data?: string): void {
    if (!IME_DEBUG) return;
    this.debugSend(event, data);
  }
  debugSend(event: string, data?: string): void {
    console.log('[ime]', this.name, event, JSON.stringify(data ?? ''));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'debug', event, data: String(data ?? ''), at: Math.round(performance.now()) }));
    }
  }

  private wireInput(): void {
    const ta = this.term.textarea;
    if (IME_DEBUG && ta) {
      for (const ev of ['compositionstart', 'compositionupdate', 'compositionend'] as const) {
        ta.addEventListener(ev, (e) => this.debug(ev, (e as CompositionEvent).data));
      }
      ta.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.isComposing || ke.keyCode === 229 || ke.keyCode === 20) this.debug('keydown', `${ke.key}/${ke.keyCode}`);
      });
    }
    if (ta) {
      const pendingKeys = new Map<number, string>();
      let lastSeq = -1;
      let seq = 0;
      const cancelLast = (): void => { if (lastSeq >= 0) { pendingKeys.delete(lastSeq); lastSeq = -1; } };
      ta.addEventListener('compositionstart', () => { this.composing = true; cancelLast(); });
      ta.addEventListener('compositionupdate', cancelLast);
      ta.addEventListener('compositionend', () => {
        this.composing = false;
        cancelLast();
        if (this.reattachAfterCompose) { this.reattachAfterCompose = false; this.fit(); if (isActive(this)) this.term.focus(); }
      });
      ta.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.keyCode !== 229) return;
        const k = ke.key;
        if (!k || k.length !== 1) return;
        const s = ++seq;
        pendingKeys.set(s, k);
        lastSeq = s;
        window.setTimeout(() => { if (!pendingKeys.has(s)) return; pendingKeys.delete(s); this.debug('forward-key', k); this.send(k); }, 90);
      });
    }
    this.term.onData((data: string) => {
      this.debug('onData', data);
      const now = performance.now();
      if (/[^\x00-\x7F]/.test(data) && data === this.lastData && now - this.lastDataAt < IME_DEDUP_MS) {
        this.lastData = '';
        this.debug('onData-DROP', data);
        return;
      }
      this.lastData = data;
      this.lastDataAt = now;
      this.send(data);
    });
  }

  private send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encoder.encode(data));
  }

  sendSeq(seq: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.send(seq); return; }
    const buffered = this.pendingSeq.reduce((n, s) => n + s.length, 0);
    if (buffered + seq.length <= MAX_PENDING_SEQ) this.pendingSeq.push(seq);
  }

  private wireTouchScroll(): void {
    const STEP = 22;
    let startX = 0, startY = 0, lastY = 0, col = 1, row = 1, tracking = false, scrolling = false;
    let selecting = false, selMoved = false, anchorCol = 0, anchorRow = 0, cellW = 1, cellH = 1, rectLeft = 0, rectTop = 0;
    const cellAt = (cx: number, cy: number): [number, number] => {
      const c = Math.max(0, Math.min(this.term.cols - 1, Math.floor((cx - rectLeft) / cellW)));
      const r = Math.max(0, Math.min(this.term.rows - 1, Math.floor((cy - rectTop) / cellH)));
      return [c, this.term.buffer.active.viewportY + r];
    };
    this.el.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; selecting = false; return; }
      const t = e.touches[0];
      startX = t.clientX; startY = lastY = t.clientY;
      const rect = this.el.getBoundingClientRect();
      cellW = rect.width / Math.max(1, this.term.cols);
      cellH = rect.height / Math.max(1, this.term.rows);
      rectLeft = rect.left; rectTop = rect.top;
      if (touchSelectMode) { tracking = false; selecting = true; selMoved = false; [anchorCol, anchorRow] = cellAt(t.clientX, t.clientY); this.term.clearSelection(); return; }
      tracking = true; scrolling = false;
      col = Math.max(1, Math.min(this.term.cols, Math.floor((t.clientX - rectLeft) / cellW) + 1));
      row = Math.max(1, Math.min(this.term.rows, Math.floor((t.clientY - rectTop) / cellH) + 1));
    }, { capture: true, passive: true });
    this.el.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (selecting) {
        e.preventDefault(); e.stopPropagation();
        if (!selMoved && Math.abs(t.clientX - startX) < 6 && Math.abs(t.clientY - startY) < 6) return;
        selMoved = true;
        let [sCol, sRow] = [anchorCol, anchorRow];
        let [eCol, eRow] = cellAt(t.clientX, t.clientY);
        if (eRow < sRow || (eRow === sRow && eCol < sCol)) [sCol, sRow, eCol, eRow] = [eCol, eRow, sCol, sRow];
        const length = (eRow - sRow) * this.term.cols + (eCol - sCol) + 1;
        this.term.select(sCol, sRow, length);
        return;
      }
      if (!tracking) return;
      if (!scrolling) {
        const dyTotal = t.clientY - startY;
        const dxTotal = t.clientX - startX;
        if (Math.abs(dyTotal) < 10 || Math.abs(dyTotal) <= Math.abs(dxTotal)) return;
        scrolling = true;
      }
      e.preventDefault(); e.stopPropagation();
      let dy = t.clientY - lastY;
      let ticks = 0;
      while (Math.abs(dy) >= STEP) { if (dy > 0) { ticks += 1; dy -= STEP; } else { ticks -= 1; dy += STEP; } }
      lastY = t.clientY - dy;
      if (ticks !== 0) this.sendWheel(ticks, col, row);
    }, { capture: true, passive: false });
    const end = (): void => { tracking = false; scrolling = false; selecting = false; };
    this.el.addEventListener('touchend', end, { capture: true, passive: true });
    this.el.addEventListener('touchcancel', end, { capture: true, passive: true });
  }

  private sendWheel(ticks: number, col: number, row: number): void {
    const seq = `\x1b[<${ticks > 0 ? 64 : 65};${col};${row}M`;
    for (let i = Math.abs(ticks); i > 0; i -= 1) this.send(seq);
  }

  private sendResize(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    }
  }

  fit(): void {
    if (this.el.classList.contains('hidden')) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Not laid out yet — retry after layout
      requestAnimationFrame(() => { try { this.fitAddon.fit(); } catch { /* give up */ } });
    }
    this.sendResize();
  }

  setFont(px: number): void { this.term.options.fontSize = px; this.fit(); }

  setActive(active: boolean): void {
    this.paneEl?.classList.toggle('focused', active);
    if (active) {
      this.panePath!.textContent = `◦ zsh — ${this.displayName}`;
      requestAnimationFrame(() => {
        this.fit();
        if (!window.matchMedia('(pointer: coarse)').matches) this.term.focus();
      });
    }
  }

  /** Attach pane to a DOM container (called by tree rendering) */
  attachTo(container: HTMLElement, paneId: number): void {
    if (this.paneEl) {
      (this.paneEl as unknown as { _paneId?: number })._paneId = paneId;
      container.append(this.paneEl);
      // Observe the pane-body element so xterm fits exactly when its size changes
      // (e.g. divider drag, window resize, layout change).
      if (typeof ResizeObserver !== 'undefined' && !this._paneBodyObserved) {
        this._paneBodyObserved = true;
        this._paneBodyObserver = new ResizeObserver(() => this.fit());
        this._paneBodyObserver.observe(this.el);
      }
    }
  }

  focus(): void { this.term.focus(); }

  restart(): void {
    this.term.reset();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'restart' }));
  }

  kill(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'kill' }));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
  }
  private stopPing(): void { if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; } }

  private setConnected(state: boolean): void {
    this.connected = state;
    updateTabDot(this);
    if (isActive(this)) {
      reflectActiveStatus();
      updateStatusBar();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    if (isActive(this)) showStatus('reconnecting...');
    const base = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_DELAY);
    const delay = Math.round(base * (0.5 + Math.random()));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  connect(): void {
    if (this.disposed) return;
    const url = `${wsProto}://${window.location.host}/ws?session=${encodeURIComponent(this.name)}`;
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectDelay = MIN_DELAY;
      this.everConnected = true;
      this.setConnected(true);
      this.startPing();
      if (this.pendingSeq.length) {
        const buffered = this.pendingSeq;
        this.pendingSeq = [];
        for (const s of buffered) this.send(s);
      }
      if (this.displayName !== this.name) renameOnServer(this.name, this.displayName);
      if (this.composing) { this.reattachAfterCompose = true; } else { this.fit(); if (isActive(this)) this.term.focus(); }
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) { this.term.write(new Uint8Array(ev.data)); return; }
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as { type?: string };
          if (msg && msg.type === 'closed') { recentlyClosed.set(this.name, performance.now()); removeLocalSession(this); }
        } catch { /* ignore */ }
      }
    };

    socket.onclose = () => {
      this.stopPing();
      if (this.ws === socket) this.ws = null;
      this.setConnected(false);
      this.scheduleReconnect();
    };

    socket.onerror = () => { try { socket.close(); } catch { /* ignore */ } };
  }

  dispose(): void {
    this.disposed = true;
    this.stopPing();
    if (this._paneBodyObserver) { this._paneBodyObserver.disconnect(); this._paneBodyObserver = null; }
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    try { this.term.dispose(); } catch { /* ignore */ }
    this.paneEl?.remove();
  }
}

// ---------------------------------------------------------------------------
// Tab / session manager
// ---------------------------------------------------------------------------
const sessions: Session[] = [];
let activeSession: Session | null = null;

function isActive(s: Session): boolean { return activeSession === s; }
function reflectActiveStatus(): void { if (activeSession && activeSession.connected) hideStatus(); else showStatus('reconnecting...'); }
function updateTabDot(s: Session): void { s.tabDot?.classList.toggle('connected', s.connected); refreshMobileUI(); }

// ---------------------------------------------------------------------------
// Tab drag-and-drop reordering
// ---------------------------------------------------------------------------
const tabDragState: { draggingId: string | null; ghost: HTMLElement | null; moved: boolean; startX: number; startY: number; offsetX: number; offsetY: number } = { draggingId: null, ghost: null, moved: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 };

function onTabPointerDown(e: PointerEvent, s: Session, el: HTMLElement): void {
  if ((e.target as HTMLElement).classList.contains('close')) return;
  tabDragState.startX = e.clientX;
  tabDragState.startY = e.clientY;
  tabDragState.moved = false;
  const moveHandler = (ev: PointerEvent) => onTabPointerMove(ev, s, el);
  const upHandler = (ev: PointerEvent) => {
    onTabPointerUp(ev, s);
    document.removeEventListener('pointermove', moveHandler);
    document.removeEventListener('pointerup', upHandler);
  };
  document.addEventListener('pointermove', moveHandler);
  document.addEventListener('pointerup', upHandler);
}

function onTabPointerMove(e: PointerEvent, s: Session, el: HTMLElement): void {
  const dx = e.clientX - tabDragState.startX;
  const dy = e.clientY - tabDragState.startY;
  if (!tabDragState.moved && Math.hypot(dx, dy) > 6) {
    tabDragState.moved = true;
    tabDragState.draggingId = s.name;
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.className = 'tab active';
    ghost.style.position = 'fixed';
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.zIndex = '70';
    ghost.style.pointerEvents = 'none';
    ghost.style.boxShadow = '0 14px 34px rgba(0,0,0,0.4)';
    ghost.style.borderRadius = '8px 8px 0 0';
    ghost.style.background = 'var(--pane)';
    ghost.style.opacity = '0.96';
    document.body.appendChild(ghost);
    tabDragState.ghost = ghost;
    tabDragState.offsetX = e.clientX - rect.left;
    tabDragState.offsetY = e.clientY - rect.top;
    el.style.opacity = '0.3';
  }
  if (tabDragState.moved) {
    tabDragState.ghost!.style.left = (e.clientX - tabDragState.offsetX) + 'px';
    tabDragState.ghost!.style.top = (e.clientY - tabDragState.offsetY) + 'px';
    reorderByPointer(e);
  }
}

function reorderByPointer(e: PointerEvent): void {
  const els = [...tabsEl.querySelectorAll('.tab')].filter((el) => el.getAttribute('data-name') !== tabDragState.draggingId);
  let insertBefore: string | null = null;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) { insertBefore = el.getAttribute('data-name'); break; }
  }
  const curIdx = sessions.findIndex((s) => s.name === tabDragState.draggingId);
  if (curIdx < 0) return;
  const [dragged] = sessions.splice(curIdx, 1);
  if (insertBefore === null) sessions.push(dragged);
  else sessions.splice(sessions.findIndex((s) => s.name === insertBefore), 0, dragged);
  renderTabs();
  saveTabs();
}

function onTabPointerUp(_e: PointerEvent, s: Session): void {
  if (!tabDragState.moved) {
    activateSession(s);
  } else {
    if (tabDragState.ghost) { tabDragState.ghost.remove(); tabDragState.ghost = null; }
    tabDragState.draggingId = null;
    tabDragState.moved = false;
    const tabEl = s.tabEl;
    if (tabEl) tabEl.style.opacity = '';
    saveTabs();
    showToast('Tab order updated');
  }
}

/** Rebuild the entire tab bar from the sessions array (data-driven, matching reference) */
function renderTabs(): void {
  // #addTab is a SIBLING of #tabs in the HTML, not a child — just clear and rebuild.
  tabsEl.innerHTML = '';
  for (const s of sessions) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (s === activeSession ? ' active' : '');
    tab.setAttribute('data-name', s.name);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', s === activeSession ? 'true' : 'false');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = s.displayName;
    label.title = `session: ${s.name} (double-click to rename)`;
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '\u2715';
    close.title = 'Close tab & kill session';
    tab.append(dot, label, close);
    tab.addEventListener('pointerdown', (e) => onTabPointerDown(e, s, tab));
    let lastTap = 0;
    tab.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('close')) return;
      const now = performance.now();
      if (now - lastTap < 350) { lastTap = 0; promptRenameSession(s); return; }
      lastTap = now;
    });
    close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); confirmCloseSession(s); });
    s.tabEl = tab;
    s.tabLabel = label;
    s.tabDot = dot;
    tabsEl.appendChild(tab);
    updateTabDot(s);
  }
  refreshMobileUI();
}

function addSession(name: string, makeActive: boolean, displayName?: string): Session {
  let s = sessions.find((x) => x.name === name);
  if (!s) {
    s = new Session(name, displayName);
    sessions.push(s);
    renderTabs();
  } else if (displayName && displayName.trim() && displayName.trim() !== s.displayName) {
    setDisplayName(s, displayName.trim());
  }
  if (makeActive) activateSession(s);
  saveTabs();
  updateStatusBar();
  return s;
}

function activateSession(s: Session): void {
  if (activeSession && activeSession !== s) activeSession.setActive(false);
  activeSession = s;
  s.setActive(true);
  // Sync activeTabId with the TabData that owns this session
  let td = findTabDataForSession(s);
  if (!td) {
    // Session has no TabData yet — create one (happens for sessions added by syncFromServer)
    td = { id: tabIdSeq++, title: s.displayName, root: { type: 'leaf', id: paneSeq++, session: s }, focused: paneSeq - 1 };
    tabDataList.push(td);
  }
  activeTabId = td.id;
  renderPanes();
  for (const x of sessions) {
    x.tabEl?.classList.toggle('active', x === s);
    x.tabEl?.setAttribute('aria-selected', x === s ? 'true' : 'false');
  }
  s.tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  reflectActiveStatus();
  refreshMobileUI();
  updateStatusBar();
  saveTabs();
}

function confirmCloseSession(s: Session): void {
  if (!settings.confirmClose) { closeSession(s); return; }
  if (document.querySelector('.confirm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay confirm-overlay open';

  const card = document.createElement('div');
  card.className = 'modal-card confirm-card';

  // Icon
  const icon = document.createElement('div');
  icon.className = 'confirm-icon';
  icon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  // Title
  const title = document.createElement('h3');
  title.className = 'confirm-title';
  title.textContent = 'Close terminal';

  // Description
  const desc = document.createElement('p');
  desc.className = 'confirm-desc';
  const sessionNote = s.displayName === s.name ? '' : ` (tmux session "${s.name}")`;
  desc.textContent = `Close "${s.displayName}"${sessionNote}? This kills its tmux session and ends any programs running in it.`;

  // Actions
  const actions = document.createElement('div');
  actions.className = 'modal-actions confirm-actions';

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';

  const confirm = document.createElement('button');
  confirm.className = 'btn btn-primary confirm-btn-danger';
  confirm.type = 'button';
  confirm.textContent = 'Close & kill';

  actions.append(cancel, confirm);
  card.append(icon, title, desc, actions);
  overlay.append(card);
  document.body.append(overlay);

  window.setTimeout(() => confirm.focus(), 0);

  const close = (): void => { overlay.remove(); activeSession?.focus(); };
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => { close(); closeSession(s); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function closeSession(s: Session): void {
  const idx = sessions.indexOf(s);
  if (idx < 0) return;
  recentlyClosed.set(s.name, performance.now());
  s.kill();
  sessions.splice(idx, 1);
  s.dispose();
  // Remove from split-tree leaves
  for (const td of tabDataList) {
    removeSessionFromTree(td.root, s);
  }
  // Remove TabData entries whose tree has no sessions left
  for (let i = tabDataList.length - 1; i >= 0; i--) {
    if (!hasAnySession(tabDataList[i].root)) {
      if (tabDataList[i].id === activeTabId) activeTabId = -1;
      tabDataList.splice(i, 1);
    }
  }
  if (activeSession === s) {
    activeSession = null;
    // If the active tab was removed, switch to the first remaining tab
    if (activeTabId === -1 && tabDataList.length > 0) {
      activeTabId = tabDataList[0].id;
      const leaf = findLeafBySession(tabDataList[0].root, sessions[0]);
      if (leaf && leaf.session) activateSession(leaf.session);
    } else {
      const next = sessions[idx] ?? sessions[idx - 1] ?? null;
      if (next) activateSession(next);
    }
  }
  if (sessions.length === 0) addSession(defaultSessionName, true);
  renderTabs();
  refreshMobileUI();
  updateStatusBar();
  saveTabs();
  renderPanes();
}

function removeSessionFromTree(node: SplitTree, s: Session): void {
  if (node.type === 'leaf') { if ((node as SplitLeaf).session === s) (node as SplitLeaf).session = null; }
  else { for (const c of (node as SplitNode).children) removeSessionFromTree(c, s); }
}

function nextSessionName(): string {
  const used = new Set(sessions.map((s) => s.name));
  for (const c of ['web', 'work', 'dev', 'scratch']) if (!used.has(c)) return c;
  let i = 2;
  while (used.has(`s${i}`)) i += 1;
  return `s${i}`;
}

function setDisplayName(s: Session, displayName: string): void {
  s.displayName = displayName;
  if (s.tabLabel) { s.tabLabel.textContent = displayName; s.tabLabel.title = `session: ${s.name} (double-click to rename)`; }
  if (s.panePath) s.panePath.textContent = `◦ zsh — ${displayName}`;
  refreshMobileUI();
}

async function promptRenameSession(s: Session): Promise<void> {
  const raw = await domPrompt({ label: `Rename tab (display only — the tmux session stays "${s.name}"):`, value: s.displayName, okText: 'Rename' });
  if (raw === null) return;
  const trimmed = raw.trim().slice(0, 64);
  setDisplayName(s, trimmed.length ? trimmed : s.name);
  saveTabs();
  renameOnServer(s.name, s.displayName);
  activeSession?.focus();
}

// PWA-safe prompt
function domPrompt(opts: { label: string; value?: string; okText?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (document.querySelector('.prompt-overlay')) { resolve(null); return; }
    const overlay = document.createElement('div');
    overlay.className = 'paste-overlay prompt-overlay';
    const box = document.createElement('div');
    box.className = 'paste-box prompt-box';
    const label = document.createElement('div');
    label.className = 'paste-label';
    label.textContent = opts.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'prompt-input';
    input.value = opts.value ?? '';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const row = document.createElement('div');
    row.className = 'paste-row';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.type = 'button';
    ok.textContent = opts.okText ?? 'OK';
    row.append(cancel, ok);
    box.append(label, input, row);
    overlay.append(box);
    document.body.append(overlay);
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
    let done = false;
    const finish = (result: string | null): void => {
      if (done) return;
      done = true;
      overlay.remove();
      activeSession?.focus();
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', () => finish(input.value));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } else if (e.key === 'Escape') { e.preventDefault(); finish(null); } });
  });
}

interface SavedTab { name: string; displayName: string; }

function saveTabs(): void {
  try {
    localStorage.setItem('tw.tabs', JSON.stringify(sessions.map((s) => ({ name: s.name, displayName: s.displayName }))));
    if (activeSession) localStorage.setItem('tw.activeTab', activeSession.name);
  } catch { /* ignore */ }
}

function loadTabs(): { tabs: SavedTab[]; active: string | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem('tw.tabs') ?? '[]');
    const active = localStorage.getItem('tw.activeTab');
    if (Array.isArray(parsed)) {
      const tabs: SavedTab[] = [];
      for (const item of parsed) {
        if (typeof item === 'string') tabs.push({ name: item, displayName: item });
        else if (item && typeof item === 'object' && typeof item.name === 'string') {
          const dn = typeof item.displayName === 'string' && item.displayName.trim().length ? item.displayName : item.name;
          tabs.push({ name: item.name, displayName: dn });
        }
      }
      return { tabs, active };
    }
  } catch { /* ignore */ }
  return { tabs: [], active: null };
}

// ---------------------------------------------------------------------------
// Cross-device sync
// ---------------------------------------------------------------------------
const recentlyClosed = new Map<string, number>();
const CLOSE_GUARD_MS = 6000;

async function fetchServerTabs(timeoutMs = 2500): Promise<SavedTab[] | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/sessions', { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { tabs?: unknown };
    if (!Array.isArray(data.tabs)) return null;
    const out: SavedTab[] = [];
    for (const item of data.tabs) {
      if (item && typeof item === 'object' && typeof (item as SavedTab).name === 'string') {
        const name = (item as SavedTab).name;
        const dnRaw = (item as SavedTab).displayName;
        const dn = typeof dnRaw === 'string' && dnRaw.trim() ? dnRaw : name;
        out.push({ name, displayName: dn });
      }
    }
    return out;
  } catch { return null; } finally { window.clearTimeout(timer); }
}

function renameOnServer(name: string, displayName: string): void {
  void fetch('/api/sessions/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, displayName }),
  }).catch(() => { /* ignore */ });
}

function removeLocalSession(s: Session): void {
  const idx = sessions.indexOf(s);
  if (idx < 0) return;
  sessions.splice(idx, 1);
  s.dispose();
  if (activeSession === s) {
    activeSession = null;
    const next = sessions[idx] ?? sessions[idx - 1] ?? null;
    if (next) activateSession(next);
  }
  renderTabs();
  refreshMobileUI();
}

let syncing = false;
async function syncFromServer(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const serverTabs = await fetchServerTabs();
    if (!serverTabs) return;
    const byName = new Map(serverTabs.map((t) => [t.name, t]));
    const now = performance.now();
    for (const [name, at] of recentlyClosed) { if (now - at > CLOSE_GUARD_MS) recentlyClosed.delete(name); }
    for (const t of serverTabs) {
      if (recentlyClosed.has(t.name)) continue;
      const existing = sessions.find((s) => s.name === t.name);
      if (!existing) addSession(t.name, false, t.displayName);
      else if (t.displayName && t.displayName !== existing.displayName) setDisplayName(existing, t.displayName);
    }
    for (const s of sessions.slice()) {
      if (byName.has(s.name)) continue;
      if (!s.everConnected) continue;
      if (recentlyClosed.has(s.name)) continue;
      removeLocalSession(s);
    }
    if (sessions.length === 0) addSession(defaultSessionName, true);
    saveTabs();
  } finally { syncing = false; }
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
function fitActive(): void {
  const td = activeTabData();
  if (!td) { activeSession?.fit(); return; }
  // Fit all visible terminals in the current tab's split tree
  const fitAll = (node: SplitTree): void => {
    if (node.type === 'leaf') { (node as SplitLeaf).session?.fit(); }
    else { for (const c of (node as SplitNode).children) fitAll(c); }
  };
  fitAll(td.root);
}

const mobileMQ = window.matchMedia('(max-width: 640px)');

function updateKeybarHeight(): void {
  if (keybarEl.classList.contains('hidden')) { root.style.setProperty('--keybar-h', '0px'); return; }
  const h = mobileMQ.matches ? keybarEl.offsetHeight : KEYBAR_HEIGHT;
  root.style.setProperty('--keybar-h', `${h}px`);
}

function setKeybarVisible(visible: boolean): void {
  keybarEl.classList.toggle('hidden', !visible);
  keysBtn?.classList.toggle('active', visible);
  refreshMobileUI();
  try { localStorage.setItem('tw.keybar', visible ? '1' : '0'); } catch { /* ignore */ }
  requestAnimationFrame(() => { updateKeybarHeight(); fitActive(); });
}

function updateKeyboardOffset(): void {
  const vv = window.visualViewport;
  const raw = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const offset = raw > 150 ? raw : 0;
  root.style.setProperty('--kb-offset', `${offset}px`);
  if (VV_DEBUG && vv) {
    activeSession?.debugSend('vv', `ih=${window.innerHeight} vvh=${Math.round(vv.height)} vvTop=${Math.round(vv.offsetTop)} pageY=${Math.round(window.pageYOffset)} raw=${Math.round(raw)} off=${Math.round(offset)}`);
  }
  fitActive();
}

function updateStatusBar(): void {
  if (activeSession) {
    connDot.classList.toggle('reconnecting', !activeSession.connected);
    connDot.style.background = activeSession.connected ? '#86efac' : '#f0b429';
    connLabel.textContent = activeSession.connected ? 'connected' : 'reconnecting...';
    layoutLabel.textContent = '1 panel';
  }
}

// ---------------------------------------------------------------------------
// Toolbar buttons (reference design)
// ---------------------------------------------------------------------------
// Layout buttons (real split actions)
document.getElementById('layoutSingle')?.addEventListener('click', () => { const td = activeTabData(); if (td) { setSingleLayout(td); showToast('Single layout'); } });
document.getElementById('layoutV')?.addEventListener('click', () => { const td = activeTabData(); if (td) { splitPaneId(td, td.focused, 'row'); showToast('Split right'); } });
document.getElementById('layoutH')?.addEventListener('click', () => { const td = activeTabData(); if (td) { splitPaneId(td, td.focused, 'col'); showToast('Split bottom'); } });
document.getElementById('layoutGrid')?.addEventListener('click', () => { const td = activeTabData(); if (td) { setGridLayout(td); showToast('Grid 2x2'); } });

// Clear
document.getElementById('clearBtn')?.addEventListener('click', () => {
  activeSession?.term.clear();
  showToast('Panel cleared');
});

// Fullscreen
document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
function toggleFullscreen(): void {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = root as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (!document.fullscreenElement && !d.webkitFullscreenElement) (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  else (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
  setTimeout(() => fitActive(), 100);
}

// Settings button
document.getElementById('settingsBtn')?.addEventListener('click', openDrawer);

// Add tab button
document.getElementById('addTab')?.addEventListener('click', openNewTabModal);

// ---------------------------------------------------------------------------
// Search (Ctrl+F or click search box)
// ---------------------------------------------------------------------------
let searchOverlay: HTMLDivElement | null = null;

function openSearch(): void {
  if (searchOverlay) { const inp = searchOverlay.querySelector('.search-input') as HTMLInputElement; inp.focus(); inp.select(); return; }
  searchOverlay = document.createElement('div');
  searchOverlay.className = 'search-overlay';
  searchOverlay.innerHTML = `
    <div class="search-bar" style="flex-direction:column;align-items:stretch;min-width:300px;">
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="text" class="search-input" style="flex:1;" placeholder="Search sessions or terminal text..." autocomplete="off" spellcheck="false" />
        <span class="search-count" id="searchCount"></span>
        <button class="search-nav" data-dir="prev" title="Previous (Shift+Enter)">&uarr;</button>
        <button class="search-nav" data-dir="next" title="Next (Enter)">&darr;</button>
        <button class="search-close" title="Close (Escape)">&times;</button>
      </div>
      <div class="search-session-list" style="display:none;margin-top:6px;max-height:200px;overflow-y:auto;border-top:1px solid var(--border-soft);padding-top:4px;"></div>
    </div>`;
  document.querySelector('.workspace')?.prepend(searchOverlay);
  const searchInput = searchOverlay.querySelector('.search-input') as HTMLInputElement;
  const searchCount = searchOverlay.querySelector('#searchCount') as HTMLElement;
  const sessionList = searchOverlay.querySelector('.search-session-list') as HTMLDivElement;

  function renderSessionList(query: string): void {
    if (!query.trim()) { sessionList.style.display = 'none'; sessionList.innerHTML = ''; return; }
    const q = query.toLowerCase();
    const matches = sessions.filter((s) => s.displayName.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    if (matches.length === 0) { sessionList.style.display = 'none'; sessionList.innerHTML = ''; return; }
    sessionList.style.display = 'block';
    sessionList.innerHTML = '';
    for (const s of matches) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;cursor:pointer;font-size:12px;font-family:var(--font-mono);color:var(--text);';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.06)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      const dot = document.createElement('span');
      dot.style.cssText = `width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${s.connected ? 'var(--accent)' : 'var(--dim)'};`;
      const label = document.createElement('span');
      label.textContent = s.displayName;
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';
      row.append(dot, label);
      row.addEventListener('click', () => { activateSession(s); closeSearch(); });
      sessionList.appendChild(row);
    }
  }

  let debounceTimer: ReturnType<typeof setTimeout>;
  const doSearch = (forward: boolean): void => {
    const q = searchInput.value;
    if (!q || !activeSession) { searchCount.textContent = ''; return; }
    const addon = activeSession.searchAddon;
    const found = forward ? addon.findNext(q) : addon.findPrevious(q);
    searchCount.textContent = found ? '' : 'No match';
  };

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderSessionList(searchInput.value);
      // Fall through to xterm text search if no session matches
      const hasSessionMatch = sessionList.style.display !== 'none' && sessionList.children.length > 0;
      if (!hasSessionMatch) doSearch(true);
    }, 150);
  });
  searchInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstRow = sessionList.querySelector('div') as HTMLElement | null;
      if (sessionList.style.display !== 'none' && firstRow) { firstRow.click(); return; }
      doSearch(!e.shiftKey);
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  searchOverlay.querySelector('.search-nav[data-dir="next"]')?.addEventListener('click', () => doSearch(true));
  searchOverlay.querySelector('.search-nav[data-dir="prev"]')?.addEventListener('click', () => doSearch(false));
  searchOverlay.querySelector('.search-close')?.addEventListener('click', closeSearch);
  setTimeout(() => { searchInput.focus(); searchInput.select(); }, 0);
}

function closeSearch(): void {
  if (searchOverlay) { searchOverlay.remove(); searchOverlay = null; }
  activeSession?.searchAddon.clearDecorations();
  activeSession?.focus();
}

document.querySelector('.search-box')?.addEventListener('click', openSearch);

// ---------------------------------------------------------------------------
// Settings drawer
// ---------------------------------------------------------------------------
let drawerTab = 'appearance';

function openDrawer(): void {
  renderDrawer();
  overlayEl.classList.add('open');
  drawerEl.classList.add('open');
}
function closeDrawer(): void {
  overlayEl.classList.remove('open');
  drawerEl.classList.remove('open');
  if (!window.matchMedia('(pointer: coarse)').matches) activeSession?.focus();
}
overlayEl.addEventListener('click', closeDrawer);
document.getElementById('closeDrawer')?.addEventListener('click', closeDrawer);

// Drawer tab switching
drawerTabsEl.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest('.dtab');
  if (tab) {
    drawerTab = (tab as HTMLElement).dataset.tab ?? 'appearance';
    renderDrawer();
  }
});

function renderDrawer(): void {
  // Update active tab state
  drawerTabsEl.querySelectorAll('.dtab').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === drawerTab);
  });

  if (drawerTab === 'appearance') {
    drawerBody.innerHTML = `
      <div class="section">
        <div class="section-title">Theme</div>
        <div class="theme-grid" id="themeGrid"></div>
        <div class="color-grid" id="customColors" style="display:none"></div>
      </div>
      <div class="section">
        <div class="section-title">Typography</div>
        <div class="row"><label>Terminal font</label>
          <select id="fontSelect">
            ${['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'IBM Plex Mono'].map((f) => `<option ${settings.font === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="row"><label>Font size<span class="hint">${settings.fontSize}px</span></label>
          <input type="range" id="fontSize" min="11" max="20" value="${settings.fontSize}">
        </div>
        <div class="row"><label>Line height<span class="hint">${settings.lineHeight.toFixed(1)}</span></label>
          <input type="range" id="lineHeight" min="1.1" max="2" step="0.1" value="${settings.lineHeight}">
        </div>
      </div>
      <div class="section">
        <div class="section-title">Cursor</div>
        <div class="row"><label>Cursor style</label>
          <div class="seg" id="cursorSeg">
            ${['bar', 'block', 'underline'].map((s) => `<button data-v="${s}" class="${settings.cursorStyle === s ? 'active' : ''}">${s}</button>`).join('')}
          </div>
        </div>
        <div class="row"><label>Blink cursor</label>
          <div class="switch ${settings.cursorBlink ? 'on' : ''}" id="blinkSwitch"></div>
        </div>
      </div>`;

    // Theme grid
    const grid = document.getElementById('themeGrid')!;
    for (const key of ['aurora', 'nord', 'solaris', 'ink']) {
      const t = THEMES[key];
      const card = document.createElement('div');
      card.className = 'theme-card' + (key === currentTheme ? ' selected' : '');
      card.innerHTML = `<div class="swatch-row">
          <div class="swatch" style="background:${t.bg}"></div>
          <div class="swatch" style="background:${t.accent}"></div>
          <div class="swatch" style="background:${t.accent2}"></div>
        </div><div class="theme-name">${t.name}</div>`;
      card.addEventListener('click', () => { applyTheme(key); showToast(`Theme: ${t.name}`); });
      grid.appendChild(card);
    }
    // Custom theme card
    const customCard = document.createElement('div');
    customCard.id = 'customThemeCard';
    customCard.className = 'theme-card' + (currentTheme === 'custom' ? ' selected' : '');
    customCard.innerHTML = `<div class="swatch-row">
        <div class="swatch sw-bg" style="background:${THEMES.custom.bg}"></div>
        <div class="swatch sw-accent" style="background:${THEMES.custom.accent}"></div>
        <div class="swatch sw-accent2" style="background:${THEMES.custom.accent2}"></div>
      </div><div class="theme-name">Custom</div>`;
    customCard.addEventListener('click', () => { applyTheme('custom'); renderDrawer(); showToast('Custom theme active — edit colors below'); });
    grid.appendChild(customCard);

    // Custom color pickers
    const colorGrid = document.getElementById('customColors')!;
    if (currentTheme === 'custom') {
      colorGrid.style.display = 'grid';
      const fields: [keyof ThemeDef, string][] = [
        ['bg', 'Background'], ['panel', 'Panel'], ['pane', 'Terminal'], ['border', 'Border'],
        ['text', 'Text'], ['muted', 'Muted'], ['accent', 'Accent'], ['accent2', 'Accent 2'],
      ];
      colorGrid.innerHTML = fields.map(([key, label]) => `
        <label class="color-field"><span>${label}</span><input type="color" data-key="${key}" value="${THEMES.custom[key]}"></label>`).join('');
      colorGrid.querySelectorAll('input[type=color]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          const key = target.dataset.key as keyof ThemeDef;
          if (key) { (THEMES.custom as unknown as Record<string, string>)[key] = target.value; applyCustomLive(); }
        });
      });
    }

    // Font select
    document.getElementById('fontSelect')?.addEventListener('change', (e) => {
      settings.font = (e.target as HTMLSelectElement).value;
      for (const s of sessions) s.term.options.fontFamily = `'${settings.font}', monospace`;
      activeSession?.fit();
    });
    // Font size
    document.getElementById('fontSize')?.addEventListener('input', (e) => {
      settings.fontSize = +(e.target as HTMLInputElement).value;
      currentFont = settings.fontSize;
      for (const s of sessions) s.setFont(settings.fontSize);
      renderDrawer();
    });
    // Line height
    document.getElementById('lineHeight')?.addEventListener('input', (e) => {
      settings.lineHeight = +(e.target as HTMLInputElement).value;
      for (const s of sessions) s.term.options.lineHeight = settings.lineHeight;
      activeSession?.fit();
      renderDrawer();
    });
    // Cursor style
    document.getElementById('cursorSeg')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-v]') as HTMLElement;
      if (btn) {
        settings.cursorStyle = btn.dataset.v as typeof settings.cursorStyle;
        for (const s of sessions) s.term.options.cursorStyle = settings.cursorStyle;
        renderDrawer();
      }
    });
    // Cursor blink
    document.getElementById('blinkSwitch')?.addEventListener('click', () => {
      settings.cursorBlink = !settings.cursorBlink;
      for (const s of sessions) s.term.options.cursorBlink = settings.cursorBlink;
      renderDrawer();
    });
  }

  if (drawerTab === 'behavior') {
    drawerBody.innerHTML = `
      <div class="section">
        <div class="section-title">General</div>
        <div class="row"><label>Confirm before closing tab<span class="hint">Shows a dialog when closing tabs with running processes</span></label>
          <div class="switch ${settings.confirmClose ? 'on' : ''}" id="confirmSwitch"></div>
        </div>
        <div class="row"><label>Bell sound<span class="hint">Beep when terminal BEL character is received</span></label>
          <div class="switch ${settings.bellSound ? 'on' : ''}" id="bellSwitch"></div>
        </div>
      </div>`;
    document.getElementById('confirmSwitch')?.addEventListener('click', () => { settings.confirmClose = !settings.confirmClose; renderDrawer(); });
    document.getElementById('bellSwitch')?.addEventListener('click', () => { settings.bellSound = !settings.bellSound; renderDrawer(); });
  }

  if (drawerTab === 'keybinds') {
    drawerBody.innerHTML = `
      <div class="section">
        <div class="section-title">Tab & panel navigation</div>
        <div id="kbList"></div>
        <a class="reset-link" id="resetKb">Reset to defaults</a>
      </div>`;
    const list = document.getElementById('kbList')!;
    const KB_LABELS: Record<string, [string, string]> = {
      newTab: ['New tab', 'Open a new terminal tab'],
      closeTab: ['Close tab', 'Close the active tab'],
      nextTab: ['Next tab', 'Switch to the next tab'],
      prevTab: ['Previous tab', 'Switch to the previous tab'],
      splitRight: ['Split right', 'Split focused pane vertically'],
      splitDown: ['Split down', 'Split focused pane horizontally'],
      singleLayout: ['Single layout', 'Merge to one pane (close others)'],
      clearPane: ['Clear pane', 'Clear the focused pane content'],
    };
    for (const [action, [label, desc]] of Object.entries(KB_LABELS)) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      row.innerHTML = `<div><div class="kb-label">${label}</div><div class="kb-desc">${desc}</div></div>
        <button class="kb-badge" data-action="${action}">${keybinds[action]}</button>`;
      list.appendChild(row);
    }
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.kb-badge') as HTMLElement;
      if (btn) startRecording(btn, btn.dataset.action!);
    });
    document.getElementById('resetKb')?.addEventListener('click', () => {
      keybinds.newTab = 'Ctrl+T';
      keybinds.closeTab = 'Ctrl+W';
      keybinds.nextTab = 'Ctrl+Tab';
      keybinds.prevTab = 'Ctrl+Shift+Tab';
      keybinds.splitRight = 'Ctrl+Shift+→';
      keybinds.splitDown = 'Ctrl+Shift+↓';
      keybinds.singleLayout = 'Ctrl+Shift+↑';
      keybinds.clearPane = 'Ctrl+K';
      renderDrawer();
      showToast('Keybinds reset to defaults');
    });
  }
}

function applyTheme(key: string): void {
  currentTheme = key;
  pushCssVars(THEMES[key]);
  // Update all open terminals
  for (const s of sessions) {
    s.term.options.theme = XTERM_THEME as never;
  }
  renderDrawer();
}

function applyCustomLive(): void {
  currentTheme = 'custom';
  pushCssVars(THEMES.custom);
  for (const s of sessions) {
    s.term.options.theme = XTERM_THEME as never;
  }
  const card = document.getElementById('customThemeCard');
  if (card) {
    card.classList.add('selected');
    const swatchBg = card.querySelector('.sw-bg') as HTMLElement | null;
    const swatchAccent = card.querySelector('.sw-accent') as HTMLElement | null;
    const swatchAccent2 = card.querySelector('.sw-accent2') as HTMLElement | null;
    if (swatchBg) swatchBg.style.background = THEMES.custom.bg;
    if (swatchAccent) swatchAccent.style.background = THEMES.custom.accent;
    if (swatchAccent2) swatchAccent2.style.background = THEMES.custom.accent2;
    document.querySelectorAll('.theme-card').forEach((c) => { if (c !== card) c.classList.remove('selected'); });
  }
}

// Keybind system
const keybinds: Record<string, string> = {
  newTab: 'Ctrl+T',
  closeTab: 'Ctrl+W',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  splitRight: 'Ctrl+Shift+→',
  splitDown: 'Ctrl+Shift+↓',
  singleLayout: 'Ctrl+Shift+↑',
  clearPane: 'Ctrl+K',
};

let recordingBtn: HTMLElement | null = null;
let recordingAction: string | null = null;

function startRecording(btn: HTMLElement, action: string): void {
  if (recordingBtn) recordingBtn.classList.remove('recording');
  recordingBtn = btn;
  recordingAction = action;
  btn.textContent = 'Press a key...';
  btn.classList.add('recording');
}
function stopRecording(): void {
  if (recordingBtn) recordingBtn.classList.remove('recording');
  recordingBtn = null;
  recordingAction = null;
}

const ARROW: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = ARROW[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) parts.push(k);
  return parts.join('+');
}

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const tag = ((e as KeyboardEvent).target as HTMLElement)?.tagName?.toLowerCase() ?? '';
  // Keybind recording mode
  if (recordingAction) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    const combo = comboFromEvent(e);
    keybinds[recordingAction] = combo;
    showToast(`Keybind: ${combo}`);
    stopRecording();
    renderDrawer();
    return;
  }
  if (tag === 'input' || tag === 'textarea') return;
  // Ctrl+F / Cmd+F — open search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch(); return; }
  const combo = comboFromEvent(e);
  for (const [action, bound] of Object.entries(keybinds)) {
    if (bound === combo) {
      e.preventDefault();
      runAction(action);
      return;
    }
  }
});

function runAction(action: string): void {
  const td = activeTabData();
  switch (action) {
    case 'newTab': openNewTabModal(); break;
    case 'closeTab': if (activeSession) confirmCloseSession(activeSession); break;
    case 'nextTab': navigateTab(1); break;
    case 'prevTab': navigateTab(-1); break;
    case 'splitRight': if (td) { splitPaneId(td, td.focused, 'row'); showToast('Split right'); } break;
    case 'splitDown': if (td) { splitPaneId(td, td.focused, 'col'); showToast('Split bottom'); } break;
    case 'singleLayout': if (td) { setSingleLayout(td); showToast('Single layout'); } break;
    case 'clearPane': if (td) clearFocusedPane(td); break;
  }
}

function navigateTab(dir: number): void {
  if (sessions.length < 2) return;
  const idx = sessions.findIndex((s) => s === activeSession);
  const next = sessions[(idx + dir + sessions.length) % sessions.length];
  if (next) activateSession(next);
}

// ---------------------------------------------------------------------------
// New tab modal
// ---------------------------------------------------------------------------
function openNewTabModal(): void {
  newTabInput.value = nextSessionName();
  modalOverlay.classList.add('open');
  setTimeout(() => { newTabInput.focus(); newTabInput.select(); }, 50);
}
function closeModal(): void { modalOverlay.classList.remove('open'); }

document.getElementById('modalCancel')?.addEventListener('click', closeModal);
document.getElementById('modalCreate')?.addEventListener('click', confirmNewTab);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
newTabInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); confirmNewTab(); }
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
});

function confirmNewTab(): void {
  const name = newTabInput.value.trim() || nextSessionName();
  const sanitized = sanitizeName(name) ?? name;
  const s = addSession(sanitized, true);
  // Create TabData for the new tab so renderPanes() has a split-tree to render
  const leafId = paneSeq++;
  const td: TabData = { id: ++paneSeq, title: sanitized, root: { type: 'leaf', id: leafId, session: s }, focused: leafId };
  tabDataList.push(td);
  activeTabId = td.id;
  renderPanes();
  closeModal();
  showToast(`Tab "${sanitized}" created`);
}

// ---------------------------------------------------------------------------
// On-screen key bar (touch devices)
// ---------------------------------------------------------------------------
interface KeyDef { label?: string; seq?: string; mod?: 'ctrl' | 'alt'; action?: 'copy' | 'paste' | 'select'; rowBreak?: boolean; }
const KEYS: KeyDef[] = [
  { label: 'Esc', seq: '\x1b' }, { label: 'Tab', seq: '\t' },
  { label: 'Ctrl', mod: 'ctrl' }, { label: 'Alt', mod: 'alt' },
  { label: '^C', seq: '\x03' }, { label: 'Enter', seq: '\r' },
  { label: 'Select', action: 'select' },
  { rowBreak: true },
  { label: '←', seq: '\x1b[D' }, { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' }, { label: '→', seq: '\x1b[C' },
];

let ctrlArmed = false, altArmed = false;
const modButtons: Partial<Record<'ctrl' | 'alt', HTMLElement>> = {};
let selectBtn: HTMLElement | null = null;
let keysBtn: HTMLButtonElement | null = null;

function refreshModVisuals(): void {
  modButtons.ctrl?.classList.toggle('armed', ctrlArmed);
  modButtons.alt?.classList.toggle('armed', altArmed);
}

function applyMods(seq: string): string {
  if (!ctrlArmed && !altArmed) return seq;
  if (/^\x1b\[[ABCD]$/.test(seq)) {
    const mod = 1 + (altArmed ? 2 : 0) + (ctrlArmed ? 4 : 0);
    return `\x1b[1;${mod}${seq[seq.length - 1]}`;
  }
  if (seq.length === 1) {
    let ch = seq;
    if (ctrlArmed) { const code = ch.toUpperCase().charCodeAt(0); if (code >= 64 && code <= 95) ch = String.fromCharCode(code & 0x1f); }
    if (altArmed) ch = '\x1b' + ch;
    return ch;
  }
  return seq;
}

for (const def of KEYS) {
  if (def.rowBreak) {
    const brk = document.createElement('div');
    brk.className = 'kb-break';
    keybarEl.append(brk);
    continue;
  }
  const b = document.createElement('button');
  b.className = 'kb-key';
  b.type = 'button';
  b.textContent = def.label ?? '';
  b.title = def.label ?? '';
  if (def.mod) modButtons[def.mod] = b;
  if (def.action === 'select') selectBtn = b;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const refocus = e.pointerType !== 'touch';
    if (def.action === 'select') {
      touchSelectMode = !touchSelectMode;
      selectBtn?.classList.toggle('armed', touchSelectMode);
      if (!touchSelectMode) activeSession?.term.clearSelection();
      flashStatus(touchSelectMode ? 'Select mode: drag to select, lift to copy' : 'Select off', 1600);
      return;
    }
    if (def.action === 'copy') {
      const sel = activeSession?.term.getSelection() ?? '';
      if (sel) void copyText(sel).then((ok) => flashStatus(ok ? 'copied' : 'copy failed', 1200));
      else flashStatus('nothing selected', 1200);
      if (refocus) activeSession?.focus();
      return;
    }
    if (def.action === 'paste') { pasteFromClipboard(); if (refocus) activeSession?.focus(); return; }
    if (def.mod) { if (def.mod === 'ctrl') ctrlArmed = !ctrlArmed; else altArmed = !altArmed; refreshModVisuals(); return; }
    if (def.seq !== undefined) activeSession?.sendSeq(applyMods(def.seq));
    if (ctrlArmed || altArmed) { ctrlArmed = false; altArmed = false; refreshModVisuals(); }
    if (refocus) activeSession?.focus();
  });
  keybarEl.append(b);
}

// ---------------------------------------------------------------------------
// Mobile UI
// ---------------------------------------------------------------------------
const mobilebar = document.getElementById('mobilebar')!;

function mBtn(label: string, title: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'm-btn';
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
  return b;
}

const mMenuBtn = mBtn('☰', 'Sessions', () => openMobileDrawer());
const mTitle = document.createElement('button');
mTitle.className = 'm-title';
mTitle.type = 'button';
const mTitleDot = document.createElement('span');
mTitleDot.className = 'tab-dot';
const mTitleLabel = document.createElement('span');
mTitleLabel.className = 'm-title-label';
const mCaret = document.createElement('span');
mCaret.className = 'm-caret';
mCaret.textContent = '▾';
mTitle.append(mTitleDot, mTitleLabel, mCaret);
mTitle.addEventListener('pointerdown', (e) => { e.preventDefault(); openMobileDrawer(); });

// File attach
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.append(fileInput);
fileInput.addEventListener('change', () => {
  if (fileInput.files) { for (const f of Array.from(fileInput.files)) void uploadFile(f, f.name); }
  fileInput.value = '';
});

const mAttachBtn = document.createElement('button');
mAttachBtn.className = 'm-btn';
mAttachBtn.type = 'button';
mAttachBtn.textContent = '📎';
mAttachBtn.title = 'Attach a file';
mAttachBtn.setAttribute('aria-label', 'Attach a file');
mAttachBtn.addEventListener('click', () => fileInput.click());
const mKeysBtn = mBtn('⌨', 'Toggle on-screen keys', () => { setKeybarVisible(keybarEl.classList.contains('hidden')); });
const mMoreBtn = mBtn('⋯', 'More actions', () => openSheet());

mobilebar.append(mMenuBtn, mTitle, mAttachBtn, mKeysBtn, mMoreBtn);

// Mobile sessions drawer (bottom sheet)
const drawerOverlay = document.createElement('div');
drawerOverlay.className = 'sheet-overlay hidden';
const drawerSheet = document.createElement('div');
drawerSheet.className = 'sheet';
const drawerGrip = document.createElement('div');
drawerGrip.className = 'sheet-grip';
const drawerSheetTitle = document.createElement('div');
drawerSheetTitle.className = 'sheet-title';
drawerSheetTitle.textContent = 'Sessions';
const drawerList = document.createElement('div');
drawerList.className = 'drawer-list';
const drawerNewBtn = document.createElement('button');
drawerNewBtn.className = 'drawer-new';
drawerNewBtn.type = 'button';
drawerNewBtn.textContent = '+  New session';
drawerNewBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); closeMobileDrawer(); openNewTabModal(); });
drawerSheet.append(drawerGrip, drawerSheetTitle, drawerList, drawerNewBtn);
drawerOverlay.append(drawerSheet);
document.body.append(drawerOverlay);
drawerOverlay.addEventListener('pointerdown', (e) => { if (e.target === drawerOverlay) closeMobileDrawer(); });

let mobileDrawerOpen = false;

function renderMobileDrawerList(): void {
  drawerList.textContent = '';
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'drawer-row' + (s === activeSession ? ' active' : '');
    const body = document.createElement('div');
    body.className = 'drawer-body';
    const dot = document.createElement('span');
    dot.className = 'tab-dot' + (s.connected ? ' connected' : '');
    const name = document.createElement('span');
    name.className = 'drawer-name';
    name.textContent = s.displayName;
    body.append(dot, name);
    body.addEventListener('pointerdown', (e) => { e.preventDefault(); activateSession(s); closeMobileDrawer(); });
    const rename = document.createElement('button');
    rename.className = 'drawer-act';
    rename.type = 'button';
    rename.textContent = '✎';
    rename.title = 'Rename tab';
    rename.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); promptRenameSession(s); renderMobileDrawerList(); });
    const close = document.createElement('button');
    close.className = 'drawer-act danger';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close tab & kill session';
    close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); closeMobileDrawer(); confirmCloseSession(s); });
    row.append(body, rename, close);
    drawerList.append(row);
  }
}

function openMobileDrawer(): void { renderMobileDrawerList(); drawerOverlay.classList.remove('hidden'); mobileDrawerOpen = true; }
function closeMobileDrawer(): void { drawerOverlay.classList.add('hidden'); mobileDrawerOpen = false; }

// Mobile actions sheet
const sheetOverlay = document.createElement('div');
sheetOverlay.className = 'sheet-overlay hidden';
const sheet = document.createElement('div');
sheet.className = 'sheet';
const sheetGrip = document.createElement('div');
sheetGrip.className = 'sheet-grip';
const sheetTitle = document.createElement('div');
sheetTitle.className = 'sheet-title';
sheetTitle.textContent = 'Actions';

const fontRow = document.createElement('div');
fontRow.className = 'sheet-font';
const fontMinus = document.createElement('button');
fontMinus.className = 'sf-btn';
fontMinus.type = 'button';
fontMinus.textContent = 'A−';
const fontVal = document.createElement('div');
fontVal.className = 'sf-val';
const fontPlus = document.createElement('button');
fontPlus.className = 'sf-btn';
fontPlus.type = 'button';
fontPlus.textContent = 'A+';
function updateFontVal(): void { fontVal.textContent = `Font ${currentFont}px`; }
fontMinus.addEventListener('pointerdown', (e) => { e.preventDefault(); changeFont(-1); updateFontVal(); });
fontPlus.addEventListener('pointerdown', (e) => { e.preventDefault(); changeFont(1); updateFontVal(); });
fontRow.append(fontMinus, fontVal, fontPlus);

function sheetRow(ico: string, label: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sheet-row';
  b.type = 'button';
  const i = document.createElement('span');
  i.className = 'sheet-ico';
  i.textContent = ico;
  const t = document.createElement('span');
  t.textContent = label;
  b.append(i, t);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
  return b;
}

sheet.append(
  sheetGrip, sheetTitle, fontRow,
  sheetRow('⟳', 'Restart this session', () => { closeSheet(); activeSession?.restart(); activeSession?.focus(); }),
  sheetRow('📋', 'Paste', () => { closeSheet(); pasteFromClipboard(); }),
  sheetRow('⬇', 'Download file', () => { closeSheet(); void (async () => { const p = await domPrompt({ label: 'Enter file path to download', value: '~/', okText: 'Download' }); if (p) void downloadFromHost(p); })(); }),
  sheetRow('⤢', 'Toggle fullscreen', () => { closeSheet(); toggleFullscreen(); }),
  sheetRow('⚙', 'Settings', () => { closeSheet(); openDrawer(); }),
  sheetRow('?', 'Help: copy / paste / files', () => { closeSheet(); openHelp(); }),
);
sheetOverlay.append(sheet);
document.body.append(sheetOverlay);
sheetOverlay.addEventListener('pointerdown', (e) => { if (e.target === sheetOverlay) closeSheet(); });

function openSheet(): void { updateFontVal(); sheetOverlay.classList.remove('hidden'); }
function closeSheet(): void { sheetOverlay.classList.add('hidden'); }

function changeFont(delta: number): void {
  currentFont = Math.min(MAX_FONT, Math.max(MIN_FONT, currentFont + delta));
  settings.fontSize = currentFont;
  try { localStorage.setItem('tw.fontSize', String(currentFont)); } catch { /* ignore */ }
  for (const s of sessions) s.setFont(currentFont);
  activeSession?.focus();
}

function refreshMobileUI(): void {
  const s = activeSession;
  mTitleLabel.textContent = s ? s.displayName : '—';
  mTitleDot.classList.toggle('connected', !!s?.connected);
  mKeysBtn.classList.toggle('active', !keybarEl.classList.contains('hidden'));
  if (mobileDrawerOpen) renderMobileDrawerList();
}

// ---------------------------------------------------------------------------
// File upload / download
// ---------------------------------------------------------------------------
function uploadFile(file: Blob, name?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!file) { resolve(); return; }
    const target = activeSession;
    const label = name ?? 'file';
    showStatus(`uploading ${label}... 0%`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload' + (name ? `?name=${encodeURIComponent(name)}` : ''));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e): void => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        showStatus(`uploading ${label}... ${pct}% (${fmtMB(e.loaded)}/${fmtMB(e.total)} MB)`);
      } else {
        showStatus(`uploading ${label}... ${fmtMB(e.loaded)} MB`);
      }
    };
    xhr.upload.onload = (): void => showStatus(`uploading ${label}... finishing...`);
    xhr.onload = (): void => {
      let data: { path?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText) as typeof data; } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.path) {
        if (target) {
          const p = /\s/.test(data.path) ? `'${data.path.replace(/'/g, `'\\''`)}'` : data.path;
          target.sendSeq(p + ' ');
          if (isActive(target)) target.focus();
        }
        const where = target && !isActive(target) ? ` -> ${target.displayName}` : '';
        flashStatus(`file added${where}: ${data.path}`, 2500);
      } else {
        flashStatus(data.error ? `upload failed: ${data.error}` : 'file upload failed', 3500);
      }
      resolve();
    };
    xhr.onerror = (): void => { flashStatus('file upload failed', 2500); resolve(); };
    xhr.send(file);
  });
}

async function downloadFromHost(rawPath: string): Promise<void> {
  const p = rawPath.trim();
  if (!p) return;
  const url = '/api/download?path=' + encodeURIComponent(p);
  showStatus(`preparing ${p}...`);
  let head: Response;
  try { head = await fetch(url, { method: 'HEAD' }); } catch { flashStatus('download failed (network)', 2500); return; }
  if (!head.ok) {
    const why = head.status === 404 ? 'not found' : head.status === 400 ? 'bad path' : `error ${head.status}`;
    flashStatus(`download failed: ${why}`, 3000);
    return;
  }
  const size = Number(head.headers.get('content-length') ?? '0');
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = p.split('/').pop() || 'download';
  document.body.append(a);
  a.click();
  a.remove();
  flashStatus(`downloading ${a.download}${size ? ` (${fmtMB(size)} MB)` : ''}...`, 2500);
}

// Paste / drag-drop file handling
window.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (PASTE_DEBUG) {
    const cd = e.clipboardData;
    let kinds = '(no items)';
    if (items) { const parts: string[] = []; for (let i = 0; i < items.length; i += 1) parts.push(`${items[i].kind}/${items[i].type}`); kinds = parts.length ? parts.join(',') : '(empty)'; }
    const types = cd && cd.types ? Array.from(cd.types).join('|') : '(none)';
    activeSession?.debugSend('paste', `types=[${types}] items=[${kinds}] files=${cd?.files?.length ?? 0}`);
  }
  const dt = e.clipboardData;
  if (!dt) return;
  const files: File[] = [];
  if (items) { for (let i = 0; i < items.length; i += 1) { if (items[i].kind === 'file') { const f = items[i].getAsFile(); if (f) files.push(f); } } }
  if (files.length === 0 && dt.files) { for (let i = 0; i < dt.files.length; i += 1) files.push(dt.files[i]); }
  if (files.length > 0) { e.preventDefault(); e.stopImmediatePropagation(); for (const f of files) void uploadFile(f, f.name); return; }
  const html = dt.getData ? dt.getData('text/html') : '';
  if (html) {
    const src = new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') ?? '';
    if (src.startsWith('data:image/') || src.startsWith('blob:')) {
      e.preventDefault(); e.stopImmediatePropagation();
      void (async () => {
        try {
          const blob = await fetch(src).then((r) => r.blob());
          if (blob.type.startsWith('image/')) { const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'; await uploadFile(blob, `pasted-image.${ext}`); }
        } catch { flashStatus('paste: could not read the image', 2500); }
      })();
      return;
    }
  }
}, true);

function dragHasFile(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  for (let i = 0; i < dt.items.length; i += 1) { if (dt.items[i].kind === 'file') return true; }
  return false;
}
const workspaceEl = document.querySelector('.workspace') as HTMLElement;
workspaceEl?.addEventListener('dragover', (e) => {
  if (!dragHasFile((e as DragEvent).dataTransfer)) return;
  e.preventDefault();
  if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'copy';
  workspaceEl.classList.add('dragging');
});
workspaceEl?.addEventListener('dragleave', () => workspaceEl.classList.remove('dragging'));
workspaceEl?.addEventListener('drop', (e) => {
  workspaceEl.classList.remove('dragging');
  const files = (e as DragEvent).dataTransfer?.files;
  if (!files || files.length === 0) return;
  e.preventDefault();
  for (const f of Array.from(files)) void uploadFile(f, f.name);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const urlSession = sanitizeName(params.get('session'));
const cached = loadTabs();
let defaultSessionName = urlSession ?? cached.tabs[0]?.name ?? 'web';

async function init(): Promise<void> {
  const server = await fetchServerTabs();
  // localStorage is source of truth for tab ORDER; server is used to discover new sessions
  const savedNames = new Set(cached.tabs.map((t) => t.name));
  // Build merged list: cached order first, then any server-only sessions appended
  let initialTabs: SavedTab[];
  if (cached.tabs.length > 0) {
    initialTabs = cached.tabs.slice();
    for (const t of (server ?? [])) {
      if (!savedNames.has(t.name)) initialTabs.push(t);
    }
  } else if (server && server.length) {
    initialTabs = server;
  } else {
    initialTabs = [{ name: defaultSessionName, displayName: defaultSessionName }];
  }
  if (urlSession && !initialTabs.some((t) => t.name === urlSession)) initialTabs = [{ name: urlSession, displayName: urlSession }, ...initialTabs];
  defaultSessionName = urlSession ?? initialTabs[0]?.name ?? 'web';

  // Create all saved tabs in order
  for (const t of initialTabs) {
    const td: TabData = { id: tabIdSeq++, title: t.displayName, root: { type: 'leaf', id: paneSeq++, session: null as unknown as Session }, focused: paneSeq - 1 };
    const s = addSession(t.name, false, t.displayName);
    const leafId = td.root.type === 'leaf' ? td.root.id : paneSeq++;
    td.root = { type: 'leaf', id: leafId, session: s };
    tabDataList.push(td);
  }
  // Activate the saved active tab or the first one
  const activeName = cached.active || urlSession || initialTabs[0]?.name;
  const targetSession = sessions.find((s) => s.name === activeName) || sessions[0];
  if (targetSession) activateSession(targetSession);
  renderPanes();
}

void init();

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncFromServer(); });
window.addEventListener('focus', () => void syncFromServer());
setInterval(() => { if (document.visibilityState === 'visible') void syncFromServer(); }, 5000);

const keybarDefault = (() => {
  try { const v = localStorage.getItem('tw.keybar'); if (v !== null) return v === '1'; } catch { /* ignore */ }
  return window.matchMedia('(pointer: coarse)').matches;
})();
setKeybarVisible(keybarDefault);

try { if (!localStorage.getItem('tw.helpSeen')) window.setTimeout(openHelp, 700); } catch { /* ignore */ }

window.addEventListener('resize', () => { updateKeybarHeight(); fitActive(); });
mobileMQ.addEventListener('change', () => { updateKeybarHeight(); fitActive(); });
if (typeof ResizeObserver !== 'undefined') { const areaObserver = new ResizeObserver(() => fitActive()); areaObserver.observe(paneGrid); }
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateKeyboardOffset);
  window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
  if (VV_DEBUG) window.setTimeout(updateKeyboardOffset, 1500);
}
window.addEventListener('beforeunload', () => { for (const s of sessions) s.dispose(); });

// Apply initial theme
pushCssVars(THEMES.aurora);

// Simulate reconnect -> connected on first load
connDot.classList.add('reconnecting');
connDot.style.background = '#f0b429';
connLabel.textContent = 'reconnecting...';
setTimeout(() => { connDot.classList.remove('reconnecting'); connDot.style.background = '#86efac'; connLabel.textContent = 'connected'; }, 1200);
