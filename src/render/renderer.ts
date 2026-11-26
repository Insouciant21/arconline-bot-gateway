import type { GatewayConfig } from "../config.js";
import type { BotB50Payload, WorkersBridgeClient } from "../bridge/workers-client.js";
import type { BotRecord, ImageMode, InstanceRecord } from "../db/repositories.js";
import type { QqApiClient } from "../qq/client.js";
import { formatB50Summary, formatB50TextList } from "./b50-text.js";
import type { MediaProxySigner } from "./media-proxy.js";

const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface CustomB50Renderer {
  render(b50: BotB50Payload, instance: InstanceRecord): Promise<{ body: ArrayBuffer; contentType: string }>;
}

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
  customRenderer?: CustomB50Renderer;
}

export async function deliverB50Reply(options: DeliverB50Options): Promise<void> {
  const mode: ImageMode = options.forceText ? "text" : options.instance.imageMode;
  const summary = formatB50Summary(options.b50, options.syncNote);

  if (mode === "custom" && options.customRenderer) {
    try {
      const rendered = await options.customRenderer.render(options.b50, options.instance);
      if (rendered.body.byteLength <= MAX_DIRECT_UPLOAD_BYTES) {
        const fileInfo = await options.qq.uploadC2CFile(options.bot, options.openid, {
          fileType: 1,
          fileData: Buffer.from(rendered.body).toString("base64"),
        });
        await options.qq.sendC2CMessage(options.bot, options.openid, {
          msgType: 7,
          media: { file_info: fileInfo },
          content: summary,
          msgId: options.msgId,
          msgSeq: options.nextSeq(),
        });
        return;
      }
    } catch (error) {
      console.warn("[gateway] custom B50 render/upload failed, falling back:", error);
    }
  }

  if (mode !== "text" && options.b50.potentialImageKey) {
    try {
      const fileInfo = await uploadOfficialB50Image(options, options.b50.potentialImageKey);
      if (fileInfo) {
        await options.qq.sendC2CMessage(options.bot, options.openid, {
          msgType: 7,
          media: { file_info: fileInfo },
          content: summary,
          msgId: options.msgId,
          msgSeq: options.nextSeq(),
        });
        return;
      }
    } catch (error) {
      console.warn("[gateway] official B50 image upload failed, falling back to text:", error);
    }
  }

  await options.qq.sendC2CMessage(options.bot, options.openid, {
    msgType: 0,
    content: formatB50TextList(options.b50, options.syncNote),
    msgId: options.msgId,
    msgSeq: options.nextSeq(),
  });
}

async function uploadOfficialB50Image(options: DeliverB50Options, key: string): Promise<string | null> {
  if (options.config.publicBaseUrl) {
    const token = options.mediaSigner.sign(options.instance.id, key);
    const url = `${options.config.publicBaseUrl}/qq/media/${token}`;
    return options.qq.uploadC2CFile(options.bot, options.openid, {
      fileType: 1,
      url,
    });
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
