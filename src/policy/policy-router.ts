import type { SupportedLanguage } from "../domain/types.js";

export type PolicyDecision =
  | { action: "continue"; language: SupportedLanguage }
  | { action: "respond"; language: SupportedLanguage; response: string }
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

const socialPatterns = [
  /^(?:(?:hi|hello|hey)(?:\s+there|\s+sage)?|good\s+(?:morning|afternoon|evening)|greetings)[!.]*$/i,
  /^(?:thank\s+you|thanks)(?:\s+(?:very\s+much|a\s+lot))?[!.]*$/i,
  /^(?:jambo|hujambo|mambo|shikamoo|habari)(?:\s+(?:yako|zako|sage|mwalimu))?[!.]*$/i,
  /^habari\s+za\s+(?:asubuhi|mchana|jioni)[!.]*$/i,
  /^asante(?:\s+sana)?[!.]*$/i,
];

const socialResponses: Record<"en" | "sw", string> = {
  en: "Hello! I'm SAGE, the Start A Library support assistant. I can help with questions about setting up and running a school library. What would you like help with?",
  sw: "Habari! Mimi ni SAGE, msaidizi wa Start A Library. Ninaweza kusaidia kuhusu kuanzisha na kuendesha maktaba ya shule. Ungependa kusaidiwa na nini?",
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

  if (socialPatterns.some((pattern) => pattern.test(message.trim()))) {
    const responseLanguage = language === "sw" || language === "mixed" ? "sw" : "en";
    return {
      action: "respond",
      language: responseLanguage,
      response: socialResponses[responseLanguage],
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
