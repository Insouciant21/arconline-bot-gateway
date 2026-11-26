import type { InstanceRecord } from "../db/repositories.js";

export interface BotB50Score {
  songId: string;
  difficulty: number;
  score: number;
  rating: number;
  clearType: number;
  title: { en?: string; ja?: string; zh?: string; [key: string]: string | undefined };
}

export interface BotB50Payload {
  snapshotId: string;
  fetchedAt: string;
  potential: number;
  weightedPotential: number;
  mediaStatus: "processing" | "complete" | "failed";
  potentialImageKey: string | null;
  user: {
    name: string | null;
    userCode: string | null;
    rating: number;
  };
  stats: {
    top10Sum: number;
    rest40Sum: number;
    weightedExact: number;
    top10Avg: number;
    top10Floor: number;
    b50Avg: number;
    b50Floor: number;
  };
  best50: BotB50Score[];
}

export interface BotJobPayload {
  id: string;
  kind: "sync" | "import" | "retry";
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  result?: {
    recorded?: boolean;
    duplicateOf?: string;
    message: string;
  };
  error?: string;
}

export class WorkersBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class WorkersBridgeClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async verifyBindCode(instance: InstanceRecord, code: string) {
    return this.requestJson<{
      verified: boolean;
      user: { name: string | null; userCode: string | null; rating: number } | null;
    }>(instance, "/api/bot/bind/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  async triggerSync(instance: InstanceRecord) {
    return this.requestJson<{ jobId: string; status: string; job: BotJobPayload }>(
      instance,
      "/api/bot/sync",
      { method: "POST" },
    );
  }

  async getJob(instance: InstanceRecord, jobId: string) {
    return this.requestJson<BotJobPayload>(instance, `/api/bot/jobs/${encodeURIComponent(jobId)}`);
  }

  async getB50(instance: InstanceRecord) {
    return this.requestJson<BotB50Payload>(instance, "/api/bot/b50");
  }

  async fetchMedia(instance: InstanceRecord, key: string): Promise<{ body: ArrayBuffer; contentType: string }> {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const response = await this.fetchImpl(`${instance.baseUrl}/api/bot/media/${encoded}`, {
      headers: {
        authorization: `Bearer ${instance.bridgeSecret}`,
      },
    });
    if (!response.ok) {
      throw new WorkersBridgeError(`拉取媒体失败（HTTP ${response.status}）`, response.status);
    }
    return {
      body: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") || "application/octet-stream",
    };
  }

  private async requestJson<T>(instance: InstanceRecord, path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${instance.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${instance.bridgeSecret}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let payload: (T & { error?: string; code?: string }) | undefined;
    try {
      payload = text ? JSON.parse(text) as T & { error?: string; code?: string } : undefined;
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      throw new WorkersBridgeError(
        payload?.error || `实例请求失败（HTTP ${response.status}）`,
        response.status,
        payload?.code,
      );
    }
    return payload as T;
  }
}
