# Product Requirements Document (PRD) v2 — terminal-web

> Versi: 2.0.0  
> Terakhir diperbarui: 2026-08-29  
> Author: AaronFei  
> Lisensi: MIT

---

## Changelog v1 → v2

| Area | v1 | v2 |
|------|-----|-----|
| Frontend | Vanilla TS + esbuild | SvelteKit + Svelte 5 + Vite |
| CSS | Manual CSS | Tailwind CSS |
| UI Components | DIY | shadcn-svelte |
| Server | Node http (single file) | SvelteKit server routes + ws |
| Runtime | Bun | Bun (all) |
| Linter | oxlint | Full OXC (linter + formatter + typecheck) |
| State Storage | localStorage | Server-side + cache |
| Tailscale | Auto-detect bind IP | First-class, auto-detect + config |
| Cloudflare Tunnel | Manual | Auto-detect + embedded cloudflared |
| Config | ENV only | ENV + .env file + CLI flags + config file |
| File Manager | Upload/download buttons | Full sidebar + future page route |
| Mobile | Basic PWA | Enhanced low-end device support |

---

## 1. Ringkasan Produk

**terminal-web** adalah aplikasi web-based terminal yang memungkinkan pengguna membuka browser tab untuk mendapatkan akses shell nyata (real shell). Shell berjalan di dalam sesi **tmux**, sehingga menutup jendela browser atau kehilangan koneksi hanya melepaskan sesi (detach) — program tetap berjalan dan dapat diakses kembali.

v2 adalah **full rewrite** dari v1 dengan arsitektur baru yang berfokus pada:

- **Performance di low-end devices**
- **Developer experience & kemudahan setup**
- **Code quality & maintainability**
- **First-class networking** (Tailscale + Cloudflare Tunnel)
- **Server-side state persistence** dengan cache
- **File Manager** sebagai fitur baru utama

**Tagline:** *Open a browser tab, get a real shell.*

---

## 2. Visi & Tujuan

### 2.1 Visi
Menyediakan akses terminal yang sepenuhnya resumable, cross-device, dan zero-install bagi pengguna yang ingin mengontrol mesin mereka dari browser di mana saja.

### 2.2 North Star (Sejajar, bukan trade-off)
1. **Performance di low-end devices** — semua keputusan diukur dari "apakah ini jalan mulus di HP 2GB RAM?"
2. **Developer experience & kemudahan setup** — satu command, auto-detect Tailscale/CF Tunnel, zero config
3. **Code quality & maintainability** — architecture yang clean, modular, gampang di-extend

### 2.3 Tujuan Utama
- **Resumability**: Sesi shell harus bertahan dari disconnect, refresh browser, sleep laptop, dan reboot server
- **Cross-device**: Tab list dan sesi harus sinkron secara real-time lintas perangkat
- **Mobile-first PWA**: Berfungsi dengan baik di mobile, termasuk keyboard on-screen
- **Minimal overhead**: Server harus ringan (Bun + tmux)
- **Security layer**: Token auth opsional untuk deployment di luar trusted network
- **Server-side state**: Settings, tabs, layouts persist di server, sync ke semua perangkat
- **File Manager**: Full file system browser dengan preview, operasi CRUD, dan zip download

---

## 3. Tech Stack Final

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Bun | Server + build + test |
| **Frontend Framework** | SvelteKit (Bun adapter) | Routing, server routes, build pipeline |
| **UI Library** | Svelte 5 + runes | Reactive UI |
| **CSS** | Tailwind CSS | Utility-first styling |
| **UI Components** | shadcn-svelte | Pre-built Svelte components |
| **Terminal** | xterm.js + addons | Browser terminal emulator |
| **Terminal Backend** | tmux | Session persistence & management |
| **Bundler** | Vite (via SvelteKit) | Frontend bundling |
| **Linter** | oxlint (OXC) | Fast Rust-based linting |
| **Formatter** | oxfmt (OXC) | Code formatting |
| **Type Checker** | oxc-type-check (OXC) | TypeScript checking |
| **Git Hooks** | lefthook | Pre-commit lint + typecheck |
| **Markdown** | marked | Lightweight markdown rendering |
| **Code Highlight** | Shiki | Syntax highlighting |

---

## 4. Arsitektur Sistem

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     BROWSER                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  SvelteKit (SSG/SPA)                            │    │
│  │  ├── Svelte 5 + runes                           │    │
│  │  ├── shadcn-svelte (UI components)              │    │
│  │  ├── Tailwind CSS                               │    │
│  │  ├── xterm.js + addons                          │    │
│  │  └── WebSocket client (ws://host:port/ws)       │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP (static + API)
                   │ WebSocket (terminal bridge)
                   │
┌──────────────────▼──────────────────────────────────────┐
│                     BUN RUNTIME                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  SvelteKit (Bun adapter)                        │    │
│  │  ├── src/routes/        (file-based routing)    │    │
│  │  │   ├── /              (terminal SPA)          │    │
│  │  │   ├── /files         (file manager) — FUTURE │    │
│  │  │   ├── /api/sessions  (GET)                   │    │
│  │  │   ├── /api/sessions/rename (POST)            │    │
│  │  │   ├── /api/upload    (POST)                  │    │
│  │  │   ├── /api/download  (GET)                   │    │
│  │  │   ├── /api/state     (GET/PUT/PATCH)         │    │
│  │  │   ├── /api/tunnels   (GET/POST)              │    │
│  │  │   └── /api/fileman   (GET/POST/DELETE)       │    │
│  │  ├── src/lib/server/   (server modules)         │    │
│  │  │   ├── tmux.ts       (session management)     │    │
│  │  │   ├── ws.ts         (WebSocket bridge)       │    │
│  │  │   ├── auth.ts       (token auth)             │    │
│  │  │   ├── config.ts     (config loading)         │    │
│  │  │   ├── state.ts      (state persistence)      │    │
│  │  │   ├── tunnels.ts    (Tailscale/CF detect)    │    │
│  │  │   └── fileman.ts    (file manager API)       │    │
│  │  └── hooks.server.ts   (auth middleware)         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Child processes (managed)                       │    │
│  │  ├── tmux server (per-session)                   │    │
│  │  └── cloudflared tunnel (optional, embedded)     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow

1. **Browser → Server** (binary frames): Keystrokes mentah dikirim sebagai binary WebSocket frames
2. **Server → Browser** (binary frames): Output pty dikirim kembali sebagai binary frames ke xterm.js
3. **Browser → Server** (text/JSON): Control messages — resize, ping, restart, kill
4. **Server → Browser** (text/JSON): Responses — pong, info, closed
5. **Browser → Server** (HTTP API): State sync, file operations, tunnel management

---

## 5. Project Structure

```
terminal-web/
├── src/
│   ├── routes/                    # SvelteKit file-based routing
│   │   ├── +layout.svelte         # Root layout (tab bar, toolbar, status bar)
│   │   ├── +page.svelte           # Main terminal page
│   │   ├── +page.server.ts        # Server load: initial session data
│   │   ├── +server.ts             # WebSocket upgrade handler
│   │   └── api/
│   │       ├── sessions/
│   │       │   ├── +server.ts     # GET: list sessions
│   │       │   └── rename/
│   │       │       └── +server.ts # POST: rename display name
│   │       ├── upload/
│   │       │   └── +server.ts     # POST: file upload
│   │       ├── download/
│   │       │   └── +server.ts     # GET: file download
│   │       ├── state/
│   │       │   └── +server.ts     # GET/PUT/PATCH: state persistence
│   │       ├── tunnels/
│   │       │   └── +server.ts     # GET/POST: tunnel management
│   │       └── fileman/
│   │           └── +server.ts     # GET/POST/DELETE: file manager ops
│   │
│   ├── lib/                       # Shared code (client + server)
│   │   ├── components/            # Svelte UI components
│   │   │   ├── TabBar.svelte
│   │   │   ├── Toolbar.svelte
│   │   │   ├── StatusBar.svelte
│   │   │   ├── Terminal.svelte
│   │   │   ├── SplitPane.svelte
│   │   │   ├── Divider.svelte
│   │   │   ├── PaneHeader.svelte
│   │   │   ├── SearchBar.svelte
│   │   │   ├── SettingsDrawer.svelte
│   │   │   ├── FileManPanel.svelte
│   │   │   ├── BreadcrumbNav.svelte
│   │   │   ├── FileTree.svelte
│   │   │   ├── FileTreeNode.svelte
│   │   │   ├── FileList.svelte
│   │   │   ├── FileListItem.svelte
│   │   │   ├── FileActions.svelte
│   │   │   ├── FilePreview.svelte
│   │   │   ├── MarkdownPreview.svelte
│   │   │   ├── CodePreview.svelte
│   │   │   ├── ImagePreview.svelte
│   │   │   ├── TextPreview.svelte
│   │   │   ├── KeyBar.svelte
│   │   │   ├── MobileBar.svelte
│   │   │   ├── MobileDrawer.svelte
│   │   │   ├── PasteBox.svelte
│   │   │   ├── HelpOverlay.svelte
│   │   │   ├── ConfirmDialog.svelte
│   │   │   └── Toast.svelte
│   │   │
│   │   ├── stores/                # Svelte 5 runes-based state
│   │   │   ├── sessions.svelte.ts # Session list, active, connection
│   │   │   ├── tabs.svelte.ts     # Tab ordering, split tree
│   │   │   ├── settings.svelte.ts # Font, theme, keybinds
│   │   │   ├── theme.svelte.ts    # Theme definitions + switching
│   │   │   ├── tunnels.svelte.ts  # Tunnel status
│   │   │   └── fileman.svelte.ts  # File manager state
│   │   │
│   │   ├── xterm/                 # xterm.js integration
│   │   │   ├── terminal.ts        # Terminal class (connect, resize, IME)
│   │   │   ├── addons.ts          # Addon loader
│   │   │   └── theme.ts           # xterm color theme mapping
│   │   │
│   │   ├── keyboard/              # Keybind system
│   │   │   ├── shortcuts.ts       # Keybind definitions + recording
│   │   │   └── keybar.ts          # On-screen key bar logic
│   │   │
│   │   ├── network/               # Tunnel client
│   │   │   └── tunnels.ts         # Fetch tunnel status
│   │   │
│   │   └── utils/
│   │       ├── copy.ts            # Copy/paste helpers
│   │       ├── upload.ts          # XHR upload + progress
│   │       ├── download.ts        # File download trigger
│   │       └── mobile.ts          # Touch, viewport, PWA helpers
│   │
│   ├── lib/server/                # Server-only modules
│   │   ├── tmux.ts                # tmux session management
│   │   ├── ws.ts                  # WebSocket bridge
│   │   ├── auth.ts                # Token auth
│   │   ├── config.ts              # Config loading (ENV + file + CLI)
│   │   ├── state.ts               # State persistence + cache
│   │   ├── tunnels.ts             # Tailscale detect, cloudflared spawn
│   │   └── fileman.ts             # File manager server ops
│   │
│   ├── app.html                   # HTML shell
│   ├── app.css                    # Tailwind directives + design tokens
│   └── hooks.server.ts            # Auth middleware + WS upgrade
│
├── static/                        # Static assets (PWA)
│   ├── manifest.webmanifest
│   └── icons/
│       ├── icon.svg
│       ├── icon-192.png
│       ├── icon-512.png
│       └── icon-512-maskable.png
│
├── tmux/
│   └── web.tmux.conf
├── scripts/
│   ├── start.sh
│   ├── dev.sh
│   ├── deploy.sh
│   └── service.sh
├── svelte.config.js
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── lefthook.yml
├── package.json
└── README.md
```

---

## 6. Fitur Detail

### 6.1 Session Management (tmux-based Resumability)

- Setiap sesi terminal berjalan di dalam tmux session bernama
- Server menggunakan `tmux new-session -A -s NAME` untuk attach ke sesi yang sudah ada atau membuat baru
- Menutup browser hanya detaches sesi, bukan kill — program tetap jalan
- **Session persistence**: tmux-resurrect + tmux-continuum untuk restore otomatis setelah reboot

### 6.2 Multi-Session Tabs

- **Tab bar** di bagian atas menampilkan semua sesi aktif
- **New tab (+)**: Membuka tab baru dengan sesi tmux baru
- **Close tab (×)**: Kill sesi tmux dan tutup tab, dengan konfirmasi dialog
- **Restart tab (℉)**: Kill sesi tmux lama, buat baru
- **Rename tab**: Double-click/tap untuk rename display name
- **Drag-and-drop reorder**: Tab bisa di-drag untuk reorder

### 6.3 Cross-Device Tab Sync

- Tab list disimpan di tmux session sebagai user options (`@twtab`, `@twlabel`)
- Server expose API `GET /api/sessions`
- Client polling setiap 5 detik + sync on visibility change + sync on focus
- Tab bar sinkron lintas semua perangkat

### 6.4 Split Pane Layout

- **Split right**: Vertical split
- **Split bottom**: Horizontal split
- **Grid 2x2**: Layout grid untuk 4 panes
- **Single layout**: Merge ke 1 pane
- **Close pane**: Tutup pane tertentu
- **Drag divider**: Pembagi bisa di-drag untuk resize
- **Responsive**: Layout otomatis berubah ke `col` di mobile

### 6.5 Mobile Layout & PWA

- **PWA**: Bisa di-install ke home screen, standalone display
- **Mobile top bar**: Compact bar dengan session title, actions
- **Sessions drawer**: Bottom sheet untuk switch sesi
- **Actions sheet**: Restart, paste, download, fullscreen, settings, help
- **On-screen key bar**: Virtual keyboard:
  - Row 1: `Esc`, `Tab`, `Ctrl` (sticky), `Alt` (sticky), `^C`, `Enter`, `Select`
  - Row 2: `←`, `↑`, `↓`, `→`
- **Touch scroll**: One-finger drag untuk scroll history
- **Touch select mode**: Toggle select → drag selection → lift to copy

### 6.6 Copy & Paste

- **Copy**: Auto-copy on mouse/touch selection. `Ctrl+Shift+C` / `⌘C`
- **Paste**: `Ctrl+Shift+V` / `⌘V`. Fallback paste box overlay
- **Rich paste**: Gambar dari clipboard langsung upload
- Berfungsi di plain HTTP

### 6.7 File Upload & Download

#### Upload
- Trigger: Attach button, paste gambar, drag-and-drop
- File disimpan ke `~/terminal-web-uploads/` dengan nama `clip-{stamp}-{rand}-{filename}`
- Response: `{ path }` — path di-insert ke terminal
- Progress indicator di status bar
- Limit: configurable `uploadMaxBytes`
- Pruning: berdasarkan retention hours dan max files

#### Download
- Stream file dari host ke browser sebagai attachment
- Mendukung `~` expansion
- RFC 6266 Content-Disposition dengan UTF-8 filename

### 6.8 Search

- `Ctrl+F` / `Cmd+F` membuka search overlay
- Menggunakan `@xterm/addon-search`

### 6.9 Settings Drawer

- Slide-in panel (shadcn-svelte drawer)
- **Tabbed sections**: Appearance, Behavior, Keybinds

#### Appearance
- 5 built-in themes + custom (color pickers)
- Font size slider (8-28px)
- Cursor blink toggle

#### Behavior
- Confirm close toggle
- Keybar auto-show toggle

#### Keybinds
- Customizable shortcuts dengan re-record
- Reset to defaults

### 6.10 Fullscreen Mode

- Toggle via toolbar atau mobile actions
- Fullscreen API browser

### 6.11 IME (CJK) Input

- Composition event handling
- IME deduplication
- Pending key forwarding
- Debug mode: `?debug=ime`

### 6.12 Status Bar

- Session name, connection status, panel count
- Flash messages untuk copy, paste, upload, errors

### 6.13 Help Overlay

- Panduan cara copy, paste, attach file, download, scroll, tabs
- Auto-show pertama kali
- Manual via `?` button

### 6.14 Touch Selection Mode

- Toggle dari key bar "Select"
- Drag untuk selection, lift untuk copy

---

## 7. Server-Side State Persistence

### 7a. Perubahan dari v1

| Data | v1 Storage | v2 Storage |
|------|-----------|-----------|
| Tab order | localStorage | Server (`~/.config/terminal-web/state.json`) |
| Active tab | localStorage | Server |
| Split layouts | Client-only | Server (persist per tab) |
| Settings | localStorage | Server |

### 7b. Cache Architecture

```
Browser (Svelte runes state)
  ↕ sync via API (on change + on reconnect)
Server (in-memory Map, hot cache)
  ↕ flush to disk (debounced 2s)
Disk (~/.config/terminal-web/state.json)
```

### 7c. API Endpoints

```
GET    /api/state          → full state dump
PUT    /api/state          → update all state
PATCH  /api/state/tabs     → update tab order
PATCH  /api/state/settings → update settings
PATCH  /api/state/layouts  → update split layouts
```

### 7d. Cache Behavior

- In-memory Map sebagai hot cache — zero disk I/O untuk reads
- Writes update cache immediately, flush ke disk setelah 2s debounce
- Startup: load dari disk ke cache
- Graceful shutdown: force flush sebelum exit

---

## 8. File Manager

### 8a. Evolution Path

| Phase | Form Factor | Location |
|-------|-------------|----------|
| **v2 Phase 1** | Sidebar/drawer (toggle) | `FileManPanel.svelte` |
| **v2 Phase 2** | Full page route | `/files` |

### 8b. Server API

```
GET    /api/fileman/list?path=...          → directory listing
GET    /api/fileman/read?path=...          → file content
GET    /api/fileman/stat?path=...          → file metadata
POST   /api/fileman/mkdir                  → create directory
POST   /api/fileman/rename                 → rename
POST   /api/fileman/move                   → move
POST   /api/fileman/copy                   → copy
DELETE /api/fileman/delete                 → delete
POST   /api/fileman/upload?path=...        → upload to directory
GET    /api/fileman/download?path=...      → download file
GET    /api/fileman/download-zip?path=...  → download folder as zip
GET    /api/fileman/search?path=...&q=...  → filename/content search
```

### 8c. Components

```
FileManPanel.svelte
├── BreadcrumbNav.svelte          # Clickable path breadcrumb
├── FileTree.svelte               # Directory tree (lazy-load)
│   └── FileTreeNode.svelte       # Expand/collapse node
├── FileList.svelte               # List/card view
│   └── FileListItem.svelte       # File row (icon, name, size, date)
├── FileActions.svelte            # Context menu (rename, delete, move, copy, download)
└── FilePreview.svelte            # Content preview panel
    ├── MarkdownPreview.svelte    # Rendered markdown (marked library)
    ├── CodePreview.svelte        # Syntax highlighted code (Shiki)
    ├── ImagePreview.svelte       # Image display
    └── TextPreview.svelte        # Plain text fallback
```

### 8d. File Preview

- **Markdown**: marked library (~8KB), GFM, sanitized HTML, KaTeX math (optional)
- **Code**: Shiki syntax highlighting
- **Images**: Direct display
- **Text**: Plain text fallback
- **Binary**: "Preview not available" + download

### 8e. Zip Download

- Streaming zip via `archiver` atau Bun native
- Filename: `{folder-name}.zip`

### 8f. Terminal Integration

- Drag file dari file manager ke terminal → inject path
- Right-click → "Open in terminal"
- Upload dari file manager → auto-navigate ke directory

---

## 9. Server & Networking

### 9a. Server Architecture

```
Bun.serve() → SvelteKit handler (HTTP)
           → WebSocket upgrade di /ws path
           → tmux spawn per connection
```

### 9b. Config System (Flexible Hierarchy)

```
CLI flags (highest priority)
  → terminal-web.config.ts (project config)
    → .env file
      → ENV variables (lowest priority)
```

**Config file format:**
```ts
export default {
  port: 8090,
  host: 'auto',
  session: 'web',
  auth: { token: '' },
  maxPtys: 16,
  upload: {
    dir: '~/terminal-web-uploads',
    maxBytes: 1024 * 1024 * 1024,
    retentionHours: 72,
  },
  tunnels: {
    tailscale: { auto: true },
    cloudflare: { auto: false, manage: false },
  },
}
```

### 9c. Tunnel Management

**Tailscale:**
- Auto-detect: `tailscale ip -4` saat startup
- Bind ke Tailscale IP jika available, fallback ke `0.0.0.0`

**Cloudflare Tunnel (Embedded):**
- User enable di config: `tunnels.cloudflare: { auto: true, manage: true }`
- Server spawn `cloudflared tunnel --url` sebagai child process
- Capture quick tunnel URL dari stdout
- Lifecycle: start saat server start, stop saat shutdown

**Tunnel API:**
```
GET  /api/tunnels                    → { tailscale: {...}, cloudflare: {...} }
POST /api/tunnels/cloudflare/start   → start tunnel
POST /api/tunnels/cloudflare/stop    → stop tunnel
```

### 9d. WebSocket Protocol

#### Binary Frames
- Client → Server: Raw keystrokes
- Server → Client: Raw pty output

#### Text Frames (JSON Control)

**Client → Server:**

| Type | Fields | Description |
|------|--------|-------------|
| `resize` | `cols, rows` | Resize terminal |
| `ping` | — | Keep-alive |
| `restart` | — | Kill & recreate session |
| `kill` | — | Kill session (close tab) |
| `debug` | `event, data?, at?` | Diagnostic trace |

**Server → Client:**

| Type | Fields | Description |
|------|--------|-------------|
| `pong` | — | Reply to ping |
| `info` | `message` | Informational |
| `closed` | — | Session closed |

#### Heartbeat: 20 detik interval, dead connection cleanup

---

## 10. Keamanan

### 10.1 Default: Trusted Network Only
Tanpa `AUTH_TOKEN`, server berjalan tanpa autentikasi.

### 10.2 Token Auth (AUTH_TOKEN)
- Active hanya untuk request melalui Cloudflare
- Direct access (Tailscale/LAN) tetap open
- Shared secret cookie `tw_auth`
- Timing-safe comparison
- HTTPS detection via `X-Forwarded-Proto`

### 10.3 Server Environment Isolation
Server env vars dihapus dari child process environment.

### 10.4 Path Traversal Protection
Static file serving, upload, download — semua validated path.

### 10.5 Pty Leak Watchdog
Periodic check, auto-restart jika pty fds melebihi ceiling.

---

## 11. Responsive Design & Low-End Device Support

### 11.1 Breakpoints

| Range | Mode | Behavior |
|-------|------|----------|
| `<= 640px` | Full mobile | MobileBar replaces TabBar+Toolbar, KeyBar visible |
| `641-700px` | Compact | TabBar hidden, MobileBar with tabs drawer |
| `> 700px` | Desktop | TabBar + Toolbar, no KeyBar |

### 11.2 Low-End Optimizations

- WebGL renderer fallback ke canvas
- `prefers-reduced-motion` respected
- Touch events `{ passive: true }` di scroll areas
- Virtual viewport API untuk keyboard overlap
- Batch DOM updates via Svelte compiled reactive
- Font: `font-display: swap`, fallback ke system monospace
- Minimal reflows — Svelte's fine-grained reactivity

---

## 12. Build & Development

### 12.1 Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev mode: Vite HMR + server auto-restart |
| `bun run build` | Production build |
| `bun start` | Production start |
| `bun run lint` | OXC lint |
| `bun run format` | OXC format |
| `bun run check` | OXC type check |

### 12.2 Build Pipeline

1. **SvelteKit** + **Bun adapter** → single build command
2. **Vite** handles: Svelte compilation, Tailwind processing, asset bundling
3. **Output**: `build/` directory (server + client bundles)

### 12.3 Git Hooks (lefthook)

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,js,mjs,json,svelte}"
      run: bun run lint
    format:
      glob: "*.{ts,js,mjs,svelte}"
      run: bunx oxfmt --check
    types:
      glob: "*.{ts,js,mjs,svelte}"
      run: bun run check
```

---

## 13. Deployment

### 13.1 Background Service

`scripts/service.sh` mendukung:

| Platform | Service Manager |
|----------|----------------|
| macOS | launchd (LaunchAgent) |
| Linux | systemd (user unit) |

### 13.2 Graceful Shutdown

- `SIGINT` / `SIGTERM`: Close WebSocket, flush state cache, close HTTP
- tmux sessions survive (process terpisah)
- Force exit setelah 5 detik timeout

### 13.3 Error Recovery

- `EADDRNOTAVAIL`: Retry setiap 3 detik (Tailscale belum ready)
- `EADDRINUSE`: Fatal, exit dengan pesan jelas
- `uncaughtException` / `unhandledRejection`: Logged, tidak crash

---

## 14. tmux Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `mouse on` | `on` | Mouse click, select, wheel |
| `history-limit` | `100000` | Deep scrollback |
| `escape-time` | `25ms` | ESC snappy untuk vim |
| `default-terminal` | `tmux-256color` | Modern terminfo |
| `terminal-overrides` | `*256col*:Tc` | Truecolor |
| `status` | `off` | Clean terminal |
| WheelUp/WheelDown | Custom | Smooth scrolling |
| `@resurrect-*` | `on` | Session persistence |
| `@continuum-restore` | `on` | Auto-restore after reboot |

---

## 15. UI/UX Design

### 15.1 Design System (Tailwind CSS Tokens)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#14161b` | Page background |
| `--panel` | `#1a1d24` | Header/panel |
| `--pane` | `#101217` | Terminal pane |
| `--border` | `#262b34` | Border |
| `--text` | `#e7e9ee` | Primary text |
| `--muted` | `#8a90a0` | Secondary text |
| `--accent` | `#5eead4` | Primary accent |
| `--accent2` | `#a78bfa` | Secondary accent |
| `--danger` | `#fb7185` | Danger actions |

### 15.2 Typography

- UI: `'Inter', sans-serif`
- Terminal: `'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### 15.3 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+Shift+→` | Split right |
| `Ctrl+Shift+↓` | Split down |
| `Ctrl+Shift+↑` | Single layout |
| `Ctrl+K` | Clear pane |
| `Ctrl+F` | Search |

---

## 16. Performance

- **WebGL rendering**: Opt-in, auto-detect + canvas fallback
- **WebSocket heartbeat**: 20 detik interval
- **PTY limit**: `maxPtys` membatasi concurrent terminals
- **Upload streaming**: Chunk-by-chunk, size limit
- **Server-side cache**: In-memory hot cache, debounced disk flush
- **No-cache**: Static files `Cache-Control: no-cache`
- **Bundle**: SvelteKit optimize + Tailwind purge

---

## 17. Limitations

1. **Single-user**: Shared token, bukan per-user identity
2. **No TLS**: Server berjalan HTTP. TLS via Tailscale/reverse proxy
3. **tmux dependency**: Tidak ada fallback tanpa tmux
4. **Personal deployment**: Single machine only
5. **Cloudflare Tunnel**: Membutuhkan `cloudflared` installed

---

## 18. Glossary

| Term | Definition |
|------|-----------|
| **pty** | Pseudo-terminal — virtual terminal device |
| **tmux** | Terminal multiplexer |
| **detach** | Melepaskan client tanpa kill session |
| **runes** | Svelte 5 reactive primitives ($state, $derived, $effect) |
| **shadcn-svelte** | Svelte port of shadcn/ui |
| **OXC** | Oxidation Compiler — Rust-based JS/TS toolchain |
| **PWA** | Progressive Web App |
| **Tailnet** | Private network via Tailscale |

---

*Document ini adalah source of truth v2 untuk terminal-web. Semua pengembangan harus mengikuti spesifikasi ini. PRD v1 (`docs/prd/PRD.md`) di-obsolete oleh document ini.*

---

> **⚠️ PRD v1 Obsoleted**
>
> `docs/prd/PRD.md` (v1) digantikan oleh document ini. Jangan referensikan v1 untuk pengembangan baru.
