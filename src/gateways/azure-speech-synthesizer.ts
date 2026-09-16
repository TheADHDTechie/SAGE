import { DefaultAzureCredential } from "@azure/identity";
import type { AppConfig } from "../config.js";
import type { SupportedLanguage } from "../domain/types.js";
import type {
  SpeechSynthesizer,
  SynthesizedSpeech,
} from "./speech-synthesizer.js";

const outputFormat = "ogg-24khz-16bit-mono-opus";

export class AzureSpeechSynthesizer implements SpeechSynthesizer {
  readonly providerName = "azure-neural-tts";
  private readonly credential = new DefaultAzureCredential();

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async synthesize(input: {
    text: string;
    language: SupportedLanguage;
  }): Promise<SynthesizedSpeech> {
    const language = input.language === "sw" ? "sw-KE" : "en-KE";
    const voice =
      input.language === "sw"
        ? this.config.AZURE_TTS_VOICE_SW
        : this.config.AZURE_TTS_VOICE_EN;
    const endpoint = this.config.AZURE_TTS_ENDPOINT;
    if (!endpoint) {
      throw new Error("Azure text-to-speech endpoint is not configured");
    }

    const response = await this.fetchImplementation(
      `${endpoint}/cognitiveservices/v1`,
      {
      method: "POST",
      headers: {
        ...(await this.authenticationHeaders()),
        "content-type": "application/ssml+xml",
        "user-agent": "SAGE",
        "x-microsoft-outputformat": outputFormat,
      },
      body: `<speak version="1.0" xml:lang="${language}"><voice name="${escapeXml(
        voice,
      )}">${escapeXml(input.text)}</voice></speak>`,
      signal: AbortSignal.timeout(this.config.AZURE_SPEECH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Azure text-to-speech failed with ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Azure text-to-speech returned empty audio");
    }
    if (bytes.byteLength > this.config.MAX_AUDIO_BYTES) {
      throw new Error(
        `Synthesized audio exceeds the ${this.config.MAX_AUDIO_BYTES}-byte limit`,
      );
    }

    return {
      bytes,
      mimeType: "audio/ogg",
      fileName: "sage-answer.ogg",
    };
  }

  private async authenticationHeaders(): Promise<HeadersInit> {
    if (this.config.AZURE_SPEECH_KEY) {
      return {
        "Ocp-Apim-Subscription-Key": this.config.AZURE_SPEECH_KEY,
      };
    }

    const resourceId = this.config.AZURE_SPEECH_RESOURCE_ID;
    if (!resourceId) {
      throw new Error(
        "AZURE_SPEECH_RESOURCE_ID is required for managed-identity text-to-speech",
      );
    }
    const token = await this.credential.getToken(
      "https://cognitiveservices.azure.com/.default",
    );
    if (!token) {
      throw new Error("Unable to obtain an Azure Speech access token");
    }
    return {
      Authorization: `Bearer aad#${resourceId}#${token.token}`,
    };
  }
}

function escapeXml(value: string) {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character,
  );
}
