import type { SupportModelResult } from "../domain/types.js";
import type { ManualChunk } from "../knowledge/manual-repository.js";
import type {
  LanguageModelGateway,
  LanguageModelInput,
} from "./language-model.js";

const swahiliTranslations: Record<string, string> = {
  maktaba: "library",
  vitabu: "books",
  kitabu: "book",
  watoto: "learners",
  mtoto: "learner",
  wanafunzi: "learners",
  kupanga: "organize",
  kusoma: "reading",
  hadithi: "story",
  mwalimu: "teacher librarian",
  walimu: "teachers",
  kukopa: "borrowing",
  kurudisha: "returning",
  usalama: "safeguarding",
  kanuni: "rules",
  shelf: "bookshelves",
  shelves: "bookshelves",
  arrange: "arranging",
  arranged: "arranging",
  duties: "responsibilities",
};

export class MockLanguageModelGateway implements LanguageModelGateway {
  readonly deploymentName = "mock-local";

  constructor(private readonly chunks: readonly ManualChunk[]) {}

  async generateSupportResponse(
    input: LanguageModelInput,
  ): Promise<SupportModelResult> {
    const socialResult = classifySocialMessage(input);
    if (socialResult) {
      return socialResult;
    }

    const exactTitle = this.chunks.find((chunk) =>
      input.question.toLowerCase().includes(chunk.title.toLowerCase()),
    );
    const queryTokens = tokens(
      input.question
        .toLowerCase()
        .split(/\s+/)
        .map((word) => swahiliTranslations[word] ?? word)
        .join(" "),
    );

    const ranked = this.chunks
      .map((chunk) => ({
        chunk,
        score: scoreChunk(chunk, queryTokens),
      }))
      .sort((left, right) => right.score - left.score);

    const best = exactTitle
      ? { chunk: exactTitle, score: Number.POSITIVE_INFINITY }
      : ranked[0];
    if (!best || best.score < 4) {
      const repeatedClarification = input.recentMessages.some(
        (message) =>
          message.senderType === "assistant" &&
          (message.content.includes("Please rephrase") ||
            message.content.includes("Tafadhali uliza tena")),
      );
      return {
        intent: "clarify_scope",
        language: input.languageHint,
        response:
          input.languageHint === "sw"
            ? repeatedClarification
              ? "Bado sikuweza kupata hilo katika mwongozo wa SAL. Jaribu swali lingine kuhusu maktaba ya shule, chagua mada, au andika MFANYAKAZI."
              : "SAGE husaidia kuhusu kuanzisha na kuendesha maktaba ya shule. Tafadhali uliza tena kuhusu maktaba, au andika MFANYAKAZI kupata msaada wa SAL."
            : repeatedClarification
              ? "I still couldn't find that in the SAL guide. Try another school-library question, choose a common topic, or type STAFF."
              : "SAGE helps with setting up and running a school library. Please rephrase your message as a school-library question, or type STAFF for help from SAL.",
        citedChunkIds: [],
        reason: "manual_content_insufficient",
      };
    }

    const excerpt = best.chunk.text
      .split(/(?<=[.!?])\s+/)
      .slice(0, 2)
      .join(" ");

    const answer =
      input.languageHint === "sw"
        ? `Mwongozo wa SAL unaeleza kuhusu "${best.chunk.title}". ${excerpt}`
        : `The SAL guide explains "${best.chunk.title}". ${excerpt}`;

    return {
      intent: "guide_answer",
      language: input.languageHint,
      response: answer,
      citedChunkIds: [best.chunk.id],
      reason: null,
    };
  }
}

function classifySocialMessage(
  input: LanguageModelInput,
): SupportModelResult | undefined {
  const message = input.question.trim();
  const normalized = message.toLowerCase();
  const language = input.languageHint === "sw" ? "sw" : "en";
  if (
    /^\s*i\s+(?:want|need|would\s+like)\s+(?:(?:to\s+)?(?:talk|speak|chat)\s+(?:to|with)\s+)?(?:a\s+)?(?:human|person|agent|staff|representative)(?:\s+member)?\s*[!.]*\s*$/i.test(
      message,
    ) ||
    /\b(?:talk|speak|chat|connect|transfer)\b.{0,30}\b(?:human|person|agent|staff|representative)\b/i.test(
      message,
    ) ||
    /\b(?:zungumza|ongea)\b.{0,30}\b(?:mtu|mfanyakazi|afisa)\b/i.test(message)
  ) {
    return {
      intent: "request_human",
      language,
      response:
        language === "sw"
          ? "Nimepeleka mazungumzo haya kwa mfanyakazi wa SAL. Andika BOT ukitaka kurudi kwa SAGE."
          : "I have transferred this conversation to SAL staff. Type BOT if you want to return to SAGE.",
      citedChunkIds: [],
      reason: "user_requested_human",
    };
  }
  const withoutConversationalQuestions = message.replace(
    /\b(?:how are you|who are you|what can you help(?: me)? with|can you help me|habari yako|wewe ni nani|unaweza kusaidia nini)\b/gi,
    " ",
  );
  const substantiveQuestion =
    /\b(?:how|what|when|where|why|which|can|should|do|does|is|are|nini|vipi|je|lini|wapi|kwa nini)\b/i.test(
      withoutConversationalQuestions,
    );
  const substantiveRequest =
    substantiveQuestion ||
    /\b(?:explain|tell me|show me|describe|list|give me|help me (?:with|understand)|arrange|organize|set up|manage|eleza|niambie|nionyeshe|orodhesha|panga|anzisha|simamia)\b/i.test(
      withoutConversationalQuestions,
    );
  if (
    !substantiveRequest &&
    /^(?:thank|thanks|thank you|bye|goodbye|see you|that is all|asante|nashukuru|kwaheri|tutaonana)\b/i.test(
      normalized,
    )
  ) {
    const previousAssistant = input.recentMessages.findLast(
      (recent) => recent.senderType === "assistant",
    );
    const brief =
      /^(?:bye|goodbye|see you|kwaheri|tutaonana)\b/i.test(normalized) &&
      previousAssistant?.content.includes(
        language === "sw" ? "Nimefurahi kukusaidia" : "glad I could help",
      );
    return {
      intent: "closing",
      language,
      response: brief
        ? language === "sw"
          ? "Kwaheri!"
          : "Goodbye!"
        : language === "sw"
          ? "Karibu! Nimefurahi kukusaidia. Unaweza kumtumia SAGE ujumbe wakati wowote ukiwa na swali lingine kuhusu maktaba ya shule."
          : "You're welcome! I'm glad I could help. You can message SAGE anytime if you have another school library question.",
      citedChunkIds: [],
      reason: null,
    };
  }
  if (
    !substantiveRequest &&
    /\b(?:hello|hi|hey|greetings|good morning|good afternoon|good evening|jambo|habari|hujambo|mambo|shikamoo|who are you|what can you help|my name is)\b/i.test(
      message,
    )
  ) {
    return {
      intent: "greeting",
      language,
      response:
        language === "sw"
          ? "Habari! Mimi ni SAGE, msaidizi wa Start A Library. Unaweza kuandika swali au kutuma ujumbe wa sauti kuhusu kuanzisha au kuendesha maktaba ya shule."
          : "Hello! I'm SAGE, the Start A Library support assistant. You can type a question or send a voice note about setting up or running a school library.",
      citedChunkIds: [],
      reason: null,
    };
  }
  return undefined;
}

function scoreChunk(chunk: ManualChunk, queryTokens: Set<string>) {
  const titleTokens = tokens(chunk.title);
  const tagTokens = tokens(`${chunk.topic} ${chunk.tags.join(" ")}`);
  const textTokens = tokens(`${chunk.chapter} ${chunk.text}`);
  let score = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      score += 5;
    } else if (tagTokens.has(token)) {
      score += 3;
    } else if (textTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function tokens(value: string) {
  const stopWords = new Set([
    "about",
    "and",
    "are",
    "does",
    "for",
    "from",
    "how",
    "please",
    "the",
    "this",
    "what",
    "with",
    "ya",
    "kwa",
    "na",
    "ni",
    "je",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
  );
}
