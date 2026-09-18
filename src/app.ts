import { Elysia, t } from "elysia";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, redactConfig } from "./config/schema.js";
import type { EffectiveConfig } from "./config/types.js";
import { isClientMessage } from "./types.js";
import { sanitizeSession, tmuxArgs, listWebTabs, tagWebSession, setWebTabLabel, readLayout, applyLayout } from "./tmux.js";
import { createTunnelManager } from "./tunnels/manager.js";

export interface AppDeps { config?: EffectiveConfig; }
type BunPty = ReturnType<typeof Bun.spawn> & { terminal: Bun.Terminal };
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const sockets = new Map<unknown, { session: string; proc: BunPty }>();
const send = (ws: { send(data: string | ArrayBuffer | Uint8Array): unknown }, value: unknown) => { try { ws.send(JSON.stringify(value)); } catch {} };

async function pruneUploads(config: EffectiveConfig): Promise<void> {
  if (config.upload.retentionHours <= 0 && config.upload.maxFiles <= 0) return;
  try {
    const entries = (await fs.readdir(config.upload.directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith("clip-"));
    const now = Date.now();
    const files = await Promise.all(entries.map(async (entry) => {
      const file = path.join(config.upload.directory, entry.name);
      const stat = await fs.stat(file);
      return { file, mtime: stat.mtimeMs };
    }));
    const fresh = config.upload.retentionHours > 0
      ? files.filter(({ mtime }) => now - mtime <= config.upload.retentionHours * 60 * 60 * 1000)
      : files;
    fresh.sort((a, b) => b.mtime - a.mtime);
    const keep = config.upload.maxFiles > 0 ? fresh.slice(0, config.upload.maxFiles) : fresh;
    const keepSet = new Set(keep.map(({ file }) => file));
    await Promise.all(files.filter(({ file }) => !keepSet.has(file)).map(({ file }) => fs.rm(file, { force: true })));
  } catch {
    // Upload cleanup is best effort and must not prevent the terminal starting.
  }
}

async function staticFile(config: EffectiveConfig, pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const allowed = ["index.html", "styles.css", "manifest.webmanifest", "apple-touch-icon.png", "icon.svg", "icon-192.png", "icon-512.png", "icon-512-maskable.png"];
  if (!rel || rel.includes("..") || (!rel.startsWith("dist/") && !allowed.includes(rel))) return new Response("Not Found", { status: 404 });
  try { const file = path.join(config.publicDir, rel); return new Response(await fs.readFile(file), { headers: { "content-type": mime[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" } }); } catch { return new Response("Not Found", { status: 404 }); }
}

export function createApp(deps: AppDeps = {}) {
  const config = deps.config ?? loadConfig();
  const tunnelManager = createTunnelManager(config);
  if (config.tunnel.enabled && config.tunnel.autostart) void tunnelManager.start();
  const authGuard = ({ request, set }: { request: Request; set: { status?: number; headers: Record<string, string | number | undefined> } }) => {
    const token = config.auth.token;
    if (!token || !(request.headers.has("cf-ray") || request.headers.has("cf-connecting-ip"))) return;
    const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tw_auth="))?.slice(8);
    if (cookie === token) return;
    const url = new URL(request.url);
    if (url.searchParams.get("token") === token) { url.searchParams.delete("token"); set.status = 302; set.headers.location = url.pathname + url.search; set.headers["set-cookie"] = `tw_auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`; return ""; }
    set.status = 401;
    return new Response("terminal-web authentication required", { status: 401 });
  };
  return new Elysia()
    .onRequest(authGuard)
    .get("/healthz", () => ({ ok: true, runtime: "bun", service: "terminal-web" }))
    .get("/readyz", async ({ set }) => { const result = await Bun.$`tmux -V`.quiet().nothrow(); set.status = result.exitCode === 0 ? 200 : 503; return { ok: result.exitCode === 0, tmux: result.exitCode === 0 }; })
    .get("/api/config/effective", () => redactConfig(config))
    .get("/api/sessions", async () => ({ tabs: await listWebTabs() }))
    .post("/api/sessions/rename", ({ body }) => { const name = sanitizeSession(body.name); setWebTabLabel(name, body.displayName ?? name); return { ok: true }; }, { body: t.Object({ name: t.String(), displayName: t.Optional(t.String()) }) })
    .get("/api/tunnel", () => tunnelManager.status())
    .post("/api/tunnel/start", () => tunnelManager.start())
    .post("/api/tunnel/stop", () => tunnelManager.stop())
    .post("/api/tunnel/restart", () => tunnelManager.restart())
    .get("/api/tunnel/logs", () => ({ logs: tunnelManager.logs() }))
    .post("/upload", async ({ request, query, set }) => { const body = Buffer.from(await request.arrayBuffer()); if (!body.length) { set.status = 400; return { error: "empty body" }; } if (config.upload.maxBytes > 0 && body.length > config.upload.maxBytes) { set.status = 413; return { error: "file too large" }; } await fs.mkdir(config.upload.directory, { recursive: true }); const safe = (query.name ?? "file").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "file"; const filename = `clip-${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${safe}`; const file = path.join(config.upload.directory, filename); await fs.writeFile(file, body, { mode: 0o600 }); await pruneUploads(config); return { path: file, name: filename, size: body.length }; }, { query: t.Object({ name: t.Optional(t.String()) }) })
    .get("/api/download", async ({ query, set, request }) => { if (!query.path) { set.status = 400; return { error: "missing path" }; } const target = query.path.startsWith("~/") ? path.join(process.env.HOME ?? "", query.path.slice(2)) : path.resolve(query.path); try { const stat = await fs.stat(target); const headers = { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${path.basename(target).replaceAll('"', "")}"`, "content-length": String(stat.size) }; return request.method === "HEAD" ? new Response(null, { headers }) : new Response(await fs.readFile(target), { headers }); } catch { set.status = 404; return { error: "file not found" }; } }, { query: t.Object({ path: t.Optional(t.String()), session: t.Optional(t.String()) }) })
    .get("/*", ({ request }) => staticFile(config, new URL(request.url).pathname))
    .ws("/ws", {
      open(ws) { const url = new URL(ws.data.request.url); const session = sanitizeSession(url.searchParams.get("session") ?? config.defaultSession); const cols = Number(url.searchParams.get("cols")) || 80; const rows = Number(url.searchParams.get("rows")) || 24; if (sockets.size >= config.pty.maxConcurrent) { send(ws, { type: "info", message: "Server is at its terminal limit." }); ws.close(); return; } let proc!: BunPty; proc = Bun.spawn(["tmux", ...tmuxArgs(session, config.tmuxConfPath)], { cwd: process.env.HOME, env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }, terminal: { name: "xterm-256color", cols, rows, data: (_terminal, data) => { if (ws.readyState === 1) ws.send(Buffer.from(data)); } } }) as BunPty; sockets.set(ws.raw, { session, proc }); tagWebSession(session); void readLayout(session).then((layout) => layout && send(ws, { type: "layout", ...layout })); },
      message(ws, message) { const current = sockets.get(ws.raw); if (!current) return; if (message instanceof Uint8Array || message instanceof ArrayBuffer || Buffer.isBuffer(message)) { current.proc.terminal.write(message instanceof ArrayBuffer ? new Uint8Array(message) : message); return; } if (typeof message !== "string") return; try { const parsed: unknown = JSON.parse(message); if (!isClientMessage(parsed)) return; if (parsed.type === "resize") current.proc.terminal.resize(parsed.cols, parsed.rows); if (parsed.type === "ping") send(ws, { type: "pong" }); if (parsed.type === "layout") void applyLayout(current.session, parsed.mode, parsed.orient).then((layout) => layout && send(ws, { type: "layout", ...layout })); if (parsed.type === "restart" || parsed.type === "kill") void Bun.$`tmux kill-session -t ${current.session}`.quiet().nothrow(); } catch {} },
      close(ws) { const current = sockets.get(ws.raw); if (!current) return; sockets.delete(ws.raw); try { current.proc.kill(); current.proc.terminal.close(); } catch {} }
    });
}
