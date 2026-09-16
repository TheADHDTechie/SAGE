import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SupportAssistant } from "../src/application/support-assistant.js";
import type { SupportModelResult } from "../src/domain/types.js";
import type {
  LanguageModelGateway,
  LanguageModelInput,
} from "../src/gateways/language-model.js";
import { MockLanguageModelGateway } from "../src/gateways/mock-language-model.js";
import { ConversationStore } from "../src/infrastructure/database.js";
import { ManualRepository } from "../src/knowledge/manual-repository.js";

const temporaryDirectories: string[] = [];

function createContext(languageModel?: LanguageModelGateway) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sal-test-"));
  temporaryDirectories.push(directory);
  const manual = new ManualRepository(
    path.resolve(
      "knowledge-base",
      "sal",
      "data",
      "sal-guide-chunks.jsonl",
    ),
  );
  const store = new ConversationStore(
    path.join(directory, "app.db"),
    "test-contact-hash-key",
  );
  return {
    store,
    assistant: new SupportAssistant(
      manual,
      store,
      languageModel ?? new MockLanguageModelGateway(manual.chunks),
    ),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SupportAssistant", () => {
  it("answers a supported question with a real citation", async () => {
    const { assistant, store } = createContext();

    const result = await assistant.process({
      externalMessageId: "message-1",
      externalUserId: "user-1",
      type: "text",
      text: "How should I set up a child-friendly library space?",
      receivedAt: new Date().toISOString(),
    });
    store.close();

    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations[0]?.chunkId).toBe("sal-0423ac330bdd");
    }
  });

  it("deduplicates an external message ID", async () => {
    const { assistant, store } = createContext();
    const message = {
      externalMessageId: "duplicate-message",
      externalUserId: "user-2",
      type: "text" as const,
      text: "How should books be organized?",
      receivedAt: new Date().toISOString(),
    };

    await assistant.process(message);
    const duplicate = await assistant.process(message);
    store.close();

    expect(duplicate.status).toBe("duplicate");
  });

  it("answers a greeting without calling the language model or creating a handoff", async () => {
    class UnexpectedLanguageModelGateway implements LanguageModelGateway {
      readonly deploymentName = "unexpected-call";

      async answerSupportQuestion(
        _input: LanguageModelInput,
      ): Promise<SupportModelResult> {
        throw new Error("The language model must not be called for greetings");
      }
    }

    const { assistant, store } = createContext(
      new UnexpectedLanguageModelGateway(),
    );
    const result = await assistant.process({
      externalMessageId: "greeting-1",
      externalUserId: "greeting-user",
      type: "text",
      text: "Habari mwalimu",
      receivedAt: new Date().toISOString(),
    });
    const diagnostics = store.whatsAppDiagnostics();
    store.close();

    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.language).toBe("sw");
      expect(result.citations).toEqual([]);
      expect(result.presentation).toBe("topic_shortcuts");
    }
    expect(diagnostics.handoffs).toEqual({});
  });

  it("uses a brief farewell after a full closing response", async () => {
    const { assistant, store } = createContext();

    const thanks = await assistant.process({
      externalMessageId: "closing-1",
      externalUserId: "closing-user",
      type: "text",
      text: "Thank you for your help",
      receivedAt: new Date().toISOString(),
    });
    const goodbye = await assistant.process({
      externalMessageId: "closing-2",
      externalUserId: "closing-user",
      type: "text",
      text: "Bye",
      receivedAt: new Date(Date.now() + 1000).toISOString(),
    });
    const laterQuestion = await assistant.process({
      externalMessageId: "closing-3",
      externalUserId: "closing-user",
      type: "text",
      text: "How should books be organized?",
      receivedAt: new Date(Date.now() + 2000).toISOString(),
    });
    const laterGoodbye = await assistant.process({
      externalMessageId: "closing-4",
      externalUserId: "closing-user",
      type: "text",
      text: "Goodbye",
      receivedAt: new Date(Date.now() + 3000).toISOString(),
    });
    store.close();

    expect(thanks.status).toBe("answered");
    if (thanks.status === "answered") {
      expect(thanks.answer).toContain("glad I could help");
      expect(thanks.presentation).toBeUndefined();
    }
    expect(goodbye.status).toBe("answered");
    if (goodbye.status === "answered") {
      expect(goodbye.answer).toBe("Goodbye!");
    }
    expect(laterQuestion.status).toBe("answered");
    expect(laterGoodbye.status).toBe("answered");
    if (laterGoodbye.status === "answered") {
      expect(laterGoodbye.answer).toContain("glad I could help");
    }
  });

  it("hands off explicit human requests and keeps the bot paused", async () => {
    const { assistant, store } = createContext();

    const handoff = await assistant.process({
      externalMessageId: "human-1",
      externalUserId: "user-3",
      type: "text",
      text: "I want to speak with a staff member",
      receivedAt: new Date().toISOString(),
    });
    const followUp = await assistant.process({
      externalMessageId: "human-2",
      externalUserId: "user-3",
      type: "text",
      text: "Are you there?",
      receivedAt: new Date(Date.now() + 1000).toISOString(),
    });
    store.close();

    expect(handoff.status).toBe("handoff");
    if (handoff.status === "handoff") {
      expect(handoff.answer).toContain("Reply BOT");
    }
    expect(followUp.status).toBe("human_active");
  });

  it("starts a fresh bot conversation after resetting a handed-off user", async () => {
    const { assistant, store } = createContext();

    await assistant.process({
      externalMessageId: "reset-human-1",
      externalUserId: "reset-user",
      type: "text",
      text: "I want to speak with a staff member",
      receivedAt: new Date().toISOString(),
    });

    expect(store.resetConversationForUser("reset-user")).toBe(1);

    const restarted = await assistant.process({
      externalMessageId: "reset-human-2",
      externalUserId: "reset-user",
      type: "text",
      text: "How should I organize library books?",
      receivedAt: new Date(Date.now() + 1000).toISOString(),
    });
    store.close();

    expect(restarted.status).toBe("answered");
  });

  it("cancels an active handoff when the user sends BOT", async () => {
    const { assistant, store } = createContext();

    await assistant.process({
      externalMessageId: "bot-resume-1",
      externalUserId: "bot-resume-user",
      type: "text",
      text: "I want to speak with a staff member",
      receivedAt: new Date().toISOString(),
    });
    const resumed = await assistant.process({
      externalMessageId: "bot-resume-2",
      externalUserId: "bot-resume-user",
      type: "text",
      text: "BOT",
      receivedAt: new Date(Date.now() + 1000).toISOString(),
    });
    const question = await assistant.process({
      externalMessageId: "bot-resume-3",
      externalUserId: "bot-resume-user",
      type: "text",
      text: "How should I organize library books?",
      receivedAt: new Date(Date.now() + 2000).toISOString(),
    });
    store.close();

    expect(resumed.status).toBe("answered");
    if (resumed.status === "answered") {
      expect(resumed.answer).toContain("handoff has been cancelled");
    }
    expect(question.status).toBe("answered");
  });

  it("asks for clarification when the model returns an invalid citation", async () => {
    class InvalidCitationGateway implements LanguageModelGateway {
      readonly deploymentName = "invalid-citation-test";

      async answerSupportQuestion(_input: LanguageModelInput) {
        return {
          language: "en" as const,
          answer: "Unsupported citation",
          supported: true,
          citedChunkIds: ["missing-chunk"],
          requiresHuman: false,
        };
      }
    }

    const { assistant, store } = createContext(new InvalidCitationGateway());
    const result = await assistant.process({
      externalMessageId: "invalid-citation",
      externalUserId: "user-4",
      type: "text",
      text: "Tell me about library rules",
      receivedAt: new Date().toISOString(),
    });
    const state =
      result.status === "answered"
        ? store.clarificationState(result.conversationId)
        : undefined;
    const diagnostics = store.whatsAppDiagnostics();
    store.close();

    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.presentation).toBe("staff_options");
      expect(result.answer).toContain("rephrase");
    }
    expect(state).toMatchObject({
      reason: "manual_content_insufficient",
      attempts: 1,
    });
    expect(diagnostics.handoffs).toEqual({});
  });

  it("tracks repeated clarification and clears it after a supported question", async () => {
    const { assistant, store } = createContext();

    const first = await assistant.process({
      externalMessageId: "clarify-1",
      externalUserId: "clarify-user",
      type: "text",
      text: "What is the weather today?",
      receivedAt: new Date().toISOString(),
    });
    const second = await assistant.process({
      externalMessageId: "clarify-2",
      externalUserId: "clarify-user",
      type: "text",
      text: "What are today's stock prices?",
      receivedAt: new Date(Date.now() + 1000).toISOString(),
    });
    const answered = await assistant.process({
      externalMessageId: "clarify-3",
      externalUserId: "clarify-user",
      type: "text",
      text: "How should books be organized?",
      receivedAt: new Date(Date.now() + 2000).toISOString(),
    });
    const conversationId =
      first.status === "answered" ? first.conversationId : "";
    const state = store.clarificationState(conversationId);
    const diagnostics = store.whatsAppDiagnostics();
    store.close();

    expect(first.status).toBe("answered");
    if (first.status === "answered") {
      expect(first.answer).toContain("rephrase");
      expect(first.presentation).toBe("staff_options");
    }
    expect(second.status).toBe("answered");
    if (second.status === "answered") {
      expect(second.answer).toContain("still couldn't find");
    }
    expect(answered.status).toBe("answered");
    expect(state).toMatchObject({
      reason: null,
      attempts: 0,
      startedAt: null,
    });
    expect(diagnostics.handoffs).toEqual({});
  });

  it("offers retry or staff when the language model is temporarily unavailable", async () => {
    class FailingLanguageModelGateway implements LanguageModelGateway {
      readonly deploymentName = "failing-model";

      async answerSupportQuestion(
        _input: LanguageModelInput,
      ): Promise<SupportModelResult> {
        throw new Error("Temporary model outage");
      }
    }

    const { assistant, store } = createContext(
      new FailingLanguageModelGateway(),
    );
    const result = await assistant.process({
      externalMessageId: "model-failure-1",
      externalUserId: "model-failure-user",
      type: "text",
      text: "How should books be organized?",
      receivedAt: new Date().toISOString(),
    });
    const diagnostics = store.whatsAppDiagnostics();
    store.close();

    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.answer).toContain("temporarily unable");
      expect(result.presentation).toBe("staff_options");
    }
    expect(diagnostics.handoffs).toEqual({});
  });
});
