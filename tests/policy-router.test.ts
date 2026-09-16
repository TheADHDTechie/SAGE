import { describe, expect, it } from "vitest";
import { detectLanguage, routeByPolicy } from "../src/policy/policy-router.js";

describe("policy routing", () => {
  it("detects a Kiswahili enquiry", () => {
    expect(detectLanguage("Ninawezaje kupanga vitabu katika maktaba?")).toBe("sw");
  });

  it("routes an explicit human request", () => {
    const decision = routeByPolicy("I want to speak with a staff member");

    expect(decision.action).toBe("handoff");
    if (decision.action === "handoff") {
      expect(decision.reason).toBe("user_requested_human");
    }
  });

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
  ] as const)("responds directly to the social message %s", (message, language) => {
    const decision = routeByPolicy(message);

    expect(decision.action).toBe("respond");
    expect(decision.language).toBe(language);
  });

  it.each([
    ["Thank you for your help", "en", "gratitude"],
    ["Bye for now", "en", "farewell"],
    ["Asante kwa msaada", "sw", "gratitude"],
    ["Kwaheri", "sw", "farewell"],
  ] as const)(
    "recognizes the closing message %s",
    (message, language, closingStyle) => {
      const decision = routeByPolicy(message);

      expect(decision.action).toBe("respond");
      if (decision.action === "respond") {
        expect(decision.socialIntent).toBe("closing");
        expect(decision.closingStyle).toBe(closingStyle);
        expect(decision.language).toBe(language);
      }
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
