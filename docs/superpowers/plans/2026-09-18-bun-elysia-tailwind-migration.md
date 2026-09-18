# Bun + ElysiaJS + Tailwind CSS 4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate terminal-web from Node/npm to Bun/ElysiaJS, add configurable networking and tunnel lifecycle management, and ship a border-only mobile-first Tailwind CSS 4 interface without breaking tmux sessions or the terminal protocol.

**Architecture:** Preserve the existing WebSocket and tmux compatibility contract while moving behavior behind injected services: configuration, command execution, PTY, tmux, uploads, auth, and tunnels. Compose those services in an Elysia app. Rebuild the UI as focused vanilla TypeScript modules with Tailwind CSS 4 tokens, keeping xterm.js as the terminal renderer.

**Tech Stack:** Bun, TypeScript strict mode, ElysiaJS, `@elysiajs/static`, Elysia WebSocket support, `node-pty` behind a PTY adapter unless Bun-native PTY validation proves a replacement, `ws` only if required by compatibility, xterm.js, Tailwind CSS 4, Bun test, Playwright for E2E.

## Global Constraints

- Preserve tmux session names and `@twtab` / `@twlabel` options.
- Preserve `/ws` binary input/output frames and JSON control messages.
- Mobile is the primary design target from 320px to 430px.
- UI must not use `box-shadow` or `drop-shadow`; hierarchy uses light borders, surface contrast, spacing, and state color.
- Configuration precedence is CLI flags > environment variables > config file > defaults.
- Tunnel providers are `none`, `reverse-proxy`, `cloudflare`, and `tailscale`.
- Tunnel failure must not terminate the terminal server.
- Secrets must be redacted from logs, API responses, and effective configuration.
- Existing environment variables remain supported during migration.
- Every task ends with a focused verification command and a small commit.

## File map

Create the following focused modules:

- `src/app.ts`: Elysia application composition and dependency injection.
- `src/index.ts`: Bun entrypoint, runtime startup, shutdown, and logging.
- `src/config/schema.ts`, `src/config/load.ts`, `src/config/types.ts`: validated configuration.
- `src/runtime/command-runner.ts`: injectable subprocess abstraction.
- `src/terminal/protocol.ts`, `src/terminal/pty.ts`, `src/terminal/service.ts`, `src/terminal/gateway.ts`: terminal protocol and PTY lifecycle.
- `src/tmux/client.ts`, `src/tmux/sessions.ts`, `src/tmux/layouts.ts`: tmux adapter.
- `src/security/auth.ts`, `src/security/proxy.ts`: auth and trusted proxy handling.
- `src/uploads/policy.ts`, `src/uploads/service.ts`: upload/download policies and storage.
- `src/tunnels/types.ts`, `src/tunnels/manager.ts`, `src/tunnels/generic.ts`, `src/tunnels/cloudflare.ts`, `src/tunnels/tailscale.ts`: tunnel abstraction and providers.
- `src/http/static.ts`, `src/http/health.routes.ts`, `src/http/session.routes.ts`, `src/http/file.routes.ts`, `src/http/tunnel.routes.ts`: Elysia route modules.
- `web/styles.css`, `web/design-tokens.css`, `web/terminal.ts`, and focused `web/ui/*.ts` modules: Tailwind-driven client.
- `tests/unit/*`, `tests/integration/*`, `tests/e2e/*`: Bun, integration, and browser tests.

Modify `package.json`, `bun.lock`, `tsconfig.json`, `esbuild.mjs`, `public/index.html`, `.env.example`, scripts, `tmux/web.tmux.conf`, and `README.md` as required by each task.

### Task 1: Baseline contracts and Bun workflow

**Files:**
- Create: `tests/compat/protocol.contract.test.ts`, `tests/compat/config.contract.test.ts`
- Modify: `package.json`, `tsconfig.json`, `README.md`, `.env.example`

- [ ] Record current endpoint and WebSocket message shapes in executable contract fixtures.
- [ ] Add Bun scripts: `dev`, `build`, `start`, `test`, `test:unit`, `test:integration`, and `test:e2e`.
- [ ] Make Bun the documented install/runtime command and retain existing env names.
- [ ] Run `bun install --frozen-lockfile` and `bun test tests/compat`.
- [ ] Commit `build: establish Bun migration workflow and compatibility contracts`.

### Task 2: Configuration schema and runtime command seam

**Files:**
- Create: `src/config/types.ts`, `src/config/schema.ts`, `src/config/load.ts`, `src/runtime/command-runner.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/command-runner.test.ts`
- Modify: `src/config.ts` only as a temporary compatibility export, then remove it after imports migrate.

- [ ] Implement `EffectiveConfig` with server, proxy, auth, PTY, upload, and tunnel sections.
- [ ] Implement YAML/JSON config loading, CLI parsing, env mapping, tilde expansion, origin validation, port validation, and secret redaction.
- [ ] Implement `CommandRunner` with `run`, `spawn`, `isAvailable`, and captured stdout/stderr interfaces.
- [ ] Test precedence, defaults, invalid ports/origins, redaction, and command argument preservation.
- [ ] Run `bun test tests/unit/config.test.ts tests/unit/command-runner.test.ts`.
- [ ] Commit `feat: add validated configuration and command seam`.

### Task 3: Tmux and PTY adapters

**Files:**
- Create: `src/tmux/client.ts`, `src/tmux/sessions.ts`, `src/tmux/layouts.ts`, `src/terminal/pty.ts`, `src/terminal/protocol.ts`, `src/terminal/service.ts`
- Test: `tests/unit/tmux.test.ts`, `tests/unit/protocol.test.ts`, `tests/unit/terminal-service.test.ts`
- Modify: `src/tmux.ts`, `src/types.ts` by moving compatibility exports and deleting them after consumers migrate.

- [ ] Preserve `sanitizeSession`, `tmuxArgs`, tab tagging, labels, layouts, repaint, and session CWD behavior.
- [ ] Define `PtyFactory` and `PtyProcess` interfaces so native PTY behavior is testable.
- [ ] Implement terminal service state for live PTYs, session clients, PTY cap, cleanup, heartbeat, and graceful detach.
- [ ] Keep binary frames raw and validate JSON control frames using the existing message union.
- [ ] Run unit tests plus a real tmux smoke test when `tmux -V` is available.
- [ ] Commit `refactor: isolate tmux and pty services`.

### Task 4: Security, uploads, and route services

**Files:**
- Create: `src/security/auth.ts`, `src/security/proxy.ts`, `src/uploads/policy.ts`, `src/uploads/service.ts`, `src/http/static.ts`, `src/http/health.routes.ts`, `src/http/session.routes.ts`, `src/http/file.routes.ts`
- Test: `tests/unit/auth.test.ts`, `tests/unit/upload-policy.test.ts`, `tests/integration/http-routes.test.ts`
- Modify: `src/auth.ts`, `src/server.ts` only while extracting behavior.

- [ ] Preserve shared-token cookie behavior and make trusted proxy/provider detection explicit.
- [ ] Port static serving, cache-busting, session list/rename, upload, download, and health/readiness behavior to Elysia route modules.
- [ ] Preserve safe upload names, `0600` files, size limits, retention pruning, session-aware relative downloads, and `HEAD` behavior.
- [ ] Add structured error responses without leaking file paths or secrets unnecessarily.
- [ ] Run `bun test tests/unit/auth.test.ts tests/unit/upload-policy.test.ts tests/integration/http-routes.test.ts`.
- [ ] Commit `feat: migrate security file and health routes to Elysia`.

### Task 5: Elysia WebSocket terminal gateway

**Files:**
- Create: `src/terminal/gateway.ts`, `src/app.ts`, `src/index.ts`
- Test: `tests/integration/websocket-terminal.test.ts`
- Modify: `src/server.ts`, `scripts/start.sh`, `scripts/dev.sh`, `esbuild.mjs`

- [ ] Compose Elysia routes and WebSocket gateway with injected services.
- [ ] Implement `/ws` query parsing, auth gate, PTY creation, binary forwarding, resize, layout, ping/pong, restart, kill, close broadcasts, and reconnect semantics.
- [ ] Add `/healthz` and `/readyz` and configure Bun listener using effective host/port.
- [ ] Implement graceful shutdown that closes WebSockets and leaves tmux sessions alive.
- [ ] Run compatibility contract tests and integration WebSocket tests.
- [ ] Start a local server with Bun and verify HTTP 200 plus a real shell command through WebSocket.
- [ ] Commit `feat: run terminal gateway on Bun and Elysia`.

### Task 6: Tunnel manager and provider adapters

**Files:**
- Create: `src/tunnels/types.ts`, `src/tunnels/manager.ts`, `src/tunnels/generic.ts`, `src/tunnels/cloudflare.ts`, `src/tunnels/tailscale.ts`, `src/http/tunnel.routes.ts`
- Test: `tests/unit/tunnels.test.ts`, `tests/integration/tunnel-routes.test.ts`
- Modify: `src/app.ts`, `src/config/*`, `.env.example`, `README.md`

- [ ] Define `TunnelAdapter` with `check`, `start`, `stop`, `restart`, `status`, and `logs` methods.
- [ ] Implement generic reverse-proxy mode as app-only metadata with no child process ownership.
- [ ] Implement Cloudflare quick/named tunnel command construction and owned process lifecycle.
- [ ] Implement Tailscale Serve/Funnel status and lifecycle without mutating unrelated routes.
- [ ] Redact tokens and credential paths; retain bounded recent logs in memory.
- [ ] Add `GET /api/config/effective`, `GET /api/tunnel`, `POST /api/tunnel/start`, `POST /api/tunnel/stop`, `POST /api/tunnel/restart`, and `GET /api/tunnel/logs`.
- [ ] Verify unavailable binaries, crash/restart, disabled provider, public URL, and terminal survival when tunnel fails.
- [ ] Commit `feat: add configurable tunnel management`.

### Task 7: Tailwind CSS 4 foundation and UI shell

**Files:**
- Create: `web/design-tokens.css`, `web/ui/types.ts`, `web/ui/status.ts`, `web/ui/sheets.ts`, `web/ui/sidebar.ts`, `web/ui/command-palette.ts`, `web/ui/settings.ts`
- Modify: `web/styles.css`, `web/terminal.ts`, `public/index.html`, `esbuild.mjs`, `package.json`
- Test: `tests/e2e/ui-shell.spec.ts`

- [ ] Add Tailwind CSS 4 and configure the build to process `web` sources into the existing production bundle.
- [ ] Define CSS-first tokens with `@theme` for surfaces, borders, text, accent, spacing, radius, typography, z-index, and breakpoints.
- [ ] Do not define or use shadow tokens; reject `box-shadow` and `drop-shadow` in UI CSS.
- [ ] Extract session navigation, status indicators, sheets, sidebar, command palette, and settings into focused UI modules.
- [ ] Preserve xterm-specific styles and terminal sizing behavior.
- [ ] Run a production build and inspect generated CSS for shadow declarations.
- [ ] Commit `feat: establish Tailwind CSS 4 border-only design system`.

### Task 8: Mobile-first terminal workspace

**Files:**
- Modify: `web/terminal.ts`, `web/ui/sheets.ts`, `web/ui/status.ts`, `web/styles.css`
- Test: `tests/e2e/mobile-terminal.spec.ts`

- [ ] Implement compact mobile top bar with active session, connection state, session drawer, and action sheet.
- [ ] Implement 44px touch targets, safe-area padding, `visualViewport` keyboard offset, no-hover actions, and focus-safe key bar.
- [ ] Preserve IME/CJK handling, touch scrolling, touch selection, copy/paste, upload progress, download, split view, and reconnect buffering.
- [ ] Add explicit connecting, reconnecting, offline, closed, upload, capacity, and auth states.
- [ ] Test viewport widths 320, 375, and 430 with no horizontal overflow and no terminal occlusion.
- [ ] Commit `feat: redesign terminal workspace for mobile first`.

### Task 9: Desktop workspace and tunnel settings UI

**Files:**
- Modify: `web/ui/sidebar.ts`, `web/ui/command-palette.ts`, `web/ui/settings.ts`, `web/terminal.ts`, `web/styles.css`
- Test: `tests/e2e/desktop-workspace.spec.ts`, `tests/e2e/tunnel-settings.spec.ts`

- [ ] Add collapsible desktop session sidebar and minimal header.
- [ ] Add keyboard-accessible command palette for session, layout, font, file, and tunnel actions.
- [ ] Add network/tunnel settings with provider selection, mode, port, hostname, autostart, status, URL, logs, and actionable errors.
- [ ] Ensure tunnel settings cannot display secrets and management actions show confirmation for stop/restart.
- [ ] Test at 1280px and 1440px widths, keyboard navigation, focus states, and reduced-motion preference.
- [ ] Commit `feat: add desktop workspace and tunnel settings`.

### Task 10: Service scripts, documentation, and release migration

**Files:**
- Modify: `scripts/start.sh`, `scripts/dev.sh`, `scripts/service.sh`, `scripts/deploy.sh`, `scripts/use-repo-as-live.sh`, `tmux/web.tmux.conf`, `.env.example`, `README.md`, `package.json`
- Delete: legacy Node/npm-only paths after rollback validation
- Test: `tests/smoke/runtime.test.ts`

- [ ] Replace npm/node/tsx invocations with Bun equivalents while preserving launchd/systemd behavior and `KillMode=process` semantics.
- [ ] Document config file, CLI flags, environment precedence, generic proxy, Cloudflare, Tailscale, health endpoints, and rollback.
- [ ] Validate `bun install --frozen-lockfile`, `bun run build`, `bun test`, and service script dry-run behavior.
- [ ] Run macOS/Linux smoke matrix where available, including missing tmux/tunnel binaries and port conflicts.
- [ ] Commit `chore: finalize Bun migration operations and documentation`.

### Task 11: Full verification and integration handoff

**Files:**
- Modify: test and documentation files only for fixes found during verification.

- [ ] Run `bun run build`.
- [ ] Run `bun test` and record exact pass/fail counts.
- [ ] Run E2E tests for mobile and desktop flows.
- [ ] Run a real tmux reconnect test and verify the shell process survives browser disconnect.
- [ ] Run tunnel adapter tests with fake command runner and at least one real binary availability check per supported provider.
- [ ] Scan source and built CSS for shadow declarations, leaked secrets, and stale Node/npm commands.
- [ ] Review git diff, confirm only intended files changed, and prepare release notes.
- [ ] Commit any verification-only fixes separately with the appropriate conventional type.
