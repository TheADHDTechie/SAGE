import { describe, expect, it } from "vitest";
import { detectLanguage, routeByPolicy } from "../src/policy/policy-router.js";

describe("policy routing", () => {
  it("detects a Kiswahili enquiry", () => {
    expect(detectLanguage("Ninawezaje kupanga vitabu katika maktaba?")).toBe("sw");
  });

  it("sends a natural human request to the unified model router", () => {
    expect(
      routeByPolicy("I want to speak with a staff member").action,
    ).toBe("continue");
  });

  it.each(["STAFF", "HUMAN", "AGENT", "MFANYAKAZI", "MHUDUMU"])(
    "routes the explicit staff command %s",
    (message) => {
      expect(routeByPolicy(message).action).toBe("handoff");
    },
  );

  it.each(["PERSON", "REPRESENTATIVE"])(
    "sends the non-command human term %s to the unified model router",
    (message) => {
      expect(routeByPolicy(message).action).toBe("continue");
    },
  );

  it("routes safeguarding language to staff", () => {
    const decision = routeByPolicy("A child reported physical punishment");

    expect(decision.action).toBe("handoff");
    if (decision.action === "handoff") {
      expect(decision.reason).toBe("safeguarding");
    }
  });

  it.each([
    ["Hello!", "en"],
    ["Good morning", "en"],
    ["Thank you very much", "en"],
    ["Jambo", "sw"],
    ["Habari mwalimu", "sw"],
    ["Asante sana", "sw"],
  ] as const)(
    "sends the social message %s to the unified model router",
    (message, _language) => {
      expect(routeByPolicy(message).action).toBe("continue");
    },
  );

  it("continues when a greeting includes a manual question", () => {
    expect(
      routeByPolicy("Hi, how should I organize library books?").action,
    ).toBe("continue");
  });

  it("continues when gratitude includes a manual question", () => {
    expect(
      routeByPolicy(
        "Thank you, but how should I record borrowed books?",
      ).action,
    ).toBe("continue");
  });

  it("does not treat a reference to a teacher as a human-support request", () => {
    expect(
      routeByPolicy("What should a teacher librarian do each morning?").action,
    ).toBe("continue");
  });

  it("does not treat a question about library staff as a handoff request", () => {
    expect(
      routeByPolicy("What are the responsibilities of library staff?").action,
    ).toBe("continue");
  });

  it("sends unrelated messages to the unified model router", () => {
    expect(routeByPolicy("What is the weather today?").action).toBe(
      "continue",
    );
  });

  it("closes an opt-out conversation", () => {
    expect(routeByPolicy("STOP").action).toBe("close");
  });

  it.each(["BOT", "bot", "BOT!"])(
    "routes the chatbot resume command %s",
    (message) => {
      expect(routeByPolicy(message).action).toBe("resume");
    },
  );
});
