export interface SpeechTranscription {
  text: string;
  language?: string;
}

export interface SpeechTranscriber {
  readonly providerName: string;
  transcribe(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<SpeechTranscription>;
}
