export type SupportedLanguage = "en" | "sw" | "mixed" | "unknown";

export type ConversationStatus =
  | "bot"
  | "waiting_for_human"
  | "human"
  | "closed";

export interface SupportMessage {
  externalMessageId: string;
  externalUserId: string;
  type: "text" | "voice";
  text: string;
  receivedAt: string;
}

export interface ChatMessage {
  senderType: "user" | "assistant" | "staff" | "system";
  content: string;
  createdAt: string;
}

export interface SupportModelResult {
  language: SupportedLanguage;
  answer: string;
  supported: boolean;
  citedChunkIds: string[];
  requiresHuman: boolean;
  handoffReason?: string;
}

export interface Citation {
  chunkId: string;
  title: string;
  chapter: string;
  pages: string;
}

export type SupportResponse =
  | {
      status: "answered";
      conversationId: string;
      language: SupportedLanguage;
      answer: string;
      citations: Citation[];
      presentation?: "topic_shortcuts" | "staff_options";
    }
  | {
      status: "handoff";
      conversationId: string;
      language: SupportedLanguage;
      answer: string;
      reason: string;
    }
  | {
      status: "human_active";
      conversationId: string;
      language: SupportedLanguage;
      answer: string;
    }
  | {
      status: "closed";
      conversationId: string;
      language: SupportedLanguage;
      answer: string;
    }
  | {
      status: "duplicate";
      conversationId: string;
    };
