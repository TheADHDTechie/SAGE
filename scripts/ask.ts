import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  baseUrl: z.url(),
  userId: z.string().min(1),
  testToken: z.string().min(1),
});

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: npm run ask -- "How should I organize library books?"');
  process.exit(1);
}

const configPath = path.resolve("ask.config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "ask.config.json is missing. Copy ask.config.example.json and configure it.",
  );
  process.exit(1);
}

const config = configSchema.parse(
  JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown,
);

const response = await fetch(`${config.baseUrl}/api/test/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Test-Token": config.testToken,
  },
  body: JSON.stringify({
    externalMessageId: randomUUID(),
    externalUserId: config.userId,
    type: "text",
    text,
    receivedAt: new Date().toISOString(),
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Request failed with HTTP ${response.status}`);
  console.error(body);
  process.exit(1);
}

try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}
