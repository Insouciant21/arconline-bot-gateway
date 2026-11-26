import { sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayApp } from "../src/app.js";
import type { GatewayConfig } from "../src/config.js";
import { decryptSecret, encryptSecret } from "../src/crypto/aes.js";
import { deriveEd25519Keys, signValidationChallenge, verifyWebhookSignature } from "../src/crypto/qq-ed25519.js";
import { openDatabase } from "../src/db/client.js";

function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    publicBaseUrl: "https://bot-gw.example",
    adminSecret: "admin-secret-xyz",
    masterKey: "master-key-xyz-0123456789",
    mediaSigningKey: "media-signing-xyz-0123456789",
    dbPath: ":memory:",
    syncPollIntervalMs: 1,
    syncPollTimeoutMs: 50,
    ...overrides,
  };
}

function makeSignedWebhookRequest(
  botId: string,
  botSecret: string,
  payload: unknown,
  timestamp = "1732640000",
) {
  const rawBody = JSON.stringify(payload);
  const { privateKey } = deriveEd25519Keys(botSecret);
  const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`, "utf8"), privateKey).toString("hex");
  return new Request(`http://localhost/qq/webhook/${botId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-timestamp": timestamp,
      "x-signature-ed25519": signature,
    },
    body: rawBody,
  });
}

function b50Fixture(id = "snap-01") {
  return {
    snapshotId: id,
    fetchedAt: "2026-11-27T01:00:00.000Z",
    potential: 12.654,
    weightedPotential: 12.654321,
    mediaStatus: "complete",
    potentialImageKey: `potential/${id}.image`,
    user: { name: "Hikari", userCode: "123456789", rating: 12.654 },
    stats: {
      top10Sum: 129.5,
      rest40Sum: 500.2,
      weightedExact: 12.653333,
      top10Avg: 12.95,
      top10Floor: 12.85,
      b50Avg: 12.594,
      b50Floor: 12.41,
    },
    best50: Array.from({ length: 50 }, (_, index) => ({
      songId: `song${index}`,
      difficulty: 2,
      score: 9900000 - index * 1000,
      rating: 13 - index / 100,
      clearType: 1,
      title: { zh: `曲目 ${index + 1}` },
    })),
  };
}

describe("crypto helpers", () => {
  it("encrypts and decrypts secrets with AES-256-GCM", () => {
    const encrypted = encryptSecret("super-secret-value", "my-master-key");
    expect(encrypted).not.toContain("super-secret-value");
    expect(decryptSecret(encrypted, "my-master-key")).toBe("super-secret-value");
  });

  it("signs and verifies QQ Ed25519 challenges and webhooks", () => {
    const secret = "short-secret";
    const sig = signValidationChallenge(secret, "1700000000", "hello-token");
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyWebhookSignature(secret, "1700000000", sig, "hello-token")).toBe(true);
    expect(verifyWebhookSignature(secret, "1700000000", sig, "tampered")).toBe(false);
  });
});

describe("gateway multi-bot & multi-instance routing", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.();
    }
  });

  function setupGateway(opts: {
    syncBehavior?: "recorded" | "unchanged" | "fail";
    config?: Partial<GatewayConfig>;
  } = {}) {
    const sentQqCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const bridgeCalls: Array<{ url: string; method: string }> = [];
    const pendingTasks: Promise<void>[] = [];
    let pollCount = 0;

    const fakeFetch: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);

      if (url.href === "https://bots.qq.com/app/getAppAccessToken") {
        const body = JSON.parse(await req.text()) as { appId: string };
        return Response.json({ access_token: `token-for-${body.appId}`, expires_in: 7200 });
      }

      if (url.hostname === "api.bot.qq.com") {
        const body = JSON.parse(await req.text()) as Record<string, unknown>;
        sentQqCalls.push({ path: url.pathname, body });
        if (url.pathname.endsWith("/files")) {
          return Response.json({ file_info: "file-info-xyz" });
        }
        return Response.json({ id: `qq-msg-${sentQqCalls.length}` });
      }

      bridgeCalls.push({ url: url.href, method: req.method });

      if (url.hostname === "alice.workers.dev") {
        expect(req.headers.get("authorization")).toBe("Bearer alice-secret");
        if (url.pathname === "/api/bot/bind/verify") {
          const body = JSON.parse(await req.text()) as { code: string };
          if (body.code !== "GOOD1234") {
            return Response.json({ error: "绑定码无效", code: "BOT_BIND_CODE_INVALID" }, { status: 400 });
          }
          return Response.json({ verified: true, user: { name: "Alice", userCode: "111", rating: 12.654 } });
        }
        if (url.pathname === "/api/bot/sync") {
          return Response.json({
            jobId: "job-1",
            status: "queued",
            job: { id: "job-1", kind: "sync", status: "queued", stage: "fetch" },
          }, { status: 202 });
        }
        if (url.pathname === "/api/bot/jobs/job-1") {
          pollCount++;
          if (opts.syncBehavior === "fail") {
            return Response.json({
              id: "job-1",
              kind: "sync",
              status: "failed",
              stage: "fetch",
              error: "Lowiro 维护中",
            });
          }
          if (pollCount === 1) {
            return Response.json({ id: "job-1", kind: "sync", status: "running", stage: "media" });
          }
          return Response.json({
            id: "job-1",
            kind: "sync",
            status: "succeeded",
            stage: "done",
            result: {
              recorded: opts.syncBehavior !== "unchanged",
              message: "ok",
            },
          });
        }
        if (url.pathname === "/api/bot/b50") {
          return Response.json(b50Fixture("snap-alice"));
        }
        if (url.pathname.startsWith("/api/bot/media/")) {
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
      }

      if (url.hostname === "bob.workers.dev") {
        expect(req.headers.get("authorization")).toBe("Bearer bob-secret");
        if (url.pathname === "/api/bot/bind/verify") {
          return Response.json({ verified: true, user: { name: "Bob", userCode: "222", rating: 11.8 } });
        }
      }

      return new Response("Not Found", { status: 404 });
    };

    const db = openDatabase(":memory:");
    const config = testConfig(opts.config);
    const { app, repo } = createGatewayApp({
      config,
      db,
      fetchImpl: fakeFetch,
      sleep: async () => {},
      scheduleBackground: (task) => {
        pendingTasks.push(task);
      },
    });
    cleanups.push(() => db.close());

    return {
      app,
      repo,
      sentQqCalls,
      bridgeCalls,
      flushBackground: async () => {
        await Promise.all(pendingTasks.splice(0));
      },
    };
  }

  it("handles OpCode 13 validation and rejects tampered webhooks", async () => {
    const { app, repo } = setupGateway();
    repo.upsertBot({ id: "bot-a", appId: "1001", clientSecret: "secret-a" });

    const validationRes = await app.request(new Request("http://localhost/qq/webhook/bot-a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: 13, d: { plain_token: "abc", event_ts: "170000" } }),
    }));
    expect(validationRes.status).toBe(200);
    const validationBody = await validationRes.json() as { plain_token: string; signature: string };
    expect(validationBody.plain_token).toBe("abc");
    expect(verifyWebhookSignature("secret-a", "170000", validationBody.signature, "abc")).toBe(true);

    const badSigRes = await app.request(new Request("http://localhost/qq/webhook/bot-a", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-timestamp": "170000",
        "x-signature-ed25519": "0".repeat(128),
      },
      body: JSON.stringify({ op: 0, id: "evt-1", t: "C2C_MESSAGE_CREATE", d: {} }),
    }));
    expect(badSigRes.status).toBe(401);
  });

  it("manages bots & instances via admin API and deduplicates webhook events", async () => {
    const { app, sentQqCalls, flushBackground } = setupGateway();

    const unauth = await app.request("/admin/bots");
    expect(unauth.status).toBe(401);

    const addBot = await app.request("/admin/bots", {
      method: "POST",
      headers: { authorization: "Bearer admin-secret-xyz", "content-type": "application/json" },
      body: JSON.stringify({ id: "bot-a", appId: "1001", clientSecret: "secret-a" }),
    });
    expect(addBot.status).toBe(201);

    const addInstA = await app.request("/admin/instances", {
      method: "POST",
      headers: { authorization: "Bearer admin-secret-xyz", "content-type": "application/json" },
      body: JSON.stringify({ id: "alice", baseUrl: "https://alice.workers.dev", bridgeSecret: "alice-secret" }),
    });
    expect(addInstA.status).toBe(201);

    const addInstB = await app.request("/admin/instances", {
      method: "POST",
      headers: { authorization: "Bearer admin-secret-xyz", "content-type": "application/json" },
      body: JSON.stringify({ id: "bob", baseUrl: "https://bob.workers.dev", bridgeSecret: "bob-secret" }),
    });
    expect(addInstB.status).toBe(201);

    const evtPayload = {
      op: 0,
      id: "evt-help-1",
      t: "C2C_MESSAGE_CREATE",
      d: { id: "msg-1", content: "/help", timestamp: "2026-11-27T01:00:00Z", author: { user_openid: "u1" } },
    };

    const res1 = await app.request(makeSignedWebhookRequest("bot-a", "secret-a", evtPayload));
    expect(res1.status).toBe(200);
    await flushBackground();
    expect(sentQqCalls).toHaveLength(1);

    // Duplicate event_id should be ignored
    const res2 = await app.request(makeSignedWebhookRequest("bot-a", "secret-a", evtPayload));
    expect(res2.status).toBe(200);
    await flushBackground();
    expect(sentQqCalls).toHaveLength(1);
  });

  it("binds users to separate instances on the same bot and serves /b50 via signed media proxy", async () => {
    const { app, repo, sentQqCalls, flushBackground } = setupGateway({ syncBehavior: "unchanged" });
    repo.upsertBot({ id: "shared-bot", appId: "2002", clientSecret: "shared-secret" });
    repo.upsertInstance({ id: "alice", baseUrl: "https://alice.workers.dev", bridgeSecret: "alice-secret" });
    repo.upsertInstance({ id: "bob", baseUrl: "https://bob.workers.dev", bridgeSecret: "bob-secret" });

    // User 1 binds to alice
    await app.request(makeSignedWebhookRequest("shared-bot", "shared-secret", {
      op: 0,
      id: "evt-bind-1",
      t: "C2C_MESSAGE_CREATE",
      d: { id: "msg-b1", content: "/bind alice:GOOD1234", timestamp: "2026-11-27T01:00:00Z", author: { user_openid: "user-1" } },
    }));
    // User 2 binds to bob
    await app.request(makeSignedWebhookRequest("shared-bot", "shared-secret", {
      op: 0,
      id: "evt-bind-2",
      t: "C2C_MESSAGE_CREATE",
      d: { id: "msg-b2", content: "/bind bob:ANYCODE", timestamp: "2026-11-27T01:00:00Z", author: { user_openid: "user-2" } },
    }));
    await flushBackground();

    expect(repo.getBinding("shared-bot", "c2c", "user-1")?.instanceId).toBe("alice");
    expect(repo.getBinding("shared-bot", "c2c", "user-2")?.instanceId).toBe("bob");
    expect(sentQqCalls[0].body.content).toContain("alice");
    expect(sentQqCalls[1].body.content).toContain("bob");

    sentQqCalls.length = 0;

    // User 1 requests /b50 -> triggers sync -> polls -> uploads image via /qq/media/:token -> sends msg_type 7
    await app.request(makeSignedWebhookRequest("shared-bot", "shared-secret", {
      op: 0,
      id: "evt-b50-1",
      t: "C2C_MESSAGE_CREATE",
      d: { id: "msg-b50", content: "/b50", timestamp: "2026-11-27T01:01:00Z", author: { user_openid: "user-1" } },
    }));
    await flushBackground();

    expect(sentQqCalls).toHaveLength(2);
    expect(sentQqCalls[0].path).toBe("/v2/users/user-1/files");
    const signedUrl = sentQqCalls[0].body.url as string;
    expect(signedUrl).toMatch(/^https:\/\/bot-gw\.example\/qq\/media\//);

    // Verify QQ server fetching the signed proxy URL works and rejects tampered tokens
    const proxyPath = new URL(signedUrl).pathname;
    const mediaRes = await app.request(proxyPath);
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await mediaRes.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    const badProxyRes = await app.request(`${proxyPath}tampered`);
    expect(badProxyRes.status).toBe(401);

    expect(sentQqCalls[1].path).toBe("/v2/users/user-1/messages");
    expect(sentQqCalls[1].body.msg_type).toBe(7);
    expect(sentQqCalls[1].body.msg_id).toBe("msg-b50");
    expect(sentQqCalls[1].body.content).toContain("B50 无变化");
  });

  it("falls back to cached B50 with notice when sync fails", async () => {
    const { app, repo, sentQqCalls, flushBackground } = setupGateway({
      syncBehavior: "fail",
      config: { publicBaseUrl: null },
    });
    repo.upsertBot({ id: "bot-a", appId: "1001", clientSecret: "secret-a" });
    repo.upsertInstance({ id: "alice", baseUrl: "https://alice.workers.dev", bridgeSecret: "alice-secret" });
    repo.setBinding("bot-a", "c2c", "user-1", "alice");

    await app.request(makeSignedWebhookRequest("bot-a", "secret-a", {
      op: 0,
      id: "evt-b50-fail",
      t: "C2C_MESSAGE_CREATE",
      d: { id: "msg-fail", content: "/b50", timestamp: "2026-11-27T01:02:00Z", author: { user_openid: "user-1" } },
    }));
    await flushBackground();

    expect(sentQqCalls).toHaveLength(2);
    expect(sentQqCalls[0].path).toBe("/v2/users/user-1/files");
    expect(typeof sentQqCalls[0].body.file_data).toBe("string");
    expect(sentQqCalls[1].body.msg_type).toBe(7);
    expect(sentQqCalls[1].body.content).toContain("Lowiro 维护中");
    expect(sentQqCalls[1].body.content).toContain("已回退发送最近一次缓存 B50");
  });

  it("serves /admin UI, supports cookie login/logout, patch, and instance connectivity check", async () => {
    const { app } = setupGateway();

    const uiRes = await app.request("/admin");
    expect(uiRes.status).toBe(200);
    expect(uiRes.headers.get("content-type")).toContain("text/html");
    expect(uiRes.headers.get("x-frame-options")).toBe("DENY");
    expect(await uiRes.text()).toContain("ArcOnline QQ Bot Gateway");

    const badLogin = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "wrong-secret" }),
    });
    expect(badLogin.status).toBe(401);

    const okLogin = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "admin-secret-xyz" }),
    });
    expect(okLogin.status).toBe(200);
    const cookie = okLogin.headers.get("set-cookie")!.split(";")[0];

    const sessionRes = await app.request("/admin/session", { headers: { cookie } });
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toEqual({ authenticated: true, publicBaseUrl: "https://bot-gw.example" });

    const createBot = await app.request("/admin/bots", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: "main", appId: "3003", clientSecret: "sec-3" }),
    });
    expect(createBot.status).toBe(201);

    const toggleBot = await app.request("/admin/bots/main", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggleBot.status).toBe(200);
    expect((await toggleBot.json() as { bot: { enabled: boolean } }).bot.enabled).toBe(false);

    const createInst = await app.request("/admin/instances", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: "alice", baseUrl: "https://alice.workers.dev", bridgeSecret: "alice-secret" }),
    });
    expect(createInst.status).toBe(201);

    const testConn = await app.request("/admin/instances/alice/test", {
      method: "POST",
      headers: { cookie },
    });
    expect(testConn.status).toBe(200);
    const connBody = await testConn.json() as { ok: boolean; message: string };
    expect(connBody.ok).toBe(true);
    expect(connBody.message).toContain("Hikari");

    const badOriginPatch = await app.request("/admin/bots/main", {
      method: "PATCH",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(badOriginPatch.status).toBe(403);

    const logoutRes = await app.request("/admin/logout", { method: "POST", headers: { cookie } });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
