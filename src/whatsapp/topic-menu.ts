import type {
  WhatsAppButtonMessage,
  WhatsAppListMessage,
} from "../gateways/whatsapp.js";

export type TopicMenuLanguage = "en" | "sw";

interface TopicDefinition {
  slug: string;
  title: Record<TopicMenuLanguage, string>;
  description: Record<TopicMenuLanguage, string>;
  question: Record<TopicMenuLanguage, string>;
}

const topics: TopicDefinition[] = [
  {
    slug: "arrange-books",
    title: { en: "Arrange books", sw: "Panga vitabu" },
    description: {
      en: "Organize books for easy use",
      sw: "Panga vitabu kwa matumizi rahisi",
    },
    question: {
      en: "How should books be organized and arranged in a school library?",
      sw: "Vitabu vinapaswa kupangwa vipi katika maktaba ya shule?",
    },
  },
  {
    slug: "start-library",
    title: { en: "Start a library", sw: "Anzisha maktaba" },
    description: {
      en: "Set up a child-friendly library",
      sw: "Anzisha maktaba rafiki kwa watoto",
    },
    question: {
      en: "How should we set up a child-friendly school library?",
      sw: "Tunaanzaje maktaba ya shule iliyo rafiki kwa watoto?",
    },
  },
  {
    slug: "borrowing",
    title: { en: "Borrowing books", sw: "Kuazima vitabu" },
    description: {
      en: "Manage borrowing and returns",
      sw: "Simamia kuazima na kurudisha",
    },
    question: {
      en: "How should a school library manage borrowing and returning books?",
      sw: "Maktaba ya shule isimamieje kuazima na kurudisha vitabu?",
    },
  },
  {
    slug: "library-records",
    title: { en: "Library records", sw: "Rekodi za maktaba" },
    description: {
      en: "Keep useful library records",
      sw: "Tunza rekodi muhimu za maktaba",
    },
    question: {
      en: "What records should a school library keep and how should they be used?",
      sw: "Maktaba ya shule inapaswa kutunza rekodi gani na kuzitumiaje?",
    },
  },
  {
    slug: "reading-activities",
    title: { en: "Reading activities", sw: "Shughuli za kusoma" },
    description: {
      en: "Encourage children to read",
      sw: "Wahimize watoto kusoma",
    },
    question: {
      en: "What reading activities can a school library organize for children?",
      sw: "Maktaba ya shule inaweza kuandaa shughuli gani za kusoma kwa watoto?",
    },
  },
  {
    slug: "care-for-books",
    title: { en: "Care for books", sw: "Tunza vitabu" },
    description: {
      en: "Protect and repair books",
      sw: "Linda na rekebisha vitabu",
    },
    question: {
      en: "How should a school library care for, protect, and repair books?",
      sw: "Maktaba ya shule inapaswa kutunza, kulinda na kurekebisha vitabu vipi?",
    },
  },
  {
    slug: "teacher-librarian",
    title: { en: "Teacher librarian", sw: "Mwalimu wa maktaba" },
    description: {
      en: "Understand the role and duties",
      sw: "Elewa wajibu na majukumu",
    },
    question: {
      en: "What are the responsibilities of a teacher librarian?",
      sw: "Majukumu ya mwalimu wa maktaba ni yapi?",
    },
  },
];

export function topicShortcutMessage(
  language: TopicMenuLanguage,
): WhatsAppButtonMessage {
  const prefix = `topic:${language}:`;
  if (language === "sw") {
    return {
      body: "Habari! Mimi ni SAGE. Unaweza kuandika swali lolote au kutuma ujumbe wa sauti kuhusu maktaba ya shule. Pia unaweza kutumia njia hizi za mkato.",
      buttons: [
        { id: `${prefix}arrange-books`, title: "Panga vitabu" },
        { id: `${prefix}start-library`, title: "Anzisha maktaba" },
        { id: `menu:${language}:topics`, title: "Mada zaidi" },
      ],
    };
  }
  return {
    body: "Hello! I'm SAGE. You can type any question or send a voice note about your school library. You can also use these optional shortcuts.",
    buttons: [
      { id: `${prefix}arrange-books`, title: "Arrange books" },
      { id: `${prefix}start-library`, title: "Start a library" },
      { id: `menu:${language}:topics`, title: "More topics" },
    ],
  };
}

export function topicList(language: TopicMenuLanguage): WhatsAppListMessage {
  return {
    body:
      language === "sw"
        ? "Chagua mada ya mkato, au andika swali lolote moja kwa moja."
        : "Choose an optional topic shortcut, or type any question directly.",
    button: language === "sw" ? "Chagua mada" : "Choose a topic",
    sections: [
      {
        title: language === "sw" ? "Mada maarufu" : "Popular topics",
        rows: topics.map((topic) => ({
          id: `topic:${language}:${topic.slug}`,
          title: topic.title[language],
          description: topic.description[language],
        })),
      },
    ],
  };
}

export function topicQuestion(
  selectionId: string,
): { language: TopicMenuLanguage; question: string } | undefined {
  const match = /^topic:(en|sw):([a-z-]+)$/.exec(selectionId);
  if (!match) {
    return undefined;
  }
  const language = match[1] as TopicMenuLanguage;
  const topic = topics.find((candidate) => candidate.slug === match[2]);
  return topic ? { language, question: topic.question[language] } : undefined;
}

export function topicListSelection(
  selectionId: string,
): TopicMenuLanguage | undefined {
  const match = /^menu:(en|sw):topics$/.exec(selectionId);
  return match?.[1] as TopicMenuLanguage | undefined;
}

export function parseTopicMenuCommand(
  message: string,
): TopicMenuLanguage | undefined {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (["menu", "topics"].includes(normalized)) {
    return "en";
  }
  if (["mada", "msaada"].includes(normalized)) {
    return "sw";
  }
  return undefined;
}

export function topicMenuTextFallback(language: TopicMenuLanguage) {
  return language === "sw"
    ? "Unaweza kuandika swali lolote au kutuma ujumbe wa sauti kuhusu maktaba ya shule. Mada maarufu ni kupanga vitabu, kuanzisha maktaba, kuazima vitabu, rekodi, shughuli za kusoma na kutunza vitabu. Tuma MADA kuona orodha tena."
    : "You can type any question or send a voice note about your school library. Popular topics include arranging books, starting a library, borrowing, records, reading activities, and caring for books. Send TOPICS to see the menu again.";
}
