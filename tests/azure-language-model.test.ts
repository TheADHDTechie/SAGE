import { describe, expect, it } from "vitest";
import {
  resolveAzureOpenAIBaseUrl,
  systemPrompt,
} from "../src/gateways/azure-language-model.js";
import { parseSupportModelResult } from "../src/gateways/language-model.js";

describe("Azure language model endpoint normalization", () => {
  it("normalizes a Responses preview endpoint to the Azure OpenAI v1 base URL", () => {
    expect(
      resolveAzureOpenAIBaseUrl({
        AZURE_OPENAI_ENDPOINT:
          "https://example.openai.azure.com/openai/responses?api-version=2025-04-01-preview",
        AZURE_FOUNDRY_PROJECT_ENDPOINT: undefined,
      }),
    ).toBe("https://example.openai.azure.com/openai/v1/");
  });

  it("retains support for a Foundry project endpoint", () => {
    expect(
      resolveAzureOpenAIBaseUrl({
        AZURE_OPENAI_ENDPOINT: undefined,
        AZURE_FOUNDRY_PROJECT_ENDPOINT:
          "https://example.services.ai.azure.com/api/projects/sal",
      }),
    ).toBe(
      "https://example.services.ai.azure.com/api/projects/sal/openai/v1/",
    );
  });

  it("instructs the model to classify and generate one structured response", () => {
    expect(systemPrompt).toContain(
      "Classify the user's conversational intent",
    );
    expect(systemPrompt).toContain("greeting");
    expect(systemPrompt).toContain("closing");
    expect(systemPrompt).toContain("guide_answer");
    expect(systemPrompt).toContain("clarify_scope");
    expect(systemPrompt).toContain("request_human");
    expect(systemPrompt).toContain(
      "What are the responsibilities of library staff?",
    );
    expect(systemPrompt).toContain(
      "For guide_answer, citedChunkIds must contain at least one valid manual chunk ID.",
    );
  });

  it("rejects contradictory intent and citation combinations", () => {
    expect(() =>
      parseSupportModelResult({
        intent: "greeting",
        language: "en",
        response: "Hello!",
        citedChunkIds: ["sal-123"],
        reason: null,
      }),
    ).toThrow("Only guide answers may include citations");

    expect(() =>
      parseSupportModelResult({
        intent: "guide_answer",
        language: "en",
        response: "Grounded answer",
        citedChunkIds: [],
        reason: null,
      }),
    ).toThrow("requires at least one citation");
  });
});
