import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MetaWhatsAppGateway } from "../src/gateways/meta-whatsapp.js";

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
    LLM_PROVIDER: "mock",
    SPEECH_PROVIDER: "mock",
    ENABLE_TEST_ENDPOINTS: "false",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_VERIFY_TOKEN: "verify-token-value",
    META_APP_SECRET: "app-secret",
    WHATSAPP_ACCESS_TOKEN: "access-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-id",
    STAFF_API_TOKEN: "staff-token-value",
  });
}

describe("MetaWhatsAppGateway", () => {
  it("sends text through the configured Graph API version", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      requests.push(
        init ? { url: String(input), init } : { url: String(input) },
      );
      return Response.json({ messages: [{ id: "wamid.outbound" }] });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    const result = await gateway.sendText({
      to: "254700000001",
      body: "Hello",
      replyToMessageId: "wamid.inbound",
    });

    expect(result.messageIds).toEqual(["wamid.outbound"]);
    expect(requests[0]?.url).toBe(
      "https://graph.facebook.com/v26.0/phone-id/messages",
    );
    const textRequest = JSON.parse(
      String(requests[0]?.init?.body),
    ) as Record<string, unknown>;
    expect(textRequest).toMatchObject({
      messaging_product: "whatsapp",
      to: "254700000001",
      context: { message_id: "wamid.inbound" },
      text: { body: "Hello" },
    });
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("uploads OGG audio to the phone-number media endpoint", async () => {
      let request: { url: string; init?: RequestInit } | undefined;
      const fakeFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        request = init
          ? { url: String(input), init }
          : { url: String(input) };
        return Response.json({ id: "media-outbound" });
      };
      const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

      const result = await gateway.uploadAudio({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "audio/ogg",
        fileName: "answer.ogg",
      });

      expect(result).toEqual({ mediaId: "media-outbound" });
      expect(request?.url).toBe(
        "https://graph.facebook.com/v26.0/phone-id/media",
      );
      expect(request?.init?.method).toBe("POST");
      expect(request?.init?.body).toBeInstanceOf(FormData);
      const form = request?.init?.body as FormData;
      expect(form.get("messaging_product")).toBe("whatsapp");
      expect(form.get("file")).toBeInstanceOf(Blob);
    });

  it("sends an uploaded media ID as a WhatsApp voice message", async () => {
      let requestBody: Record<string, unknown> | undefined;
      const fakeFetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ messages: [{ id: "wamid.audio" }] });
      };
      const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

      await gateway.sendAudio({
        to: "254700000001",
        mediaId: "media-outbound",
        replyToMessageId: "wamid.inbound",
      });

      expect(requestBody).toMatchObject({
        type: "audio",
        to: "254700000001",
        audio: { id: "media-outbound", voice: true },
        context: { message_id: "wamid.inbound" },
      });
    });

  it("sends reusable interactive list messages", async () => {
      let requestBody: Record<string, unknown> | undefined;
      const fakeFetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ messages: [{ id: "wamid.list" }] });
      };
      const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

      await gateway.sendList({
        to: "254700000001",
        list: {
          body: "Choose a reply format",
          button: "Choose",
          sections: [
            {
              title: "Formats",
              rows: [{ id: "preference:en:auto", title: "Automatic" }],
            },
          ],
        },
      });

      expect(requestBody).toMatchObject({
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: "Choose a reply format" },
          action: {
            button: "Choose",
            sections: [
              {
                rows: [
                  { id: "preference:en:auto", title: "Automatic" },
                ],
              },
            ],
          },
        },
      });
    });

  it("retrieves, downloads, and verifies media", async () => {
    const bytes = new TextEncoder().encode("voice-note");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const requests: string[] = [];
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://graph.facebook.com/")) {
        return Response.json({
          url: "https://lookaside.fbsbx.com/media/voice",
          mime_type: "audio/ogg",
          sha256: checksum,
          file_size: bytes.byteLength,
        });
      }
      return new Response(bytes, {
        headers: {
          "content-type": "audio/ogg; codecs=opus",
          "content-length": String(bytes.byteLength),
        },
      });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    const media = await gateway.downloadMedia("media-id");

    expect(requests).toEqual([
      "https://graph.facebook.com/v26.0/media-id?phone_number_id=phone-id",
      "https://lookaside.fbsbx.com/media/voice",
    ]);
    expect(media.mimeType).toBe("audio/ogg");
    expect(media.bytes).toEqual(bytes);
  });

  it("rejects media that fails checksum validation", async () => {
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).startsWith("https://graph.facebook.com/")) {
        return Response.json({
          url: "https://lookaside.fbsbx.com/media/voice",
          mime_type: "audio/ogg",
          sha256: "invalid-checksum",
          file_size: 5,
        });
      }
      return new Response("audio", {
        headers: { "content-type": "audio/ogg" },
      });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    await expect(gateway.downloadMedia("media-id")).rejects.toThrow(
      "checksum validation failed",
    );
  });

  it("compares Base64 media checksums case-sensitively", async () => {
    const bytes = new TextEncoder().encode("voice-note");
    const validChecksum = createHash("sha256").update(bytes).digest("base64");
    const invalidChecksum = `${validChecksum[0] === "A" ? "a" : "A"}${validChecksum.slice(1)}`;
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).startsWith("https://graph.facebook.com/")) {
        return Response.json({
          url: "https://lookaside.fbsbx.com/media/voice",
          mime_type: "audio/ogg",
          sha256: invalidChecksum,
          file_size: bytes.byteLength,
        });
      }
      return new Response(bytes, {
        headers: { "content-type": "audio/ogg" },
      });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    await expect(gateway.downloadMedia("media-id")).rejects.toThrow(
      "checksum validation failed",
    );
  });

  it("rejects an untrusted media host before sending the access token", async () => {
    const requests: string[] = [];
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(String(input));
      return Response.json({
        url: "https://attacker.example/media/voice",
        mime_type: "audio/ogg",
        file_size: 5,
      });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    await expect(gateway.downloadMedia("media-id")).rejects.toThrow(
      "not hosted by Meta",
    );
    expect(requests).toHaveLength(1);
  });

  it("shortens oversized responses into one idempotent outbound message", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fakeFetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ messages: [{ id: "wamid.outbound" }] });
    };
    const gateway = new MetaWhatsAppGateway(config(), fakeFetch);

    await gateway.sendText({
      to: "254700000001",
      body: "x".repeat(5000),
    });

    const text = requestBody?.text as { body: string } | undefined;
    expect(text?.body).toHaveLength(4000);
    expect(text?.body).toMatch(/\[Response shortened\]$/);
  });
});
