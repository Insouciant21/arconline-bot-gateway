import { serve } from "@hono/node-server";
import { createGatewayApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, db } = createGatewayApp({ config });

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
}, (info) => {
  console.log(`[gateway] listening on http://${info.address}:${info.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
