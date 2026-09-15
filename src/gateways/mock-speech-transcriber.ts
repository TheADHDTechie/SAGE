import type {
  SpeechTranscriber,
  SpeechTranscription,
} from "./speech-transcriber.js";

export class MockSpeechTranscriber implements SpeechTranscriber {
  readonly providerName = "mock-local";

  async transcribe(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<SpeechTranscription> {
    if (input.mimeType !== "text/plain") {
      throw new Error(
        "Mock speech accepts text/plain fixtures. Configure SPEECH_PROVIDER=azure for audio.",
      );
    }

    const text = Buffer.from(input.bytes).toString("utf8").trim();
    if (!text) {
      throw new Error("The mock speech fixture is empty");
    }

    return { text };
  }
}
