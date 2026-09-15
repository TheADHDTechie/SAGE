import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { ConversationStore } from "../src/infrastructure/database.js";

const cliConfigSchema = z.object({
  userId: z.string().min(1),
});

const configPath = path.resolve("ask.config.json");
const configuredUserId = fs.existsSync(configPath)
  ? cliConfigSchema.parse(
      JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown,
    ).userId
  : undefined;
const userId = process.argv.slice(2).join(" ").trim() || configuredUserId;

if (!userId) {
  console.error(
    'Usage: npm run reset-conversation -- "user-id", or configure userId in ask.config.json',
  );
  process.exit(1);
}

const config = loadConfig();
const store = new ConversationStore(
  path.join(config.DATA_DIR, "app.db"),
  config.CONTACT_HASH_KEY,
);

try {
  const resetCount = store.resetConversationForUser(userId);
  console.log(
    JSON.stringify(
      {
        userId,
        resetConversations: resetCount,
        status:
          resetCount > 0
            ? "The next message will start a new bot conversation."
            : "No active conversation was found. The next message will start normally.",
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
