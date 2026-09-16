import { describe, expect, it } from "vitest";
import {
  parseTopicMenuCommand,
  topicList,
  topicListSelection,
  topicQuestion,
  topicShortcutMessage,
} from "../src/whatsapp/topic-menu.js";

describe("topic menu", () => {
  it("maps stable topic IDs to canonical localized questions", () => {
    expect(topicQuestion("topic:en:arrange-books")).toEqual({
      language: "en",
      question:
        "How should books be organized and arranged in a school library?",
    });
    expect(topicQuestion("topic:sw:arrange-books")).toEqual({
      language: "sw",
      question: "Vitabu vinapaswa kupangwa vipi katika maktaba ya shule?",
    });
    expect(topicQuestion("topic:en:unknown")).toBeUndefined();
  });

  it("provides three shortcuts and seven full-list topics", () => {
    expect(topicShortcutMessage("en").buttons).toHaveLength(3);
    expect(topicList("en").sections[0]?.rows).toHaveLength(7);
  });

  it("recognizes menu selections and typed commands", () => {
    expect(topicListSelection("menu:en:topics")).toBe("en");
    expect(topicListSelection("menu:sw:topics")).toBe("sw");
    expect(parseTopicMenuCommand("TOPICS!")).toBe("en");
    expect(parseTopicMenuCommand("MADA")).toBe("sw");
  });
});
