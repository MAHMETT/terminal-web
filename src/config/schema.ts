import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { EffectiveConfig, TunnelMode, TunnelProvider } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const int = (value: unknown, fallback: number, min = 0): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
};
const bool = (value: unknown, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === "1";
};
const expand = (value: string): string => value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
const env = process.env;

export function loadConfig(argv = process.argv.slice(2)): EffectiveConfig {
  const configPath = argv.find((arg) => arg.startsWith("--config="))?.slice(9) ?? env.CONFIG_FILE ?? path.join(root, "terminal-web.yaml");
  const file = existsSync(configPath) ? parseYaml(readFileSync(configPath, "utf8")) as Record<string, any> : {};
  const server = file.server ?? {}, tunnel = file.tunnel ?? {}, upload = file.upload ?? {}, proxy = file.proxy ?? {}, auth = file.auth ?? {}, pty = file.pty ?? {};
  const flag = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const port = int(flag("port") ?? env.PORT ?? server.port, 8090, 1);
  const host = flag("host") ?? env.HOST ?? server.host ?? "0.0.0.0";
  const publicOrigin = flag("public-origin") ?? env.PUBLIC_ORIGIN ?? server.publicOrigin ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  try { new URL(publicOrigin); } catch { throw new Error(`Invalid PUBLIC_ORIGIN: ${publicOrigin}`); }
  const provider = (env.TUNNEL_PROVIDER ?? tunnel.provider ?? "none") as TunnelProvider;
  if (!["none", "reverse-proxy", "cloudflare", "tailscale"].includes(provider)) throw new Error(`Invalid TUNNEL_PROVIDER: ${provider}`);
  const mode = (env.TUNNEL_MODE ?? tunnel.mode ?? (provider === "tailscale" ? "serve" : "quick")) as TunnelMode;
  return {
    server: { host, port, publicOrigin, requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS ?? server.requestTimeoutMs, 0) },
    proxy: { trust: bool(env.TRUST_PROXY ?? proxy.trust), forwardedProtoHeader: proxy.forwardedProtoHeader ?? "x-forwarded-proto", forwardedHostHeader: proxy.forwardedHostHeader ?? "x-forwarded-host" },
    auth: { token: (env.AUTH_TOKEN ?? auth.token ?? "").trim() },
    pty: { maxConcurrent: Math.max(1, int(env.MAX_PTYS ?? pty.maxConcurrent, 48, 1)) },
    upload: { directory: expand(env.UPLOAD_DIR ?? upload.directory ?? path.join(os.homedir(), "terminal-web-uploads")), maxBytes: int(env.UPLOAD_MAX_MB ?? upload.maxMb, 25) * 1024 * 1024, retentionHours: int(env.UPLOAD_RETENTION_HOURS ?? upload.retentionHours, 72), maxFiles: int(env.UPLOAD_MAX_FILES ?? upload.maxFiles, 100) },
    tunnel: { provider, enabled: bool(env.TUNNEL_ENABLED ?? tunnel.enabled), autostart: bool(env.TUNNEL_AUTOSTART ?? tunnel.autostart), exposePort: int(env.TUNNEL_EXPOSE_PORT ?? tunnel.exposePort, port, 1), mode, hostname: env.TUNNEL_HOSTNAME ?? tunnel.hostname, configPath: env.TUNNEL_CONFIG_PATH ?? tunnel.configPath, credentialsPath: env.TUNNEL_CREDENTIALS_PATH ?? tunnel.credentialsPath },
    defaultSession: env.DEFAULT_SESSION ?? file.defaultSession ?? "web", repoRoot: root, publicDir: path.join(root, "public"), tmuxConfPath: path.join(root, "tmux/web.tmux.conf")
  };
}

export function redactConfig(config: EffectiveConfig) {
  return { ...config, auth: { enabled: Boolean(config.auth.token) }, tunnel: { ...config.tunnel, credentialsPath: config.tunnel.credentialsPath ? "[redacted]" : undefined } };
}
