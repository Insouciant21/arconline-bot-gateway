const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const REFRESH_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class QqTokenManager {
  private readonly cache = new Map<string, CachedToken>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getAccessToken(appId: string, clientSecret: string): Promise<string> {
    const cached = this.cache.get(appId);
    if (cached && cached.expiresAtMs - REFRESH_BUFFER_MS > Date.now()) {
      return cached.accessToken;
    }

    const pending = this.inFlight.get(appId);
    if (pending) return pending;

    const refresh = this.requestToken(appId, clientSecret).finally(() => {
      this.inFlight.delete(appId);
    });
    this.inFlight.set(appId, refresh);
    return refresh;
  }

  invalidate(appId: string) {
    this.cache.delete(appId);
  }

  private async requestToken(appId: string, clientSecret: string): Promise<string> {
    const response = await this.fetchImpl(QQ_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId, clientSecret }),
    });
    if (!response.ok) {
      throw new Error(`QQ getAppAccessToken failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as { access_token?: string; expires_in?: number | string };
    const expiresInSec = Number(payload.expires_in ?? 7200);
    if (!payload.access_token || !Number.isFinite(expiresInSec)) {
      throw new Error("QQ getAppAccessToken returned invalid payload");
    }
    this.cache.set(appId, {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + expiresInSec * 1000,
    });
    return payload.access_token;
  }
}
