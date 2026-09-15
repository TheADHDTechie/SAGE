import { z } from "zod";
import type {
  ChatMessage,
  SupportModelResult,
  SupportedLanguage,
} from "../domain/types.js";

export const supportModelResultSchema = z.object({
  language: z.enum(["en", "sw", "mixed", "unknown"]),
  answer: z.string().min(1).max(4000),
  supported: z.boolean(),
  citedChunkIds: z.array(z.string()).max(12),
  requiresHuman: z.boolean(),
  handoffReason: z.string().optional(),
});

export interface LanguageModelInput {
  question: string;
  languageHint: SupportedLanguage;
  recentMessages: ChatMessage[];
  manualContext: string;
}

export interface LanguageModelGateway {
  readonly deploymentName: string;
  answerSupportQuestion(input: LanguageModelInput): Promise<SupportModelResult>;
}
