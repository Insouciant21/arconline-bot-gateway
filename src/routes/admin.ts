import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { WorkersBridgeClient, WorkersBridgeError } from "../bridge/workers-client.js";
import { constantTimeEqual } from "../crypto/aes.js";
import type { GatewayRepository, ImageMode } from "../db/repositories.js";
import { renderAdminHtml } from "../ui/admin-page.js";

const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_MODES = new Set<ImageMode>(["official", "custom", "text"]);
const SESSION_COOKIE = "gw_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

export interface AdminRoutesDeps {
  repo: GatewayRepository;
  adminSecret: string;
  publicBaseUrl: string | null;
  bridge: WorkersBridgeClient;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

function signSessionToken(secret: string, expiresAt: number): string {
  const payload = String(expiresAt);
  const sig = createHmac("sha256", secret).update(`admin-session:${payload}`, "utf8").digest("base64url");
  return `${payload}.${sig}`;
}

function verifySessionToken(secret: string, token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !/^\d+$/.test(payload)) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expectedSig = createHmac("sha256", secret).update(`admin-session:${payload}`, "utf8").digest("base64url");
  return constantTimeEqual(sig, expectedSig);
}

function isHttpsRequest(req: Request, publicBaseUrl: string | null): boolean {
  if (publicBaseUrl?.startsWith("https://")) return true;
  if (req.headers.get("x-forwarded-proto") === "https") return true;
  return new URL(req.url).protocol === "https:";
}

function buildSessionCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

function hasValidOrigin(req: Request, publicBaseUrl: string | null): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(req.url).origin;
  return origin === requestOrigin || (publicBaseUrl !== null && origin === new URL(publicBaseUrl).origin);
}

export function createAdminRoutes(deps: AdminRoutesDeps) {
  const router = new Hono();
  const loginFailures = new Map<string, { count: number; resetAt: number }>();

  router.get("/admin", () => {
    return new Response(renderAdminHtml(), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      },
    });
  });

  router.post("/admin/login", async (c) => {
    if (!hasValidOrigin(c.req.raw, deps.publicBaseUrl)) {
      return c.json({ error: "Invalid origin" }, 403);
    }
    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
    const now = Date.now();
    const record = loginFailures.get(clientIp);
    if (record && record.resetAt > now && record.count >= LOGIN_MAX_FAILURES) {
      return c.json({ error: "尝试过于频繁，请稍后再试" }, 429);
    }

    let body: { secret?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const supplied = typeof body.secret === "string" ? body.secret.trim() : "";

    if (!supplied || !constantTimeEqual(supplied, deps.adminSecret)) {
      const nextCount = record && record.resetAt > now ? record.count + 1 : 1;
      loginFailures.set(clientIp, { count: nextCount, resetAt: record && record.resetAt > now ? record.resetAt : now + LOGIN_WINDOW_MS });
      return c.json({ error: "ADMIN_SECRET 无效" }, 401);
    }

    loginFailures.delete(clientIp);
    const token = signSessionToken(deps.adminSecret, now + SESSION_TTL_MS);
    const secure = isHttpsRequest(c.req.raw, deps.publicBaseUrl);
    return Response.json(
      { ok: true },
      {
        headers: {
          "set-cookie": buildSessionCookie(token, SESSION_TTL_MS / 1000, secure),
          "cache-control": "no-store",
        },
      },
    );
  });

  router.post("/admin/logout", (c) => {
    const secure = isHttpsRequest(c.req.raw, deps.publicBaseUrl);
    return Response.json(
      { ok: true },
      {
        headers: {
          "set-cookie": buildSessionCookie("", 0, secure),
          "cache-control": "no-store",
        },
      },
    );
  });

  router.use("/admin/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const supplied = match?.[1]?.trim() ?? "";
    const bearerOk = Boolean(supplied && constantTimeEqual(supplied, deps.adminSecret));

    if (!bearerOk) {
      const cookieToken = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
      const cookieOk = verifySessionToken(deps.adminSecret, cookieToken);
      if (!cookieOk) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !hasValidOrigin(c.req.raw, deps.publicBaseUrl)) {
        return c.json({ error: "Invalid origin" }, 403);
      }
    }
    await next();
  });

  router.get("/admin/session", (c) => c.json({
    authenticated: true,
    publicBaseUrl: deps.publicBaseUrl,
  }));

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

  router.patch("/admin/bots/:id", async (c) => {
    let body: { appId?: unknown; clientSecret?: unknown; enabled?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const updated = deps.repo.updateBot(c.req.param("id"), {
      ...(typeof body.appId === "string" && body.appId.trim() ? { appId: body.appId.trim() } : {}),
      ...(typeof body.clientSecret === "string" && body.clientSecret.trim() ? { clientSecret: body.clientSecret.trim() } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    });
    if (!updated) return c.json({ error: "Bot not found" }, 404);
    return c.json({ bot: { id: updated.id, appId: updated.appId, enabled: updated.enabled, createdAt: updated.createdAt } });
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

  router.patch("/admin/instances/:id", async (c) => {
    let body: {
      baseUrl?: unknown;
      bridgeSecret?: unknown;
      imageMode?: unknown;
      label?: unknown;
      enabled?: unknown;
    };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (body.imageMode !== undefined && (typeof body.imageMode !== "string" || !VALID_MODES.has(body.imageMode as ImageMode))) {
      return c.json({ error: "Invalid imageMode" }, 400);
    }
    const updated = deps.repo.updateInstance(c.req.param("id"), {
      ...(typeof body.baseUrl === "string" && /^https?:\/\//.test(body.baseUrl.trim()) ? { baseUrl: body.baseUrl.trim() } : {}),
      ...(typeof body.bridgeSecret === "string" && body.bridgeSecret.trim() ? { bridgeSecret: body.bridgeSecret.trim() } : {}),
      ...(typeof body.imageMode === "string" ? { imageMode: body.imageMode as ImageMode } : {}),
      ...(body.label !== undefined ? { label: typeof body.label === "string" ? body.label.trim() || null : null } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    });
    if (!updated) return c.json({ error: "Instance not found" }, 404);
    return c.json({
      instance: {
        id: updated.id,
        baseUrl: updated.baseUrl,
        imageMode: updated.imageMode,
        label: updated.label,
        enabled: updated.enabled,
        createdAt: updated.createdAt,
      },
    });
  });

  router.post("/admin/instances/:id/test", async (c) => {
    const instance = deps.repo.getInstance(c.req.param("id"));
    if (!instance) return c.json({ error: "Instance not found" }, 404);
    try {
      const b50 = await deps.bridge.getB50(instance);
      return c.json({
        ok: true,
        status: 200,
        message: `连接成功（玩家 ${b50.user.name || "未知"}，PTT ${b50.potential.toFixed(3)}，快照 ${b50.snapshotId}）`,
      });
    } catch (error) {
      if (error instanceof WorkersBridgeError && error.status === 404) {
        return c.json({
          ok: true,
          status: 404,
          message: "桥接鉴权通过，但该实例尚未同步过任何 B50 快照。",
        });
      }
      const message = error instanceof Error ? error.message : "连接失败";
      return c.json({
        ok: false,
        status: error instanceof WorkersBridgeError ? error.status : 502,
        message,
      });
    }
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
