export interface WhatsAppMedia {
  bytes: Uint8Array;
  mimeType: string;
}

export interface WhatsAppSendResult {
  messageIds: string[];
}

export interface WhatsAppListMessage {
  body: string;
  button: string;
  sections: Array<{
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

export interface WhatsAppButtonMessage {
  body: string;
  buttons: Array<{
    id: string;
    title: string;
  }>;
}

export interface WhatsAppGateway {
  downloadMedia(mediaId: string): Promise<WhatsAppMedia>;
  uploadAudio(input: {
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }): Promise<{ mediaId: string }>;
  markRead(messageId: string): Promise<void>;
  sendText(input: {
    to: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult>;
  sendAudio(input: {
    to: string;
    mediaId: string;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult>;
  sendList(input: {
    to: string;
    list: WhatsAppListMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult>;
  sendButtons(input: {
    to: string;
    message: WhatsAppButtonMessage;
    replyToMessageId?: string;
  }): Promise<WhatsAppSendResult>;
}
