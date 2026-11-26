import { createHmac } from "node:crypto";
import { constantTimeEqual } from "../crypto/aes.js";

const MEDIA_TOKEN_TTL_MS = 5 * 60 * 1000;
const ALLOWED_KEY_PREFIX = /^(charts|characters|potential|banners|custom)\//;

export interface MediaTokenPayload {
  instanceId: string;
  key: string;
  exp: number;
}

export class MediaProxySigner {
  constructor(private readonly signingKey: string) {}

  sign(instanceId: string, key: string, ttlMs = MEDIA_TOKEN_TTL_MS): string {
    if (!isValidMediaKey(key)) {
      throw new Error(`Invalid media key: ${key}`);
    }
    const payload: MediaTokenPayload = {
      instanceId,
      key,
      exp: Date.now() + ttlMs,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = this.hmac(encoded);
    return `${encoded}.${sig}`;
  }

  verify(token: string, now = Date.now()): MediaTokenPayload | null {
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return null;
    const expectedSig = this.hmac(encoded);
    if (!constantTimeEqual(sig, expectedSig)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<MediaTokenPayload>;
      if (
        typeof payload.instanceId !== "string" ||
        typeof payload.key !== "string" ||
        typeof payload.exp !== "number" ||
        !isValidMediaKey(payload.key) ||
        payload.exp <= now
      ) {
        return null;
      }
      return {
        instanceId: payload.instanceId,
        key: payload.key,
        exp: payload.exp,
      };
    } catch {
      return null;
    }
  }

  private hmac(encoded: string): string {
    return createHmac("sha256", this.signingKey).update(encoded, "utf8").digest("base64url");
  }
}

export function isValidMediaKey(key: string): boolean {
  return Boolean(
    key &&
    !key.includes("..") &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    ALLOWED_KEY_PREFIX.test(key),
  );
}
