export type TunnelProvider = "none" | "reverse-proxy" | "cloudflare" | "tailscale";
export type TunnelMode = "quick" | "named" | "serve" | "funnel";

export interface EffectiveConfig {
  server: { host: string; port: number; publicOrigin: string; requestTimeoutMs: number };
  proxy: { trust: boolean; forwardedProtoHeader: string; forwardedHostHeader: string };
  auth: { token: string };
  pty: { maxConcurrent: number };
  upload: { directory: string; maxBytes: number; retentionHours: number; maxFiles: number };
  tunnel: {
    provider: TunnelProvider;
    enabled: boolean;
    autostart: boolean;
    exposePort: number;
    mode: TunnelMode;
    hostname?: string;
    configPath?: string;
    credentialsPath?: string;
  };
  defaultSession: string;
  repoRoot: string;
  publicDir: string;
  tmuxConfPath: string;
}

export type PublicConfig = Omit<EffectiveConfig, "auth"> & { auth: { enabled: boolean } };
