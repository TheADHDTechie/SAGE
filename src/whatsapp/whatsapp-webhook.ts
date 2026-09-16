import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SupportAssistant } from "../application/support-assistant.js";
import type { AppConfig } from "../config.js";
import type { SupportResponse } from "../domain/types.js";
import type { SpeechSynthesizer } from "../gateways/speech-synthesizer.js";
import type { SpeechTranscriber } from "../gateways/speech-transcriber.js";
import type { WhatsAppGateway } from "../gateways/whatsapp.js";
import type { ConversationStore } from "../infrastructure/database.js";
import type {
  ReplyMode,
  WhatsAppDeliveryPlan,
  WhatsAppDeliveryStep,
} from "./delivery-types.js";
import {
  parseTopicMenuCommand,
  staffOptionMessage,
  staffRequestSelection,
  topicList,
  topicListSelection,
  topicMenuTextFallback,
  topicQuestion,
  topicShortcutMessage,
} from "./topic-menu.js";

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
    interactive: z
      .object({
        type: z.string(),
        list_reply: z
          .object({
            id: z.string(),
            title: z.string().optional(),
          })
          .optional(),
        button_reply: z
          .object({
            id: z.string(),
            title: z.string().optional(),
          })
          .optional(),
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
  speechSynthesizer: SpeechSynthesizer | undefined;
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
    speechSynthesizer,
    gateway,
    rawBodyFor,
  } = dependencies;
  const appSecret = required(config.META_APP_SECRET, "META_APP_SECRET");
  const phoneNumberId = required(
    config.WHATSAPP_PHONE_NUMBER_ID,
    "WHATSAPP_PHONE_NUMBER_ID",
  );
  const staffApiToken = required(config.STAFF_API_TOKEN, "STAFF_API_TOKEN");
  const senderQueue = new SenderSerialQueue();

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
                speechSynthesizer,
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

  app.get("/api/staff/diagnostics", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (
      !authorization?.startsWith("Bearer ") ||
      !safeStringEqual(authorization.slice("Bearer ".length), staffApiToken)
    ) {
      return reply.code(401).send({ error: "Unauthorized staff request" });
    }

    return reply.code(200).send(store.whatsAppDiagnostics());
  });
}

export function registerWhatsAppVerificationRoute(
  app: FastifyInstance,
  verifyToken: string,
) {
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
  speechSynthesizer: SpeechSynthesizer | undefined;
  gateway: WhatsAppGateway;
  markRead: boolean;
}) {
  const {
    message,
    assistant,
    store,
    speechTranscriber,
    speechSynthesizer,
    gateway,
    markRead,
  } = input;

  const processingState = store.beginWhatsAppProcessing(message.id);
  if (!processingState) {
    const existingDelivery = store.whatsAppDelivery(message.id);
    if (
      existingDelivery?.plan &&
      existingDelivery.status !== "sent"
    ) {
      if (
        existingDelivery.allowDuringHandoff &&
        ((existingDelivery.conversationId &&
          !store.isConversationHumanActive(existingDelivery.conversationId)) ||
          (!existingDelivery.conversationId &&
            !store.isHumanActiveForUser(message.from)))
      ) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
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
        store,
        gateway,
      );
    }
    return;
  }

  try {
    if (processingState === "reclaimed") {
      const handoffRecovery = store.handoffResponseForInbound(message.id);
      if (handoffRecovery) {
        if (!handoffRecovery.active) {
          store.completeWhatsAppWithoutResponse(message.id);
          return;
        }
        store.prepareWhatsAppDelivery(
          message.id,
          handoffRecovery.content,
          true,
          handoffRecovery.conversationId,
        );
        await sendPreparedDelivery(message.id, message.from, store, gateway);
        return;
      }
      const originalInbound = store.inboundConversationForMessage(message.id);
      if (originalInbound && originalInbound.status !== "bot") {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
    }

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
    } else if (message.type === "interactive") {
      if (store.isHumanActiveForUser(message.from)) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      const selectionId = interactiveSelectionId(message);
      const preference = preferenceSelection(selectionId);
      if (preference) {
        store.setReplyPreference(message.from, preference.mode);
        const response = preferenceConfirmation(
          preference.mode,
          preference.language,
        );
        store.prepareWhatsAppDelivery(message.id, response);
        await sendPreparedDelivery(message.id, message.from, store, gateway);
        return;
      }
      const staffRequest = staffRequestSelection(selectionId ?? "");
      if (staffRequest) {
        text = staffRequest.command;
        inputType = "text";
      } else {
        const topicMenuLanguage = topicListSelection(selectionId ?? "");
        if (topicMenuLanguage) {
          store.prepareWhatsAppDeliveryPlan(message.id, {
            steps: [{ kind: "topic_list", language: topicMenuLanguage }],
          });
          await sendPreparedDelivery(message.id, message.from, store, gateway);
          return;
        }
        const selectedTopic = topicQuestion(selectionId ?? "");
        if (!selectedTopic) {
          const response =
            "I could not read that selection. Type your question directly, or send TOPICS to see the topic menu.";
          store.prepareWhatsAppDelivery(message.id, response);
          await sendPreparedDelivery(
            message.id,
            message.from,
            store,
            gateway,
          );
          return;
        }
        text = selectedTopic.question;
        inputType = "text";
      }
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
        store,
        gateway,
      );
      return;
    }

    const topicMenuLanguage = parseTopicMenuCommand(text);
    if (topicMenuLanguage) {
      if (store.isHumanActiveForUser(message.from)) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      store.prepareWhatsAppDeliveryPlan(message.id, {
        steps: [{ kind: "topic_shortcuts", language: topicMenuLanguage }],
      });
      await sendPreparedDelivery(message.id, message.from, store, gateway);
      return;
    }

    const preferenceCommand = parsePreferenceCommand(text);
    if (preferenceCommand) {
      if (store.isHumanActiveForUser(message.from)) {
        store.completeWhatsAppWithoutResponse(message.id);
        return;
      }
      const current = store.replyPreference(message.from);
      if (preferenceCommand.kind === "show") {
        store.prepareWhatsAppDeliveryPlan(message.id, {
          steps: [
            {
              kind: "list",
              language: preferenceCommand.language,
              currentMode: current.mode,
            },
          ],
        });
      } else {
        store.setReplyPreference(message.from, preferenceCommand.mode);
        const response = preferenceConfirmation(
          preferenceCommand.mode,
          preferenceCommand.language,
        );
        store.prepareWhatsAppDelivery(message.id, response);
      }
      await sendPreparedDelivery(message.id, message.from, store, gateway);
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
    const plan = await createResponsePlan({
      response: assistantResponse,
      responseText,
      inputType,
      recipient: message.from,
      inboundMessageId: message.id,
      store,
      gateway,
      speechSynthesizer,
    });
    store.prepareWhatsAppDeliveryPlan(
      message.id,
      plan,
      assistantResponse.status === "handoff",
      responseText,
      assistantResponse.conversationId,
    );
    await sendPreparedDelivery(message.id, message.from, store, gateway);
  } catch (error) {
    const delivery = store.whatsAppDelivery(message.id);
    if (!delivery?.responseText && !delivery?.plan) {
      store.markWhatsAppProcessingFailed(message.id, errorMessage(error));
    }
    throw error;
  }
}

async function sendPreparedDelivery(
  inboundMessageId: string,
  recipient: string,
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
    const plan = delivery?.plan;
    if (!plan) {
      throw new Error("WhatsApp delivery has no prepared response plan");
    }
    for (const step of plan.steps) {
      if (step.messageIds) {
        if (step.kind === "list") {
          store.markVoicePreferencePrompted(recipient);
        }
        continue;
      }
      const result = await sendDeliveryStep(
        step,
        recipient,
        inboundMessageId,
        store,
        gateway,
      );
      step.messageIds = result.messageIds;
      store.saveWhatsAppDeliveryPlan(inboundMessageId, plan);
      if (step.kind === "list") {
        store.markVoicePreferencePrompted(recipient);
      }
    }
    store.markWhatsAppDeliverySent(
      inboundMessageId,
      plan.steps.flatMap((step) => step.messageIds ?? []),
    );
  } catch (error) {
    store.markWhatsAppDeliveryFailed(inboundMessageId, errorMessage(error));
    throw error;
  }
}

async function sendDeliveryStep(
  step: WhatsAppDeliveryStep,
  recipient: string,
  inboundMessageId: string,
  store: ConversationStore,
  gateway: WhatsAppGateway,
) {
  if (step.kind === "audio") {
    return gateway.sendAudio({
      to: recipient,
      mediaId: step.mediaId,
      replyToMessageId: inboundMessageId,
    });
  }
  if (step.kind === "list") {
    try {
      return await gateway.sendList({
        to: recipient,
        list: preferenceList(step.language, step.currentMode),
        replyToMessageId: inboundMessageId,
      });
    } catch (error) {
      store.recordAuditEvent({
        eventType: "whatsapp_interactive_failure",
        details: {
          messageId: inboundMessageId,
          error: errorMessage(error),
        },
      });
      return gateway.sendText({
        to: recipient,
        body: preferenceTextFallback(step.language),
        replyToMessageId: inboundMessageId,
      });
    }
  }
  if (step.kind === "topic_shortcuts") {
    try {
      return await gateway.sendButtons({
        to: recipient,
        message: topicShortcutMessage(step.language, step.body),
        replyToMessageId: inboundMessageId,
      });
    } catch (error) {
      store.recordAuditEvent({
        eventType: "whatsapp_interactive_failure",
        details: {
          messageId: inboundMessageId,
          error: errorMessage(error),
        },
      });
      return gateway.sendText({
        to: recipient,
        body: step.body
          ? `${step.body}\n\n${topicMenuTextFallback(step.language)}`
          : topicMenuTextFallback(step.language),
        replyToMessageId: inboundMessageId,
      });
    }
  }
  if (step.kind === "topic_list") {
    try {
      return await gateway.sendList({
        to: recipient,
        list: topicList(step.language),
        replyToMessageId: inboundMessageId,
      });
    } catch (error) {
      store.recordAuditEvent({
        eventType: "whatsapp_interactive_failure",
        details: {
          messageId: inboundMessageId,
          error: errorMessage(error),
        },
      });
      return gateway.sendText({
        to: recipient,
        body: topicMenuTextFallback(step.language),
        replyToMessageId: inboundMessageId,
      });
    }
  }
  if (step.kind === "staff_options") {
    try {
      return await gateway.sendButtons({
        to: recipient,
        message: staffOptionMessage(step.language, step.body),
        replyToMessageId: inboundMessageId,
      });
    } catch (error) {
      store.recordAuditEvent({
        eventType: "whatsapp_interactive_failure",
        details: {
          messageId: inboundMessageId,
          error: errorMessage(error),
        },
      });
      return gateway.sendText({
        to: recipient,
        body: step.body,
        replyToMessageId: inboundMessageId,
      });
    }
  }
  return gateway.sendText({
    to: recipient,
    body: step.body,
    replyToMessageId: inboundMessageId,
  });
}

async function createResponsePlan(input: {
  response: Exclude<SupportResponse, { status: "duplicate" | "human_active" }>;
  responseText: string;
  inputType: "text" | "voice";
  recipient: string;
  inboundMessageId: string;
  store: ConversationStore;
  gateway: WhatsAppGateway;
  speechSynthesizer: SpeechSynthesizer | undefined;
}): Promise<WhatsAppDeliveryPlan> {
  const {
    response,
    responseText,
    inputType,
    recipient,
    inboundMessageId,
    store,
    gateway,
    speechSynthesizer,
  } = input;
  if (response.status !== "answered") {
    return { steps: [{ kind: "text", body: responseText }] };
  }
  if (response.presentation === "topic_shortcuts") {
    return {
      steps: [
        {
          kind: "topic_shortcuts",
          language: response.language === "sw" ? "sw" : "en",
          body: response.answer,
        },
      ],
    };
  }
  if (response.presentation === "staff_options") {
    return {
      steps: [
        {
          kind: "staff_options",
          language: response.language === "sw" ? "sw" : "en",
          body: response.answer,
        },
      ],
    };
  }

  const preference = store.replyPreference(recipient);
  const replyMode =
    preference.mode === "auto"
      ? inputType === "voice"
        ? "voice"
        : "text"
      : preference.mode;
  if (replyMode === "text" || !speechSynthesizer) {
    return { steps: [{ kind: "text", body: responseText }] };
  }

  const spoken = spokenAnswer(response.answer, response.language);
  try {
    const audio = await speechSynthesizer.synthesize({
      text: spoken.text,
      language: response.language,
    });
    const uploaded = await gateway.uploadAudio(audio);
    const steps: WhatsAppDeliveryStep[] = [
      { kind: "audio", mediaId: uploaded.mediaId },
    ];
    if (replyMode === "both" || spoken.shortened) {
      steps.push({ kind: "text", body: responseText });
    } else {
      const sources = formatSources(response);
      if (sources) {
        steps.push({ kind: "text", body: sources });
      }
    }
    if (
      inputType === "voice" &&
      preference.mode === "auto" &&
      !preference.prompted
    ) {
      steps.push({
        kind: "list",
        language: response.language === "sw" ? "sw" : "en",
        currentMode: preference.mode,
      });
    }
    return { steps };
  } catch (error) {
    store.recordAuditEvent({
      eventType: "whatsapp_voice_reply_failure",
      details: {
        messageId: inboundMessageId,
        error: errorMessage(error),
      },
    });
    return { steps: [{ kind: "text", body: responseText }] };
  }
}

function formatSupportResponse(response: Exclude<SupportResponse, {
  status: "duplicate" | "human_active";
}>) {
  if (response.status !== "answered" || response.citations.length === 0) {
    return response.answer;
  }

  return `${response.answer}\n\n${formatSources(response)}`;
}

function formatSources(
  response: Extract<SupportResponse, { status: "answered" }>,
) {
  if (response.citations.length === 0) {
    return "";
  }
  const sourceLabel = response.language === "sw" ? "Vyanzo" : "Sources";
  const sources = response.citations.map(
    (citation) =>
      `- ${citation.title}; ${citation.chapter}; pages ${citation.pages}`,
  );
  return `${sourceLabel}:\n${sources.join("\n")}`;
}

function spokenAnswer(answer: string, language: string) {
  const normalized = answer
    .replace(/[*_#`]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const maximumLength = 1200;
  if (normalized.length <= maximumLength) {
    return { text: normalized, shortened: false };
  }
  const candidate = normalized.slice(0, maximumLength);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?"),
  );
  const summary =
    candidate.slice(0, sentenceEnd > 600 ? sentenceEnd + 1 : maximumLength)
      .trim();
  return {
    text: `${summary} ${
      language === "sw"
        ? "Nimetuma jibu kamili kwa maandishi."
        : "I have sent the complete answer in text."
    }`,
    shortened: true,
  };
}

function interactiveSelectionId(
  message: z.infer<typeof webhookMessageSchema>,
): string | undefined {
  return (
    message.interactive?.list_reply?.id ??
    message.interactive?.button_reply?.id
  );
}

function preferenceSelection(
  selectionId: string | undefined,
): { mode: ReplyMode; language: "en" | "sw" } | undefined {
  const match = /^preference:(en|sw):(auto|text|voice|both)$/.exec(
    selectionId ?? "",
  );
  return match
    ? {
        language: match[1] as "en" | "sw",
        mode: match[2] as ReplyMode,
      }
    : undefined;
}

function parsePreferenceCommand(message: string):
  | { kind: "show"; language: "en" | "sw" }
  | { kind: "set"; language: "en" | "sw"; mode: ReplyMode }
  | undefined {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (["settings", "my settings"].includes(normalized)) {
    return { kind: "show", language: "en" };
  }
  if (["mipangilio", "mpangilio"].includes(normalized)) {
    return { kind: "show", language: "sw" };
  }
  const commands: Record<string, { mode: ReplyMode; language: "en" | "sw" }> = {
    auto: { mode: "auto", language: "en" },
    automatic: { mode: "auto", language: "en" },
    text: { mode: "text", language: "en" },
    "text replies": { mode: "text", language: "en" },
    voice: { mode: "voice", language: "en" },
    "voice replies": { mode: "voice", language: "en" },
    both: { mode: "both", language: "en" },
    otomatiki: { mode: "auto", language: "sw" },
    maandishi: { mode: "text", language: "sw" },
    sauti: { mode: "voice", language: "sw" },
    zote: { mode: "both", language: "sw" },
  };
  const selected = commands[normalized];
  return selected ? { kind: "set", ...selected } : undefined;
}

function preferenceConfirmation(mode: ReplyMode, language: "en" | "sw") {
  const labels = {
    en: {
      auto: "Automatic",
      text: "Text",
      voice: "Voice",
      both: "Voice and text",
    },
    sw: {
      auto: "Otomatiki",
      text: "Maandishi",
      voice: "Sauti",
      both: "Sauti na maandishi",
    },
  } as const;
  return language === "sw"
    ? `Mpangilio wako wa majibu sasa ni ${labels.sw[mode]}. Tuma MIPANGILIO wakati wowote ili kuubadilisha.`
    : `Your reply preference is now ${labels.en[mode]}. Send SETTINGS at any time to change it.`;
}

function preferenceList(language: "en" | "sw", currentMode: ReplyMode) {
  const prefix = `preference:${language}:`;
  if (language === "sw") {
    return {
      body: `Chagua jinsi SAGE inavyojibu. Mpangilio wa sasa: ${preferenceModeLabel(
        currentMode,
        language,
      )}.`,
      button: "Chagua",
      sections: [
        {
          title: "Aina ya jibu",
          rows: [
            {
              id: `${prefix}auto`,
              title: "Otomatiki",
              description: "Fuata aina ya ujumbe wangu",
            },
            {
              id: `${prefix}text`,
              title: "Maandishi",
              description: "Jibu kila wakati kwa maandishi",
            },
            {
              id: `${prefix}voice`,
              title: "Sauti",
              description: "Sauti pamoja na vyanzo vifupi",
            },
            {
              id: `${prefix}both`,
              title: "Zote",
              description: "Sauti na jibu kamili kwa maandishi",
            },
          ],
        },
      ],
    };
  }
  return {
    body: `Choose how SAGE replies. Current preference: ${preferenceModeLabel(
      currentMode,
      language,
    )}.`,
    button: "Choose an option",
    sections: [
      {
        title: "Reply format",
        rows: [
          {
            id: `${prefix}auto`,
            title: "Automatic",
            description: "Follow the format of my message",
          },
          {
            id: `${prefix}text`,
            title: "Text",
            description: "Always reply with text",
          },
          {
            id: `${prefix}voice`,
            title: "Voice",
            description: "Audio with short text sources",
          },
          {
            id: `${prefix}both`,
            title: "Both",
            description: "Audio and the complete text answer",
          },
        ],
      },
    ],
  };
}

function preferenceModeLabel(mode: ReplyMode, language: "en" | "sw") {
  const labels = {
    en: { auto: "Automatic", text: "Text", voice: "Voice", both: "Both" },
    sw: {
      auto: "Otomatiki",
      text: "Maandishi",
      voice: "Sauti",
      both: "Zote",
    },
  } as const;
  return labels[language][mode];
}

function preferenceTextFallback(language: "en" | "sw") {
  return language === "sw"
    ? "Chagua aina ya majibu kwa kutuma: OTOMATIKI, MAANDISHI, SAUTI, au ZOTE."
    : "Choose your reply format by sending: AUTO, TEXT, VOICE, or BOTH.";
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
