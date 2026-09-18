import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/schema.js";

describe("Elysia app", () => {
  test("serves health and effective config", async () => {
    const app = createApp({ config: loadConfig([]) });
    const health = await app.handle(new Request("http://localhost/healthz"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, runtime: "bun" });
    const config = await app.handle(new Request("http://localhost/api/config/effective"));
    expect(config.status).toBe(200);
  });
});
