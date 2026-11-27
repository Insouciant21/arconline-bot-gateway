import { Hono } from "hono";
import type { WorkersBridgeClient } from "../bridge/workers-client.js";
import type { GatewayRepository } from "../db/repositories.js";
import type { MediaProxySigner } from "../render/media-proxy.js";

export function createMediaRoutes(deps: {
  repo: GatewayRepository;
  bridge: WorkersBridgeClient;
  mediaSigner: MediaProxySigner;
}) {
  const router = new Hono();

  router.get("/qq/media/:token", async (c) => {
    const token = c.req.param("token");
    const verified = deps.mediaSigner.verify(token);
    if (!verified) {
      return c.json({ error: "Invalid or expired media token" }, 401);
    }
    const instance = deps.repo.getInstance(verified.instanceId);
    if (!instance || !instance.enabled) {
      return c.json({ error: "Instance not found" }, 404);
    }
    try {
      const media = await deps.bridge.fetchMedia(instance, verified.key);
      return new Response(media.body, {
        status: 200,
        headers: {
          "content-type": media.contentType,
          "content-length": String(media.body.byteLength),
          "cache-control": "private, no-store",
        },
      });
    } catch {
      return c.json({ error: "Upstream media unavailable" }, 502);
    }
  });

  return router;
}
