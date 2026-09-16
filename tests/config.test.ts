import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("WhatsApp configuration", () => {
  it("keeps WhatsApp routes disabled by default", () => {
    const config = loadConfig({
      ENABLE_TEST_ENDPOINTS: "false",
    });

    expect(config.WHATSAPP_ENABLED).toBe(false);
  });

  it("requires WhatsApp secrets and identifiers when enabled", () => {
    expect(() =>
      loadConfig({
        ENABLE_TEST_ENDPOINTS: "false",
        WHATSAPP_ENABLED: "true",
      }),
    ).toThrow();
  });

  it("rejects weak callback and staff tokens", () => {
    expect(() =>
      loadConfig({
        ENABLE_TEST_ENDPOINTS: "false",
        WHATSAPP_ENABLED: "true",
        WHATSAPP_VERIFY_TOKEN: "short",
        META_APP_SECRET: "app-secret",
        WHATSAPP_ACCESS_TOKEN: "access-token",
        WHATSAPP_PHONE_NUMBER_ID: "phone-id",
        STAFF_API_TOKEN: "short",
      }),
    ).toThrow();
  });

  it("requires a TTS endpoint and authentication when voice replies are enabled", () => {
    expect(() =>
      loadConfig({
        ENABLE_TEST_ENDPOINTS: "false",
        VOICE_REPLIES_ENABLED: "true",
      }),
    ).toThrow();
  });
});
