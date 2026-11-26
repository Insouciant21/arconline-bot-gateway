export interface GatewayConfig {
  port: number;
  host: string;
  publicBaseUrl: string | null;
  adminSecret: string;
  masterKey: string;
  mediaSigningKey: string;
  dbPath: string;
  syncPollIntervalMs: number;
  syncPollTimeoutMs: number;
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const masterKey = requiredEnv(env, "MASTER_KEY");
  const publicBaseUrlRaw = env.PUBLIC_BASE_URL?.trim();
  return {
    port: positiveInt(env.PORT, 8787),
    host: env.HOST?.trim() || "0.0.0.0",
    publicBaseUrl: publicBaseUrlRaw ? publicBaseUrlRaw.replace(/\/+$/, "") : null,
    adminSecret: requiredEnv(env, "ADMIN_SECRET"),
    masterKey,
    mediaSigningKey: env.MEDIA_SIGNING_KEY?.trim() || masterKey,
    dbPath: env.DB_PATH?.trim() || "./data/gateway.db",
    syncPollIntervalMs: positiveInt(env.SYNC_POLL_INTERVAL_MS, 1500),
    syncPollTimeoutMs: positiveInt(env.SYNC_POLL_TIMEOUT_MS, 45_000),
  };
}
