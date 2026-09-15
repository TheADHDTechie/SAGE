import { execFile } from "node:child_process";
import { DefaultAzureCredential } from "@azure/identity";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type {
  SpeechTranscriber,
  SpeechTranscription,
} from "./speech-transcriber.js";

const execFileAsync = promisify(execFile);

const transcriptionResponseSchema = z.object({
  combinedPhrases: z
    .array(
      z.object({
        text: z.string(),
        locale: z.string().optional(),
      }),
    )
    .optional(),
  phrases: z
    .array(
      z.object({
        text: z.string().optional(),
        locale: z.string().optional(),
      }),
    )
    .optional(),
});

export class AzureSpeechTranscriber implements SpeechTranscriber {
  readonly providerName: string;
  private readonly credential = new DefaultAzureCredential();

  constructor(private readonly config: AppConfig) {
    this.providerName = "azure-enhanced-transcription";
  }

  async transcribe(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<SpeechTranscription> {
    const wav = await this.convertToWav(input.bytes, input.mimeType);
    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "voice-message.wav",
    );
    form.append(
      "definition",
      JSON.stringify({
        locales: ["en-US", "sw-KE"],
      }),
    );

    const endpoint = this.config.AZURE_SPEECH_ENDPOINT;
    if (!endpoint) {
      throw new Error("Azure Speech endpoint is not configured");
    }

    const headers = await this.authenticationHeaders();
    const response = await fetch(
      `${endpoint}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`,
      {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(this.config.AZURE_SPEECH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Azure Speech failed with ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const parsed = transcriptionResponseSchema.parse(await response.json());
    const combined = parsed.combinedPhrases
      ?.map((phrase) => phrase.text.trim())
      .filter(Boolean);
    const fallback = parsed.phrases
      ?.map((phrase) => phrase.text?.trim())
      .filter((text): text is string => Boolean(text));
    const text = (combined?.length ? combined : fallback)?.join(" ").trim();

    if (!text) {
      throw new Error("Azure Speech returned no transcript");
    }

    const language =
      parsed.combinedPhrases?.find((phrase) => phrase.locale)?.locale ??
      parsed.phrases?.find((phrase) => phrase.locale)?.locale;
    return language ? { text, language } : { text };
  }

  private async authenticationHeaders(): Promise<HeadersInit> {
    if (this.config.AZURE_SPEECH_KEY) {
      return {
        "Ocp-Apim-Subscription-Key": this.config.AZURE_SPEECH_KEY,
      };
    }

    const token = await this.credential.getToken(
      "https://cognitiveservices.azure.com/.default",
    );
    if (!token) {
      throw new Error("Unable to obtain an Azure Speech access token");
    }
    return { Authorization: `Bearer ${token.token}` };
  }

  private async convertToWav(bytes: Uint8Array, mimeType: string) {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "sal-audio-"),
    );
    const inputPath = path.join(
      temporaryDirectory,
      `input${extensionForMimeType(mimeType)}`,
    );
    const outputPath = path.join(temporaryDirectory, "output.wav");

    try {
      await fs.writeFile(inputPath, bytes);
      await execFileAsync(this.config.FFMPEG_PATH, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ]);
      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function extensionForMimeType(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = {
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "audio/flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
  };
  return extensions[normalized ?? ""] ?? ".audio";
}
