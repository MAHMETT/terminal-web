export interface CommandResult { code: number; stdout: string; stderr: string; }
export interface CommandProcess { pid?: number; kill(signal?: NodeJS.Signals): void; on(event: "exit", listener: (code: number | null) => void): this; }
export interface CommandRunner { run(command: string, args: string[]): Promise<CommandResult>; spawn(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void }): CommandProcess; available(command: string): Promise<boolean>; }

export const commandRunner: CommandRunner = {
  async run(command, args) {
    try {
      const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    } catch {
      return { code: 1, stdout: "", stderr: "" };
    }
  },
  spawn(command, args, options = {}) {
    const proc = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: options.env as Record<string, string> | undefined,
      stdout: "pipe",
      stderr: "pipe",
    });
    const onOutput = options.onOutput;
    if (onOutput) {
      void Promise.all([
        new Response(proc.stdout).text().then(onOutput),
        new Response(proc.stderr).text().then(onOutput),
      ]);
    }
    const result: CommandProcess = {
      pid: proc.pid,
      kill: (signal = "SIGTERM") => proc.kill(signal),
      on: (_event, listener) => { void proc.exited.then(listener); return result; },
    };
    return result;
  },
  async available(command) { return (await this.run(command, ["--version"])).code === 0; }
};
