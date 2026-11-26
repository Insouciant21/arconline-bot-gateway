import { Hono } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { WorkersBridgeClient } from "./bridge/workers-client.js";
import { CommandDispatcher } from "./commands/dispatcher.js";
import type { GatewayConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { GatewayRepository } from "./db/repositories.js";
import { QqApiClient } from "./qq/client.js";
import { QqTokenManager } from "./qq/token.js";
import { MediaProxySigner } from "./render/media-proxy.js";
import type { CustomB50Renderer } from "./render/renderer.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createMediaRoutes } from "./routes/media.js";
import { createWebhookRoutes } from "./routes/webhook.js";

export interface GatewayAppOptions {
  config: GatewayConfig;
  db?: DatabaseSync;
  fetchImpl?: typeof fetch;
  customRenderer?: CustomB50Renderer;
  sleep?: (ms: number) => Promise<void>;
  scheduleBackground?: (task: Promise<void>) => void;
}

export function createGatewayApp(options: GatewayAppOptions) {
  const db = options.db ?? openDatabase(options.config.dbPath);
  const repo = new GatewayRepository(db, options.config.masterKey);
  const tokenManager = new QqTokenManager(options.fetchImpl);
  const qq = new QqApiClient(tokenManager, options.fetchImpl);
  const bridge = new WorkersBridgeClient(options.fetchImpl);
  const mediaSigner = new MediaProxySigner(options.config.mediaSigningKey);
  const dispatcher = new CommandDispatcher({
    config: options.config,
    repo,
    bridge,
    qq,
    mediaSigner,
    customRenderer: options.customRenderer,
    sleep: options.sleep,
  });

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));
  app.route("/", createWebhookRoutes({ repo, dispatcher, scheduleBackground: options.scheduleBackground }));
  app.route("/", createMediaRoutes({ repo, bridge, mediaSigner }));
  app.route("/", createAdminRoutes({ repo, adminSecret: options.config.adminSecret }));

  return { app, db, repo };
}
