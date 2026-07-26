export type ChatChannel =
  | 'GLOBAL'
  | 'REALM'
  | 'MAP'
  | 'PARTY'
  | 'GUILD'
  | 'PRIVATE'
  | 'SYSTEM';

export interface ChatMessageCommand {
  requestId: string;
  channel: ChatChannel;
  content: string;
  targetCharacterId?: string;
}

export interface ChatMessageEvent {
  messageId: string;
  channel: ChatChannel;
  senderCharacterId?: string;
  senderName?: string;
  targetCharacterId?: string;
  content: string;
  createdAt: string;
}
