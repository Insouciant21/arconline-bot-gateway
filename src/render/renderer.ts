import type { GatewayConfig } from "../config.js";
import type { BotB50Payload, WorkersBridgeClient } from "../bridge/workers-client.js";
import type { BotRecord, ImageMode, InstanceRecord } from "../db/repositories.js";
import type { QqApiClient } from "../qq/client.js";
import { formatB50Summary, formatB50TextList } from "./b50-text.js";
import type { MediaProxySigner } from "./media-proxy.js";

const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface DeliverB50Options {
  bot: BotRecord;
  openid: string;
  msgId: string;
  nextSeq: () => number;
  instance: InstanceRecord;
  b50: BotB50Payload;
  syncNote?: string;
  forceText?: boolean;
  config: GatewayConfig;
  bridge: WorkersBridgeClient;
  qq: QqApiClient;
  mediaSigner: MediaProxySigner;
}

export async function deliverB50Reply(options: DeliverB50Options): Promise<void> {
  const mode: ImageMode = options.forceText ? "text" : options.instance.imageMode;
  const summary = formatB50Summary(options.b50, options.syncNote);

  if (mode === "custom" && options.b50.customImageKey) {
    if (await trySendStoredImage(options, options.b50.customImageKey, summary, "custom")) {
      return;
    }
  }

  if (mode !== "text" && options.b50.potentialImageKey) {
    if (await trySendStoredImage(options, options.b50.potentialImageKey, summary, "official")) {
      return;
    }
  }

  await options.qq.sendC2CMessage(options.bot, options.openid, {
    msgType: 0,
    content: formatB50TextList(options.b50, options.syncNote),
    msgId: options.msgId,
    msgSeq: options.nextSeq(),
  });
}

async function trySendStoredImage(
  options: DeliverB50Options,
  key: string,
  summary: string,
  kind: "custom" | "official",
): Promise<boolean> {
  try {
    const fileInfo = await uploadB50Image(options, key);
    if (!fileInfo) return false;
    await options.qq.sendC2CMessage(options.bot, options.openid, {
      msgType: 7,
      media: { file_info: fileInfo },
      content: summary,
      msgId: options.msgId,
      msgSeq: options.nextSeq(),
    });
    return true;
  } catch (error) {
    console.warn(`[gateway] ${kind} B50 image upload failed, falling back:`, error);
    return false;
  }
}

async function uploadB50Image(options: DeliverB50Options, key: string): Promise<string | null> {
  if (options.config.publicBaseUrl) {
    const token = options.mediaSigner.sign(options.instance.id, key);
    const url = `${options.config.publicBaseUrl}/qq/media/${token}`;
    try {
      return await options.qq.uploadC2CFile(options.bot, options.openid, {
        fileType: 1,
        url,
      });
    } catch (error) {
      console.warn(`[gateway] URL media upload failed for ${key}, retrying via direct file_data:`, error);
    }
  }

  const media = await options.bridge.fetchMedia(options.instance, key);
  if (media.body.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
    return null;
  }
  return options.qq.uploadC2CFile(options.bot, options.openid, {
    fileType: 1,
    fileData: Buffer.from(media.body).toString("base64"),
  });
}
