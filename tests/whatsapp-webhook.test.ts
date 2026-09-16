import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type {
  LanguageModelGateway,
  LanguageModelInput,
} from "../src/gateways/language-model.js";
import type {
  SpeechTranscriber,
  SpeechTranscription,
} from "../src/gateways/speech-transcriber.js";
import type {
  SpeechSynthesizer,
  SynthesizedSpeech,
} from "../src/gateways/speech-synthesizer.js";
import type {
  WhatsAppButtonMessage,
  WhatsAppListMessage,
  WhatsAppGateway,
  WhatsAppMedia,
  WhatsAppSendResult,
} from "../src/gateways/whatsapp.js";

const temporaryDirectories: string[] = [];
const appSecret = "test-meta-app-secret";

function whatsAppConfig(
  overrides: Record<string, string> = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sal-whatsapp-test-"));
  temporaryDirectories.push(directory);
  return loadConfig({
    NODE_ENV: "test",
    DATA_DIR: directory,
    MANUAL_PATH: path.resolve(
      "knowledge-base",
      "sal",
      "data",
      "sal-guide-chunks.jsonl",
    ),
    CONTACT_HASH_KEY: "test-contact-hash-key",
    LLM_PROVIDER: "mock",
    SPEECH_PROVIDER: "mock",
    ENABLE_TEST_ENDPOINTS: "false",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_VERIFY_TOKEN: "test-verify-token",
    META_APP_SECRET: appSecret,
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-number-id",
    STAFF_API_TOKEN: "test-staff-token",
    ...overrides,
  });
}

class FakeWhatsAppGateway implements WhatsAppGateway {
  readonly sent: Array<{
    to: string;
    body: string;
    replyToMessageId?: string;
  }> = [];
  readonly markedRead: string[] = [];
  readonly downloadedMedia: string[] = [];
  readonly uploadedAudio: Array<{
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }> = [];
  readonly sentAudio: Array<{
    to: string;
    mediaId: string;
    replyToMessageId?: string;
  }> = [];
  readonly sentLists: Array<{
    to: string;
    list: WhatsAppListMessage;
    replyToMessageId?: string;
  }> = [];
  readonly sentButtons: Array<{
    to: string;
    message: WhatsAppButtonMessage;
    replyToMessageId?: string;
  }> = [];
  sendAttempts = 0;
  failuresRemaining = 0;
  failOnAttempt: number | undefined;
  media: WhatsAppMedia = {
    bytes: new TextEncoder().encode("audio"),
    mimeType: "audio/ogg",
  };

  async downloadMedia(mediaId: string): Promise<WhatsAppMedia> {
    this.downloadedMedia.push(mediaId);
    return this.media;
  }

  async markRead(messageId: string): Promise<void> {
    this.markedRead.push(messageId);
  }

  async uploadAudio(input: {
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }) {
    this.uploadedAudio.push(input);
    return { mediaId: `uploaded-${this.uploadedAudio.length}` };
  }

  async sendText(input: {
    to: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    this.sendAttempts += 1;
    if (
      this.failuresRemaining > 0 ||
      this.failOnAttempt === this.sendAttempts
    ) {
      this.failuresRemaining -= 1;
      this.failOnAttempt = undefined;
      throw new Error("Temporary Meta failure");
    }
    this.sent.push(input);
    return { messageIds: [`outbound-${this.sendAttempts}`] };
  }

  async sendAudio(input: {
    to: string;
    mediaId: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    this.sendAttempts += 1;
    if (
      this.failuresRemaining > 0 ||
      this.failOnAttempt === this.sendAttempts
    ) {
      this.failuresRemaining -= 1;
      this.failOnAttempt = undefined;
      throw new Error("Temporary Meta failure");
    }
    this.sentAudio.push(input);
    return { messageIds: [`outbound-${this.sendAttempts}`] };
  }

  async sendList(input: {
    to: string;
    list: WhatsAppListMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    this.sendAttempts += 1;
    if (
      this.failuresRemaining > 0 ||
      this.failOnAttempt === this.sendAttempts
    ) {
      this.failuresRemaining -= 1;
      this.failOnAttempt = undefined;
      throw new Error("Temporary Meta failure");
    }
    this.sentLists.push(input);
    return { messageIds: [`outbound-${this.sendAttempts}`] };
  }

  async sendButtons(input: {
    to: string;
    message: WhatsAppButtonMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    this.sendAttempts += 1;
    if (
      this.failuresRemaining > 0 ||
      this.failOnAttempt === this.sendAttempts
    ) {
      this.failuresRemaining -= 1;
      this.failOnAttempt = undefined;
      throw new Error("Temporary Meta failure");
    }
    this.sentButtons.push(input);
    return { messageIds: [`outbound-${this.sendAttempts}`] };
  }
}

class FakeSpeechTranscriber implements SpeechTranscriber {
  readonly providerName = "fake-speech";
  readonly inputs: Array<{ bytes: Uint8Array; mimeType: string }> = [];

  async transcribe(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<SpeechTranscription> {
    this.inputs.push(input);
    return {
      text: "How should books be organized?",
      language: "en",
    };
  }
}

class FakeSpeechSynthesizer implements SpeechSynthesizer {
  readonly providerName = "fake-tts";
  readonly inputs: Array<{ text: string; language: string }> = [];
  failure: Error | undefined;

  async synthesize(input: {
    text: string;
    language: "en" | "sw" | "mixed" | "unknown";
  }): Promise<SynthesizedSpeech> {
    this.inputs.push(input);
    if (this.failure) {
      throw this.failure;
    }
    return {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
      fileName: "answer.ogg",
    };
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("WhatsApp webhook", () => {
  it("completes Meta callback verification", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345",
    });
    const rejected = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("12345");
    expect(rejected.statusCode).toBe(403);
  });

  it("rejects an invalid webhook signature", async () => {
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: new FakeWhatsAppGateway(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=wrong",
      },
      payload: JSON.stringify(textPayload("message-1")),
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for malformed JSON and acknowledges unknown signed events", async () => {
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: new FakeWhatsAppGateway(),
    });
    const malformedBody = '{"object":';
    const malformedSignature = createHmac("sha256", appSecret)
      .update(malformedBody)
      .digest("hex");
    const malformed = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${malformedSignature}`,
      },
      payload: malformedBody,
    });
    const unknown = await injectWebhook(app, {
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1" }],
    });
    await app.close();

    expect(malformed.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ status: "ignored" });
  });

  it("answers a signed inbound text message with citations", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(app, textPayload("message-2"));
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.markedRead).toEqual(["message-2"]);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]).toMatchObject({
      to: "254700000001",
      replyToMessageId: "message-2",
    });
    expect(gateway.sent[0]?.body).toContain("Sources:");
    expect(gateway.sent[0]?.body).toContain("Organizing and Arranging Books");
  });

  it("validates signatures over the exact UTF-8 body", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-unicode", "Ninawezaje kupanga vitabu? 📚"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent.length + gateway.sentButtons.length).toBe(1);
  });

  it("does not resend a completed duplicate delivery", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const payload = textPayload("message-3");

    const first = await injectWebhook(app, payload);
    const duplicate = await injectWebhook(app, payload);
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
  });

  it("handles multiple messages and statuses in one callback", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const payload = messagePayload({
      from: "254700000001",
      id: "message-multi-1",
      timestamp: "1789460000",
      type: "text",
      text: { body: "How should books be organized?" },
    });
    const value = payload.entry[0]?.changes[0]?.value;
    value?.messages.push({
      from: "254700000002",
      id: "message-multi-2",
      timestamp: "1789460001",
      type: "text",
      text: { body: "How should books be organized?" },
    });
    Object.assign(value ?? {}, {
      statuses: [
        {
          id: "outbound-prior",
          status: "delivered",
          timestamp: "1789460001",
        },
      ],
    });

    const response = await injectWebhook(app, payload);
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ messages: 2, statuses: 1 });
    expect(gateway.sent).toHaveLength(2);
  });

  it("processes messages from the same sender in callback order", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const payload = textPayload("message-ordered-1");
    payload.entry[0]?.changes[0]?.value.messages.push({
      from: "254700000001",
      id: "message-ordered-2",
      timestamp: "1789460001",
      type: "text",
      text: { body: "I need a human" },
    });

    const response = await injectWebhook(app, payload);
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[0]?.replyToMessageId).toBe("message-ordered-1");
    expect(gateway.sent[1]?.replyToMessageId).toBe("message-ordered-2");
    expect(gateway.sent[1]?.body).toContain("SAL staff");
  });

  it("serializes separate concurrent callbacks from the same sender", async () => {
    const gateway = new FakeWhatsAppGateway();
    let markStarted: () => void = () => undefined;
    let releaseModel: () => void = () => undefined;
    const modelStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const modelGate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const languageModel: LanguageModelGateway = {
      deploymentName: "delayed-model",
      async generateSupportResponse(_input: LanguageModelInput) {
        markStarted();
        await modelGate;
        return {
          intent: "guide_answer",
          language: "en",
          response: "Delayed grounded answer.",
          citedChunkIds: ["sal-6ad9f66d2582"],
          reason: null,
        };
      },
    };
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
      languageModel,
    });

    const question = injectWebhook(app, textPayload("message-concurrent-1"));
    await modelStarted;
    const handoff = injectWebhook(
      app,
      textPayload("message-concurrent-2", "I need a human"),
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    releaseModel();
    const [questionResponse, handoffResponse] = await Promise.all([
      question,
      handoff,
    ]);
    await app.close();

    expect(questionResponse.statusCode).toBe(200);
    expect(handoffResponse.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[0]?.replyToMessageId).toBe("message-concurrent-1");
    expect(gateway.sent[1]?.replyToMessageId).toBe("message-concurrent-2");
  });

  it("retries a stored response without regenerating it after send failure", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failuresRemaining = 1;
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const payload = textPayload("message-4");

    const failed = await injectWebhook(app, payload);
    const retried = await injectWebhook(app, payload);
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
    expect(gateway.sendAttempts).toBe(2);
    expect(gateway.sent).toHaveLength(1);
  });

  it("suppresses an old failed bot response after human handoff begins", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failuresRemaining = 1;
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const original = textPayload("message-old-answer");

    const failed = await injectWebhook(app, original);
    const handoff = await injectWebhook(
      app,
      textPayload("message-new-handoff", "I need a human"),
    );
    const oldRetry = await injectWebhook(app, original);
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(handoff.statusCode).toBe(200);
    expect(oldRetry.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.replyToMessageId).toBe("message-new-handoff");
  });

  it("recovers a message interrupted before its delivery was prepared", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app, assistant, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const message = {
      externalMessageId: "message-recovery",
      externalUserId: "254700000001",
      type: "text" as const,
      text: "How should books be organized?",
      receivedAt: new Date().toISOString(),
    };
    expect(store.beginWhatsAppProcessing(message.externalMessageId)).toBe("new");
    await assistant.process(message);
    store.markWhatsAppProcessingFailed(
      message.externalMessageId,
      "Simulated interruption",
    );

    const response = await injectWebhook(
      app,
      textPayload(message.externalMessageId, message.text),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
  });

  it("recovers a handoff interrupted before its delivery was prepared", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app, assistant, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const message = {
      externalMessageId: "message-handoff-recovery",
      externalUserId: "254700000001",
      type: "text" as const,
      text: "I want to speak with staff",
      receivedAt: new Date().toISOString(),
    };
    expect(store.beginWhatsAppProcessing(message.externalMessageId)).toBe("new");
    const result = await assistant.process(message);
    expect(result.status).toBe("handoff");
    store.markWhatsAppProcessingFailed(
      message.externalMessageId,
      "Interrupted before delivery preparation",
    );

    const response = await injectWebhook(
      app,
      textPayload(message.externalMessageId, message.text),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.body).toContain("SAL staff");
    expect(gateway.sent[0]?.body).toContain("BOT");
  });

  it("does not replay a handoff for a reclaimed follow-up message", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app, assistant, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    await injectWebhook(
      app,
      textPayload("message-existing-handoff", "I want to speak with staff"),
    );
    const followUp = {
      externalMessageId: "message-handoff-follow-up",
      externalUserId: "254700000001",
      type: "text" as const,
      text: "Are you there?",
      receivedAt: new Date().toISOString(),
    };
    expect(store.beginWhatsAppProcessing(followUp.externalMessageId)).toBe(
      "new",
    );
    expect((await assistant.process(followUp)).status).toBe("human_active");
    store.markWhatsAppProcessingFailed(
      followUp.externalMessageId,
      "Interrupted before suppression completed",
    );

    const response = await injectWebhook(
      app,
      textPayload(followUp.externalMessageId, followUp.text),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.replyToMessageId).toBe(
      "message-existing-handoff",
    );
  });

  it("does not reopen a cancelled handoff from a reclaimed follow-up", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app, assistant, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    await injectWebhook(
      app,
      textPayload("message-follow-up-handoff", "I want to speak with staff"),
    );
    const followUp = {
      externalMessageId: "message-follow-up-request-again",
      externalUserId: "254700000001",
      type: "text" as const,
      text: "I still need to speak with staff",
      receivedAt: new Date().toISOString(),
    };
    expect(store.beginWhatsAppProcessing(followUp.externalMessageId)).toBe(
      "new",
    );
    expect((await assistant.process(followUp)).status).toBe("human_active");
    store.markWhatsAppProcessingFailed(
      followUp.externalMessageId,
      "Interrupted before suppression completed",
    );
    await injectWebhook(
      app,
      textPayload("message-cancel-before-follow-up-retry", "BOT"),
    );

    const retry = await injectWebhook(
      app,
      textPayload(followUp.externalMessageId, followUp.text),
    );
    const humanActive = store.isHumanActiveForUser(followUp.externalUserId);
    await app.close();

    expect(retry.statusCode).toBe(200);
    expect(humanActive).toBe(false);
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[1]?.replyToMessageId).toBe(
      "message-cancel-before-follow-up-retry",
    );
  });

  it("does not reopen a cancelled handoff when its old message is retried", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app, assistant, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const handoffMessage = {
      externalMessageId: "message-cancelled-handoff",
      externalUserId: "254700000001",
      type: "text" as const,
      text: "I want to speak with staff",
      receivedAt: new Date().toISOString(),
    };
    expect(
      store.beginWhatsAppProcessing(handoffMessage.externalMessageId),
    ).toBe("new");
    expect((await assistant.process(handoffMessage)).status).toBe("handoff");
    store.markWhatsAppProcessingFailed(
      handoffMessage.externalMessageId,
      "Interrupted before delivery preparation",
    );
    await injectWebhook(
      app,
      textPayload("message-cancel-handoff-with-bot", "BOT"),
    );

    const response = await injectWebhook(
      app,
      textPayload(
        handoffMessage.externalMessageId,
        handoffMessage.text,
      ),
    );
    const humanActive = store.isHumanActiveForUser(
      handoffMessage.externalUserId,
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(humanActive).toBe(false);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.replyToMessageId).toBe(
      "message-cancel-handoff-with-bot",
    );
  });

  it("does not resend a prepared handoff confirmation after BOT", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failuresRemaining = 1;
    const { app, store } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const handoffPayload = textPayload(
      "message-prepared-cancelled-handoff",
      "I want to speak with staff",
    );
    const failedHandoff = await injectWebhook(app, handoffPayload);
    const botResponse = await injectWebhook(
      app,
      textPayload("message-cancel-prepared-handoff", "BOT"),
    );
    const staleRetry = await injectWebhook(app, handoffPayload);
    const humanActive = store.isHumanActiveForUser("254700000001");
    await app.close();

    expect(failedHandoff.statusCode).toBe(503);
    expect(botResponse.statusCode).toBe(200);
    expect(staleRetry.statusCode).toBe(200);
    expect(humanActive).toBe(false);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.replyToMessageId).toBe(
      "message-cancel-prepared-handoff",
    );
  });

  it("shows optional topic shortcuts for a standalone greeting", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-greeting-menu", "Hello"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentButtons).toHaveLength(1);
    expect(gateway.sentButtons[0]?.message.body).toContain(
      "Start A Library support assistant",
    );
    expect(gateway.sentButtons[0]?.message.buttons).toEqual([
      { id: "topic:en:arrange-books", title: "Arrange books" },
      { id: "topic:en:start-library", title: "Start a library" },
      { id: "menu:en:topics", title: "More topics" },
    ]);
    expect(gateway.sent).toHaveLength(0);
  });

  it("answers a greeting with a question without showing shortcuts", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload(
        "message-greeting-question",
        "Hi, how should books be organized?",
      ),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentButtons).toHaveLength(0);
    expect(gateway.sent[0]?.body).toContain("Organizing and Arranging Books");
  });

  it("opens the full topic list and answers a selected topic", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    await injectWebhook(
      app,
      interactivePayload("message-more-topics", "menu:en:topics"),
    );
    await injectWebhook(
      app,
      interactivePayload(
        "message-arrange-topic",
        "topic:en:arrange-books",
      ),
    );
    await app.close();

    expect(gateway.sentLists).toHaveLength(1);
    expect(gateway.sentLists[0]?.list.body).toContain("type any question");
    expect(gateway.sentLists[0]?.list.sections[0]?.rows).toHaveLength(7);
    expect(gateway.sent[0]?.body).toContain("Sources:");
  });

  it("reopens topic shortcuts through a typed command", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-topics-command", "TOPICS"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentButtons).toHaveLength(1);
    expect(gateway.sentButtons[0]?.message.buttons).toHaveLength(3);
  });

  it("falls back to text when topic buttons cannot be sent", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failOnAttempt = 1;
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-topic-fallback", "Hello"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentButtons).toHaveLength(0);
    expect(gateway.sent[0]?.body).toContain(
      "Start A Library support assistant",
    );
    expect(gateway.sent[0]?.body).toContain("type any question");
  });

  it("offers clarification choices and hands off only after staff is selected", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const clarification = await injectWebhook(
      app,
      textPayload("message-clarify-first", "What is the weather today?"),
    );
    const handoff = await injectWebhook(
      app,
      interactivePayload(
        "message-clarify-staff",
        "action:en:request-staff",
      ),
    );
    await app.close();

    expect(clarification.statusCode).toBe(200);
    expect(gateway.sentButtons).toHaveLength(1);
    expect(gateway.sentButtons[0]?.message.body).toContain("rephrase");
    expect(gateway.sentButtons[0]?.message.buttons).toEqual([
      { id: "menu:en:topics", title: "Popular topics" },
      { id: "action:en:request-staff", title: "Talk to staff" },
    ]);
    expect(handoff.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.body).toContain("SAL staff member");
    expect(gateway.sent[0]?.body).toContain("Reply BOT");
  });

  it("uses a short farewell after a full WhatsApp closing response", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    await injectWebhook(
      app,
      textPayload("message-closing-thanks", "Thank you for your help"),
    );
    await injectWebhook(
      app,
      textPayload("message-closing-bye", "Bye"),
    );
    await app.close();

    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[0]?.body).toContain("glad I could help");
    expect(gateway.sent[1]?.body).toBe("Goodbye!");
    expect(gateway.sentButtons).toHaveLength(0);
  });

  it("downloads and transcribes an inbound voice note", async () => {
    const gateway = new FakeWhatsAppGateway();
    const transcriber = new FakeSpeechTranscriber();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
      speechTranscriber: transcriber,
    });

    const response = await injectWebhook(app, audioPayload("message-5"));
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.downloadedMedia).toEqual(["media-1"]);
    expect(transcriber.inputs).toHaveLength(1);
    expect(gateway.sent[0]?.body).toContain("Organizing and Arranging Books");
  });

  it("answers the first voice note with audio, sources, and a preference list", async () => {
    const gateway = new FakeWhatsAppGateway();
    const transcriber = new FakeSpeechTranscriber();
    const synthesizer = new FakeSpeechSynthesizer();
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: transcriber,
        speechSynthesizer: synthesizer,
      },
    );

    const response = await injectWebhook(
      app,
      audioPayload("message-voice-reply"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(synthesizer.inputs).toHaveLength(1);
    expect(gateway.uploadedAudio).toHaveLength(1);
    expect(gateway.sentAudio).toEqual([
      {
        to: "254700000001",
        mediaId: "uploaded-1",
        replyToMessageId: "message-voice-reply",
      },
    ]);
    expect(gateway.sent[0]?.body).toContain("Sources:");
    expect(gateway.sentLists).toHaveLength(1);
    expect(gateway.sentLists[0]?.list.sections[0]?.rows).toHaveLength(4);
  });

  it("offers the preference list only once for automatic voice replies", async () => {
    const gateway = new FakeWhatsAppGateway();
    const synthesizer = new FakeSpeechSynthesizer();
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: new FakeSpeechTranscriber(),
        speechSynthesizer: synthesizer,
      },
    );

    await injectWebhook(app, audioPayload("message-voice-first"));
    await injectWebhook(app, audioPayload("message-voice-second"));
    await app.close();

    expect(gateway.sentAudio).toHaveLength(2);
    expect(gateway.sentLists).toHaveLength(1);
  });

  it("applies an interactive text preference to later voice questions", async () => {
    const gateway = new FakeWhatsAppGateway();
    const synthesizer = new FakeSpeechSynthesizer();
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: new FakeSpeechTranscriber(),
        speechSynthesizer: synthesizer,
      },
    );

    const selected = await injectWebhook(
      app,
      interactivePayload("message-preference-text", "preference:en:text"),
    );
    const answered = await injectWebhook(
      app,
      audioPayload("message-after-text-preference"),
    );
    await app.close();

    expect(selected.statusCode).toBe(200);
    expect(answered.statusCode).toBe(200);
    expect(gateway.sent[0]?.body).toContain("preference is now Text");
    expect(gateway.sent[1]?.body).toContain("Sources:");
    expect(gateway.sentAudio).toHaveLength(0);
    expect(synthesizer.inputs).toHaveLength(0);
  });

  it("opens preference settings through a typed command", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-settings", "SETTINGS"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentLists).toHaveLength(1);
    expect(gateway.sent).toHaveLength(0);
  });

  it("reuses uploaded audio when an outbound voice send is retried", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failuresRemaining = 1;
    const synthesizer = new FakeSpeechSynthesizer();
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: new FakeSpeechTranscriber(),
        speechSynthesizer: synthesizer,
      },
    );
    const payload = audioPayload("message-audio-retry");

    const failed = await injectWebhook(app, payload);
    const retried = await injectWebhook(app, payload);
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
    expect(synthesizer.inputs).toHaveLength(1);
    expect(gateway.uploadedAudio).toHaveLength(1);
    expect(gateway.sentAudio).toHaveLength(1);
  });

  it("does not resend audio when a later source message is retried", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failOnAttempt = 2;
    const synthesizer = new FakeSpeechSynthesizer();
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: new FakeSpeechTranscriber(),
        speechSynthesizer: synthesizer,
      },
    );
    const payload = audioPayload("message-source-retry");

    const failed = await injectWebhook(app, payload);
    const retried = await injectWebhook(app, payload);
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
    expect(gateway.sentAudio).toHaveLength(1);
    expect(gateway.uploadedAudio).toHaveLength(1);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sentLists).toHaveLength(1);
  });

  it("falls back to typed preference choices when the list cannot be sent", async () => {
    const gateway = new FakeWhatsAppGateway();
    gateway.failuresRemaining = 1;
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(
      app,
      textPayload("message-settings-fallback", "SETTINGS"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentLists).toHaveLength(0);
    expect(gateway.sent[0]?.body).toContain("AUTO, TEXT, VOICE, or BOTH");
  });

  it("falls back to the full text answer when speech synthesis fails", async () => {
    const gateway = new FakeWhatsAppGateway();
    const synthesizer = new FakeSpeechSynthesizer();
    synthesizer.failure = new Error("TTS unavailable");
    const { app } = await buildApp(
      whatsAppConfig({
        VOICE_REPLIES_ENABLED: "true",
        AZURE_TTS_ENDPOINT: "https://tts.example",
        AZURE_SPEECH_KEY: "speech-key",
      }),
      {
        whatsAppGateway: gateway,
        speechTranscriber: new FakeSpeechTranscriber(),
        speechSynthesizer: synthesizer,
      },
    );

    const response = await injectWebhook(
      app,
      audioPayload("message-tts-fallback"),
    );
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sentAudio).toHaveLength(0);
    expect(gateway.sent[0]?.body).toContain("Sources:");
  });

  it("acknowledges delivery statuses without sending a message", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    const response = await injectWebhook(app, statusPayload());
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ messages: 0, statuses: 1 });
    expect(gateway.sent).toHaveLength(0);
  });

  it("skips callbacks for a different configured phone number", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    const payload = textPayload("message-other-phone");
    const metadata = payload.entry[0]?.changes[0]?.value.metadata;
    if (metadata) {
      metadata.phone_number_id = "other-phone-number-id";
    }

    const response = await injectWebhook(app, payload);
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(0);
    expect(gateway.markedRead).toHaveLength(0);
  });

  it("does not send unsupported-message fallbacks during human handoff", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    await injectWebhook(app, textPayload("message-handoff", "I need a human"));
    const unsupported = await injectWebhook(
      app,
      messagePayload({
        from: "254700000001",
        id: "message-sticker",
        timestamp: "1789460002",
        type: "sticker",
        sticker: { id: "sticker-1" },
      }),
    );
    const audio = await injectWebhook(app, audioPayload("message-human-audio"));
    await app.close();

    expect(unsupported.statusCode).toBe(200);
    expect(audio.statusCode).toBe(200);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.downloadedMedia).toHaveLength(0);
  });

  it("returns a handed-off user to chatbot control through the staff API", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    await injectWebhook(app, textPayload("message-6", "I need a human"));
    const reset = await app.inject({
      method: "POST",
      url: "/api/staff/conversations/reset",
      headers: {
        authorization: "Bearer test-staff-token",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ externalUserId: "254700000001" }),
    });
    await injectWebhook(
      app,
      textPayload("message-7", "How should books be organized?"),
    );
    await app.close();

    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ resetConversations: 1 });
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[1]?.body).toContain("Organizing and Arranging Books");
  });

  it("cancels handoff and resumes chatbot control when the user sends BOT", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });

    await injectWebhook(app, textPayload("message-bot-resume-1", "I need a human"));
    await injectWebhook(app, textPayload("message-bot-resume-2", "BOT"));
    await injectWebhook(
      app,
      textPayload("message-bot-resume-3", "How should books be organized?"),
    );
    await app.close();

    expect(gateway.sent).toHaveLength(3);
    expect(gateway.sent[1]?.body).toContain("handoff has been cancelled");
    expect(gateway.sent[2]?.body).toContain("Organizing and Arranging Books");
  });

  it("rejects staff reset requests with an invalid bearer token", async () => {
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: new FakeWhatsAppGateway(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/staff/conversations/reset",
      headers: {
        authorization: "Bearer wrong-token",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ externalUserId: "254700000001" }),
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });

  it("reports privacy-safe WhatsApp diagnostics to authorized staff", async () => {
    const gateway = new FakeWhatsAppGateway();
    const { app } = await buildApp(whatsAppConfig(), {
      whatsAppGateway: gateway,
    });
    await injectWebhook(app, textPayload("message-diagnostics"));

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/staff/diagnostics",
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/staff/diagnostics",
      headers: { authorization: "Bearer test-staff-token" },
    });
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      messages: { inbound: 1, outbound: 1 },
      deliveries: { sent: 1 },
      deliveryAttempts: 1,
      recentFailures: {
        deliveries: [],
        auditEvents: [],
      },
    });
    expect(response.body).not.toContain("254700000001");
    expect(response.body).not.toContain("How should books be organized?");
  });
});

async function injectWebhook(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  payload: unknown,
) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", appSecret).update(body).digest("hex");
  return app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    payload: body,
  });
}

function textPayload(
  messageId: string,
  body = "How should books be organized?",
) {
  return messagePayload({
    from: "254700000001",
    id: messageId,
    timestamp: "1789460000",
    type: "text",
    text: { body },
  });
}

function audioPayload(messageId: string) {
  return messagePayload({
    from: "254700000001",
    id: messageId,
    timestamp: "1789460000",
    type: "audio",
    audio: {
      id: "media-1",
      mime_type: "audio/ogg",
      voice: true,
    },
  });
}

function interactivePayload(messageId: string, selectionId: string) {
  return messagePayload({
    from: "254700000001",
    id: messageId,
    timestamp: "1789460000",
    type: "interactive",
    interactive: {
      type: "list_reply",
      list_reply: {
        id: selectionId,
        title: "Text",
      },
    },
  });
}

function messagePayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: "phone-number-id",
              },
              contacts: [{ wa_id: "254700000001" }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "phone-number-id" },
              statuses: [
                {
                  id: "outbound-1",
                  status: "delivered",
                  timestamp: "1789460001",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
