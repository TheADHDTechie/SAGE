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

  it("closes an opt-out conversation", () => {
    expect(routeByPolicy("STOP").action).toBe("close");
  });
});
