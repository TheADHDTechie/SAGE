import { z } from "zod";
import type {
  ChatMessage,
  SupportModelResult,
  SupportedLanguage,
} from "../domain/types.js";

export const supportModelResultSchema = z.object({
  intent: z.enum([
    "greeting",
    "closing",
    "guide_answer",
    "clarify_scope",
    "request_human",
  ]),
  language: z.enum(["en", "sw", "mixed", "unknown"]),
  response: z.string().min(1).max(4000),
  citedChunkIds: z.array(z.string()).max(12),
  reason: z.string().nullable(),
});

export type SupportModelResultInput = z.infer<
  typeof supportModelResultSchema
>;

export function parseSupportModelResult(input: unknown): SupportModelResult {
  const result = supportModelResultSchema.parse(input);
  if (result.intent === "guide_answer") {
    if (result.citedChunkIds.length === 0) {
      throw new Error("A guide answer requires at least one citation");
    }
    return {
      ...result,
      intent: "guide_answer",
    };
  }
  if (result.citedChunkIds.length !== 0) {
    throw new Error("Only guide answers may include citations");
  }
  return {
    ...result,
    intent: result.intent,
    citedChunkIds: [],
  };
}

export interface LanguageModelInput {
  question: string;
  languageHint: SupportedLanguage;
  recentMessages: ChatMessage[];
  manualContext: string;
}

export interface LanguageModelGateway {
  readonly deploymentName: string;
  generateSupportResponse(
    input: LanguageModelInput,
  ): Promise<SupportModelResultInput>;
}
