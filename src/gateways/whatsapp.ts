export interface WhatsAppMedia {
  bytes: Uint8Array;
  mimeType: string;
}

export interface WhatsAppSendResult {
  messageIds: string[];
}

export interface WhatsAppGateway {
  downloadMedia(mediaId: string): Promise<WhatsAppMedia>;
  markRead(messageId: string): Promise<void>;
  sendText(input: {
    to: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult>;
}
