import type { SupportedLanguage } from "../domain/types.js";

export type PolicyDecision =
  | { action: "continue"; language: SupportedLanguage }
  | {
      action: "respond";
      language: SupportedLanguage;
      response: string;
      socialIntent: "greeting" | "closing";
      closingStyle?: "gratitude" | "farewell";
      briefResponse?: string;
    }
  | { action: "handoff"; language: SupportedLanguage; reason: string; response: string }
  | { action: "resume"; language: SupportedLanguage; response: string }
  | { action: "close"; language: SupportedLanguage; response: string };

const kiswahiliSignals = [
  "naomba",
  "nina",
  "nini",
  "vipi",
  "jinsi",
  "maktaba",
  "vitabu",
  "kusoma",
  "mtoto",
  "watoto",
  "mwalimu",
  "tafadhali",
  "jambo",
  "habari",
  "hujambo",
  "mambo",
  "shikamoo",
  "asante",
  "nashukuru",
  "kwaheri",
];

const humanPatterns = [
  /\b(human|person|agent|staff|representative)\b/i,
  /\b(talk|speak|chat)\s+(to|with)\b/i,
  /\b(zungumza|ongea)\s+na\b/i,
  /\b(nataka|naomba|nahitaji)\b.{0,30}\b(mtu|mfanyakazi|afisa)\b/i,
  /\b(niunganishe|nipatie)\b.{0,30}\b(mtu|mfanyakazi|afisa)\b/i,
];

const stopPatterns = [
  /^\s*(stop|unsubscribe|cancel)\s*$/i,
  /^\s*(acha|sitisha)\s*$/i,
];

const resumeBotPattern = /^\s*bot\s*[!.]*\s*$/i;

const safeguardingPatterns = [
  /\b(child abuse|abuse a child|sexual abuse|physical punishment|unsafe child)\b/i,
  /\b(learner|child).{0,30}\bunsafe\b/i,
  /\b(harass|violence|assault|threaten|threatened)\b/i,
  /\b(unyanyasaji|ukatili|adhabu ya mwili|mtoto.*hatari|usalama wa mtoto)\b/i,
];

const obviousOutOfScopePatterns = [
  /\b(weather|football match|bank loan|medical condition|email password)\b/i,
  /\b(exchange rate|airline ticket|legal contract|car engine)\b/i,
  /\b(stock prices|order dinner|passport|transfer money|airport)\b/i,
  /\b(sell me a mobile phone)\b/i,
];

const greetingPatterns = [
  /^(?:(?:hi|hello|hey)(?:\s+there|\s+sage)?|good\s+(?:morning|afternoon|evening)|greetings)[!.]*$/i,
  /^(?:jambo|hujambo|mambo|shikamoo|habari)(?:\s+(?:yako|zako|sage|mwalimu))?[!.]*$/i,
  /^habari\s+za\s+(?:asubuhi|mchana|jioni)[!.]*$/i,
];

const gratitudePatterns = [
  /^(?:thank\s+you|thanks)(?:\s+(?:so\s+much|very\s+much|a\s+lot|for\s+(?:your\s+)?help|for\s+helping(?:\s+me)?))?[!.]*$/i,
  /^(?:that(?:'s| is)\s+all|that\s+will\s+be\s+all)[!.]*$/i,
  /^(?:asante)(?:\s+(?:sana|kwa\s+(?:msaada|kunisaidia)))?[!.]*$/i,
  /^(?:nashukuru)(?:\s+kwa\s+(?:msaada|kunisaidia))?[!.]*$/i,
];

const farewellPatterns = [
  /^(?:bye|goodbye|bye\s+for\s+now|see\s+you|see\s+you\s+later)[!.]*$/i,
  /^(?:kwaheri|tutaonana)[!.]*$/i,
];

const greetingResponses: Record<"en" | "sw", string> = {
  en: "Hello! I'm SAGE. You can type any question or send a voice note about your school library. You can also use the optional topic shortcuts.",
  sw: "Habari! Mimi ni SAGE. Unaweza kuandika swali lolote au kutuma ujumbe wa sauti kuhusu maktaba ya shule. Pia unaweza kutumia mada za mkato.",
};

const closingResponses: Record<"en" | "sw", string> = {
  en: "You're welcome! I'm glad I could help. You can message SAGE anytime if you have another school library question.",
  sw: "Karibu! Nimefurahi kukusaidia. Unaweza kumtumia SAGE ujumbe wakati wowote ukiwa na swali lingine kuhusu maktaba ya shule.",
};

const briefFarewellResponses: Record<"en" | "sw", string> = {
  en: "Goodbye!",
  sw: "Kwaheri!",
};

export function routeByPolicy(message: string): PolicyDecision {
  const language = detectLanguage(message);

  if (resumeBotPattern.test(message)) {
    return {
      action: "resume",
      language,
      response:
        "The handoff has been cancelled. You are now back with the SAGE chatbot. How can I help?",
    };
  }

  if (stopPatterns.some((pattern) => pattern.test(message))) {
    return {
      action: "close",
      language,
      response:
        language === "sw"
          ? "Mazungumzo haya yamefungwa. Unaweza kututumia ujumbe mpya wakati wowote ukihitaji msaada."
          : "This conversation is now closed. You can message us again whenever you need support.",
    };
  }

  if (safeguardingPatterns.some((pattern) => pattern.test(message))) {
    return {
      action: "handoff",
      language,
      reason: "safeguarding",
      response:
        language === "sw"
          ? "Asante kwa kutueleza. Nimepeleka ujumbe wako kwa mfanyakazi wa SAL ili akusaidie moja kwa moja."
          : "Thank you for telling us. I have forwarded your message to a SAL staff member for direct support.",
    };
  }

  if (humanPatterns.some((pattern) => pattern.test(message))) {
    return {
      action: "handoff",
      language,
      reason: "user_requested_human",
      response:
        language === "sw"
          ? "Nimepeleka swali lako kwa mfanyakazi wa SAL, ambaye anaweza kujibu katika mazungumzo haya."
          : "I have forwarded your question to a SAL staff member, who can reply in this conversation.",
    };
  }

  if (greetingPatterns.some((pattern) => pattern.test(message.trim()))) {
    const responseLanguage = language === "sw" || language === "mixed" ? "sw" : "en";
    return {
      action: "respond",
      language: responseLanguage,
      response: greetingResponses[responseLanguage],
      socialIntent: "greeting",
    };
  }

  if (gratitudePatterns.some((pattern) => pattern.test(message.trim()))) {
    const responseLanguage = language === "sw" || language === "mixed" ? "sw" : "en";
    return {
      action: "respond",
      language: responseLanguage,
      response: closingResponses[responseLanguage],
      socialIntent: "closing",
      closingStyle: "gratitude",
    };
  }

  if (farewellPatterns.some((pattern) => pattern.test(message.trim()))) {
    const responseLanguage = language === "sw" || language === "mixed" ? "sw" : "en";
    return {
      action: "respond",
      language: responseLanguage,
      response: closingResponses[responseLanguage],
      socialIntent: "closing",
      closingStyle: "farewell",
      briefResponse: briefFarewellResponses[responseLanguage],
    };
  }

  if (obviousOutOfScopePatterns.some((pattern) => pattern.test(message))) {
    return {
      action: "handoff",
      language,
      reason: "out_of_scope",
      response:
        language === "sw"
          ? "Sikuweza kuthibitisha hilo kutoka kwenye mwongozo wa SAL. Nimepeleka swali lako kwa mfanyakazi wa SAL."
          : "I could not confirm that from the SAL guide. I have forwarded your question to a SAL staff member.",
    };
  }

  return { action: "continue", language };
}

export function isFullClosingResponse(message: string) {
  return Object.values(closingResponses).includes(message);
}

export function detectLanguage(message: string): SupportedLanguage {
  const normalized = message.toLowerCase();
  const matches = kiswahiliSignals.filter((word) =>
    new RegExp(`\\b${escapeRegex(word)}\\b`, "i").test(normalized),
  ).length;
  return matches >= 2 ? "sw" : matches === 1 ? "mixed" : "en";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
