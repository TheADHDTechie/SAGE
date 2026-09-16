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
    });

export interface WhatsAppDeliveryPlan {
  steps: WhatsAppDeliveryStep[];
}
