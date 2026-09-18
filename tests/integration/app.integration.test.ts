import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/schema.js";

describe("HTTP integration", () => {
  test("serves health, readiness, and the configured frontend", async () => {
    const app = createApp({ config: loadConfig([]) });
    const health = await app.handle(new Request("http://localhost/healthz"));
    const ready = await app.handle(new Request("http://localhost/readyz"));
    const index = await app.handle(new Request("http://localhost/"));

    expect(health.status).toBe(200);
    expect((await health.json()).runtime).toBe("bun");
    expect([200, 503]).toContain(ready.status);
    expect(index.status).toBe(200);
    expect((await index.text())).toContain("terminal");
  });
});
