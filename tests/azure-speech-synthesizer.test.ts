import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { AzureSpeechSynthesizer } from "../src/gateways/azure-speech-synthesizer.js";

function config() {
  return loadConfig({
    NODE_ENV: "test",
    DATA_DIR: ".\\data",
    MANUAL_PATH: path.resolve(
      "knowledge-base",
      "sal",
      "data",
      "sal-guide-chunks.jsonl",
    ),
    CONTACT_HASH_KEY: "test-contact-hash-key",
    ENABLE_TEST_ENDPOINTS: "false",
    AZURE_SPEECH_KEY: "speech-key",
    VOICE_REPLIES_ENABLED: "true",
    AZURE_TTS_ENDPOINT: "https://eastus2.tts.speech.microsoft.com",
  });
}

describe("AzureSpeechSynthesizer", () => {
  it("creates WhatsApp-compatible English OGG audio", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const fakeFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      request = init
        ? { url: String(input), init }
        : { url: String(input) };
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/ogg" },
      });
    };
    const synthesizer = new AzureSpeechSynthesizer(config(), fakeFetch);

    const audio = await synthesizer.synthesize({
      text: "Books & shelves",
      language: "en",
    });

    expect(audio).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
      fileName: "sage-answer.ogg",
    });
    expect(request?.url).toBe(
      "https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1",
    );
    const headers = new Headers(request?.init?.headers);
    expect(headers.get("x-microsoft-outputformat")).toBe(
      "ogg-24khz-16bit-mono-opus",
    );
    expect(headers.get("ocp-apim-subscription-key")).toBe("speech-key");
    expect(request?.init?.body).toContain('name="en-KE-AsiliaNeural"');
    expect(request?.init?.body).toContain("Books &amp; shelves");
  });

  it("selects the Kiswahili voice", async () => {
    let body: BodyInit | null | undefined;
    const fakeFetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      body = init?.body;
      return new Response(new Uint8Array([1]));
    };
    const synthesizer = new AzureSpeechSynthesizer(config(), fakeFetch);

    await synthesizer.synthesize({
      text: "Panga vitabu",
      language: "sw",
    });

    expect(body).toContain('xml:lang="sw-KE"');
    expect(body).toContain('name="sw-KE-ZuriNeural"');
  });
});
