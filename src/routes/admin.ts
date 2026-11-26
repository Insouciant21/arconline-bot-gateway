import { Hono } from "hono";
import { constantTimeEqual } from "../crypto/aes.js";
import type { GatewayRepository, ImageMode } from "../db/repositories.js";

const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_MODES = new Set<ImageMode>(["official", "custom", "text"]);

export function createAdminRoutes(deps: {
  repo: GatewayRepository;
  adminSecret: string;
}) {
  const router = new Hono();

  router.use("/admin/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const supplied = match?.[1]?.trim() ?? "";
    if (!supplied || !constantTimeEqual(supplied, deps.adminSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  router.get("/admin/bots", (c) => c.json({ bots: deps.repo.listBots() }));

  router.post("/admin/bots", async (c) => {
    let body: { id?: unknown; appId?: unknown; clientSecret?: unknown; enabled?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const appId = typeof body.appId === "string" ? body.appId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!VALID_ID.test(id) || !appId || !clientSecret) {
      return c.json({ error: "Invalid id, appId or clientSecret" }, 400);
    }
    const saved = deps.repo.upsertBot({
      id,
      appId,
      clientSecret,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    });
    return c.json({ bot: { id: saved.id, appId: saved.appId, enabled: saved.enabled, createdAt: saved.createdAt } }, 201);
  });

  router.delete("/admin/bots/:id", (c) => {
    const removed = deps.repo.deleteBot(c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Bot not found" }, 404);
  });

  router.get("/admin/instances", (c) => c.json({ instances: deps.repo.listInstances() }));

  router.post("/admin/instances", async (c) => {
    let body: {
      id?: unknown;
      baseUrl?: unknown;
      bridgeSecret?: unknown;
      imageMode?: unknown;
      label?: unknown;
      enabled?: unknown;
    };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const bridgeSecret = typeof body.bridgeSecret === "string" ? body.bridgeSecret.trim() : "";
    const imageMode = typeof body.imageMode === "string" ? body.imageMode : "official";
    if (!VALID_ID.test(id) || !/^https?:\/\//.test(baseUrl) || !bridgeSecret || !VALID_MODES.has(imageMode as ImageMode)) {
      return c.json({ error: "Invalid instance payload" }, 400);
    }
    const saved = deps.repo.upsertInstance({
      id,
      baseUrl,
      bridgeSecret,
      imageMode: imageMode as ImageMode,
      label: typeof body.label === "string" ? body.label.trim() || null : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    });
    return c.json({
      instance: {
        id: saved.id,
        baseUrl: saved.baseUrl,
        imageMode: saved.imageMode,
        label: saved.label,
        enabled: saved.enabled,
        createdAt: saved.createdAt,
      },
    }, 201);
  });

  router.delete("/admin/instances/:id", (c) => {
    const removed = deps.repo.deleteInstance(c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Instance not found" }, 404);
  });

  router.get("/admin/bindings", (c) => c.json({ bindings: deps.repo.listBindings() }));

  router.delete("/admin/bindings/:botId/:scene/:openid", (c) => {
    const scene = c.req.param("scene");
    if (scene !== "c2c" && scene !== "group") {
      return c.json({ error: "Invalid scene" }, 400);
    }
    const removed = deps.repo.deleteBinding(c.req.param("botId"), scene, c.req.param("openid"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Binding not found" }, 404);
  });

  return router;
}
