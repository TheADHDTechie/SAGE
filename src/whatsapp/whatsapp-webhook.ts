import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SupportAssistant } from "../application/support-assistant.js";
import type { AppConfig } from "../config.js";
import type { SupportResponse } from "../domain/types.js";
import type { SpeechTranscriber } from "../gateways/speech-transcriber.js";
import type { WhatsAppGateway } from "../gateways/whatsapp.js";
import type { ConversationStore } from "../infrastructure/database.js";

const verificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string(),
  "hub.challenge": z.string(),
});

const webhookMessageSchema = z
  .object({
    from: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().optional(),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).optional(),
    audio: z
      .object({
        id: z.string().min(1),
        mime_type: z.string().optional(),
        voice: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

const webhookStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.string().optional(),
    errors: z
      .array(
        z
          .object({
            code: z.number().optional(),
            title: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const webhookPayloadSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                field: z.string(),
                value: z
                  .object({
                    metadata: z
                      .object({ phone_number_id: z.string() })
                      .optional(),
                    messages: z.array(webhookMessageSchema).optional(),
                    statuses: z.array(webhookStatusSchema).optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const staffResetSchema = z.object({
  externalUserId: z.string().min(1).max(200),
});

interface WhatsAppRouteDependencies {
  config: AppConfig;
  assistant: SupportAssistant;
  store: ConversationStore;
  speechTranscriber: SpeechTranscriber;
  gateway: WhatsAppGateway;
  rawBodyFor(request: FastifyRequest): Buffer | undefined;
}

export function registerWhatsAppRoutes(
  app: FastifyInstance,
  dependencies: WhatsAppRouteDependencies,
) {
  const {
    config,
    assistant,
    store,
    speechTranscriber,
    gateway,
    rawBodyFor,
  } = dependencies;
  const verifyToken = required(config.WHATSAPP_VERIFY_TOKEN, "WHATSAPP_VERIFY_TOKEN");
  const appSecret = required(config.META_APP_SECRET, "META_APP_SECRET");
  const phoneNumberId = required(
    config.WHATSAPP_PHONE_NUMBER_ID,
    "WHATSAPP_PHONE_NUMBER_ID",
  );
  const staffApiToken = required(config.STAFF_API_TOKEN, "STAFF_API_TOKEN");
  const senderQueue = new SenderSerialQueue();

  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = verificationQuerySchema.safeParse(request.query);
    if (
      !query.success ||
      !safeStringEqual(query.data["hub.verify_token"], verifyToken)
    ) {
      return reply.code(403).type("text/plain").send("Forbidden");
    }

    return reply
      .code(200)
      .type("text/plain")
      .send(query.data["hub.challenge"]);
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = rawBodyFor(request);
    const signature = request.headers["x-hub-signature-256"];
    if (
      !rawBody ||
      typeof signature !== "string" ||
      !validateWhatsAppSignature(rawBody, signature, appSecret)
    ) {
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }

    const payload = webhookPayloadSchema.safeParse(request.body);
    if (!payload.success || payload.data.object !== "whatsapp_business_account") {
      store.recordAuditEvent({
        eventType: "whatsapp_unhandled_payload",
        details: {
          reason: payload.success ? "unsupported_object" : "unsupported_shape",
        },
      });
      return reply.code(200).send({ status: "ignored" });
    }

    const messages: z.infer<typeof webhookMessageSchema>[] = [];
    let statusCount = 0;

    for (const entry of payload.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") {
          continue;
        }

        const receivedPhoneNumberId = change.value.metadata?.phone_number_id;
        if (
          receivedPhoneNumberId &&
          receivedPhoneNumberId !== phoneNumberId
        ) {
          store.recordAuditEvent({
            eventType: "whatsapp_phone_number_mismatch",
            details: { receivedPhoneNumberId },
          });
          continue;
        }

        messages.push(...(change.value.messages ?? []));
        for (const status of change.value.statuses ?? []) {
          statusCount += 1;
          store.recordAuditEvent({
            eventType: "whatsapp_message_status",
            details: {
              messageId: status.id,
              status: status.status,
              timestamp: status.timestamp,
              errorCode: status.errors?.[0]?.code,
              errorTitle: status.errors?.[0]?.title,
            },
          });
        }
      }
    }

    const messagesBySender = new Map<
      string,
      Array<z.infer<typeof webhookMessageSchema>>
    >();
    for (const message of messages) {
      const senderMessages = messagesBySender.get(message.from) ?? [];
      senderMessages.push(message);
      messagesBySender.set(message.from, senderMessages);
    }

    const failureCounts = await Promise.all(
      [...messagesBySender.entries()].map(([sender, senderMessages]) =>
        senderQueue.run(sender, async () => {
          let failures = 0;
          for (const message of senderMessages) {
            try {
              await processWhatsAppMessage({
                message,
                assistant,
                store,
                speechTranscriber,
                gateway,
                markRead: config.WHATSAPP_MARK_MESSAGES_READ,
              });
            } catch (error) {
              failures += 1;
              request.log.error(
                { error: errorMessage(error), messageId: message.id },
                "WhatsApp webhook message processing failed",
              );
            }
          }
          return failures;
        }),
      ),
    );
    const failureCount = failureCounts.reduce(
      (total, failures) => total + failures,
      0,
    );

    if (failureCount > 0) {
      return reply.code(503).send({
        error: "One or more WhatsApp messages could not be processed",
        accepted: messages.length - failureCount,
        failed: failureCount,
      });
    }

    return reply.code(200).send({
      status: "accepted",
      messages: messages.length,
      statuses: statusCount,
    });
  });

  app.post("/api/staff/conversations/reset", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (
      !authorization?.startsWith("Bearer ") ||
      !safeStringEqual(authorization.slice("Bearer ".length), staffApiToken)
    ) {
      return reply.code(401).send({ error: "Unauthorized staff request" });
    }

    const body = staffResetSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "Invalid reset request",
        details: z.treeifyError(body.error),
      });
    }

    const resetConversations = store.resetConversationForUser(
      body.data.externalUserId,
    );
    return reply.code(200).send({
      resetConversations,
      status:
        resetConversations > 0
          ? "The next message will start a new bot conversation."
          : "No active conversation was found.",
    });
  });
}

export function validateWhatsAppSignature(
  rawBody: Uint8Array,
  signatureHeader: string,
  appSecret: string,
) {
  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const received = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(received)) {
    return false;
  }

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const receivedBytes = Buffer.from(received, "hex");
  return (
    expected.byteLength === receivedBytes.byteLength &&
    timingSafeEqual(expected, receivedBytes)
  );
}

async function processWhatsAppMessage(input: {
  message: z.infer<typeof webhookMessageSchema>;
  assistant: SupportAssistant;
  store: ConversationStore;
  speechTranscriber: SpeechTranscriber;
  gateway: WhatsAppGateway;
  markRead: boolean;
}) {
  const { message, assistant, store, speechTranscriber, gateway, markRead } =
    input;

  const processingState = store.beginWhatsAppProcessing(message.id);
  if (!processingState) {
    const existingDelivery = store.whatsAppDelivery(message.id);
    if (
      existingDelivery?.responseText &&
      existingDelivery.status !== "sent" &&
      existingDelivery.status !== "sending"
    ) {
      if (
        store.isHumanActiveForUser(message.from) &&
        !existingDelivery.allowDuringHandoff
      ) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      await sendPreparedDelivery(
        message.id,
        message.from,
        existingDelivery.responseText,
        store,
        gateway,
      );
    }
    return;
  }

  try {
    if (markRead) {
      try {
        await gateway.markRead(message.id);
      } catch (error) {
        store.recordAuditEvent({
          eventType: "whatsapp_mark_read_failure",
          details: {
            messageId: message.id,
            error: errorMessage(error),
          },
        });
      }
    }

    let text: string;
    let inputType: "text" | "voice";

    if (message.type === "text" && message.text?.body.trim()) {
      text = message.text.body.trim();
      inputType = "text";
    } else if (message.type === "audio" && message.audio?.id) {
      if (store.isHumanActiveForUser(message.from)) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      try {
        const media = await gateway.downloadMedia(message.audio.id);
        const transcript = await speechTranscriber.transcribe(media);
        text = transcript.text;
        inputType = "voice";
      } catch (error) {
        store.recordAuditEvent({
          eventType: "whatsapp_audio_failure",
          details: {
            messageId: message.id,
            error: errorMessage(error),
          },
        });
        if (store.isHumanActiveForUser(message.from)) {
          store.completeWhatsAppWithoutResponse(message.id);
          return;
        }
        const response =
          "I could not read that voice note. Please resend it or type your question.";
        store.prepareWhatsAppDelivery(message.id, response);
        await sendPreparedDelivery(
          message.id,
          message.from,
          response,
          store,
          gateway,
        );
        return;
      }
    } else {
      if (store.isHumanActiveForUser(message.from)) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      const response =
        "I can currently help with text messages and WhatsApp voice notes. Please resend your question as text or audio.";
      store.prepareWhatsAppDelivery(message.id, response);
      await sendPreparedDelivery(
        message.id,
        message.from,
        response,
        store,
        gateway,
      );
      return;
    }

    const assistantResponse = await assistant.process(
      {
        externalMessageId: message.id,
        externalUserId: message.from,
        type: inputType,
        text,
        receivedAt: whatsappTimestamp(message.timestamp),
      },
      { allowDuplicate: processingState === "reclaimed" },
    );

    if (assistantResponse.status === "human_active") {
      store.completeWhatsAppWithoutResponse(message.id);
      return;
    }

    if (assistantResponse.status === "duplicate") {
      throw new Error(
        "Duplicate WhatsApp message has no recoverable delivery response",
      );
    }

    if (
      assistantResponse.status !== "handoff" &&
      store.isHumanActiveForUser(message.from)
    ) {
      store.completeWhatsAppWithoutResponse(message.id);
      return;
    }

    const responseText = formatSupportResponse(assistantResponse);
    store.prepareWhatsAppDelivery(
      message.id,
      responseText,
      assistantResponse.status === "handoff",
    );
    await sendPreparedDelivery(
      message.id,
      message.from,
      responseText,
      store,
      gateway,
    );
  } catch (error) {
    const delivery = store.whatsAppDelivery(message.id);
    if (!delivery?.responseText) {
      store.markWhatsAppProcessingFailed(message.id, errorMessage(error));
    }
    throw error;
  }
}

async function sendPreparedDelivery(
  inboundMessageId: string,
  recipient: string,
  responseText: string,
  store: ConversationStore,
  gateway: WhatsAppGateway,
) {
  const delivery = store.whatsAppDelivery(inboundMessageId);
  if (delivery?.status === "sent") {
    return;
  }
  if (!store.claimWhatsAppDelivery(inboundMessageId)) {
    return;
  }

  try {
    const result = await gateway.sendText({
      to: recipient,
      body: responseText,
      replyToMessageId: inboundMessageId,
    });
    store.markWhatsAppDeliverySent(inboundMessageId, result.messageIds);
  } catch (error) {
    store.markWhatsAppDeliveryFailed(inboundMessageId, errorMessage(error));
    throw error;
  }
}

function formatSupportResponse(response: Exclude<SupportResponse, {
  status: "duplicate" | "human_active";
}>) {
  if (response.status !== "answered" || response.citations.length === 0) {
    return response.answer;
  }

  const sourceLabel = response.language === "sw" ? "Vyanzo" : "Sources";
  const sources = response.citations.map(
    (citation) =>
      `- ${citation.title}; ${citation.chapter}; pages ${citation.pages}`,
  );
  return `${response.answer}\n\n${sourceLabel}:\n${sources.join("\n")}`;
}

function whatsappTimestamp(timestamp: string | undefined) {
  const milliseconds = Number(timestamp) * 1000;
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : new Date().toISOString();
}

function safeStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function required(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

class SenderSerialQueue {
  private readonly pending = new Map<string, Promise<unknown>>();

  async run<T>(sender: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(sender) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pending.set(sender, current);

    try {
      return await current;
    } finally {
      if (this.pending.get(sender) === current) {
        this.pending.delete(sender);
      }
    }
  }
}
