import { Hono } from "hono";
import { signValidationChallenge, verifyWebhookSignature } from "../crypto/qq-ed25519.js";
import type { GatewayRepository } from "../db/repositories.js";
import type { QqC2CMessageData, QqWebhookPayload } from "../qq/types.js";
import type { CommandDispatcher } from "../commands/dispatcher.js";

const MAX_WEBHOOK_SKEW_SECONDS = 5 * 60;
const VALID_PLAIN_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const VALID_UNIX_TS = /^\d{1,20}$/;

export interface WebhookRouterDeps {
  repo: GatewayRepository;
  dispatcher: CommandDispatcher;
  scheduleBackground?: (task: Promise<void>) => void;
  nowSeconds?: () => number;
}

export function createWebhookRoutes(deps: WebhookRouterDeps) {
  const router = new Hono();
  const schedule = deps.scheduleBackground ?? ((task) => {
    queueMicrotask(() => {
      void task.catch((err) => console.error("[gateway] background command failed:", err));
    });
  });
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  router.post("/qq/webhook/:botId", async (c) => {
    const botId = c.req.param("botId");
    const bot = deps.repo.getBot(botId);
    if (!bot || !bot.enabled) {
      return c.json({ error: "Bot not found" }, 404);
    }

    const rawBody = await c.req.text();
    const signature = c.req.header("x-signature-ed25519");
    const timestamp = c.req.header("x-signature-timestamp");

    if (signature && !verifyWebhookSignature(bot.clientSecret, timestamp, signature, rawBody)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let payload: QqWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as QqWebhookPayload;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (payload.op === 13) {
      const plainToken = payload.d?.plain_token;
      const eventTs = payload.d?.event_ts;
      // Strictly reject non-token characters so op=13 cannot act as a signing oracle for JSON payloads.
      if (
        typeof plainToken !== "string" ||
        typeof eventTs !== "string" ||
        !VALID_PLAIN_TOKEN.test(plainToken) ||
        !VALID_UNIX_TS.test(eventTs)
      ) {
        return c.json({ error: "Invalid validation payload" }, 400);
      }
      return c.json({
        plain_token: plainToken,
        signature: signValidationChallenge(bot.clientSecret, eventTs, plainToken),
      });
    }

    if (
      !signature ||
      !timestamp ||
      !VALID_UNIX_TS.test(timestamp) ||
      Math.abs(nowSeconds() - Number(timestamp)) > MAX_WEBHOOK_SKEW_SECONDS ||
      !verifyWebhookSignature(bot.clientSecret, timestamp, signature, rawBody)
    ) {
      return c.json({ error: "Missing, expired or invalid signature" }, 401);
    }

    if (payload.op === 0) {
      const eventData = payload.d as unknown as Partial<QqC2CMessageData>;
      const eventId = payload.id || eventData.id;
      if (eventId && !deps.repo.recordWebhookEvent(bot.id, eventId)) {
        return c.json({ op: 12 });
      }

      if (payload.t === "C2C_MESSAGE_CREATE" && eventData.id && eventData.author?.user_openid) {
        schedule(deps.dispatcher.handleC2CMessage(bot, eventData as QqC2CMessageData));
      }
      return c.json({ op: 12 });
    }

    return c.json({ op: 12 });
  });

  return router;
}
