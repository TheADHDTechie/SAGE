import type {
  SupportMessage,
  SupportResponse,
  SupportedLanguage,
} from "../domain/types.js";
import type { LanguageModelGateway } from "../gateways/language-model.js";
import type { ConversationStore } from "../infrastructure/database.js";
import type { ManualRepository } from "../knowledge/manual-repository.js";
import {
  isFullClosingResponse,
  routeByPolicy,
} from "../policy/policy-router.js";

const humanActiveResponses: Record<"en" | "sw", string> = {
  en: "A SAL staff member is handling this conversation and can reply here.",
  sw: "Mfanyakazi wa SAL anashughulikia mazungumzo haya na anaweza kujibu hapa.",
};

const clarificationResponses: Record<
  "en" | "sw",
  { first: string; repeat: string; serviceFailure: string }
> = {
  en: {
    first:
      "I couldn't match that question to information in the SAL school-library guide. Please rephrase it as a question about setting up or running a school library. For example: \"How should I arrange books?\" or \"How do I manage book borrowing?\"\n\nYou can also type STAFF or HUMAN if you would like help from a SAL staff member.",
    repeat:
      "I still couldn't find that in the SAL guide. Try another school-library question, choose a common topic, or type STAFF to speak with SAL.",
    serviceFailure:
      "SAGE is temporarily unable to check the SAL guide. Please try again shortly, choose a common topic, or type STAFF to speak with SAL.",
  },
  sw: {
    first:
      "Sikuweza kulinganisha swali hilo na maelezo katika mwongozo wa SAL wa maktaba za shule. Tafadhali liulize tena kuhusu kuanzisha au kuendesha maktaba ya shule. Kwa mfano: \"Nipangeje vitabu?\" au \"Nisimamieje kuazima vitabu?\"\n\nUnaweza pia kuandika MFANYAKAZI au HUMAN kupata msaada wa mfanyakazi wa SAL.",
    repeat:
      "Bado sikuweza kupata jibu hilo katika mwongozo wa SAL. Jaribu swali lingine kuhusu maktaba ya shule, chagua mada, au andika MFANYAKAZI kuzungumza na SAL.",
    serviceFailure:
      "SAGE haiwezi kuangalia mwongozo wa SAL kwa muda. Tafadhali jaribu tena baadaye kidogo, chagua mada, au andika MFANYAKAZI kuzungumza na SAL.",
  },
};

const handoffReturnInstructions: Record<"en" | "sw", string> = {
  en: "Reply BOT at any time to cancel the handoff and return to SAGE.",
  sw: "Jibu BOT wakati wowote ili kusitisha uhamisho na kurudi kwa SAGE.",
};

export class SupportAssistant {
  constructor(
    private readonly manual: ManualRepository,
    private readonly store: ConversationStore,
    private readonly languageModel: LanguageModelGateway,
  ) {}

  async process(
    message: SupportMessage,
    options: { allowDuplicate?: boolean } = {},
  ): Promise<SupportResponse> {
    const inbound = this.store.beginInbound(message);
    if (inbound.duplicate && !options.allowDuplicate) {
      return {
        status: "duplicate",
        conversationId: inbound.conversationId,
      };
    }

    const policy = routeByPolicy(message.text);
    const responseLanguage = baseLanguage(policy.language);

    if (policy.action === "resume") {
      if (
        inbound.status === "waiting_for_human" ||
        inbound.status === "human"
      ) {
        this.store.resetConversationForUser(message.externalUserId);
      }
      this.store.recordAssistantMessage({
        conversationId: inbound.conversationId,
        content: policy.response,
        language: policy.language,
      });
      return {
        status: "answered",
        conversationId: inbound.conversationId,
        language: policy.language,
        answer: policy.response,
        citations: [],
      };
    }

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

    if (policy.action === "respond") {
      const response =
        policy.socialIntent === "closing" &&
        policy.closingStyle === "farewell" &&
        policy.briefResponse &&
        this.previousAssistantMessageWasClosing(inbound.conversationId)
          ? policy.briefResponse
          : policy.response;
      this.store.clearClarification(inbound.conversationId);
      this.store.recordAssistantMessage({
        conversationId: inbound.conversationId,
        content: response,
        language: policy.language,
      });
      return {
        status: "answered",
        conversationId: inbound.conversationId,
        language: policy.language,
        answer: response,
        citations: [],
        ...(policy.socialIntent === "greeting"
          ? { presentation: "topic_shortcuts" as const }
          : {}),
      };
    }

    if (policy.action === "clarify") {
      return this.clarify(
        inbound.conversationId,
        policy.language,
        policy.reason,
      );
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
      return this.clarify(
        inbound.conversationId,
        policy.language,
        "language_model_failure",
        true,
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
      return this.clarify(
        inbound.conversationId,
        result.language,
        result.handoffReason ?? "manual_content_insufficient",
      );
    }

    const citations = this.manual.citations(result.citedChunkIds);
    this.store.clearClarification(inbound.conversationId);
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

  private clarify(
    conversationId: string,
    language: SupportedLanguage,
    reason: string,
    serviceFailure = false,
  ): SupportResponse {
    const responseLanguage = baseLanguage(language);
    const state = this.store.recordClarification(conversationId, reason);
    const responses = clarificationResponses[responseLanguage];
    const response = serviceFailure
      ? responses.serviceFailure
      : state.attempts === 1
        ? responses.first
        : responses.repeat;
    this.store.recordAssistantMessage({
      conversationId,
      content: response,
      language,
    });
    return {
      status: "answered",
      conversationId,
      language,
      answer: response,
      citations: [],
      presentation: "staff_options",
    };
  }

  private handoff(
    conversationId: string,
    language: SupportedLanguage,
    reason: string,
    response: string,
  ): SupportResponse {
    const handoffResponse = `${response}\n\n${handoffReturnInstructions[baseLanguage(language)]}`;
    this.store.createHandoff(conversationId, reason);
    this.store.recordAssistantMessage({
      conversationId,
      content: handoffResponse,
      language,
    });
    return {
      status: "handoff",
      conversationId,
      language,
      answer: handoffResponse,
      reason,
    };
  }

  private previousAssistantMessageWasClosing(conversationId: string) {
    const recentMessages = this.store.recentMessages(conversationId);
    const previousMessage = recentMessages.findLast(
      (message) => message.senderType === "assistant",
    );
    return (
      previousMessage !== undefined &&
      isFullClosingResponse(previousMessage.content)
    );
  }
}

function baseLanguage(language: SupportedLanguage): "en" | "sw" {
  return language === "sw" ? "sw" : "en";
}
