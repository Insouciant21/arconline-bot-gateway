import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL UNIQUE,
      client_secret_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      bridge_secret_enc TEXT NOT NULL,
      image_mode TEXT NOT NULL DEFAULT 'official',
      label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bindings (
      bot_id TEXT NOT NULL,
      scene TEXT NOT NULL,
      openid TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (bot_id, scene, openid),
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS bindings_instance_idx ON bindings(instance_id);

    CREATE TABLE IF NOT EXISTS webhook_events (
      bot_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (bot_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS webhook_events_time_idx ON webhook_events(received_at);
  `);
  return db;
}
