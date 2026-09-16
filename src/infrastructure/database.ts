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
import type {
  ReplyMode,
  WhatsAppDeliveryPlan,
} from "../whatsapp/delivery-types.js";

interface ConversationRow {
  id: string;
  status: ConversationStatus;
}

export interface WhatsAppDelivery {
  inboundMessageId: string;
  responseText: string | null;
  plan: WhatsAppDeliveryPlan | null;
  status: "processing" | "pending" | "sending" | "sent" | "failed";
  attempts: number;
  allowDuringHandoff: boolean;
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

  isHumanActiveForUser(externalUserId: string) {
    const contactId = this.hashContact(externalUserId);
    const row = this.database
      .prepare(
        `SELECT 1 AS active
         FROM conversations
         WHERE contact_id = ? AND status IN ('waiting_for_human', 'human')
         LIMIT 1`,
      )
      .get(contactId);
    return row !== undefined;
  }

  replyPreference(externalUserId: string): {
    mode: ReplyMode;
    prompted: boolean;
  } {
    const row = this.database
      .prepare(
        `SELECT reply_mode AS mode,
                voice_preference_prompted AS prompted
         FROM contacts
         WHERE id = ?`,
      )
      .get(this.hashContact(externalUserId)) as
      | { mode: ReplyMode; prompted: number }
      | undefined;
    return row
      ? { mode: row.mode, prompted: Boolean(row.prompted) }
      : { mode: "auto", prompted: false };
  }

  setReplyPreference(externalUserId: string, mode: ReplyMode) {
    const contactId = this.hashContact(externalUserId);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO contacts (
           id, reply_mode, voice_preference_prompted, created_at, updated_at
         ) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           reply_mode = excluded.reply_mode,
           voice_preference_prompted = 1,
           updated_at = excluded.updated_at`,
      )
      .run(contactId, mode, now, now);
  }

  markVoicePreferencePrompted(externalUserId: string) {
    const contactId = this.hashContact(externalUserId);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO contacts (
           id, reply_mode, voice_preference_prompted, created_at, updated_at
         ) VALUES (?, 'auto', 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           voice_preference_prompted = 1,
           updated_at = excluded.updated_at`,
      )
      .run(contactId, now, now);
  }

  beginWhatsAppProcessing(inboundMessageId: string) {
    const currentTime = new Date();
    const now = currentTime.toISOString();
    const staleBefore = new Date(
      currentTime.getTime() - 2 * 60 * 1000,
    ).toISOString();
    return this.database.transaction(() => {
      const inserted = this.database
        .prepare(
          `INSERT OR IGNORE INTO whatsapp_deliveries (
             inbound_message_id, response_text, delivery_plan_json, status,
             attempts, created_at, updated_at
           ) VALUES (?, NULL, NULL, 'processing', 0, ?, ?)`,
        )
        .run(inboundMessageId, now, now);
      if (inserted.changes === 1) {
        return "new" as const;
      }

      const reclaimed = this.database
        .prepare(
          `UPDATE whatsapp_deliveries
           SET status = 'processing', updated_at = ?
           WHERE inbound_message_id = ?
             AND response_text IS NULL
             AND delivery_plan_json IS NULL
             AND (
               status = 'failed'
               OR (status = 'processing' AND updated_at < ?)
             )`,
        )
        .run(now, inboundMessageId, staleBefore);
      return reclaimed.changes === 1 ? ("reclaimed" as const) : undefined;
    })();
  }

  prepareWhatsAppDelivery(
    inboundMessageId: string,
    responseText: string,
    allowDuringHandoff = false,
  ) {
    this.prepareWhatsAppDeliveryPlan(
      inboundMessageId,
      { steps: [{ kind: "text", body: responseText }] },
      allowDuringHandoff,
      responseText,
    );
  }

  prepareWhatsAppDeliveryPlan(
    inboundMessageId: string,
    plan: WhatsAppDeliveryPlan,
    allowDuringHandoff = false,
    responseText: string | null = null,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO whatsapp_deliveries (
           inbound_message_id, response_text, delivery_plan_json, status, attempts,
           allow_during_handoff, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
         ON CONFLICT(inbound_message_id) DO UPDATE SET
           response_text = excluded.response_text,
           delivery_plan_json = excluded.delivery_plan_json,
           allow_during_handoff = excluded.allow_during_handoff,
           status = CASE
             WHEN whatsapp_deliveries.status = 'sent' THEN 'sent'
             ELSE 'pending'
           END,
           updated_at = excluded.updated_at`,
      )
      .run(
        inboundMessageId,
        responseText,
        JSON.stringify(plan),
        allowDuringHandoff ? 1 : 0,
        now,
        now,
      );
  }

  whatsAppDelivery(inboundMessageId: string): WhatsAppDelivery | undefined {
    const delivery = this.database
      .prepare(
        `SELECT inbound_message_id AS inboundMessageId,
                response_text AS responseText,
                delivery_plan_json AS planJson,
                status,
                attempts,
                allow_during_handoff AS allowDuringHandoff
         FROM whatsapp_deliveries
         WHERE inbound_message_id = ?`,
      )
      .get(inboundMessageId) as
      | (Omit<WhatsAppDelivery, "allowDuringHandoff" | "plan"> & {
          allowDuringHandoff: number;
          planJson: string | null;
        })
      | undefined;
    return delivery
      ? {
          ...delivery,
          plan: delivery.planJson
            ? (JSON.parse(delivery.planJson) as WhatsAppDeliveryPlan)
            : delivery.responseText
              ? { steps: [{ kind: "text", body: delivery.responseText }] }
              : null,
          allowDuringHandoff: Boolean(delivery.allowDuringHandoff),
        }
      : undefined;
  }

  saveWhatsAppDeliveryPlan(
    inboundMessageId: string,
    plan: WhatsAppDeliveryPlan,
  ) {
    this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET delivery_plan_json = ?, updated_at = ?
         WHERE inbound_message_id = ?`,
      )
      .run(JSON.stringify(plan), new Date().toISOString(), inboundMessageId);
  }

  claimWhatsAppDelivery(inboundMessageId: string) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const result = this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET status = 'sending', attempts = attempts + 1, updated_at = ?
         WHERE inbound_message_id = ?
           AND (response_text IS NOT NULL OR delivery_plan_json IS NOT NULL)
           AND (
             status IN ('pending', 'failed')
             OR (status = 'sending' AND updated_at < ?)
           )`,
      )
      .run(now.toISOString(), inboundMessageId, staleBefore);
    return result.changes === 1;
  }

  markWhatsAppDeliverySent(
    inboundMessageId: string,
    outboundMessageIds: readonly string[],
  ) {
    this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET status = 'sent',
             outbound_message_ids_json = ?,
             last_error = NULL,
             updated_at = ?
         WHERE inbound_message_id = ?`,
      )
      .run(
        JSON.stringify(outboundMessageIds),
        new Date().toISOString(),
        inboundMessageId,
      );
  }

  markWhatsAppProcessingFailed(inboundMessageId: string, error: string) {
    this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET status = 'failed',
             last_error = ?,
             updated_at = ?
         WHERE inbound_message_id = ?
           AND response_text IS NULL
           AND delivery_plan_json IS NULL`,
      )
      .run(error.slice(0, 1000), new Date().toISOString(), inboundMessageId);
  }

  completeWhatsAppWithoutResponse(inboundMessageId: string) {
    this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET status = 'sent',
             outbound_message_ids_json = '[]',
             last_error = NULL,
             updated_at = ?
         WHERE inbound_message_id = ?`,
      )
      .run(new Date().toISOString(), inboundMessageId);
  }

  whatsAppDiagnostics() {
    const countBy = (table: string, column: string) =>
      Object.fromEntries(
        (
          this.database
            .prepare(
              `SELECT ${column} AS name, COUNT(*) AS count
               FROM ${table}
               GROUP BY ${column}`,
            )
            .all() as Array<{ name: string; count: number }>
        ).map((row) => [row.name, row.count]),
      );
    const scalar = (sql: string) =>
      (
        this.database.prepare(sql).get() as
          | { count: number }
          | undefined
      )?.count ?? 0;
    const latest = this.database
      .prepare(
        `SELECT MAX(updated_at) AS latestActivityAt
         FROM (
           SELECT updated_at FROM conversations
           UNION ALL
           SELECT updated_at FROM whatsapp_deliveries
         )`,
      )
      .get() as { latestActivityAt: string | null };
    const deliveryFailures = this.database
      .prepare(
        `SELECT attempts, last_error AS error, updated_at AS updatedAt
         FROM whatsapp_deliveries
         WHERE status = 'failed' AND last_error IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 5`,
      )
      .all() as Array<{
        attempts: number;
        error: string;
        updatedAt: string;
      }>;
    const auditFailures = (
      this.database
        .prepare(
          `SELECT event_type AS eventType,
                  details_json AS detailsJson,
                  created_at AS createdAt
           FROM audit_events
           WHERE event_type LIKE '%failure'
           ORDER BY created_at DESC
           LIMIT 5`,
        )
        .all() as Array<{
          eventType: string;
          detailsJson: string | null;
          createdAt: string;
        }>
    ).map((row) => {
      const details = row.detailsJson
        ? (JSON.parse(row.detailsJson) as Record<string, unknown>)
        : {};
      return {
        eventType: row.eventType,
        error:
          typeof details.error === "string"
            ? details.error.slice(0, 500)
            : "No error detail",
        createdAt: row.createdAt,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      latestActivityAt: latest.latestActivityAt,
      conversations: countBy("conversations", "status"),
      messages: countBy("messages", "direction"),
      handoffs: countBy("handoffs", "status"),
      deliveries: countBy("whatsapp_deliveries", "status"),
      deliveryAttempts: scalar(
        "SELECT COALESCE(SUM(attempts), 0) AS count FROM whatsapp_deliveries",
      ),
      auditEvents: countBy("audit_events", "event_type"),
      recentFailures: {
        deliveries: deliveryFailures,
        auditEvents: auditFailures,
      },
    };
  }

  markWhatsAppDeliveryFailed(inboundMessageId: string, error: string) {
    this.database
      .prepare(
        `UPDATE whatsapp_deliveries
         SET status = 'failed',
             last_error = ?,
             updated_at = ?
         WHERE inbound_message_id = ?`,
      )
      .run(error.slice(0, 1000), new Date().toISOString(), inboundMessageId);
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
        reply_mode TEXT NOT NULL DEFAULT 'auto'
          CHECK (reply_mode IN ('auto', 'text', 'voice', 'both')),
        voice_preference_prompted INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS whatsapp_deliveries (
        inbound_message_id TEXT PRIMARY KEY,
        response_text TEXT,
        delivery_plan_json TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('processing', 'pending', 'sending', 'sent', 'failed')
        ),
        attempts INTEGER NOT NULL DEFAULT 0,
        allow_during_handoff INTEGER NOT NULL DEFAULT 0,
        outbound_message_ids_json TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_contact
        ON conversations(contact_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
    `);
    this.ensureColumn(
      "contacts",
      "reply_mode",
      "TEXT NOT NULL DEFAULT 'auto' CHECK (reply_mode IN ('auto', 'text', 'voice', 'both'))",
    );
    this.ensureColumn(
      "contacts",
      "voice_preference_prompted",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn("whatsapp_deliveries", "delivery_plan_json", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
