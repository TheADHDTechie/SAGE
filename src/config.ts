import path from "node:path";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalUrl = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim().replace(/\/+$/, "") : undefined))
  .pipe(z.url().optional());

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATA_DIR: z.string().default(".\\data"),
    MANUAL_PATH: z
      .string()
      .default(".\\knowledge-base\\sal\\data\\sal-guide-chunks.jsonl"),
    CONTACT_HASH_KEY: z.string().min(16).default("local-development-hash-key"),
    LLM_PROVIDER: z.enum(["mock", "azure"]).default("mock"),
    AZURE_OPENAI_ENDPOINT: optionalUrl,
    AZURE_FOUNDRY_PROJECT_ENDPOINT: optionalUrl,
    AZURE_LLM_DEPLOYMENT: z.string().default("sal-support-luna"),
    AZURE_OPENAI_API_KEY: optionalString,
    AZURE_AI_API_KEY: optionalString,
    AZURE_LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(4000).default(600),
    AZURE_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    SPEECH_PROVIDER: z.enum(["mock", "azure"]).default("mock"),
    AZURE_SPEECH_ENDPOINT: optionalUrl,
    AZURE_SPEECH_KEY: optionalString,
    AZURE_SPEECH_MODEL: z.string().default("MAI-Transcribe-2"),
    AZURE_SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
    FFMPEG_PATH: z.string().default("ffmpeg"),
    ENABLE_TEST_ENDPOINTS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    TEST_API_TOKEN: optionalString,
    MAX_AUDIO_BYTES: z.coerce.number().int().min(1024).default(16 * 1024 * 1024),
  })
  .superRefine((value, context) => {
    if (
      value.LLM_PROVIDER === "azure" &&
      !value.AZURE_OPENAI_ENDPOINT &&
      !value.AZURE_FOUNDRY_PROJECT_ENDPOINT
    ) {
      context.addIssue({
        code: "custom",
        path: ["AZURE_OPENAI_ENDPOINT"],
        message:
          "AZURE_OPENAI_ENDPOINT or AZURE_FOUNDRY_PROJECT_ENDPOINT is required when LLM_PROVIDER=azure",
      });
    }

    if (value.SPEECH_PROVIDER === "azure" && !value.AZURE_SPEECH_ENDPOINT) {
      context.addIssue({
        code: "custom",
        path: ["AZURE_SPEECH_ENDPOINT"],
        message: "Required when SPEECH_PROVIDER=azure",
      });
    }

    if (value.ENABLE_TEST_ENDPOINTS && !value.TEST_API_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["TEST_API_TOKEN"],
        message: "Required when ENABLE_TEST_ENDPOINTS=true",
      });
    }

    if (value.NODE_ENV === "production" && value.ENABLE_TEST_ENDPOINTS) {
      context.addIssue({
        code: "custom",
        path: ["ENABLE_TEST_ENDPOINTS"],
        message: "Test endpoints cannot be enabled in production",
      });
    }
  });

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
) {
  const parsed = environmentSchema.parse(environment);

  return {
    ...parsed,
    DATA_DIR: path.resolve(workingDirectory, parsed.DATA_DIR),
    MANUAL_PATH: path.resolve(workingDirectory, parsed.MANUAL_PATH),
  };
}
