import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';

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
};
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
  r.setProperty('--accent-soft', t.accent + '24');
  // Update xterm theme to match
  XTERM_THEME.background = t.pane;
  XTERM_THEME.foreground = t.text;
  XTERM_THEME.cursor = t.accent;
  XTERM_THEME.cursorAccent = t.pane;
  XTERM_THEME.selectionBackground = t.accent;
}


// xterm theme (starts with aurora; pushed by applyTheme)
const XTERM_THEME: Record<string, string> = {
  background: '#101217',
  foreground: '#e7e9ee',
  cursor: '#5eead4',
  cursorAccent: '#101217',
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
const termArea = document.getElementById('terminal')!;
const keybarEl = document.getElementById('keybar')!;
const statusEl = document.getElementById('status');
const tabsEl = document.getElementById('tabs')!;
const controlsEl = document.getElementById('controls')!;

const connDot = document.getElementById('connDot')!;
const connLabel = document.getElementById('connLabel')!;
const layoutLabel = document.getElementById('layoutLabel')!;

let currentFont = (() => {
  try {
    const n = parseInt(localStorage.getItem('tw.fontSize') ?? '', 10);
    if (!Number.isNaN(n)) return Math.min(MAX_FONT, Math.max(MIN_FONT, n));
  } catch { /* ignore */ }
  return 14;
})();

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

// ---------------------------------------------------------------------------
// Session class — one real terminal per tmux session
// ---------------------------------------------------------------------------
class Session {
  readonly name: string;
  displayName: string;
  readonly term: Terminal;
  readonly el: HTMLElement;
  tabEl: HTMLElement | null = null;
  tabLabel: HTMLElement | null = null;
  tabDot: HTMLElement | null = null;
  connected = false;
  everConnected = false;

  private readonly fitAddon = new FitAddon();
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

  constructor(name: string, displayName?: string) {
    this.name = name;
    this.displayName = displayName?.trim() || name;
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: currentFont,
      scrollback: 100000,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      theme: XTERM_THEME as never,
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.el = document.createElement('div');
    this.el.className = 'term-pane hidden';
    termArea.append(this.el);
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
    try { this.fitAddon.fit(); } catch { /* not laid out yet */ }
    this.sendResize();
  }

  setFont(px: number): void { this.term.options.fontSize = px; this.fit(); }

  setActive(active: boolean): void {
    this.el.classList.toggle('hidden', !active);
    if (active) {
      requestAnimationFrame(() => {
        this.fit();
        if (!window.matchMedia('(pointer: coarse)').matches) this.term.focus();
      });
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
    if (isActive(this)) showStatus('reconnecting…');
    const base = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_DELAY);
    const delay = Math.round(base * (0.5 + Math.random()));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private connect(): void {
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
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    try { this.term.dispose(); } catch { /* ignore */ }
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// Tab / session manager
// ---------------------------------------------------------------------------
const sessions: Session[] = [];
let activeSession: Session | null = null;

function isActive(s: Session): boolean { return activeSession === s; }
function reflectActiveStatus(): void { if (activeSession && activeSession.connected) hideStatus(); else showStatus('reconnecting…'); }
function updateTabDot(s: Session): void { s.tabDot?.classList.toggle('connected', s.connected); refreshMobileUI(); }

function buildTab(s: Session): void {
  const tab = document.createElement('div');
  tab.className = 'tab';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = s.displayName;
  label.title = `session: ${s.name} (double-click to rename)`;
  const close = document.createElement('span');
  close.className = 'close';
  close.textContent = '✕';
  close.title = 'Close tab & kill session';
  tab.append(dot, label, close);

  let lastTap = 0;
  tab.addEventListener('pointerdown', (e) => {
    if (e.target === close) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap < 350) { lastTap = 0; promptRenameSession(s); return; }
    lastTap = now;
    activateSession(s);
  });
  close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); confirmCloseSession(s); });

  s.tabEl = tab;
  s.tabLabel = label;
  s.tabDot = dot;
  tabsEl.insertBefore(tab, document.getElementById('addTab'));
  updateTabDot(s);
  refreshMobileUI();
}

function addSession(name: string, makeActive: boolean, displayName?: string): Session {
  let s = sessions.find((x) => x.name === name);
  if (!s) {
    s = new Session(name, displayName);
    sessions.push(s);
    buildTab(s);
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
  for (const x of sessions) x.tabEl?.classList.toggle('active', x === s);
  s.tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  reflectActiveStatus();
  refreshMobileUI();
  updateStatusBar();
  saveTabs();
}

function confirmCloseSession(s: Session): void {
  if (document.querySelector('.confirm-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'paste-overlay confirm-overlay';
  const box = document.createElement('div');
  box.className = 'paste-box confirm-box';
  const label = document.createElement('div');
  label.className = 'paste-label';
  const strong = document.createElement('b');
  strong.textContent = s.displayName;
  const sessionNote = s.displayName === s.name ? '' : ` (tmux session "${s.name}")`;
  label.append('Close ', strong, `${sessionNote}? This kills its tmux session and ends any programs running in it.`);
  const row = document.createElement('div');
  row.className = 'paste-row';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.className = 'btn btn-primary';
  confirm.style.background = 'var(--danger)';
  confirm.type = 'button';
  confirm.textContent = 'Close & kill';
  row.append(cancel, confirm);
  box.append(label, row);
  overlay.append(box);
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
  s.tabEl?.remove();
  s.dispose();
  if (activeSession === s) {
    activeSession = null;
    const next = sessions[idx] ?? sessions[idx - 1] ?? null;
    if (next) activateSession(next);
  }
  if (sessions.length === 0) addSession(defaultSessionName, true);
  refreshMobileUI();
  updateStatusBar();
  saveTabs();
}

function nextSessionName(): string {
  const used = new Set(sessions.map((s) => s.name));
  for (const c of ['web', 'work', 'dev', 'scratch']) if (!used.has(c)) return c;
  let i = 2;
  while (used.has(`s${i}`)) i += 1;
  return `s${i}`;
}

async function promptAddSession(): Promise<void> {
  const suggestion = nextSessionName();
  const raw = await domPrompt({ label: 'New session name:', value: suggestion, okText: 'Create' });
  if (raw === null) return;
  addSession(sanitizeName(raw) ?? suggestion, true);
}

function setDisplayName(s: Session, displayName: string): void {
  s.displayName = displayName;
  if (s.tabLabel) { s.tabLabel.textContent = displayName; s.tabLabel.title = `session: ${s.name} (double-click to rename)`; }
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
  s.tabEl?.remove();
  s.dispose();
  if (activeSession === s) {
    activeSession = null;
    const next = sessions[idx] ?? sessions[idx - 1] ?? null;
    if (next) activateSession(next);
  }
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
// Layout: key bar height + iOS keyboard offset
// ---------------------------------------------------------------------------
function fitActive(): void { activeSession?.fit(); }

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
    connLabel.textContent = activeSession.connected ? 'connected' : 'reconnecting…';
    layoutLabel.textContent = '1 panel';
  }
}

// ---------------------------------------------------------------------------
// Top-bar controls + on-screen key bar
// ---------------------------------------------------------------------------
function makeButton(parent: HTMLElement, cls: string, label: string, title: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
  parent.append(b);
  return b;
}

function changeFont(delta: number): void {
  currentFont = Math.min(MAX_FONT, Math.max(MIN_FONT, currentFont + delta));
  try { localStorage.setItem('tw.fontSize', String(currentFont)); } catch { /* ignore */ }
  for (const s of sessions) s.setFont(currentFont);
  activeSession?.focus();
}

function toggleFullscreen(): void {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = root as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (!document.fullscreenElement && !d.webkitFullscreenElement) (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  else (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
  setTimeout(() => fitActive(), 100);
}

// Build controls
// Settings button (gear icon)
makeButton(controlsEl, 'tb-btn', '⚙', 'Settings', () => openDrawer());
// Sessions list button
makeButton(controlsEl, 'tb-btn', '☰', 'Sessions', () => openDrawer());
makeButton(controlsEl, 'tb-btn', 'A−', 'Smaller font', () => changeFont(-1));
makeButton(controlsEl, 'tb-btn', 'A+', 'Larger font', () => changeFont(1));
let keysBtn: HTMLButtonElement | null = null;
keysBtn = makeButton(controlsEl, 'tb-btn', '⌨', 'Toggle on-screen keys', () => {
  setKeybarVisible(keybarEl.classList.contains('hidden'));
  activeSession?.focus();
});
makeButton(controlsEl, 'tb-btn', '⟳', 'Restart this session', () => { activeSession?.restart(); activeSession?.focus(); });

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
const fileBtn = document.createElement('button');
fileBtn.className = 'tb-btn';
fileBtn.type = 'button';
fileBtn.title = 'Attach a file (upload + insert path)';
fileBtn.setAttribute('aria-label', 'Attach a file');
fileBtn.textContent = '📎';
fileBtn.addEventListener('click', () => fileInput.click());
controlsEl.append(fileBtn);

// Download
const dlBtn = document.createElement('button');
dlBtn.className = 'tb-btn';
dlBtn.type = 'button';
dlBtn.title = 'Download a file from the host';
dlBtn.setAttribute('aria-label', 'Download a file from the host');
dlBtn.textContent = '⬇';
dlBtn.addEventListener('click', () => {
  void (async () => {
    const p = await domPrompt({ label: 'Download a file from the host — enter its full path', value: '~/', okText: 'Download' });
    if (p) void downloadFromHost(p);
  })();
});
controlsEl.append(dlBtn);

makeButton(controlsEl, 'tb-btn', '⤢', 'Toggle fullscreen', toggleFullscreen);
makeButton(controlsEl, 'tb-btn', '?', 'Help: copy / paste / files', openHelp);

// On-screen key bar
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

const mMenuBtn = mBtn('☰', 'Sessions', () => openDrawer());
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
mTitle.addEventListener('pointerdown', (e) => { e.preventDefault(); openDrawer(); });

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

// --- Sessions drawer (bottom sheet) ---
const drawerOverlay = document.getElementById('drawerOverlay')!;
const drawerList = document.createElement('div');
drawerList.className = 'drawer-list';
const drawerNew = document.createElement('button');
drawerNew.className = 'drawer-new';
drawerNew.type = 'button';
drawerNew.textContent = '+  New session';
drawerNew.addEventListener('pointerdown', (e) => { e.preventDefault(); closeDrawer(); promptAddSession(); });
document.getElementById('drawerBody')!.append(drawerList, drawerNew);
drawerOverlay.addEventListener('pointerdown', (e) => { if (e.target === drawerOverlay) closeDrawer(); });

let drawerOpen = false;

function renderDrawerList(): void {
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
    body.addEventListener('pointerdown', (e) => { e.preventDefault(); activateSession(s); closeDrawer(); });
    const rename = document.createElement('button');
    rename.className = 'drawer-act';
    rename.type = 'button';
    rename.textContent = '✎';
    rename.title = 'Rename tab';
    rename.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); promptRenameSession(s); renderDrawerList(); });
    const close = document.createElement('button');
    close.className = 'drawer-act danger';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close tab & kill session';
    close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); closeDrawer(); confirmCloseSession(s); });
    row.append(body, rename, close);
    drawerList.append(row);
  }
}

function openDrawer(): void { renderDrawerList(); drawerOverlay.classList.remove('hidden'); drawerOpen = true; }
function closeDrawer(): void {
  drawerOverlay.classList.add('hidden');
  drawerOpen = false;
  if (!window.matchMedia('(pointer: coarse)').matches) activeSession?.focus();
}

// --- Actions sheet ---
const sheetOverlay = document.createElement('div');
sheetOverlay.className = 'sheet-overlay hidden';
const sheet = document.createElement('div');
sheet.className = 'sheet actions-sheet';
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
  sheetRow('⤢', 'Toggle fullscreen', () => { closeSheet(); toggleFullscreen(); }),
  sheetRow('?', 'Help: copy / paste / files', () => { closeSheet(); openHelp(); }),
);
sheetOverlay.append(sheet);
document.body.append(sheetOverlay);
sheetOverlay.addEventListener('pointerdown', (e) => { if (e.target === sheetOverlay) closeSheet(); });

function openSheet(): void { updateFontVal(); sheetOverlay.classList.remove('hidden'); }
function closeSheet(): void { sheetOverlay.classList.add('hidden'); }

function refreshMobileUI(): void {
  const s = activeSession;
  mTitleLabel.textContent = s ? s.displayName : '—';
  mTitleDot.classList.toggle('connected', !!s?.connected);
  mKeysBtn.classList.toggle('active', !keybarEl.classList.contains('hidden'));
  if (drawerOpen) renderDrawerList();
}

// ---------------------------------------------------------------------------
// File upload / download
// ---------------------------------------------------------------------------
function uploadFile(file: Blob, name?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!file) { resolve(); return; }
    const target = activeSession;
    const label = name ?? 'file';
    showStatus(`uploading ${label}… 0%`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload' + (name ? `?name=${encodeURIComponent(name)}` : ''));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e): void => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        showStatus(`uploading ${label}… ${pct}% (${fmtMB(e.loaded)}/${fmtMB(e.total)} MB)`);
      } else {
        showStatus(`uploading ${label}… ${fmtMB(e.loaded)} MB`);
      }
    };
    xhr.upload.onload = (): void => showStatus(`uploading ${label}… finishing…`);
    xhr.onload = (): void => {
      let data: { path?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText) as typeof data; } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.path) {
        if (target) {
          const p = /\s/.test(data.path) ? `'${data.path.replace(/'/g, `'\\''`)}'` : data.path;
          target.sendSeq(p + ' ');
          if (isActive(target)) target.focus();
        }
        const where = target && !isActive(target) ? ` → ${target.displayName}` : '';
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
  showStatus(`preparing ${p}…`);
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
  flashStatus(`downloading ${a.download}${size ? ` (${fmtMB(size)} MB)` : ''}…`, 2500);
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
termArea.addEventListener('dragover', (e) => {
  if (!dragHasFile(e.dataTransfer)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  termArea.classList.add('dragging');
});
termArea.addEventListener('dragleave', () => termArea.classList.remove('dragging'));
termArea.addEventListener('drop', (e) => {
  termArea.classList.remove('dragging');
  const files = e.dataTransfer?.files;
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
  let initialTabs: SavedTab[] = server && server.length ? server : cached.tabs.length ? cached.tabs.slice() : [{ name: defaultSessionName, displayName: defaultSessionName }];
  if (urlSession && !initialTabs.some((t) => t.name === urlSession)) initialTabs = [{ name: urlSession, displayName: urlSession }, ...initialTabs];
  defaultSessionName = urlSession ?? initialTabs[0]?.name ?? 'web';
  for (const t of initialTabs) addSession(t.name, false, t.displayName);
  const activeName = urlSession ?? cached.active ?? initialTabs[0].name;
  activateSession(sessions.find((s) => s.name === activeName) ?? sessions[0]);
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
if (typeof ResizeObserver !== 'undefined') { const areaObserver = new ResizeObserver(() => fitActive()); areaObserver.observe(termArea); }
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
connLabel.textContent = 'reconnecting…';
setTimeout(() => { connDot.classList.remove('reconnecting'); connDot.style.background = '#86efac'; connLabel.textContent = 'connected'; }, 1200);
