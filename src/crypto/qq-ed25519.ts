import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

// RFC 8410 PKCS#8 DER prefix for a 32-byte Ed25519 private seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function deriveEd25519Keys(botSecret: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const secretBytes = Buffer.from(botSecret, "utf8");
  if (secretBytes.length === 0) {
    throw new Error("Bot clientSecret must not be empty");
  }
  const seed = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = secretBytes[i % secretBytes.length];
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Sign QQ Webhook URL validation challenge (OpCode 13): event_ts + plain_token.
 */
export function signValidationChallenge(botSecret: string, eventTs: string, plainToken: string): string {
  const { privateKey } = deriveEd25519Keys(botSecret);
  const message = Buffer.from(`${eventTs}${plainToken}`, "utf8");
  return sign(null, message, privateKey).toString("hex");
}

/**
 * Verify X-Signature-Ed25519 over X-Signature-Timestamp + rawBody.
 */
export function verifyWebhookSignature(
  botSecret: string,
  timestamp: string | undefined,
  signatureHex: string | undefined,
  rawBody: string,
): boolean {
  if (!timestamp || !signatureHex || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    return false;
  }
  try {
    const { publicKey } = deriveEd25519Keys(botSecret);
    const message = Buffer.from(`${timestamp}${rawBody}`, "utf8");
    const signature = Buffer.from(signatureHex, "hex");
    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}
