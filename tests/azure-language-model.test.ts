import { describe, expect, it } from "vitest";
import { resolveAzureOpenAIBaseUrl } from "../src/gateways/azure-language-model.js";

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
});
