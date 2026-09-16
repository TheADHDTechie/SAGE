import path from "node:path";
import { z } from "zod";

const booleanFromString = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
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
    AZURE_SPEECH_RESOURCE_ID: optionalString,
    AZURE_SPEECH_MODEL: z.string().default("MAI-Transcribe-2"),
    AZURE_SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
    VOICE_REPLIES_ENABLED: booleanFromString("false"),
    AZURE_TTS_ENDPOINT: optionalUrl,
    AZURE_TTS_VOICE_EN: z.string().default("en-KE-AsiliaNeural"),
    AZURE_TTS_VOICE_SW: z.string().default("sw-KE-ZuriNeural"),
    FFMPEG_PATH: z.string().default("ffmpeg"),
    ENABLE_TEST_ENDPOINTS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    TEST_API_TOKEN: optionalString,
    MAX_AUDIO_BYTES: z.coerce.number().int().min(1024).default(16 * 1024 * 1024),
    WHATSAPP_ENABLED: booleanFromString("false"),
    WHATSAPP_VERIFY_TOKEN: optionalString,
    META_APP_SECRET: optionalString,
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v26.0"),
    WHATSAPP_GRAPH_BASE_URL: z
      .url()
      .default("https://graph.facebook.com"),
    WHATSAPP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
    WHATSAPP_MARK_MESSAGES_READ: booleanFromString("true"),
    STAFF_API_TOKEN: optionalString,
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

    if (value.VOICE_REPLIES_ENABLED) {
      if (!value.AZURE_TTS_ENDPOINT) {
        context.addIssue({
          code: "custom",
          path: ["AZURE_TTS_ENDPOINT"],
          message: "Required when VOICE_REPLIES_ENABLED=true",
        });
      }
      if (!value.AZURE_SPEECH_KEY && !value.AZURE_SPEECH_RESOURCE_ID) {
        context.addIssue({
          code: "custom",
          path: ["AZURE_SPEECH_RESOURCE_ID"],
          message:
            "AZURE_SPEECH_RESOURCE_ID or AZURE_SPEECH_KEY is required when VOICE_REPLIES_ENABLED=true",
        });
      }
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

    if (value.WHATSAPP_ENABLED) {
      const requiredValues = [
        ["WHATSAPP_VERIFY_TOKEN", value.WHATSAPP_VERIFY_TOKEN],
        ["META_APP_SECRET", value.META_APP_SECRET],
        ["WHATSAPP_ACCESS_TOKEN", value.WHATSAPP_ACCESS_TOKEN],
        ["WHATSAPP_PHONE_NUMBER_ID", value.WHATSAPP_PHONE_NUMBER_ID],
        ["STAFF_API_TOKEN", value.STAFF_API_TOKEN],
      ] as const;

      for (const [path, configuredValue] of requiredValues) {
        if (!configuredValue) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: `Required when WHATSAPP_ENABLED=true`,
          });
        }
      }

      for (const [path, configuredValue] of [
        ["WHATSAPP_VERIFY_TOKEN", value.WHATSAPP_VERIFY_TOKEN],
        ["STAFF_API_TOKEN", value.STAFF_API_TOKEN],
      ] as const) {
        if (configuredValue && configuredValue.length < 16) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: "Must contain at least 16 characters",
          });
        }
      }
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
