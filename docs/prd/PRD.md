# Product Requirements Document (PRD) — terminal-web

> Versi: 1.0.0  
> Terakhir diperbarui: 2026-08-29  
> Author: AaronFei  
> Lisensi: MIT

---

## 1. Ringkasan Produk

**terminal-web** adalah aplikasi web-based terminal yang memungkinkan pengguna membuka browser tab untuk mendapatkan akses shell nyata (real shell). Shell berjalan di dalam sesi **tmux**, sehingga menutup jendela browser atau kehilangan koneksi hanya melepaskan sesi (detach) — program tetap berjalan dan dapat diakses kembali saat pengguna datang kembali.

Aplikasi ini dirancang untuk berjalan di **Tailnet** (jaringan Tailscale pribadi) atau LAN/intranet, dengan opsional autentikasi token bersama untuk deployment yang lebih luas.

**Tagline:** *Open a browser tab, get a real shell.*

---

## 2. Visi & Tujuan

### 2.1 Visi
Menyediakan akses terminal yang sepenuhnya resumable, cross-device, dan zero-install bagi pengguna yang ingin mengontrol mesin mereka dari browser di mana saja.

### 2.2 Tujuan Utama
- **Resumability**: Sesi shell harus bertahan dari disconnect, refresh browser, sleep laptop, dan reboot server.
- **Cross-device**: Tab list dan sesi harus sinkron secara real-time lintas perangkat (laptop, desktop, mobile).
- **Mobile-first PWA**: Harus berfungsi dengan baik di mobile, termasuk keyboard on-screen yang fungsional.
- **Minimal overhead**: Server harus ringan (Bun + tmux), tanpa dependency berat.
- **Security layer**: Token auth opsional untuk deployment di luar trusted network.

---

## 3. Pengguna Target

| Persona | Kebutuhan |
|---------|-----------|
| Developer | Akses shell dari mana saja untuk coding, debugging, deployment |
| Sysadmin | Monitoring server, menjalankan command, mengelola service |
| AI/CLI user | Menggunakan Claude Code, ChatGPT CLI, atau tools AI lainnya dari browser |
| Mobile user | Quick access ke shell dari ponsel/tablet saat di luar |

---

## 4. Arsitektur Sistem

### 4.1 High-Level Architecture

```
Browser (xterm.js)                    Server (Bun + TypeScript)
+-----------------+                   +----------------------+
|  FitAddon       | <--- WS ----->   |  ws (WebSocket)      |
|  WebLinksAddon  |   binary frames   |  Bun.Terminal (pty)  |
|  WebglAddon     |   text=JSON ctrl  |  tmux new-session -A |
|  SearchAddon    |                   |                      |
+-----------------+                   +----------+-----------+
       ^                                        |
       |  static files (/, /styles.css,         |  pty runs:
       |  /dist/*.js, /dist/*.css)              |  tmux session
       +----------------------------------------+  "NAME"
                                                v
                                    +-------------------------+
                                    |     tmux server         |
                                    |  session "NAME" ------->| shell + programs
                                    |  (survives disconnect)  |
                                    +-------------------------+
```

### 4.2 Data Flow

1. **Browser → Server** (binary frames): Keystrokes mentah dikirim sebagai binary WebSocket frames.
2. **Server → Browser** (binary frames): Output pty dikirim kembali sebagai binary frames ke xterm.js.
3. **Browser → Server** (text/JSON): Control messages — resize, ping, restart, kill.
4. **Server → Browser** (text/JSON): Responses — pong, info, closed.

### 4.3 Source Structure

```
terminal-web/
├── src/                        # Server-side code (Bun)
│   ├── server.ts               # HTTP server + WebSocket bridge
│   ├── config.ts               # Configuration loading + validation
│   ├── auth.ts                 # Token-based auth (Cloudflare-aware)
│   ├── tmux.ts                 # tmux session management + tab tagging
│   └── types.ts                # WebSocket protocol type definitions
├── web/                        # Client-side code (browser)
│   └── terminal.ts             # xterm.js terminal + UI (single file)
├── public/                     # Static assets
│   ├── index.html              # Main HTML shell
│   ├── styles.css              # Custom UI styles (design tokens, layout)
│   ├── app.css                 # xterm.css (bundled)
│   ├── app.js                  # (legacy/unused)
│   ├── manifest.webmanifest    # PWA manifest
│   ├── icon.svg                # Favicon
│   ├── icon-192.png            # PWA icon
│   ├── icon-512.png            # PWA icon
│   ├── icon-512-maskable.png   # PWA icon (maskable)
│   └── apple-touch-icon.png    # iOS home screen icon
├── tmux/
│   └── web.tmux.conf           # tmux configuration
├── scripts/
│   ├── start.sh                # Production start (auto-detect Tailscale)
│   ├── dev.sh                  # Development mode (watch + auto-restart)
│   ├── service.sh              # Background service (launchd/systemd)
│   ├── deploy.sh               # Build + deploy + restart
│   ├── use-repo-as-live.sh     # Helper for WSL mirror deployment
│   └── fix-pty-perms.mjs       # Fix node-pty spawn-helper permissions
├── esbuild.mjs                 # esbuild bundler config
├── tsconfig.json               # TypeScript configuration
├── lefthook.yml                # Git hooks (pre-commit: lint + typecheck)
└── package.json                # Dependencies and scripts
```

---

## 5. Fitur Detail

### 5.1 Session Management (tmux-based Resumability)

- Setiap sesi terminal berjalan di dalam tmux session bernama.
- Server menggunakan `tmux new-session -A -s NAME` untuk attach ke sesi yang sudah ada atau membuat baru.
- Menutup browser hanya detaches sesi, bukan kill — program tetap jalan.
- **Session persistence**: Menggunakan tmux-resurrect + tmux-continuum untuk restore otomatis setelah reboot.
  - tmux-resurrect menyimpan layout, windows, panes, dan working directory.
  - tmux-continuum auto-save setiap 15 menit dan auto-restore saat tmux server start.
  - Scrollback contents ter-capture dan `claude` auto-relaunch di panes yang menjalankannya.
  - Plugin di-load langsung (bukan via TPM) karena server menggunakan custom tmux config.

### 5.2 Multi-Session Tabs

- **Tab bar** di bagian atas menampilkan semua sesi aktif.
- **New tab (+)**: Membuka tab baru dengan sesi tmux baru. Nama auto-generated: `web`, `work`, `dev`, `scratch`, atau `s{N}`.
- **Close tab (×)**: Kill sesi tmux dan tutup tab. Ada konfirmasi dialog (bisa di-disable via settings).
- **Restart tab (⟳)**: Kill sesi tmux lama, buat baru — useful untuk restart tanpa buka tab baru.
- **Rename tab**: Double-click/tap pada tab untuk rename display name. Nama display hanya untuk UI, tmux session name tetap sama.
- **Drag-and-drop reorder**: Tab bisa di-drag untuk reorder dengan ghost element dan visual feedback.

### 5.3 Cross-Device Tab Sync

- Tab list disimpan di tmux session sendiri sebagai user options (`@twtab`, `@twlabel`).
- Server meng-expose API `GET /api/sessions` yang mengembalikan semua sesi yang ter-tag.
- Client melakukan polling setiap 5 detik + sync on visibility change + sync on focus.
- Tab bar sinkron lintas semua perangkat yang terhubung ke server yang sama.
- `liveSessions` Set di server melacak sesi dengan WebSocket aktif untuk muncul di tab list segera.
- Close guard: sesi baru-baru ini di-close dihindari dari re-appear selama 6 detik.

### 5.4 Split Pane Layout

- **Split right (⬒)**: Membagi pane ke arah vertikal.
- **Split bottom (⬓)**: Membagi pane ke arah horizontal.
- **Grid 2x2**: Layout grid untuk 4 panes.
- **Single layout**: Merge ke 1 pane (close semua pane lain).
- **Close pane (✕)**: Tutup pane tertentu.
- Split tree direpresentasikan sebagai recursive `SplitTree` (type: `leaf` | `split`).
- Setiap leaf memiliki `Session` instance dengan WebSocket terpisah ke tmux.
- **Drag divider**: Pembagi antar pane bisa di-drag untuk resize ratio.
- **Responsive**: Layout otomatis berubah ke `col` di mobile (`max-width: 700px`).
- Clear pane: Meng-clear display pane tanpa kill session.

### 5.5 Mobile Layout & PWA

- **PWA (Progressive Web App)**: Bisa di-install ke home screen.
  - Manifest: `manifest.webmanifest` dengan standalone display mode.
  - Orientation: `any`.
  - Icons: 192px, 512px, 512px maskable, SVG.
- **Mobile top bar**: Compact bar dengan session title, attach button, keys button, more button.
- **Sessions drawer**: Bottom sheet untuk switch antar sesi di mobile.
- **Actions sheet**: Bottom sheet untuk restart, paste, download, fullscreen, settings, help.
- **On-screen key bar**: Virtual keyboard dengan key penting:
  - Row 1: `Esc`, `Tab`, `Ctrl` (sticky), `Alt` (sticky), `^C`, `Enter`, `Select` (mode)
  - Row 2: `←`, `↑`, `↓`, `→` (arrow keys)
  - Sticky modifier: Tap `Ctrl`/`Alt` → armed, lalu tap key → modifier diterapkan, lalu auto-disarm.
- **Touch scroll**: One-finger drag untuk scroll history (sama dengan mouse wheel).
- **Touch select mode**: Toggle "Select" di key bar → drag untuk selection, lift untuk copy.

### 5.6 Copy & Paste

- **Copy**: Mouse selection → auto-copy (mouseup/touchend). Atau `Ctrl+Shift+C` (non-Mac). Atau `⌘C` (Mac).
- **Paste**: 
  - Desktop: `Ctrl+Shift+V` / `⌘V`.
  - Fallback: Paste box overlay (textarea untuk paste manual) karena browser security restrictions.
  - Rich paste: Mendukung paste gambar dari clipboard (langsung upload).
- **Paste box**: Overlay modal dengan textarea, otomatis submit saat paste atau click "Send".
- Berfungsi di plain HTTP (tidak perlu HTTPS).

### 5.7 File Upload & Download

#### Upload (POST /upload)
- **Trigger**: 
  - Attach button (📎) → file picker.
  - Paste gambar dari clipboard.
  - Drag-and-drop file ke workspace.
- **Behavior**: File disimpan ke `~/terminal-web-uploads/` dengan nama `clip-{ISO-stamp}-{rand}-{filename}`.
- **Response**: `{ path, name, size }` — path file di-insert ke terminal sebagai teks (append spasi).
- **Optimized untuk Claude Code**: File path langsung dimasukkan ke terminal command line.
- **Progress**: XHR upload dengan progress indicator di status bar.
- **Limits**: `uploadMaxBytes` (default 1024 MB), configurable.
- **Pruning**: Upload lama di-prune berdasarkan `uploadRetentionHours` (default 72 jam) dan `uploadMaxFiles` (default 100).

#### Download (GET /api/download?path=…)
- Stream file dari host ke browser sebagai attachment.
- Mendukung `~` expansion untuk home directory.
- RFC 6266 Content-Disposition dengan UTF-8 filename support.
- Dipicu dari mobile via Actions sheet atau `?` help.

### 5.8 Search (xterm.js SearchAddon)

- `Ctrl+F` / `Cmd+F` membuka search overlay di toolbar.
- Search box dengan input field, prev/next button, dan close button.
- Menggunakan `@xterm/addon-search` untuk terminal text search.

### 5.9 Settings Drawer

- Slide-in panel dari kanan (width 380px, max 92vw).
- **Tabbed sections**: Appearance, Behavior, Keybinds.

#### Appearance Tab
- **Theme system**: 5 built-in themes + 1 custom:
  - **Graphite Aurora**: Dark teal accent (default).
  - **Nord Mist**: Blue/cool tones.
  - **Solaris Light**: Light theme.
  - **Mono Ink**: Pure monochrome.
  - **Custom**: User-defined colors (bg, accent, accent2 via color pickers).
- **Font size**: Range slider 8-28px, persist to localStorage.
- **Cursor blink**: Toggle on/off.

#### Behavior Tab
- **Confirm close**: Toggle konfirmasi dialog sebelum kill session.
- **Keybar auto-show**: Toggle keybar default untuk touch devices.

#### Keybinds Tab
- Customizable keyboard shortcuts:
  - `newTab`: default `Ctrl+T`
  - `closeTab`: default `Ctrl+W`
  - `nextTab`: default `Ctrl+Tab`
  - `prevTab`: default `Ctrl+Shift+Tab`
  - `splitRight`: default `Ctrl+Shift+→`
  - `splitDown`: default `Ctrl+Shift+↓`
  - `singleLayout`: default `Ctrl+Shift+↑`
  - `clearPane`: default `Ctrl+K`
- Klik badge keybind untuk re-record (press key sequence).
- Reset to defaults button.

### 5.10 Fullscreen Mode

- Toggle via toolbar button atau mobile actions sheet.
- Menggunakan Fullscreen API browser.

### 5.11 IME (Input Method Editor) Support

- CJK input handling dengan composition events.
- IME deduplication: Mencegah duplicate characters dari composition.
- Pending key forwarding: Keys yang belum di-forward selama composition di-forward setelah delay.
- Debug mode: `?debug=ime` URL param untuk logging IME events.

### 5.12 Status Bar

- Fixed bottom bar menampilkan:
  - Session name.
  - Connection status (green dot = connected, yellow = reconnecting).
  - Layout info (e.g., "1 panel", "4 panels").
- **Status banner** (top-right): Flash messages untuk copy, paste, upload progress, errors.

### 5.13 Help Overlay

- Tampilkan panduan cara copy, paste, attach file, download, scroll, tabs.
- Muncul otomatis di pertama kali (stored di localStorage `tw.helpSeen`).
- Buka manual via `?` button di toolbar.

### 5.14 Tab Title / Host Label

- Page title menampilkan hostname mesin server: `{hostname} · terminal-web`.
- Berguna saat membuka beberapa host di tab browser berbeda — mudah dibedakan.

### 5.15 Touch Selection Mode

- Toggle dari key bar "Select" button.
- Drag untuk character-level selection di terminal.
- Lift finger otomatis copy selection.
- Berguna untuk select & copy di touch devices.

---

## 6. API Endpoints

### 6.1 HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve index.html (dengan hostname injection ke title) |
| `GET` | `/styles.css` | Custom UI styles |
| `GET` | `/dist/*` | esbuild bundle output (JS, CSS, sourcemaps) |
| `GET` | `/manifest.webmanifest` | PWA manifest |
| `GET` | `/icon.svg`, `/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png` | PWA icons |
| `GET` | `/apple-touch-icon.png` | iOS home screen icon |
| `POST` | `/upload?name=FILENAME` | Upload file ke server |
| `GET` | `/api/sessions` | List semua web tabs (dari tmux @twtab tag) |
| `POST` | `/api/sessions/rename` | Rename display name tab |
| `GET` | `/api/download?path=FILEPATH` | Download file dari host |
| `HEAD` | `/api/download?path=FILEPATH` | Check file existence & size |

### 6.2 WebSocket Endpoint

| Path | Protocol | Description |
|------|----------|-------------|
| `/ws?session=NAME` | ws/wss | Terminal bridge — binary frames untuk I/O, text frames untuk control |

---

## 7. WebSocket Protocol

### 7.1 Binary Frames

- **Client → Server**: Raw keystrokes (UTF-8 encoded user input).
- **Server → Client**: Raw pty output bytes.

### 7.2 Text Frames (JSON Control Messages)

#### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `resize` | `cols: number, rows: number` | Resize terminal dimensions |
| `ping` | — | Keep-alive request (server replies with pong) |
| `restart` | — | Kill sesi tmux untuk restart fresh |
| `kill` | — | Kill sesi tmux untuk good (saat close tab) |
| `debug` | `event: string, data?: string, at?: number` | Diagnostic trace (debug mode) |

#### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `pong` | — | Reply to ping |
| `info` | `message: string` | Informational message |
| `closed` | — | Sesi ditutup (oleh device ini atau lainnya) — client drop tab, jangan reconnect |

### 7.3 Heartbeat

- Server mengirim WebSocket ping setiap 20 detik.
- Jika client tidak respond, koneksi ditutup.
- `ws.isAlive` flag di-tracker untuk dead connection cleanup.

---

## 8. Konfigurasi

### 8.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | TCP port server listen |
| `HOST` | Tailscale IPv4, fallback `0.0.0.0` | Host/IP bind address |
| `DEFAULT_SESSION` | `web` | Nama default sesi tmux jika tidak ada `?session=` |
| `AUTH_TOKEN` | `""` (disabled) | Shared token untuk autentikasi (HTTP + WS) |
| `MAX_PTYS` | OS-dependent | Max concurrent terminal/pty instances |
| `UPLOAD_DIR` | `~/terminal-web-uploads` | Direktori penyimpanan upload |
| `UPLOAD_RETENTION_HOURS` | `72` | Hapus upload lebih tua dari N jam |
| `UPLOAD_MAX_FILES` | `100` | Max jumlah file upload |
| `UPLOAD_MAX_MB` | `1024` | Max ukuran per file upload (MB) |

### 8.2 Configuration Interface (Config)

```typescript
interface Config {
  port: number;
  host: string;
  hostFromTailscale: boolean;
  defaultSession: string;
  repoRoot: string;
  tmuxConfPath: string;
  publicDir: string;
  uploadDir: string;
  uploadRetentionHours: number;
  uploadMaxFiles: number;
  uploadMaxBytes: number;
  authToken: string;
  maxPtys: number;
  tailscaleIp: string | null;
}
```

### 8.3 URL Parameters

| Parameter | Description |
|-----------|-------------|
| `?session=NAME` | Buka sesi tertentu (create jika belum ada) |
| `?webgl=0` | Disable WebGL renderer |
| `?debug=ime` | Enable IME debug logging |
| `?debug=vv` | Enable virtual viewport debug |
| `?debug=paste` | Enable paste debug logging |

---

## 9. Keamanan

### 9.1 Default: Trusted Network Only

- Tanpa `AUTH_TOKEN`, server berjalan tanpa autentikasi — siapa pun yang bisa mengakses URL mendapat full shell.
- Dirancang untuk Tailscale tailnet atau LAN trusted.

### 9.2 Token Auth (AUTH_TOKEN)

- **Scope**: Aktif hanya untuk request yang melalui Cloudflare (`cf-ray` / `cf-connecting-ip` headers).
- **Direct access**: Tailscale IP / LAN tetap open tanpa auth.
- **Mechanism**: Shared secret cookie `tw_auth`.
  - Login page muncul jika token required tapi cookie invalid.
  - `?token=TOKEN` URL untuk set cookie (bisa bookmark).
  - Cookie: `HttpOnly`, `SameSite=Lax`, `Max-Age=1 tahun`, `Secure` (jika HTTPS).
- **Timing-safe**: Menggunakan `crypto.timingSafeEqual` untuk token comparison.
- **HTTPS detection**: Via `X-Forwarded-Proto` header (Cloudflare sets this).

### 9.3 Server Environment Isolation

- Server env vars (`HOST`, `PORT`, `DEFAULT_SESSION`) dihapus dari child process environment.
- Mencegah bocornya env var ke shell user (contoh: zsh `%m` prompt escape membaca `$HOST`).

### 9.4 Path Traversal Protection

- Static file serving memvalidasi resolved path tetap dalam `publicDir`.
- Upload filename di-sanitize: strip directories, collapse unsafe chars, no leading dots.
- Download: relatif path di-resolve against home directory, absolute paths di-resolve.

### 9.5 Pty Leak Watchdog

- Periodic check menghitung open pty file descriptors.
- Jika melebihi ceiling (`maxPtys * 4 + 16`), server exit agar launchd restart.
- tmux sessions persist karena berjalan di process terpisah.

---

## 10. Tech Stack & Dependencies

### 10.1 Runtime

| Component | Technology |
|-----------|-----------|
| Server runtime | **Bun** (latest) |
| Language | **TypeScript** (ES2022, strict mode) |
| Module system | ESM (`"type": "module"`) |
| Module resolution | NodeNext |

### 10.2 Server Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ws` | ^8.18.0 | WebSocket server |

### 10.3 Client Dependencies (bundled via esbuild)

| Package | Version | Purpose |
|---------|---------|---------|
| `@xterm/xterm` | ^5.5.0 | Terminal emulator (core) |
| `@xterm/addon-fit` | ^0.10.0 | Auto-resize terminal to container |
| `@xterm/addon-web-links` | ^0.11.0 | Clickable URLs in terminal |
| `@xterm/addon-webgl` | ^0.18.0 | GPU-accelerated rendering |
| `@xterm/addon-search` | ^0.16.0 | Text search in terminal |
| `@xterm/addon-web-links` | ^0.11.0 | Link detection |

### 10.4 Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/bun` | ^1.4.0 | Bun type definitions |
| `@types/node` | ^20.14.0 | Node.js type definitions |
| `@types/ws` | ^8.5.10 | ws type definitions |
| `esbuild` | ^0.21.5 | Client bundle bundler |
| `typescript` | ^5.4.5 | Type checking |
| `oxlint` | ^0.16.0 | Linter (fast) |
| `lefthook` | ^1.11.0 | Git hooks manager |

### 10.5 External Tools (System)

| Tool | Purpose |
|------|---------|
| **tmux** | Session management, scrollback, persistence |
| **tailscale** (optional) | Auto-detect bind IP, Tailnet access |
| **tmux-resurrect** (optional) | Session save/restore across reboots |
| **tmux-continuum** (optional) | Auto-save/restore sessions |

### 10.6 Fonts

| Font | Weight | Usage |
|------|--------|-------|
| **JetBrains Mono** | 400, 500, 600 | Terminal monospace font |
| **Inter** | 400, 500, 600, 700 | UI sans-serif font |

Loaded via Google Fonts CDN with preconnect.

---

## 11. Build & Development

### 11.1 Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Development mode: esbuild watcher + bun server auto-restart |
| `bun run build` | Production build: esbuild bundle ke `public/dist/` |
| `bun start` | Production start: `bun --no-env-file src/server.ts` |
| `bun run lint` | Lint `src/` dan `web/` dengan oxlint |

### 11.2 Build Pipeline

1. **esbuild**: Entry point `web/terminal.ts` → bundle ke `public/dist/terminal.js` + `public/dist/terminal.css`.
   - Format: ESM, Platform: browser.
   - Minified di production, sourcemaps selalu.
   - Watch mode available (`--watch`).

2. **TypeScript**: `noEmit: true` (type checking only, esbuild handles bundling).
   - Target: ES2022, Lib: ES2022 + DOM + DOM.Iterable.
   - Strict mode: all strict checks enabled.

3. **Linting**: oxlint via `bun run lint` (src + web directories).

### 11.3 Git Hooks (lefthook)

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,js,mjs,json}"
      run: bun run lint
    types:
      glob: "*.{ts,js,mjs}"
      run: bunx tsc --noEmit
```

---

## 12. Deployment

### 12.1 Background Service

`scripts/service.sh` mendukung:

| Platform | Service Manager | Label/Unit |
|----------|----------------|------------|
| macOS | launchd | `com.aaronfei.terminal-web` (LaunchAgent) |
| Linux | systemd | `terminal-web` (user unit) |

Commands: `install`, `uninstall`, `restart`, `status`, `logs`.

### 12.2 Deploy Script

`scripts/deploy.sh` mendukung:

- **repo-live mode**: Service berjalan dari checkout langsung. Deploy = build + restart.
- **mirror mode**: Service berjalan dari directory terpisah (misal `/opt/terminal-web`). Deploy = build + rsync + restart.
- Flags: `--dry-run`, `--no-build`, `--no-restart`.

### 12.3 Graceful Shutdown

- `SIGINT` / `SIGTERM`: Close semua WebSocket (detach tmux clients), close WSS, close HTTP server.
- Force exit setelah 5 detik timeout.
- tmux sessions tetap survive karena berjalan di process terpisah.

### 12.4 Error Recovery

- `EADDRNOTAVAIL`: Retry bind setiap 3 detik (untuk Tailscale yang belum ready saat boot).
- `EADDRINUSE`: Fatal error, exit dengan pesan yang jelas.
- `uncaughtException` / `unhandledRejection`: Logged, tidak crash server.

---

## 13. tmux Configuration

Konfigurasi khusus di `tmux/web.tmux.conf`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `mouse on` | `on` | Mouse click, select, wheel scrolling |
| `history-limit` | `100000` | Deep scrollback buffer |
| `escape-time` | `25ms` | ESC snappy untuk vim/editor (bukan 0 untuk avoid mis-parse) |
| `default-terminal` | `tmux-256color` | Modern terminfo |
| `terminal-overrides` | `*256col*:Tc` | Truecolor (24-bit) support |
| `status` | `off` | Hidden status bar untuk clean terminal |
| WheelUp/WheelDown | Custom bindings | Smooth mouse-wheel scrolling di copy-mode |
| `@resurrect-capture-pane-contents` | `on` | Save scrollback contents |
| `@resurrect-processes` | `claude` | Auto-relaunch Claude Code after reboot |
| `@continuum-restore` | `on` | Auto-restore after reboot |

---

## 14. UI/UX Design

### 14.1 Design System

**Color Palette (Graphite Aurora — default)**:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#14161b` | Page background |
| `--panel` | `#1a1d24` | Header/panel background |
| `--pane` | `#101217` | Terminal pane background |
| `--pane-alt` | `#0d0f13` | Alternate pane background |
| `--border` | `#262b34` | Border color |
| `--border-soft` | `#1f232b` | Subtle border |
| `--text` | `#e7e9ee` | Primary text |
| `--muted` | `#8a90a0` | Secondary text |
| `--dim` | `#565c6a` | Tertiary text |
| `--accent` | `#5eead4` | Primary accent (teal) |
| `--accent-soft` | `rgba(94,234,212,.14)` | Soft accent background |
| `--accent2` | `#a78bfa` | Secondary accent (purple) |
| `--danger` | `#fb7185` | Danger/close actions |

**Typography**:
- UI: `'Inter', sans-serif`
- Terminal: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

**Spacing & Radius**:
- `--radius`: `10px` (card, panel)
- `--radius-sm`: `7px` (buttons, inputs)
- `--shadow`: `0 14px 34px rgba(0,0,0,.4)`

### 14.2 Layout Structure

```
+--------------------------------------------------+
| Titlebar: [tabs...] [+]                          |
+--------------------------------------------------+
| Toolbar: [layouts] [search] [clear][fullscreen]  |
+--------------------------------------------------+
| Workspace:                                       |
| +----------------------------------------------+ |
| | Pane 1          | Pane 2                     | |
| | .pane-head      | .pane-head                 | |
| | .pane-body      | .pane-body                 | |
| | (xterm.js)      | (xterm.js)                 | |
| +----------------------------------------------+ |
+--------------------------------------------------+
| Statusbar: session · connected · N panels        |
+--------------------------------------------------+
| [mobile bar: ☰ title 📎 ⌨ ⋯]                    |
| [keybar: Esc Tab Ctrl Alt ^C Enter Sel  ←↑↓→ ]  |
+--------------------------------------------------+
```

### 14.3 Keyboard Shortcuts

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
| `Ctrl+F` / `Cmd+F` | Open search |
| `Ctrl+Shift+C` | Copy selection (non-Mac) |
| `Ctrl+Shift+V` | Paste (non-Mac) |

---

## 15. Performance Considerations

- **WebGL rendering**: Opt-in via `@xterm/addon-webgl` (GPU-accelerated). Disable dengan `?webgl=0`.
- **WebSocket heartbeat**: 20 detik interval untuk detect dead connections.
- **PTY limit**: `maxPtys` membatasi concurrent terminals untuk protect system pty table.
- **Upload streaming**: Body dibaca chunk-by-chunk dengan size limit, tidak menahan seluruh body di memory.
- **esbuild bundling**: Single-file output (`terminal.js` + `terminal.css`) untuk minimal HTTP requests.
- **localStorage**: Tab order, settings, font size, keybar state, help-seen flag disimpan di localStorage.
- **No-cache**: Semua static files di-serve dengan `Cache-Control: no-cache`.

---

## 16. Error Handling & Resilience

- **WebSocket reconnect**: Exponential backoff (500ms → 5000ms) setiap disconnect.
- **Server crash recovery**: tmux sessions survive — client reconnect ke sesi yang sama.
- **EADDRNOTAVAIL retry**: Server retry bind setiap 3 detik untuk Tailscale yang belum ready.
- **pty fd leak watchdog**: Periodic check → auto-restart jika pty fds melebihi ceiling.
- **Uncaught exception**: Logged, tidak crash server.
- **Upload error handling**: Graceful error response, tidak crash.
- **ResizeObserver**: Auto-fit terminals saat layout berubah.

---

## 17. Limitations & Known Issues

1. **Single-user**: Shared token, bukan per-user identity.
2. **No TLS**: Server berjalan HTTP. TLS via Tailscale atau reverse proxy (Cloudflare).
3. **tmux dependency**: Tidak ada fallback tanpa tmux.
4. **Mobile keyboard**: Virtual keyboard bisa overlap terminal content di beberapa browser.
5. **IME edge cases**: CJK input memiliki dedup logic yang kompleks — edge cases mungkin masih ada.
6. **Large file upload**: Upload di slow connection bisa timeout (server.requestTimeout = 0 untuk handle ini).
7. **Browser clipboard API**: Paste box fallback untuk non-HTTPS contexts.

---

## 18. Future Considerations

> Catatan: Bagian ini mencatat potensi pengembangan, bukan commitment saat ini.

- Per-user authentication (OAuth, OIDC).
- Session sharing/invitations.
- File manager integration.
- Integrated code editor (Monaco).
- Plugin system.
- Custom shell selection.
- Audit logging.
- Connection history & session replay.

---

## 19. Glossary

| Term | Definition |
|------|-----------|
| **pty** | Pseudo-terminal — virtual terminal device yang menghubungkan shell ke program |
| **tmux** | Terminal multiplexer — memungkinkan multiple terminal dalam satu session |
| **detach** | Melepaskan client dari tmux session tanpa kill session |
| **attach** | Menghubungkan client ke tmux session yang sudah berjalan |
| **scrollback** | History buffer dari terminal output sebelumnya |
| **xterm.js** | Terminal emulator berbasis browser |
| **PWA** | Progressive Web App — web app yang bisa di-install ke home screen |
| **Tailnet** | Private network via Tailscale mesh VPN |
| **Split tree** | Recursive data structure untuk merepresentasikan pane layout |

---

## Appendix A: WebSocket Message Types (TypeScript)

```typescript
// Client → Server
type ClientMessage = ResizeMessage | PingMessage | RestartMessage | KillMessage | DebugMessage;

// Server → Client
type ServerMessage = PongMessage | InfoMessage | ClosedMessage;

// Union
type ControlMessage = ClientMessage | ServerMessage;
```

## Appendix B: Session Class API (Client-side)

```typescript
class Session {
  name: string;
  displayName: string;
  term: Terminal;           // xterm.js instance
  connected: boolean;
  everConnected: boolean;

  attachTo(el: HTMLElement, paneId: number): void;
  setActive(active: boolean): void;
  fit(): void;
  focus(): void;
  kill(): void;             // send kill message, close ws
  restart(): void;          // send restart message, ws will close & reconnect
  sendSeq(seq: string): void; // send text sequence (with pending buffer)
  setFont(size: number): void;
  dispose(): void;          // cleanup timers, observers, ws
}
```

## Appendix C: tmux Tab Tagging System

```
@twtab = "1"     → session is a web tab (shown on every device)
@twlabel = "..." → the tab's display label
```

Tag is written via `tmux set-option -t NAME @twtab 1` with retry logic (up to 10 attempts, 150ms interval) because the session may not be registered yet immediately after `new-session`.

---

*Document ini merupakan source of truth untuk semua fitur dan behavior terminal-web. Semua pengembangan harus mengikuti spesifikasi yang terdokumentasi di sini.*
