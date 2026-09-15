import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  ChatMessage,
  ConversationStatus,
  SupportMessage,
  SupportedLanguage,
} from "../domain/types.js";

interface ConversationRow {
  id: string;
  status: ConversationStatus;
}

export class ConversationStore {
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly contactHashKey: string,
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  close() {
    this.database.close();
  }

  ready() {
    return this.database.prepare("SELECT 1 AS ok").get() !== undefined;
  }

  beginInbound(message: SupportMessage): {
    duplicate: boolean;
    conversationId: string;
    status: ConversationStatus;
  } {
    return this.database.transaction(() => {
      const contactId = this.hashContact(message.externalUserId);
      const now = new Date().toISOString();

      this.database
        .prepare(
          `INSERT INTO contacts (id, created_at, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        .run(contactId, now, now);

      let conversation = this.database
        .prepare(
          `SELECT id, status
           FROM conversations
           WHERE contact_id = ? AND status != 'closed'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(contactId) as ConversationRow | undefined;

      if (!conversation) {
        conversation = { id: randomUUID(), status: "bot" };
        this.database
          .prepare(
            `INSERT INTO conversations (id, contact_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(conversation.id, contactId, conversation.status, now, now);
      }

      const result = this.database
        .prepare(
          `INSERT OR IGNORE INTO messages (
             id, conversation_id, external_message_id, direction, sender_type,
             input_type, language, content, created_at
           ) VALUES (?, ?, ?, 'inbound', 'user', ?, 'unknown', ?, ?)`,
        )
        .run(
          randomUUID(),
          conversation.id,
          message.externalMessageId,
          message.type,
          message.text,
          message.receivedAt,
        );

      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(now, conversation.id);

      return {
        duplicate: result.changes === 0,
        conversationId: conversation.id,
        status: conversation.status,
      };
    })();
  }

  recentMessages(conversationId: string, limit = 8): ChatMessage[] {
    const rows = this.database
      .prepare(
        `SELECT sender_type AS senderType, content, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(conversationId, limit) as ChatMessage[];
    return rows.reverse();
  }

  recordAssistantMessage(input: {
    conversationId: string;
    content: string;
    language: SupportedLanguage;
    citations?: readonly string[];
    modelDeployment?: string;
  }) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, direction, sender_type, input_type, language,
           content, citations_json, model_deployment, created_at
         ) VALUES (?, ?, 'outbound', 'assistant', 'text', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.conversationId,
        input.language,
        input.content,
        input.citations ? JSON.stringify(input.citations) : null,
        input.modelDeployment ?? null,
        now,
      );
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, input.conversationId);
  }

  recordAuditEvent(input: {
    conversationId?: string;
    eventType: string;
    details?: Record<string, unknown>;
  }) {
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, conversation_id, event_type, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.conversationId ?? null,
        input.eventType,
        input.details ? JSON.stringify(input.details) : null,
        new Date().toISOString(),
      );
  }

  createHandoff(conversationId: string, reason: string) {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE conversations
           SET status = 'waiting_for_human', updated_at = ?
           WHERE id = ?`,
        )
        .run(now, conversationId);
      this.database
        .prepare(
          `INSERT INTO handoffs (id, conversation_id, reason, status, created_at)
           VALUES (?, ?, ?, 'waiting', ?)`,
        )
        .run(randomUUID(), conversationId, reason, now);
    })();
  }

  closeConversation(conversationId: string) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE conversations
         SET status = 'closed', updated_at = ?, closed_at = ?
         WHERE id = ?`,
      )
      .run(now, now, conversationId);
  }

  resetConversationForUser(externalUserId: string) {
    const contactId = this.hashContact(externalUserId);
    const now = new Date().toISOString();

    return this.database.transaction(() => {
      const conversations = this.database
        .prepare(
          `SELECT id
           FROM conversations
           WHERE contact_id = ? AND status != 'closed'`,
        )
        .all(contactId) as Array<{ id: string }>;

      for (const conversation of conversations) {
        this.database
          .prepare(
            `UPDATE conversations
             SET status = 'closed', updated_at = ?, closed_at = ?
             WHERE id = ?`,
          )
          .run(now, now, conversation.id);
        this.database
          .prepare(
            `UPDATE handoffs
             SET status = 'cancelled', resolved_at = ?
             WHERE conversation_id = ? AND status = 'waiting'`,
          )
          .run(now, conversation.id);
      }

      return conversations.length;
    })();
  }

  private hashContact(externalUserId: string) {
    return createHmac("sha256", this.contactHashKey)
      .update(externalUserId)
      .digest("hex");
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('bot', 'waiting_for_human', 'human', 'closed')),
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        external_message_id TEXT UNIQUE,
        direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'staff', 'system')),
        input_type TEXT NOT NULL CHECK (input_type IN ('text', 'voice')),
        language TEXT,
        content TEXT NOT NULL,
        citations_json TEXT,
        model_deployment TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        event_type TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_contact
        ON conversations(contact_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
    `);
  }
}
