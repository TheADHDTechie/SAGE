import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../src/infrastructure/database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("ConversationStore migrations", () => {
  it("backfills conversations for legacy WhatsApp handoff deliveries", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "sal-migration-test-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "app.db");
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        external_message_id TEXT UNIQUE,
        direction TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        input_type TEXT NOT NULL,
        language TEXT,
        content TEXT NOT NULL,
        citations_json TEXT,
        model_deployment TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE whatsapp_deliveries (
        inbound_message_id TEXT PRIMARY KEY,
        response_text TEXT,
        delivery_plan_json TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        allow_during_handoff INTEGER NOT NULL DEFAULT 0,
        outbound_message_ids_json TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO contacts VALUES ('contact-1', 'now', 'now');
      INSERT INTO conversations
        (id, contact_id, status, created_at, updated_at)
      VALUES ('conversation-1', 'contact-1', 'waiting_for_human', 'now', 'now');
      INSERT INTO messages
        (id, conversation_id, external_message_id, direction, sender_type,
         input_type, language, content, created_at)
      VALUES
        ('message-1', 'conversation-1', 'inbound-1', 'inbound', 'user',
         'text', 'en', 'STAFF', 'now');
      INSERT INTO whatsapp_deliveries
        (inbound_message_id, response_text, delivery_plan_json, status,
         attempts, allow_during_handoff, created_at, updated_at)
      VALUES
        ('inbound-1', 'Transferring to staff', NULL, 'failed',
         1, 1, 'now', 'now');
    `);
    database.close();

    const store = new ConversationStore(databasePath, "test-hash-key");
    const delivery = store.whatsAppDelivery("inbound-1");
    store.close();

    expect(delivery?.conversationId).toBe("conversation-1");
    expect(delivery?.allowDuringHandoff).toBe(true);
  });
});
