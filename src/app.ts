import path from "node:path";
import multipart from "@fastify/multipart";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { SupportAssistant } from "./application/support-assistant.js";
import type { AppConfig } from "./config.js";
import type { LanguageModelGateway } from "./gateways/language-model.js";
import { MockLanguageModelGateway } from "./gateways/mock-language-model.js";
import { MockSpeechTranscriber } from "./gateways/mock-speech-transcriber.js";
import type { SpeechTranscriber } from "./gateways/speech-transcriber.js";
import type { WhatsAppGateway } from "./gateways/whatsapp.js";
import { ConversationStore } from "./infrastructure/database.js";
import { ManualRepository } from "./knowledge/manual-repository.js";
import { registerWhatsAppRoutes } from "./whatsapp/whatsapp-webhook.js";

const testMessageSchema = z.object({
  externalMessageId: z.string().min(1).max(200),
  externalUserId: z.string().min(1).max(200),
  type: z.literal("text").default("text"),
  text: z.string().min(1).max(8000),
  receivedAt: z.iso.datetime().default(() => new Date().toISOString()),
});

export interface AppDependencies {
  manual?: ManualRepository;
  store?: ConversationStore;
  languageModel?: LanguageModelGateway;
  speechTranscriber?: SpeechTranscriber;
  whatsAppGateway?: WhatsAppGateway;
}

export interface BuiltApp {
  app: FastifyInstance;
  manual: ManualRepository;
  store: ConversationStore;
  assistant: SupportAssistant;
  speechTranscriber: SpeechTranscriber;
  whatsAppGateway: WhatsAppGateway | undefined;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<BuiltApp> {
  const manual = dependencies.manual ?? new ManualRepository(config.MANUAL_PATH);
  const store =
    dependencies.store ??
    new ConversationStore(
      path.join(config.DATA_DIR, "app.db"),
      config.CONTACT_HASH_KEY,
    );
  const languageModel =
    dependencies.languageModel ??
    (config.LLM_PROVIDER === "azure"
      ? new (await import("./gateways/azure-language-model.js"))
          .AzureLanguageModelGateway(config)
      : new MockLanguageModelGateway(manual.chunks));
  const assistant = new SupportAssistant(manual, store, languageModel);
  const speechTranscriber =
    dependencies.speechTranscriber ??
    (config.SPEECH_PROVIDER === "azure"
      ? new (await import("./gateways/azure-speech-transcriber.js"))
          .AzureSpeechTranscriber(config)
      : new MockSpeechTranscriber());
  const whatsAppGateway =
    dependencies.whatsAppGateway ??
    (config.WHATSAPP_ENABLED
      ? new (await import("./gateways/meta-whatsapp.js")).MetaWhatsAppGateway(
          config,
        )
      : undefined);

  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.x-hub-signature-256",
                "req.headers.x-test-token",
                "body.externalUserId",
              ],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: config.MAX_AUDIO_BYTES,
  });
  const rawJsonBodies = new WeakMap<FastifyRequest, Buffer>();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: config.MAX_AUDIO_BYTES },
    (request, body, done) => {
      const rawBody = body as Buffer;
      rawJsonBodies.set(request, rawBody);
      try {
        done(null, JSON.parse(rawBody.toString("utf8")) as unknown);
      } catch {
        done(
          Object.assign(new Error("Invalid JSON request body"), {
            statusCode: 400,
          }),
          undefined,
        );
      }
    },
  );
  await app.register(multipart);

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const ready = store.ready() && manual.size > 0;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      manualChunks: manual.size,
      manualVersion: manual.version,
      llmProvider: config.LLM_PROVIDER,
      speechProvider: config.SPEECH_PROVIDER,
      whatsAppEnabled: config.WHATSAPP_ENABLED,
    });
  });

  if (config.ENABLE_TEST_ENDPOINTS) {
    app.addHook("preHandler", async (request, reply) => {
      if (
        request.url.startsWith("/api/test/") &&
        request.headers["x-test-token"] !== config.TEST_API_TOKEN
      ) {
        return reply.code(401).send({ error: "Unauthorized test request" });
      }
    });

    app.post("/api/test/messages", async (request, reply) => {
      const parsed = testMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid message",
          details: z.treeifyError(parsed.error),
        });
      }

      const response = await assistant.process(parsed.data);
      return reply
        .code(response.status === "duplicate" ? 200 : 201)
        .send(response);
    });

    app.post("/api/test/messages/voice", async (request, reply) => {
      let externalMessageId: string | undefined;
      let externalUserId: string | undefined;
      let receivedAt = new Date().toISOString();
      let audio:
        | { bytes: Uint8Array; mimeType: string }
        | undefined;

      for await (const part of request.parts({
        limits: { fileSize: config.MAX_AUDIO_BYTES, files: 1 },
      })) {
        if (part.type === "file") {
          if (part.fieldname !== "audio") {
            await part.toBuffer();
            continue;
          }
          audio = {
            bytes: await part.toBuffer(),
            mimeType: part.mimetype,
          };
        } else if (part.fieldname === "externalMessageId") {
          externalMessageId = String(part.value);
        } else if (part.fieldname === "externalUserId") {
          externalUserId = String(part.value);
        } else if (part.fieldname === "receivedAt") {
          receivedAt = String(part.value);
        }
      }

      const fields = z
        .object({
          externalMessageId: z.string().min(1).max(200),
          externalUserId: z.string().min(1).max(200),
          receivedAt: z.iso.datetime(),
        })
        .safeParse({ externalMessageId, externalUserId, receivedAt });

      if (!fields.success || !audio) {
        return reply.code(400).send({
          error: "Voice request requires externalMessageId, externalUserId, and audio",
        });
      }

      let transcript;
      try {
        transcript = await speechTranscriber.transcribe(audio);
      } catch (error) {
        request.log.error(
          { error: error instanceof Error ? error.message : "Unknown error" },
          "Voice transcription failed",
        );
        return reply.code(422).send({
          error: "Unable to transcribe the voice message",
        });
      }

      const response = await assistant.process({
        externalMessageId: fields.data.externalMessageId,
        externalUserId: fields.data.externalUserId,
        type: "voice",
        text: transcript.text,
        receivedAt: fields.data.receivedAt,
      });
      return reply
        .code(response.status === "duplicate" ? 200 : 201)
        .send({ ...response, transcript });
    });
  }

  if (config.WHATSAPP_ENABLED && whatsAppGateway) {
    registerWhatsAppRoutes(app, {
      config,
      assistant,
      store,
      speechTranscriber,
      gateway: whatsAppGateway,
      rawBodyFor: (request) => rawJsonBodies.get(request),
    });
  }

  app.addHook("onClose", async () => {
    if (!dependencies.store) {
      store.close();
    }
  });

  return {
    app,
    manual,
    store,
    assistant,
    speechTranscriber,
    whatsAppGateway,
  };
}
