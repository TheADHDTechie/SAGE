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
};

export class MockLanguageModelGateway implements LanguageModelGateway {
  readonly deploymentName = "mock-local";

  constructor(private readonly chunks: readonly ManualChunk[]) {}

  async answerSupportQuestion(
    input: LanguageModelInput,
  ): Promise<SupportModelResult> {
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
      return {
        language: input.languageHint,
        answer: "",
        supported: false,
        citedChunkIds: [],
        requiresHuman: true,
        handoffReason: "The local mock could not find relevant manual content.",
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
      language: input.languageHint,
      answer,
      supported: true,
      citedChunkIds: [best.chunk.id],
      requiresHuman: false,
    };
  }
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
