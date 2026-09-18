export type TunnelState = "disabled" | "stopped" | "starting" | "running" | "degraded";
export interface TunnelStatus { provider: string; state: TunnelState; url?: string; pid?: number; error?: string; }
export interface TunnelAdapter { status(): TunnelStatus; start(): Promise<TunnelStatus>; stop(): Promise<TunnelStatus>; restart(): Promise<TunnelStatus>; logs(): string[]; }
