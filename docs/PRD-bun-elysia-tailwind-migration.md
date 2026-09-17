# PRD: Bun + ElysiaJS Migration and Mobile-First UI Redesign

**Status:** Draft for implementation
**Date:** 2026-09-18
**Project:** terminal-web
**Decision owner:** Project maintainer

## 1. Problem statement

terminal-web currently provides a useful browser terminal, but its runtime is
based on Node.js/npm and its HTTP/WebSocket orchestration is concentrated in a
large `src/server.ts`. Configuration is primarily environment-driven, tunnel
support is implicit and provider-specific, and the UI has grown around a
desktop-first top bar while mobile is the primary use case.

The project needs a controlled migration to Bun and ElysiaJS without breaking
existing tmux sessions or the terminal WebSocket protocol. At the same time,
the UI needs to become mobile-first, minimalist, clean, fresh, and easier to
operate on both touch and desktop devices. Port binding, public origin, proxy
mode, and tunnel lifecycle must be explicit and configurable.

## 2. Product vision

Provide a fast, dependable personal remote terminal that opens quickly on a
phone, keeps terminal sessions alive through tmux, and makes network exposure
understandable and controllable. The terminal remains the primary workspace;
secondary controls are available without competing with the shell.

## 3. Goals

1. Migrate the server runtime and package workflow from Node/npm to Bun.
2. Replace ad-hoc HTTP routing with modular ElysiaJS routes and plugins.
3. Preserve tmux session identity, reconnect behavior, and protocol
   compatibility during migration.
4. Support flexible host, port, public-origin, proxy, and tunnel configuration.
5. Provide native Cloudflare Tunnel and Tailscale Serve/Funnel adapters.
6. Provide generic reverse-proxy mode for providers managed outside the app.
7. Allow tunnel status and lifecycle control from a secured API and UI.
8. Redesign the frontend mobile-first using Tailwind CSS 4.
9. Improve accessibility, touch ergonomics, connection feedback, and error
   recovery.
10. Add test seams around configuration, commands, PTY lifecycle, routes, and
    tunnel adapters.

## 4. Non-goals

- Multi-user accounts, roles, OAuth, MFA, or per-user authorization.
- A database-backed session store.
- Replacing tmux as the persistence layer.
- Implementing every tunnel vendor natively.
- A full file manager or remote IDE.
- TLS termination inside the application.
- Horizontal scaling across multiple hosts.
- Rebuilding the terminal emulator from scratch.

## 5. Users and primary journeys

### Primary user

A developer operating their own machine or small trusted host who needs to
run shell programs from a phone, tablet, laptop, or desktop browser.

### Journey A: mobile terminal

1. User opens the configured URL on a phone.
2. The app restores the last active session.
3. The terminal occupies the usable viewport and avoids the soft keyboard.
4. User switches sessions through a bottom sheet/drawer.
5. User uses the on-screen key bar for Esc, Tab, modifiers, arrows, and
   Ctrl+C.
6. A temporary network loss shows an explicit reconnect state while tmux keeps
   the process alive.

### Journey B: attachment for a CLI

1. User picks, pastes, or drops a file.
2. The app uploads it and shows progress.
3. The returned path is inserted into the active terminal.
4. The user submits the path to a CLI such as Claude Code.

### Journey C: exposing the terminal

1. User opens Network/Tunnel settings.
2. User chooses disabled, generic reverse proxy, Cloudflare, or Tailscale.
3. User configures bind port, exposed port, hostname/mode, and autostart.
4. The app validates prerequisites before starting.
5. The UI shows status, public URL, process health, and actionable errors.

## 6. Target architecture

```text
Bun runtime
└── Elysia application
    ├── config plugin
    ├── auth/security plugin
    ├── static/PWA routes
    ├── session routes
    ├── upload/download routes
    ├── tunnel management routes
    ├── health/readiness routes
    └── terminal WebSocket gateway
        ├── terminal service
        ├── PTY adapter
        ├── tmux adapter
        └── session registry

Tunnel manager
├── generic reverse-proxy adapter
├── Cloudflare adapter (`cloudflared`)
└── Tailscale adapter (`tailscale serve` / `tailscale funnel`)

Frontend
├── terminal workspace
├── session navigation
├── mobile controls/drawers
├── desktop sidebar/command palette
├── network/tunnel settings
└── Tailwind CSS 4 design system
```

### Proposed module seams

```text
src/
├── app.ts
├── index.ts
├── config/
│   ├── schema.ts
│   ├── load.ts
│   └── types.ts
├── http/
│   ├── static.ts
│   ├── sessions.routes.ts
│   ├── files.routes.ts
│   ├── tunnel.routes.ts
│   └── health.routes.ts
├── terminal/
│   ├── gateway.ts
│   ├── service.ts
│   ├── protocol.ts
│   └── pty.ts
├── tmux/
│   ├── client.ts
│   ├── sessions.ts
│   └── layouts.ts
├── tunnels/
│   ├── manager.ts
│   ├── types.ts
│   ├── generic.ts
│   ├── cloudflare.ts
│   └── tailscale.ts
├── uploads/
│   ├── service.ts
│   └── policy.ts
└── security/
    ├── auth.ts
    └── proxy.ts
```

The exact filenames may vary, but each module must have one responsibility and
must depend on interfaces rather than directly invoking process APIs where a
test double is needed.

## 7. Migration requirements

### Runtime and package manager

- Bun is the documented runtime and package manager.
- `bun.lock` is the canonical lockfile.
- `package-lock.json` is removed after migration validation.
- Scripts become `bun run dev`, `bun run build`, `bun run start`, and
  `bun test`.
- Node-only dependencies are removed where Bun-compatible alternatives exist.
- Native PTY support must be explicitly validated on supported macOS and Linux
  versions. If `node-pty` remains temporarily, it must be isolated behind a
  PTY adapter and tracked as a migration exception.
- Startup errors must identify missing `tmux`, missing tunnel binary, native
  module incompatibility, or invalid configuration.

### ElysiaJS

- Elysia owns HTTP routing, request validation, error mapping, and WebSocket
  registration.
- Route schemas are typed and validate request params, query strings, bodies,
  and response shapes.
- Static serving, auth, upload policy, and request limits are composed as
  plugins or focused route modules.
- The terminal binary stream must not be converted to JSON or buffered as a
  whole request.
- Graceful shutdown closes listeners and WebSocket connections while allowing
  tmux sessions to persist.

### Compatibility contract

The following remain stable during the first migration release:

- `tmux` session names and `@twtab` / `@twlabel` options.
- `/ws?session=NAME&cols=N&rows=N`.
- Binary browser-to-server input frames.
- Binary server-to-browser PTY output frames.
- JSON control messages: `resize`, `ping`, `restart`, `kill`, `layout`, and
  `debug`.
- REST behavior for session listing/rename, upload, and download.
- Existing environment variables, with documented aliases where names change.

## 8. Configuration specification

Configuration precedence:

```text
CLI flags > environment variables > config file > defaults
```

Example file:

```yaml
server:
  host: 0.0.0.0
  port: 8090
  publicOrigin: http://localhost:8090
  requestTimeoutMs: 0

proxy:
  trust: false
  forwardedProtoHeader: x-forwarded-proto
  forwardedHostHeader: x-forwarded-host

tunnel:
  provider: none # none | reverse-proxy | cloudflare | tailscale
  enabled: false
  autostart: false
  exposePort: 8090
  mode: serve # cloudflare: quick|named; tailscale: serve|funnel
  hostname:
  configPath:
  credentialsPath:

auth:
  token:

pty:
  maxConcurrent: 48

upload:
  directory: ~/terminal-web-uploads
  maxMb: 25
  retentionHours: 72
  maxFiles: 100
```

Required behavior:

- `HOST`, `PORT`, and `publicOrigin` are independent values.
- `exposePort` may differ from the local server port.
- Port values are validated as integers from 1 to 65535.
- Hostnames and origins are normalized and rejected if malformed.
- Secrets are redacted from effective-config responses and logs.
- The app reports the effective local URL and public URL when known.
- Tunnel failure does not terminate the terminal server.
- Config changes that affect a running tunnel require explicit restart or
  reload behavior; they must not silently mutate an unrelated tunnel.

Backward-compatible environment variables:

`HOST`, `PORT`, `DEFAULT_SESSION`, `AUTH_TOKEN`, `UPLOAD_DIR`,
`UPLOAD_RETENTION_HOURS`, `UPLOAD_MAX_FILES`, `UPLOAD_MAX_MB`, and `MAX_PTYS`.

## 9. Tunnel requirements

### Generic reverse proxy

- The app runs only the local server.
- `publicOrigin` documents the externally reachable origin.
- Proxy trust is opt-in and configured explicitly.
- Provider-specific lifecycle remains outside the app.

### Cloudflare adapter

- Detect `cloudflared` and report version/availability.
- Support quick tunnel and named tunnel modes.
- Start, stop, restart, status, public URL, PID, and recent logs.
- Never expose tunnel tokens or credential paths in API responses.
- Handle missing binary, invalid credentials, port conflict, and process crash.

### Tailscale adapter

- Detect `tailscale` and report daemon availability.
- Support Serve and Funnel modes.
- Read status and public/local URL.
- Start, stop, restart, and refresh only the route owned by the app.
- Do not delete or overwrite unrelated Tailscale Serve/Funnel configuration.

### Tunnel API

- `GET /api/config/effective`
- `GET /api/tunnel`
- `POST /api/tunnel/start`
- `POST /api/tunnel/stop`
- `POST /api/tunnel/restart`
- `GET /api/tunnel/logs`

Management actions require the same auth boundary as the terminal, with an
additional explicit authorization check in the route layer.

## 10. UX/UI requirements

### Information architecture

Primary navigation:

- Active terminal workspace.
- Session switcher.
- Network/Tunnel settings.
- Help and keyboard shortcuts.

Secondary actions must not consume permanent screen space on mobile.

### Mobile layout

- Mobile is the primary design target from 320px to 430px viewport width.
- Terminal fills the usable viewport including safe-area insets.
- Compact top bar shows active session, connection state, and menu actions.
- Sessions open in a bottom sheet or drawer.
- Secondary actions open in an action sheet.
- On-screen key bar is toggleable and does not steal terminal focus.
- Soft keyboard offset is handled using `visualViewport`.
- All controls have at least 44px touch targets.
- No critical feature depends on hover.
- Reconnect, upload progress, tunnel state, and errors are visible without
  blocking the terminal unnecessarily.

### Desktop layout

- Collapsible session sidebar.
- Minimal header with host/session and connection state.
- Terminal receives the majority of available width and height.
- Command palette exposes restart, layout, font, upload, download, and tunnel
  actions.
- Split pane remains tmux-backed.

### Visual language

- Minimalist, clean, fresh, dark-first.
- Neutral surfaces with one restrained accent color.
- Thin borders, moderate radius, minimal shadow.
- Sans-serif UI typography and monospace terminal typography.
- No decorative gradients or excessive cards.
- Clear status colors with non-color text/icon equivalents.
- Respect `prefers-reduced-motion`.

### Tailwind CSS 4

- Tailwind CSS 4 is the primary UI styling system.
- Theme tokens are defined with CSS-first `@theme`.
- Tokens cover color, spacing, radius, typography, shadow, z-index, and
  breakpoints.
- Existing `styles.css` behavior is mapped to components and tokens instead of
  copied wholesale.
- Terminal-specific CSS remains narrowly scoped for xterm, selection clipping,
  IME, and viewport behavior.
- Production builds must be deterministic and exclude unused styles.

### Required states

- Connecting.
- Connected.
- Reconnecting.
- Offline.
- Session closed remotely.
- Uploading with progress.
- Upload failed.
- Tunnel disabled.
- Tunnel starting/stopping.
- Tunnel healthy.
- Tunnel degraded/crashed.
- Auth required/invalid.
- Server at PTY capacity.

## 11. Functional requirements

### Terminal and sessions

- Create, activate, rename, restart, and kill sessions.
- Reconnect to existing tmux sessions.
- Synchronize tab list across devices.
- Resize terminal with bounds validation.
- Support one, two, and both pane modes.
- Preserve touch scrolling, selection clipping, copy/paste, and IME behavior.
- Keep PTY concurrency bounded.

### Files

- Upload any file through picker, paste, or drag/drop.
- Show progress and actionable errors.
- Sanitize names and save files with restrictive permissions.
- Apply retention and count policies.
- Download host-readable files using a session-aware relative path.

### Health and operations

- `GET /healthz` returns process health.
- `GET /readyz` verifies required runtime readiness, including tmux when
  configured as required.
- Logs identify subsystem and session without leaking secrets.
- Graceful shutdown detaches PTY clients but preserves tmux sessions.

## 12. Testing strategy

The highest-value seam is the application composition boundary: construct the
Elysia app with injected config, command runner, PTY factory, tmux client, and
tunnel adapters.

Required test layers:

- Unit tests for config precedence/validation, session sanitization, protocol
  guard, auth, upload policy, and tunnel command construction.
- Integration tests for HTTP routes, auth gates, health/readiness, upload,
  download, session APIs, and WebSocket control messages.
- PTY/tmux tests using a fake command runner plus a small real-tmux smoke test.
- Tunnel adapter tests for disabled mode, unavailable binary, start/stop,
  status, crash, and secret redaction.
- E2E tests for mobile and desktop flows: initial connect, reconnect, session
  switch, upload, split, command palette, and tunnel status.
- Manual smoke tests on supported macOS and Linux environments.
- Compatibility tests against the current WebSocket and REST contract before
  removing the legacy server.

## 13. Rollout plan

### Phase 0: baseline and contract freeze

- Capture current protocol and endpoint behavior.
- Add characterization tests around tmux/session behavior.
- Record current environment variables and deployment commands.

### Phase 1: runtime foundation

- Introduce Bun scripts and lockfile workflow.
- Add Elysia app shell and injected service interfaces.
- Implement health/readiness and structured error handling.

### Phase 2: compatibility backend

- Migrate static routes, auth, sessions, files, and WebSocket gateway.
- Keep old protocol and tmux semantics.
- Run old and new behavior against the same contract tests.

### Phase 3: configurable networking

- Add config file, CLI flags, precedence, redaction, and effective-config API.
- Add generic reverse-proxy mode.
- Add Cloudflare and Tailscale adapters plus lifecycle API.

### Phase 4: UI redesign

- Add Tailwind CSS 4 tokens and build pipeline.
- Implement mobile terminal shell and session sheets.
- Implement desktop sidebar and command palette.
- Add network/tunnel settings and all required states.

### Phase 5: cutover and cleanup

- Validate supported OS/service scripts.
- Remove legacy Node/npm runtime path.
- Update README and operational runbooks.
- Perform regression, accessibility, performance, and tunnel smoke tests.

## 14. Success metrics

- Existing tmux sessions attach successfully after upgrade.
- Reconnect preserves running programs in 100% of tested scenarios.
- Mobile core flow is usable at 320px width without horizontal overflow.
- No critical terminal action is hidden behind hover.
- Build, typecheck, unit, integration, and E2E checks are reproducible with Bun.
- Tunnel can be disabled without affecting terminal functionality.
- Cloudflare and Tailscale failures produce actionable UI errors without
  taking down the local server.
- No secret appears in logs, effective config, tunnel status, or error payloads.
- Startup configuration requires no source-code edits.

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Bun/native PTY incompatibility | Isolate PTY adapter; validate early on macOS/Linux; fail clearly |
| WebSocket regression | Freeze protocol; contract-test binary and JSON frames |
| tmux session loss | Never kill tmux during app shutdown; test upgrade/reconnect |
| Tunnel process ownership mistakes | Adapter-specific ownership metadata; never mutate unrelated routes |
| Proxy header spoofing | Explicit trust-proxy configuration and provider-aware headers |
| Mobile keyboard/IME regressions | Preserve current behavior as characterization tests; test real devices |
| UI redesign scope expansion | Terminal-first IA; defer account management and file browser |
| Large frontend module persists | Split by domain/state boundary during redesign |

## 16. Definition of done

- The application runs using Bun and ElysiaJS with documented commands.
- Legacy Node/npm startup path is removed or explicitly documented as a
  temporary rollback path.
- Terminal protocol, tmux persistence, session sync, upload/download, and
  layout behavior pass compatibility tests.
- Host, port, public origin, proxy, upload, PTY, and tunnel settings are
  configurable and validated.
- Generic reverse proxy, Cloudflare, and Tailscale modes are implemented and
  tested.
- Mobile-first and desktop UI flows meet the required interaction and
  accessibility criteria.
- Tailwind CSS 4 is the primary styling system.
- Health/readiness, logging, graceful shutdown, and secret redaction are in
  place.
- README, `.env.example`, service scripts, and deployment documentation are
  updated.
- Verification commands and test results are recorded before release.
