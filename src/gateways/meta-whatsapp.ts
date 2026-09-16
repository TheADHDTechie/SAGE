import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type {
  WhatsAppGateway,
  WhatsAppButtonMessage,
  WhatsAppListMessage,
  WhatsAppMedia,
  WhatsAppSendResult,
} from "./whatsapp.js";

const mediaMetadataSchema = z.object({
  url: z.url(),
  mime_type: z.string().min(1),
  sha256: z.string().optional(),
  file_size: z.coerce.number().int().nonnegative().optional(),
});

const sendMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

const uploadMediaResponseSchema = z.object({
  id: z.string().min(1),
});

const markReadResponseSchema = z.object({ success: z.boolean() });

export class MetaWhatsAppGateway implements WhatsAppGateway {
  private readonly graphBaseUrl: string;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.graphBaseUrl = config.WHATSAPP_GRAPH_BASE_URL.replace(/\/+$/, "");
  }

  async downloadMedia(mediaId: string): Promise<WhatsAppMedia> {
    const metadataUrl = new URL(
      `${this.graphBaseUrl}/${this.config.WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`,
    );
    metadataUrl.searchParams.set(
      "phone_number_id",
      this.required("WHATSAPP_PHONE_NUMBER_ID"),
    );

    const metadataResponse = await this.authorizedFetch(metadataUrl);
    const metadata = await parseResponse(
      metadataResponse,
      mediaMetadataSchema,
      "retrieve WhatsApp media metadata",
    );

    if (
      metadata.file_size !== undefined &&
      metadata.file_size > this.config.MAX_AUDIO_BYTES
    ) {
      throw new Error(
        `WhatsApp media exceeds the ${this.config.MAX_AUDIO_BYTES}-byte limit`,
      );
    }

    const mediaUrl = new URL(metadata.url);
    if (
      mediaUrl.protocol !== "https:" ||
      !isTrustedMetaMediaHost(mediaUrl.hostname)
    ) {
      throw new Error("WhatsApp media URL is not hosted by Meta");
    }

    const mediaResponse = await this.authorizedFetch(mediaUrl);
    if (!mediaResponse.ok) {
      throw await graphError(mediaResponse, "download WhatsApp media");
    }

    const declaredLength = Number(mediaResponse.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.config.MAX_AUDIO_BYTES
    ) {
      throw new Error(
        `WhatsApp media exceeds the ${this.config.MAX_AUDIO_BYTES}-byte limit`,
      );
    }

    const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
    if (bytes.byteLength > this.config.MAX_AUDIO_BYTES) {
      throw new Error(
        `WhatsApp media exceeds the ${this.config.MAX_AUDIO_BYTES}-byte limit`,
      );
    }

    if (metadata.sha256) {
      const digest = createHash("sha256").update(bytes).digest();
      const expectedHash = metadata.sha256.trim();
      const checksumMatches = /^[a-f0-9]{64}$/i.test(expectedHash)
        ? digest.toString("hex").toLowerCase() === expectedHash.toLowerCase()
        : checksumBytesMatch(digest, expectedHash);
      if (!checksumMatches) {
        throw new Error("WhatsApp media checksum validation failed");
      }
    }

    return {
      bytes,
      mimeType:
        mediaResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
        metadata.mime_type,
    };
  }

  async markRead(messageId: string): Promise<void> {
    const response = await this.authorizedFetch(this.messagesUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
    await parseResponse(response, markReadResponseSchema, "mark message as read");
  }

  async uploadAudio(input: {
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }): Promise<{ mediaId: string }> {
    if (input.bytes.byteLength > this.config.MAX_AUDIO_BYTES) {
      throw new Error(
        `Synthesized audio exceeds the ${this.config.MAX_AUDIO_BYTES}-byte limit`,
      );
    }
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
      input.fileName,
    );
    const response = await this.authorizedFetch(this.mediaUploadUrl(), {
      method: "POST",
      body: form,
    });
    const result = await parseResponse(
      response,
      uploadMediaResponseSchema,
      "upload WhatsApp audio",
    );
    return { mediaId: result.id };
  }

  async sendText(input: {
    to: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: {
        preview_url: false,
        body: fitMessage(input.body),
      },
    };
    if (input.replyToMessageId) {
      payload.context = { message_id: input.replyToMessageId };
    }

    const response = await this.authorizedFetch(this.messagesUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await parseResponse(
      response,
      sendMessageResponseSchema,
      "send WhatsApp text message",
    );
    return { messageIds: result.messages.map((message) => message.id) };
  }

  async sendAudio(input: {
    to: string;
    mediaId: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    return this.sendMessage(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "audio",
        audio: {
          id: input.mediaId,
          voice: true,
        },
      },
      input.replyToMessageId,
      "send WhatsApp audio message",
    );
  }

  async sendList(input: {
    to: string;
    list: WhatsAppListMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    return this.sendMessage(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: input.list.body },
          action: {
            button: input.list.button,
            sections: input.list.sections,
          },
        },
      },
      input.replyToMessageId,
      "send WhatsApp list message",
    );
  }

  async sendButtons(input: {
    to: string;
    message: WhatsAppButtonMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult> {
    return this.sendMessage(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: input.message.body },
          action: {
            buttons: input.message.buttons.map((button) => ({
              type: "reply",
              reply: button,
            })),
          },
        },
      },
      input.replyToMessageId,
      "send WhatsApp reply buttons",
    );
  }

  private messagesUrl() {
    return new URL(
      `${this.graphBaseUrl}/${this.config.WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(
        this.required("WHATSAPP_PHONE_NUMBER_ID"),
      )}/messages`,
    );
  }

  private mediaUploadUrl() {
    return new URL(
      `${this.graphBaseUrl}/${this.config.WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(
        this.required("WHATSAPP_PHONE_NUMBER_ID"),
      )}/media`,
    );
  }

  private async sendMessage(
    payload: Record<string, unknown>,
    replyToMessageId: string | undefined,
    action: string,
  ) {
    if (replyToMessageId) {
      payload.context = { message_id: replyToMessageId };
    }
    const response = await this.authorizedFetch(this.messagesUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await parseResponse(
      response,
      sendMessageResponseSchema,
      action,
    );
    return { messageIds: result.messages.map((message) => message.id) };
  }

  private async authorizedFetch(url: URL, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set(
      "authorization",
      `Bearer ${this.required("WHATSAPP_ACCESS_TOKEN")}`,
    );

    return this.fetchImplementation(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.config.WHATSAPP_TIMEOUT_MS),
    });
  }

  private required(
    key: "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_PHONE_NUMBER_ID",
  ) {
    const value = this.config[key];
    if (!value) {
      throw new Error(`${key} is not configured`);
    }
    return value;
  }
}

async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  action: string,
): Promise<T> {
  if (!response.ok) {
    throw await graphError(response, action);
  }

  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Meta Graph API returned an invalid response while trying to ${action}`);
  }
  return parsed.data;
}

async function graphError(response: Response, action: string) {
  const body = (await response.text()).slice(0, 500);
  return new Error(
    `Unable to ${action}: Meta Graph API returned ${response.status}${body ? `: ${body}` : ""}`,
  );
}

function fitMessage(body: string, maximumLength = 4000) {
  const normalized = body.trim();
  if (!normalized) {
    throw new Error("Cannot send an empty WhatsApp message");
  }
  if (normalized.length <= maximumLength) {
    return normalized;
  }

  const suffix = "\n\n[Response shortened]";
  return `${normalized.slice(0, maximumLength - suffix.length).trimEnd()}${suffix}`;
}

function isTrustedMetaMediaHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return [
    "facebook.com",
    "fbcdn.net",
    "fbsbx.com",
  ].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function checksumBytesMatch(actual: Buffer, expectedBase64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(expectedBase64)) {
    return false;
  }
  const expected = Buffer.from(expectedBase64, "base64");
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}
