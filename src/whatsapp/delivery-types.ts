export type ReplyMode = "auto" | "text" | "voice" | "both";

interface DeliveryStepState {
  messageIds?: string[];
}

export type WhatsAppDeliveryStep =
  | (DeliveryStepState & {
      kind: "text";
      body: string;
    })
  | (DeliveryStepState & {
      kind: "audio";
      mediaId: string;
    })
  | (DeliveryStepState & {
      kind: "list";
      language: "en" | "sw";
      currentMode: ReplyMode;
    })
  | (DeliveryStepState & {
      kind: "topic_shortcuts";
      language: "en" | "sw";
    })
  | (DeliveryStepState & {
      kind: "topic_list";
      language: "en" | "sw";
    });

export interface WhatsAppDeliveryPlan {
  steps: WhatsAppDeliveryStep[];
}
