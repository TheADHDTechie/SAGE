import type {
  SupportMessage,
  SupportResponse,
  SupportedLanguage,
} from "../domain/types.js";
import type { LanguageModelGateway } from "../gateways/language-model.js";
import type { ConversationStore } from "../infrastructure/database.js";
import type { ManualRepository } from "../knowledge/manual-repository.js";
import { routeByPolicy } from "../policy/policy-router.js";

const humanActiveResponses: Record<"en" | "sw", string> = {
  en: "A SAL staff member is handling this conversation and can reply here.",
  sw: "Mfanyakazi wa SAL anashughulikia mazungumzo haya na anaweza kujibu hapa.",
};

const unsupportedResponses: Record<"en" | "sw", string> = {
  en: "I could not confirm that from the SAL guide. I have forwarded your question to a SAL staff member.",
  sw: "Sikuweza kuthibitisha hilo kutoka kwenye mwongozo wa SAL. Nimepeleka swali lako kwa mfanyakazi wa SAL.",
};

export class SupportAssistant {
  constructor(
    private readonly manual: ManualRepository,
    private readonly store: ConversationStore,
    private readonly languageModel: LanguageModelGateway,
  ) {}

  async process(message: SupportMessage): Promise<SupportResponse> {
    const inbound = this.store.beginInbound(message);
    if (inbound.duplicate) {
      return {
        status: "duplicate",
        conversationId: inbound.conversationId,
      };
    }

    const policy = routeByPolicy(message.text);
    const responseLanguage = baseLanguage(policy.language);

    if (
      inbound.status === "waiting_for_human" ||
      inbound.status === "human"
    ) {
      return {
        status: "human_active",
        conversationId: inbound.conversationId,
        language: policy.language,
        answer: humanActiveResponses[responseLanguage],
      };
    }

    if (policy.action === "close") {
      this.store.closeConversation(inbound.conversationId);
      this.store.recordAssistantMessage({
        conversationId: inbound.conversationId,
        content: policy.response,
        language: policy.language,
      });
      return {
        status: "closed",
        conversationId: inbound.conversationId,
        language: policy.language,
        answer: policy.response,
      };
    }

    if (policy.action === "handoff") {
      return this.handoff(
        inbound.conversationId,
        policy.language,
        policy.reason,
        policy.response,
      );
    }

    let result;
    try {
      result = await this.languageModel.answerSupportQuestion({
        question: message.text,
        languageHint: policy.language,
        recentMessages: this.store.recentMessages(inbound.conversationId),
        manualContext: this.manual.context,
      });
    } catch (error) {
      this.store.recordAuditEvent({
        conversationId: inbound.conversationId,
        eventType: "language_model_failure",
        details: {
          deployment: this.languageModel.deploymentName,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      return this.handoff(
        inbound.conversationId,
        policy.language,
        "language_model_failure",
        unsupportedResponses[responseLanguage],
      );
    }

    const citationsValid = result.citedChunkIds.every((id) =>
      this.manual.hasChunk(id),
    );

    if (
      !result.supported ||
      result.requiresHuman ||
      result.citedChunkIds.length === 0 ||
      !citationsValid
    ) {
      const language = baseLanguage(result.language);
      return this.handoff(
        inbound.conversationId,
        result.language,
        result.handoffReason ?? "manual_content_insufficient",
        unsupportedResponses[language],
      );
    }

    const citations = this.manual.citations(result.citedChunkIds);
    this.store.recordAssistantMessage({
      conversationId: inbound.conversationId,
      content: result.answer,
      language: result.language,
      citations: result.citedChunkIds,
      modelDeployment: this.languageModel.deploymentName,
    });

    return {
      status: "answered",
      conversationId: inbound.conversationId,
      language: result.language,
      answer: result.answer,
      citations,
    };
  }

  private handoff(
    conversationId: string,
    language: SupportedLanguage,
    reason: string,
    response: string,
  ): SupportResponse {
    this.store.createHandoff(conversationId, reason);
    this.store.recordAssistantMessage({
      conversationId,
      content: response,
      language,
    });
    return {
      status: "handoff",
      conversationId,
      language,
      answer: response,
      reason,
    };
  }
}

function baseLanguage(language: SupportedLanguage): "en" | "sw" {
  return language === "sw" ? "sw" : "en";
}
