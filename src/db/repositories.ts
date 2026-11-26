import type { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret } from "../crypto/aes.js";

export type ImageMode = "official" | "custom" | "text";

export interface BotRecord {
  id: string;
  appId: string;
  clientSecret: string;
  enabled: boolean;
  createdAt: string;
}

export interface InstanceRecord {
  id: string;
  baseUrl: string;
  bridgeSecret: string;
  imageMode: ImageMode;
  label: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface BindingRecord {
  botId: string;
  scene: "c2c" | "group";
  openid: string;
  instanceId: string;
  createdAt: string;
  updatedAt: string;
}

export class GatewayRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly masterKey: string,
  ) {}

  upsertBot(input: { id: string; appId: string; clientSecret: string; enabled?: boolean }): BotRecord {
    const now = new Date().toISOString();
    const enabled = input.enabled ?? true;
    const encrypted = encryptSecret(input.clientSecret, this.masterKey);
    this.db.prepare(`
      INSERT INTO bots(id, app_id, client_secret_enc, enabled, created_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        app_id = excluded.app_id,
        client_secret_enc = excluded.client_secret_enc,
        enabled = excluded.enabled
    `).run(input.id, input.appId, encrypted, enabled ? 1 : 0, now);
    return this.getBot(input.id)!;
  }

  getBot(id: string): BotRecord | null {
    const row = this.db.prepare(
      "SELECT id, app_id, client_secret_enc, enabled, created_at FROM bots WHERE id = ?",
    ).get(id) as { id: string; app_id: string; client_secret_enc: string; enabled: number; created_at: string } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      appId: row.app_id,
      clientSecret: decryptSecret(row.client_secret_enc, this.masterKey),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    };
  }

  listBots(): Array<Omit<BotRecord, "clientSecret">> {
    const rows = this.db.prepare(
      "SELECT id, app_id, enabled, created_at FROM bots ORDER BY created_at ASC",
    ).all() as Array<{ id: string; app_id: string; enabled: number; created_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      appId: row.app_id,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    }));
  }

  deleteBot(id: string): boolean {
    const result = this.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  updateBot(id: string, patch: { appId?: string; clientSecret?: string; enabled?: boolean }): BotRecord | null {
    const existing = this.getBot(id);
    if (!existing) return null;
    return this.upsertBot({
      id,
      appId: patch.appId ?? existing.appId,
      clientSecret: patch.clientSecret ?? existing.clientSecret,
      enabled: patch.enabled ?? existing.enabled,
    });
  }

  upsertInstance(input: {
    id: string;
    baseUrl: string;
    bridgeSecret: string;
    imageMode?: ImageMode;
    label?: string | null;
    enabled?: boolean;
  }): InstanceRecord {
    const now = new Date().toISOString();
    const normalizedUrl = input.baseUrl.replace(/\/+$/, "");
    const encrypted = encryptSecret(input.bridgeSecret, this.masterKey);
    this.db.prepare(`
      INSERT INTO instances(id, base_url, bridge_secret_enc, image_mode, label, enabled, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        base_url = excluded.base_url,
        bridge_secret_enc = excluded.bridge_secret_enc,
        image_mode = excluded.image_mode,
        label = excluded.label,
        enabled = excluded.enabled
    `).run(
      input.id,
      normalizedUrl,
      encrypted,
      input.imageMode ?? "official",
      input.label ?? null,
      (input.enabled ?? true) ? 1 : 0,
      now,
    );
    return this.getInstance(input.id)!;
  }

  getInstance(id: string): InstanceRecord | null {
    const row = this.db.prepare(
      "SELECT id, base_url, bridge_secret_enc, image_mode, label, enabled, created_at FROM instances WHERE id = ?",
    ).get(id) as {
      id: string;
      base_url: string;
      bridge_secret_enc: string;
      image_mode: ImageMode;
      label: string | null;
      enabled: number;
      created_at: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      baseUrl: row.base_url,
      bridgeSecret: decryptSecret(row.bridge_secret_enc, this.masterKey),
      imageMode: row.image_mode,
      label: row.label,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    };
  }

  listInstances(): Array<Omit<InstanceRecord, "bridgeSecret">> {
    const rows = this.db.prepare(
      "SELECT id, base_url, image_mode, label, enabled, created_at FROM instances ORDER BY created_at ASC",
    ).all() as Array<{
      id: string;
      base_url: string;
      image_mode: ImageMode;
      label: string | null;
      enabled: number;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      baseUrl: row.base_url,
      imageMode: row.image_mode,
      label: row.label,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    }));
  }

  deleteInstance(id: string): boolean {
    const result = this.db.prepare("DELETE FROM instances WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  updateInstance(
    id: string,
    patch: { baseUrl?: string; bridgeSecret?: string; imageMode?: ImageMode; label?: string | null; enabled?: boolean },
  ): InstanceRecord | null {
    const existing = this.getInstance(id);
    if (!existing) return null;
    return this.upsertInstance({
      id,
      baseUrl: patch.baseUrl ?? existing.baseUrl,
      bridgeSecret: patch.bridgeSecret ?? existing.bridgeSecret,
      imageMode: patch.imageMode ?? existing.imageMode,
      label: patch.label !== undefined ? patch.label : existing.label,
      enabled: patch.enabled ?? existing.enabled,
    });
  }

  setBinding(botId: string, scene: "c2c" | "group", openid: string, instanceId: string): BindingRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO bindings(bot_id, scene, openid, instance_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_id, scene, openid) DO UPDATE SET
        instance_id = excluded.instance_id,
        updated_at = excluded.updated_at
    `).run(botId, scene, openid, instanceId, now, now);
    return this.getBinding(botId, scene, openid)!;
  }

  getBinding(botId: string, scene: "c2c" | "group", openid: string): BindingRecord | null {
    const row = this.db.prepare(
      "SELECT bot_id, scene, openid, instance_id, created_at, updated_at FROM bindings WHERE bot_id = ? AND scene = ? AND openid = ?",
    ).get(botId, scene, openid) as {
      bot_id: string;
      scene: "c2c" | "group";
      openid: string;
      instance_id: string;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!row) return null;
    return {
      botId: row.bot_id,
      scene: row.scene,
      openid: row.openid,
      instanceId: row.instance_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteBinding(botId: string, scene: "c2c" | "group", openid: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM bindings WHERE bot_id = ? AND scene = ? AND openid = ?",
    ).run(botId, scene, openid);
    return Number(result.changes) > 0;
  }

  listBindings(): BindingRecord[] {
    const rows = this.db.prepare(
      "SELECT bot_id, scene, openid, instance_id, created_at, updated_at FROM bindings ORDER BY updated_at DESC",
    ).all() as Array<{
      bot_id: string;
      scene: "c2c" | "group";
      openid: string;
      instance_id: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      botId: row.bot_id,
      scene: row.scene,
      openid: row.openid,
      instanceId: row.instance_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Record a QQ webhook event ID for idempotency; returns false if already processed.
   */
  recordWebhookEvent(botId: string, eventId: string, now = Date.now()): boolean {
    const cutoff = now - 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM webhook_events WHERE received_at < ?").run(cutoff);
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO webhook_events(bot_id, event_id, received_at) VALUES(?, ?, ?)",
    ).run(botId, eventId, now);
    return Number(result.changes) > 0;
  }

  createAdminSession(tokenHash: string, expiresAt: number, now = Date.now()): void {
    this.db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
    this.db.prepare(
      "INSERT INTO admin_sessions(token_hash, created_at, expires_at) VALUES(?, ?, ?)",
    ).run(tokenHash, now, expiresAt);
  }

  hasValidAdminSession(tokenHash: string, now = Date.now()): boolean {
    const row = this.db.prepare(
      "SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
    ).get(tokenHash, now) as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  deleteAdminSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
  }
}
