import { commandRunner } from "../runtime/command-runner.js";
import type { EffectiveConfig } from "../config/types.js";
import type { TunnelAdapter, TunnelStatus } from "./types.js";

const output: string[] = [];
export function createTunnelManager(config: EffectiveConfig): TunnelAdapter {
  let child: ReturnType<typeof commandRunner.spawn> | undefined;
  let state: TunnelStatus = { provider: config.tunnel.provider, state: config.tunnel.enabled ? "stopped" : "disabled" };
  const command = (): [string, string[]] => config.tunnel.provider === "cloudflare"
    ? ["cloudflared", config.tunnel.mode === "named"
      ? ["tunnel", "run", ...(config.tunnel.hostname ? [config.tunnel.hostname] : [])]
      : ["tunnel", "--url", `http://127.0.0.1:${config.tunnel.exposePort}`]]
    : ["tailscale", [config.tunnel.mode === "funnel" ? "funnel" : "serve", String(config.tunnel.exposePort)]];
  return {
    status: () => state,
    logs: () => output.slice(-100),
    async start() {
    if (state.state === "running") return state;
    if (config.tunnel.provider === "none" || config.tunnel.provider === "reverse-proxy") return (state = { ...state, state: config.tunnel.provider === "none" ? "disabled" : "running", url: config.server.publicOrigin });
    const [bin, args] = command();
    if (!(await commandRunner.available(bin))) return (state = { ...state, state: "degraded", error: `${bin} is not installed` });
    state = { ...state, state: "starting", error: undefined };
    child = commandRunner.spawn(bin, args, { onOutput: (chunk) => { output.push(chunk); if (output.length > 100) output.shift(); } });
    child.on("exit", (code) => { if (state.state === "running") state = { ...state, state: "degraded", error: `tunnel exited with code ${code ?? "unknown"}` }; });
    state = { ...state, state: "running", pid: child.pid, url: config.tunnel.provider === "tailscale" && config.tunnel.hostname ? config.tunnel.hostname : state.url };
      return state;
    },
    async stop() { child?.kill("SIGTERM"); child = undefined; return (state = { ...state, state: config.tunnel.enabled ? "stopped" : "disabled", pid: undefined }); },
    async restart() { await this.stop(); return this.start(); }
  };
}
