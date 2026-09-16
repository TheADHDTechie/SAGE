import type {
  SupportMessage,
  SupportResponse,
  SupportedLanguage,
} from "../domain/types.js";
import {
  type LanguageModelGateway,
  parseSupportModelResult,
} from "../gateways/language-model.js";
import type { ConversationStore } from "../infrastructure/database.js";
import type { ManualRepository } from "../knowledge/manual-repository.js";
import { routeByPolicy } from "../policy/policy-router.js";

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

    if (policy.action === "handoff") {
      return this.handoff(
        inbound.conversationId,
        policy.language,
        policy.reason,
        policy.response,
        message.externalMessageId,
      );
    }

    let modelOutput;
    try {
      modelOutput = await this.languageModel.generateSupportResponse({
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

    let result;
    try {
      result = parseSupportModelResult(modelOutput);
    } catch (error) {
      this.store.recordAuditEvent({
        conversationId: inbound.conversationId,
        eventType: "language_model_validation_failure",
        details: {
          deployment: this.languageModel.deploymentName,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      return this.clarify(
        inbound.conversationId,
        policy.language,
        "invalid_model_intent",
      );
    }

    if (result.intent === "greeting") {
      return this.answerWithoutCitations(
        inbound.conversationId,
        result.language,
        result.response,
        "topic_shortcuts",
      );
    }

    if (result.intent === "closing") {
      return this.answerWithoutCitations(
        inbound.conversationId,
        result.language,
        result.response,
      );
    }

    if (result.intent === "clarify_scope") {
      return this.clarifyWithResponse(
        inbound.conversationId,
        result.language,
        result.reason ?? "manual_content_insufficient",
        result.response,
      );
    }

    if (result.intent === "request_human") {
      return this.handoff(
        inbound.conversationId,
        result.language,
        result.reason ?? "user_requested_human",
        result.response,
        message.externalMessageId,
      );
    }

    const citationsValid =
      result.citedChunkIds.length > 0 &&
      result.citedChunkIds.every((id) => this.manual.hasChunk(id));
    if (!citationsValid) {
      this.store.recordAuditEvent({
        conversationId: inbound.conversationId,
        eventType: "language_model_validation_failure",
        details: {
          deployment: this.languageModel.deploymentName,
          intent: result.intent,
          reason: "invalid_or_missing_citations",
          citedChunkIds: result.citedChunkIds,
        },
      });
      return this.clarify(
        inbound.conversationId,
        result.language,
        "invalid_or_missing_citations",
      );
    }

    const citations = this.manual.citations(result.citedChunkIds);
    this.store.clearClarification(inbound.conversationId);
    this.store.recordAssistantMessage({
      conversationId: inbound.conversationId,
      content: result.response,
      language: result.language,
      citations: result.citedChunkIds,
      modelDeployment: this.languageModel.deploymentName,
    });

    return {
      status: "answered",
      conversationId: inbound.conversationId,
      language: result.language,
      answer: result.response,
      citations,
    };
  }

  private answerWithoutCitations(
    conversationId: string,
    language: SupportedLanguage,
    response: string,
    presentation?: "topic_shortcuts",
  ): SupportResponse {
    this.store.clearClarification(conversationId);
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
      ...(presentation ? { presentation } : {}),
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

  private clarifyWithResponse(
    conversationId: string,
    language: SupportedLanguage,
    reason: string,
    response: string,
  ): SupportResponse {
    this.store.recordClarification(conversationId, reason);
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
    inReplyToExternalMessageId: string,
  ): SupportResponse {
    const handoffResponse = /\bBOT\b/i.test(response)
      ? response
      : `${response}\n\n${handoffReturnInstructions[baseLanguage(language)]}`;
    this.store.createHandoff(conversationId, reason, {
      content: handoffResponse,
      language,
      inReplyToExternalMessageId,
    });
    return {
      status: "handoff",
      conversationId,
      language,
      answer: handoffResponse,
      reason,
    };
  }

}

function baseLanguage(language: SupportedLanguage): "en" | "sw" {
  return language === "sw" ? "sw" : "en";
}
