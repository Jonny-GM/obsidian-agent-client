import type { ChatMessage } from "./chat-message";

export interface SerializedChatMessage
	extends Omit<ChatMessage, "timestamp"> {
	timestamp: string;
}

export interface ChatHistoryRecord {
	schemaVersion: 1;
	chatId: string;
	sessionId: string | null;
	agentId: string;
	agentDisplayName: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	tags?: string[];
	title?: string;
	messages: SerializedChatMessage[];
}

export interface ChatHistoryEntry {
	chatId: string;
	path: string;
	agentId: string;
	agentDisplayName: string;
	createdAt: Date;
	updatedAt: Date;
	messageCount: number;
	title?: string;
	isConflict: boolean;
}
