import { describe, expect, test } from "bun:test";
import { loadConfig, redactConfig } from "../../src/config/schema.js";

describe("configuration", () => {
  test("loads configurable host and port", () => {
    const previousHost = process.env.HOST;
    const previousPort = process.env.PORT;
    process.env.HOST = "127.0.0.1";
    process.env.PORT = "9123";
    const config = loadConfig([]);
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(9123);
    if (previousHost === undefined) delete process.env.HOST; else process.env.HOST = previousHost;
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
  });

  test("redacts auth token", () => {
    const previous = process.env.AUTH_TOKEN;
    process.env.AUTH_TOKEN = "secret-value";
    const config = redactConfig(loadConfig([]));
    expect(config.auth.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain("secret-value");
    if (previous === undefined) delete process.env.AUTH_TOKEN; else process.env.AUTH_TOKEN = previous;
  });
});
