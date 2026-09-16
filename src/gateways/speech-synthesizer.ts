import type { SupportedLanguage } from "../domain/types.js";

export interface SynthesizedSpeech {
  bytes: Uint8Array;
  mimeType: "audio/ogg";
  fileName: string;
}

export interface SpeechSynthesizer {
  readonly providerName: string;
  synthesize(input: {
    text: string;
    language: SupportedLanguage;
  }): Promise<SynthesizedSpeech>;
}
