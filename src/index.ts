import { createApp } from "./app.js";
import { loadConfig } from "./config/schema.js";

const config = loadConfig();
const app = createApp({ config });
const server = app.listen({ hostname: config.server.host, port: config.server.port });
console.log(`terminal-web running on http://${config.server.host}:${config.server.port}`);

const shutdown = () => { server.stop(true); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
