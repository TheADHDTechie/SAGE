import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const temporaryDirectories: string[] = [];

function testConfig() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sal-api-test-"));
  temporaryDirectories.push(directory);
  return loadConfig({
    NODE_ENV: "test",
    DATA_DIR: directory,
    MANUAL_PATH: path.resolve(
      "knowledge-base",
      "sal",
      "data",
      "sal-guide-chunks.jsonl",
    ),
    CONTACT_HASH_KEY: "test-contact-hash-key",
    LLM_PROVIDER: "mock",
    SPEECH_PROVIDER: "mock",
    ENABLE_TEST_ENDPOINTS: "true",
    TEST_API_TOKEN: "test-token",
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("HTTP API", () => {
  it("reports readiness with the manual details", async () => {
    const { app } = await buildApp(testConfig());

    const response = await app.inject({ method: "GET", url: "/ready" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      manualChunks: 58,
      llmProvider: "mock",
      speechProvider: "mock",
      whatsAppEnabled: false,
    });
  });

  it("does not expose WhatsApp routes when the integration is disabled", async () => {
    const { app } = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp",
    });
    await app.close();

    expect(response.statusCode).toBe(404);
  });

  it("can expose callback verification before full WhatsApp messaging is enabled", async () => {
    const config = {
      ...testConfig(),
      WHATSAPP_VERIFY_TOKEN: "verification-only-token",
    };
    const { app } = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verification-only-token&hub.challenge=54321",
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("54321");
    expect(postResponse.statusCode).toBe(404);
  });

  it("protects test endpoints", async () => {
    const { app } = await buildApp(testConfig());

    const response = await app.inject({
      method: "POST",
      url: "/api/test/messages",
      payload: {
        externalMessageId: "message-1",
        externalUserId: "user-1",
        text: "How should books be organized?",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });

  it("processes a Postman-style text request", async () => {
    const { app } = await buildApp(testConfig());

    const response = await app.inject({
      method: "POST",
      url: "/api/test/messages",
      headers: { "x-test-token": "test-token" },
      payload: {
        externalMessageId: "message-2",
        externalUserId: "user-2",
        text: "How should I set up a child-friendly library space?",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "answered",
      citations: [{ chunkId: "sal-0423ac330bdd" }],
    });
  });
});
