# Graph Report - terminal-web  (2026-08-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 309 nodes · 484 edges · 23 communities (18 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cc27d810`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- terminal.ts
- server.ts
- Session
- compilerOptions
- devDependencies
- package.json
- activateSession
- service.sh
- types.ts
- auth.ts
- use-repo-as-live.sh
- config.ts
- rules
- deploy.sh
- fitActive
- promptAddSession
- esbuild.mjs
- dev.sh
- openSheet
- fix-pty-perms.mjs
- start.sh
- openDrawer

## God Nodes (most connected - your core abstractions)
1. `Session` - 22 edges
2. `compilerOptions` - 19 edges
3. `activateSession()` - 12 edges
4. `addSession()` - 10 edges
5. `uploadFile()` - 9 edges
6. `closeSession()` - 9 edges
7. `refreshMobileUI()` - 9 edges
8. `gateHttp()` - 9 edges
9. `promptRenameSession()` - 8 edges
10. `buildTab()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `server` --calls--> `gateHttp()`  [EXTRACTED]
  src/server.ts → src/auth.ts
- `handleListSessions()` --calls--> `listWebTabs()`  [EXTRACTED]
  src/server.ts → src/tmux.ts
- `handleRenameSession()` --calls--> `sanitizeSession()`  [EXTRACTED]
  src/server.ts → src/tmux.ts
- `handleRenameSession()` --calls--> `setWebTabLabel()`  [EXTRACTED]
  src/server.ts → src/tmux.ts
- `logStartup()` --calls--> `ensureTmuxAvailable()`  [EXTRACTED]
  src/server.ts → src/tmux.ts

## Import Cycles
- None detected.

## Communities (23 total, 5 thin omitted)

### Community 0 - "terminal.ts"
Cohesion: 0.04
Nodes (39): cached, currentFont, dlBtn, drawerList, drawerNew, encoder, fileBtn, fileInput (+31 more)

### Community 1 - "server.ts"
Cohesion: 0.07
Nodes (41): RFC-6266, broadcastClosed(), buildChildEnv(), config, CONTENT_TYPES, contentTypeFor(), countOwnPtyFds(), escapeHtml() (+33 more)

### Community 2 - "Session"
Cohesion: 0.12
Nodes (16): changeFont(), closeDrawer(), copyText(), downloadFromHost(), flashStatus(), fmtMB(), hideStatus(), isActive() (+8 more)

### Community 3 - "compilerOptions"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, ES2022, src, web, compilerOptions, allowImportingTsExtensions, esModuleInterop (+17 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): lefthook, oxlint, devDependencies, esbuild, lefthook, oxlint, @types/node, @types/ws (+13 more)

### Community 5 - "package.json"
Cohesion: 0.11
Nodes (18): bun-pty, author, dependencies, bun-pty, ws, description, license, name (+10 more)

### Community 6 - "activateSession"
Cohesion: 0.25
Nodes (17): activateSession(), addSession(), buildTab(), closeSession(), confirmCloseSession(), fetchServerTabs(), init(), promptRenameSession() (+9 more)

### Community 7 - "service.sh"
Cohesion: 0.18
Nodes (5): die(), linux_install(), mac_install(), resolve_env(), service.sh script

### Community 8 - "types.ts"
Cohesion: 0.15
Nodes (12): ClientMessage, ClosedMessage, ControlMessage, DebugMessage, InfoMessage, isClientMessage(), KillMessage, PingMessage (+4 more)

### Community 9 - "auth.ts"
Cohesion: 0.38
Nodes (10): authCookie(), authRequired(), gateHttp(), hasValidCookie(), isAuthed(), loginPage(), parseCookies(), reqIsHttps() (+2 more)

### Community 10 - "use-repo-as-live.sh"
Cohesion: 0.43
Nodes (5): detect_live(), die(), say(), use-repo-as-live.sh script, show_status()

### Community 11 - "config.ts"
Cohesion: 0.36
Nodes (7): Config, detectTailscaleIp(), loadConfig(), parseNonNegInt(), parsePort(), REPO_ROOT, thisDir

### Community 12 - "rules"
Cohesion: 0.33
Nodes (5): rules, correctness, nursery, suspicious, $schema

### Community 13 - "deploy.sh"
Cohesion: 0.53
Nodes (4): detect_live(), die(), say(), deploy.sh script

### Community 14 - "fitActive"
Cohesion: 0.33
Nodes (6): fitActive(), mKeysBtn, setKeybarVisible(), toggleFullscreen(), updateKeybarHeight(), updateKeyboardOffset()

### Community 15 - "promptAddSession"
Cohesion: 0.50
Nodes (4): domPrompt(), nextSessionName(), promptAddSession(), sanitizeName()

### Community 18 - "openSheet"
Cohesion: 0.67
Nodes (3): mMoreBtn, openSheet(), updateFontVal()

## Knowledge Gaps
- **120 isolated node(s):** `KeyDef`, `SavedTab`, `ThemeDef`, `LiveSocket`, `WebTab` (+115 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Session` connect `Session` to `terminal.ts`, `activateSession`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `KeyDef`, `SavedTab`, `ThemeDef` to the rest of the system?**
  _120 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `terminal.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `server.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07030527289546716 - nodes in this community are weakly interconnected._
- **Should `Session` be split into smaller, more focused modules?**
  _Cohesion score 0.12063492063492064 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._