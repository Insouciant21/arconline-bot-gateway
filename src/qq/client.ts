import type { BotRecord } from "../db/repositories.js";
import type { QqTokenManager } from "./token.js";

const QQ_API_BASE = "https://api.bot.qq.com";
const QQ_REQUEST_TIMEOUT_MS = 30_000;

export interface UploadC2CFileOptions {
  fileType: 1;
  url?: string;
  fileData?: string;
  fileName?: string;
}

export interface SendC2CMessageOptions {
  msgType: 0 | 7;
  content?: string;
  media?: { file_info: string };
  msgId?: string;
  msgSeq?: number;
}

export class QqApiClient {
  constructor(
    private readonly tokenManager: QqTokenManager,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async uploadC2CFile(bot: BotRecord, openid: string, options: UploadC2CFileOptions): Promise<string> {
    const payload = await this.request<{ file_info?: string }>(
      bot,
      `/v2/users/${encodeURIComponent(openid)}/files`,
      {
        file_type: options.fileType,
        srv_send_msg: false,
        ...(options.url ? { url: options.url } : {}),
        ...(options.fileData ? { file_data: options.fileData } : {}),
        ...(options.fileName ? { file_name: options.fileName } : {}),
      },
    );
    if (!payload.file_info) {
      throw new Error("QQ file upload response missing file_info");
    }
    return payload.file_info;
  }

  async sendC2CMessage(bot: BotRecord, openid: string, options: SendC2CMessageOptions): Promise<{ id?: string }> {
    return this.request<{ id?: string }>(
      bot,
      `/v2/users/${encodeURIComponent(openid)}/messages`,
      {
        msg_type: options.msgType,
        ...(options.content !== undefined ? { content: options.content } : {}),
        ...(options.media ? { media: options.media } : {}),
        ...(options.msgId ? { msg_id: options.msgId } : {}),
        ...(options.msgSeq !== undefined ? { msg_seq: options.msgSeq } : {}),
      },
    );
  }

  private async request<T>(bot: BotRecord, path: string, body: unknown, retryAuth = true): Promise<T> {
    const token = await this.tokenManager.getAccessToken(bot.appId, bot.clientSecret);
    const response = await this.fetchImpl(`${QQ_API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `QQBot ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QQ_REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401 && retryAuth) {
      this.tokenManager.invalidate(bot.appId);
      return this.request<T>(bot, path, body, false);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`QQ OpenAPI ${path} failed (${response.status}): ${text}`);
    }
    return await response.json() as T;
  }
}
