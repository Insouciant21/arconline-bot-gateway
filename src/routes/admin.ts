import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { WorkersBridgeClient, WorkersBridgeError } from "../bridge/workers-client.js";
import { constantTimeEqual } from "../crypto/aes.js";
import type { GatewayRepository, ImageMode } from "../db/repositories.js";

const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_MODES = new Set<ImageMode>(["official", "custom", "text"]);
const SESSION_COOKIE = "gw_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const MAX_TRACKED_LOGIN_IPS = 1000;

const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join("; ");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

export interface AdminRoutesDeps {
  repo: GatewayRepository;
  adminSecret: string;
  publicBaseUrl: string | null;
  bridge: WorkersBridgeClient;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function resolveAdminUiDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../admin-ui"),
    resolve(here, "../../dist/admin-ui"),
    resolve(process.cwd(), "dist/admin-ui"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) return dir;
  }
  return null;
}

function readStaticAsset(baseDir: string, relativePath: string): { body: Buffer; contentType: string } | null {
  const target = resolve(baseDir, relativePath);
  if (target !== baseDir && !target.startsWith(`${baseDir}${sep}`)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  const contentType = MIME_TYPES[extname(target).toLowerCase()] || "application/octet-stream";
  return { body: readFileSync(target), contentType };
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

function isHttpsRequest(req: Request, publicBaseUrl: string | null): boolean {
  if (publicBaseUrl?.startsWith("https://")) return true;
  if (req.headers.get("x-forwarded-proto") === "https") return true;
  return new URL(req.url).protocol === "https:";
}

function buildSessionCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

function hasValidOrigin(req: Request, publicBaseUrl: string | null): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(req.url).origin;
  return origin === requestOrigin || (publicBaseUrl !== null && origin === new URL(publicBaseUrl).origin);
}

/**
 * Resolve trusted client IP from proxy headers without trusting spoofed leading XFF entries.
 */
function resolveClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((item) => item.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * Validate Workers instance baseUrl to prevent SSRF to localhost, private IPs, or Docker internal hosts.
 */
export function isAllowedInstanceUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || !host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (isIP(host) !== 0) return false;
  return true;
}

export function createAdminRoutes(deps: AdminRoutesDeps) {
  const router = new Hono();
  const loginFailures = new Map<string, { count: number; resetAt: number }>();

  function pruneLoginFailures(now: number) {
    for (const [key, entry] of loginFailures) {
      if (entry.resetAt <= now) loginFailures.delete(key);
    }
    while (loginFailures.size >= MAX_TRACKED_LOGIN_IPS) {
      const oldest = loginFailures.keys().next().value;
      if (!oldest) break;
      loginFailures.delete(oldest);
    }
  }

  const serveIndex = () => {
    const uiDir = resolveAdminUiDir();
    const asset = uiDir ? readStaticAsset(uiDir, "index.html") : null;
    if (!asset) {
      return new Response("Admin UI not built. Run `pnpm build` first.", { status: 503 });
    }
    return new Response(new Uint8Array(asset.body), {
      status: 200,
      headers: {
        "content-type": asset.contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": ADMIN_CSP,
      },
    });
  };

  router.get("/admin", serveIndex);
  router.get("/admin/", serveIndex);
  router.get("/admin/favicon.svg", () => {
    const uiDir = resolveAdminUiDir();
    const asset = uiDir ? readStaticAsset(uiDir, "favicon.svg") : null;
    if (!asset) return new Response("Not Found", { status: 404 });
    return new Response(new Uint8Array(asset.body), {
      status: 200,
      headers: {
        "content-type": asset.contentType,
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  });

  router.get("/admin/_astro/*", (c) => {
    const uiDir = resolveAdminUiDir();
    if (!uiDir) return new Response("Not Found", { status: 404 });
    const rawPath = new URL(c.req.url).pathname.slice("/admin/".length);
    let relPath: string;
    try { relPath = decodeURIComponent(rawPath); } catch { return new Response("Bad Request", { status: 400 }); }
    const asset = readStaticAsset(uiDir, relPath);
    if (!asset) return new Response("Not Found", { status: 404 });
    return new Response(new Uint8Array(asset.body), {
      status: 200,
      headers: {
        "content-type": asset.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  });

  router.post("/admin/login", async (c) => {
    if (!hasValidOrigin(c.req.raw, deps.publicBaseUrl)) {
      return c.json({ error: "Invalid origin" }, 403);
    }
    const clientIp = resolveClientIp(c.req.raw);
    const now = Date.now();
    const record = loginFailures.get(clientIp);
    if (record && record.resetAt > now && record.count >= LOGIN_MAX_FAILURES) {
      return c.json({ error: "尝试过于频繁，请稍后再试" }, 429);
    }

    let body: { secret?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const supplied = typeof body.secret === "string" ? body.secret.trim() : "";

    if (!supplied || !constantTimeEqual(supplied, deps.adminSecret)) {
      pruneLoginFailures(now);
      const nextCount = record && record.resetAt > now ? record.count + 1 : 1;
      loginFailures.set(clientIp, {
        count: nextCount,
        resetAt: record && record.resetAt > now ? record.resetAt : now + LOGIN_WINDOW_MS,
      });
      return c.json({ error: "ADMIN_SECRET 无效" }, 401);
    }

    loginFailures.delete(clientIp);
    const rawToken = randomBytes(32).toString("hex");
    deps.repo.createAdminSession(sha256Hex(rawToken), now + SESSION_TTL_MS, now);
    const secure = isHttpsRequest(c.req.raw, deps.publicBaseUrl);
    return Response.json(
      { ok: true },
      {
        headers: {
          "set-cookie": buildSessionCookie(rawToken, SESSION_TTL_MS / 1000, secure),
          "cache-control": "no-store",
        },
      },
    );
  });

  router.post("/admin/logout", (c) => {
    if (!hasValidOrigin(c.req.raw, deps.publicBaseUrl)) {
      return c.json({ error: "Invalid origin" }, 403);
    }
    const cookieToken = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (cookieToken && /^[a-f0-9]{64}$/.test(cookieToken)) {
      deps.repo.deleteAdminSession(sha256Hex(cookieToken));
    }
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

  const api = new Hono();
  api.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const supplied = match?.[1]?.trim() ?? "";
    const bearerOk = Boolean(supplied && constantTimeEqual(supplied, deps.adminSecret));

    if (!bearerOk) {
      const cookieToken = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
      const cookieOk = Boolean(
        cookieToken &&
        /^[a-f0-9]{64}$/.test(cookieToken) &&
        deps.repo.hasValidAdminSession(sha256Hex(cookieToken)),
      );
      if (!cookieOk) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !hasValidOrigin(c.req.raw, deps.publicBaseUrl)) {
        return c.json({ error: "Invalid origin" }, 403);
      }
    }
    await next();
  });

  api.get("/session", (c) => c.json({
    authenticated: true,
    publicBaseUrl: deps.publicBaseUrl,
  }));

  api.get("/bots", (c) => c.json({ bots: deps.repo.listBots() }));

  api.post("/bots", async (c) => {
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

  api.patch("/bots/:id", async (c) => {
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

  api.delete("/bots/:id", (c) => {
    const removed = deps.repo.deleteBot(c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Bot not found" }, 404);
  });

  api.get("/instances", (c) => c.json({ instances: deps.repo.listInstances() }));

  api.post("/instances", async (c) => {
    let body: {
      baseUrl?: unknown;
      bridgeSecret?: unknown;
      imageMode?: unknown;
      label?: unknown;
      enabled?: unknown;
    };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
    const bridgeSecret = typeof body.bridgeSecret === "string" ? body.bridgeSecret.trim() : "";
    const imageMode = typeof body.imageMode === "string" ? body.imageMode : "official";
    if (!isAllowedInstanceUrl(baseUrl) || !bridgeSecret || !VALID_MODES.has(imageMode as ImageMode)) {
      return c.json({ error: "Invalid instance payload (requires public https:// baseUrl)" }, 400);
    }

    let id = "";
    let autoLabel: string | null = null;
    try {
      const profile = await deps.bridge.getProfile({
        id: "pending",
        baseUrl,
        bridgeSecret,
        imageMode: imageMode as ImageMode,
        label: null,
        enabled: true,
        createdAt: "",
      });
      const resolved = profile.userCode?.trim() ?? "";
      if (!VALID_ID.test(resolved)) {
        return c.json({ error: "该实例尚未同步到有效的 Arcaea userCode，请先在面板同步一次。" }, 400);
      }
      id = resolved;
      autoLabel = profile.name?.trim() || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取实例 userCode";
      return c.json({ error: `读取实例 userCode 失败：${message}` }, 400);
    }

    const saved = deps.repo.upsertInstance({
      id,
      baseUrl,
      bridgeSecret,
      imageMode: imageMode as ImageMode,
      label: typeof body.label === "string" ? (body.label.trim() || autoLabel) : autoLabel,
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

  api.patch("/instances/:id", async (c) => {
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
    let nextBaseUrl: string | undefined;
    if (body.baseUrl !== undefined) {
      if (typeof body.baseUrl !== "string" || !isAllowedInstanceUrl(body.baseUrl.trim())) {
        return c.json({ error: "Invalid baseUrl (requires public https:// URL)" }, 400);
      }
      nextBaseUrl = body.baseUrl.trim().replace(/\/+$/, "");
    }
    const updated = deps.repo.updateInstance(c.req.param("id"), {
      ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
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

  api.post("/instances/:id/test", async (c) => {
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

  api.delete("/instances/:id", (c) => {
    const removed = deps.repo.deleteInstance(c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Instance not found" }, 404);
  });

  api.get("/bindings", (c) => c.json({ bindings: deps.repo.listBindings() }));

  api.delete("/bindings/:botId/:scene/:openid", (c) => {
    const scene = c.req.param("scene");
    if (scene !== "c2c" && scene !== "group") {
      return c.json({ error: "Invalid scene" }, 400);
    }
    const removed = deps.repo.deleteBinding(c.req.param("botId"), scene, c.req.param("openid"));
    return removed ? c.json({ ok: true }) : c.json({ error: "Binding not found" }, 404);
  });

  router.route("/admin", api);

  return router;
}
