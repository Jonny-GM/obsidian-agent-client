import type AgentClientPlugin from "../plugin";
import type {
	ChatHistoryEntry,
	ChatHistoryRecord,
	SerializedChatMessage,
} from "../domain/models/chat-history";
import type { ChatMessage } from "../domain/models/chat-message";
import type { ChatSession } from "../domain/models/chat-session";
import { Logger } from "./logger";
import { TFile, TFolder } from "obsidian";

const SCHEMA_VERSION = 1;
const CONFLICT_MARKER = "(conflict";
const HISTORY_TAGS = ["agent-client"];

export class ChatHistoryStore {
	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = new Logger(plugin);
	}

	async listChats(): Promise<ChatHistoryEntry[]> {
		const folder = await this.ensureFolderExists();
		if (!folder) {
			return [];
		}

		const entries: ChatHistoryEntry[] = [];

		for (const child of folder.children) {
			if (!(child instanceof TFile)) {
				continue;
			}
			if (!child.path.endsWith(".json")) {
				continue;
			}
			try {
				const raw = await this.plugin.app.vault.read(child);
				const record = this.parseRecord(raw);
				if (!record) {
					continue;
				}
				entries.push({
					chatId: record.chatId,
					path: child.path,
					agentId: record.agentId,
					agentDisplayName: record.agentDisplayName,
					createdAt: new Date(record.createdAt),
					updatedAt: new Date(record.updatedAt),
					messageCount: record.messageCount,
					title: record.title,
					isConflict: child.path.includes(CONFLICT_MARKER),
				});
			} catch (error) {
				this.logger.error(
					"[ChatHistoryStore] Failed to read chat history entry",
					child.path,
					error,
				);
			}
		}

		return entries.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async loadChat(path: string): Promise<ChatHistoryRecord | null> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}
		try {
			const raw = await this.plugin.app.vault.read(file);
			return this.parseRecord(raw);
		} catch (error) {
			this.logger.error(
				"[ChatHistoryStore] Failed to load chat history file",
				path,
				error,
			);
			return null;
		}
	}

	async saveChat(
		session: ChatSession,
		messages: ChatMessage[],
		chatId: string,
		startedAt: Date,
		existingPath?: string | null,
	): Promise<{ path: string; record: ChatHistoryRecord } | null> {
		if (messages.length === 0) {
			return null;
		}

		const record: ChatHistoryRecord = {
			schemaVersion: SCHEMA_VERSION,
			chatId,
			sessionId: session.sessionId,
			agentId: session.agentId,
			agentDisplayName: session.agentDisplayName,
			createdAt: startedAt.toISOString(),
			updatedAt: new Date().toISOString(),
			messageCount: messages.length,
			tags: HISTORY_TAGS,
			title: deriveChatTitle(messages),
			messages: serializeMessages(messages),
		};

		const path = existingPath || (await this.createHistoryPath(record));
		if (!path) {
			return null;
		}

		const content = JSON.stringify(record, null, 2);
		const existingFile =
			this.plugin.app.vault.getAbstractFileByPath(path);

		try {
			if (existingFile instanceof TFile) {
				await this.plugin.app.vault.modify(existingFile, content);
			} else {
				await this.plugin.app.vault.create(path, content);
			}
			return { path, record };
		} catch (error) {
			this.logger.error(
				"[ChatHistoryStore] Failed to save chat history file",
				path,
				error,
			);
			return null;
		}
	}

	private async ensureFolderExists(): Promise<TFolder | null> {
		const folderPath = this.plugin.settings.historySettings.defaultFolder;
		const existing =
			this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) {
			return existing;
		}
		if (existing) {
			this.logger.error(
				"[ChatHistoryStore] History folder path exists but is not a folder",
				folderPath,
			);
			return null;
		}
		try {
			await this.plugin.app.vault.createFolder(folderPath);
			return this.plugin.app.vault.getAbstractFileByPath(
				folderPath,
			) as TFolder | null;
		} catch (error) {
			this.logger.error(
				"[ChatHistoryStore] Failed to create history folder",
				folderPath,
				error,
			);
			return null;
		}
	}

	private parseRecord(raw: string): ChatHistoryRecord | null {
		try {
			const parsed = JSON.parse(raw) as ChatHistoryRecord;
			if (
				parsed &&
				parsed.schemaVersion === SCHEMA_VERSION &&
				parsed.chatId &&
				parsed.messages
			) {
				return parsed;
			}
			return null;
		} catch (error) {
			this.logger.error(
				"[ChatHistoryStore] Failed to parse chat history JSON",
				error,
			);
			return null;
		}
	}

	private async createHistoryPath(
		record: ChatHistoryRecord,
	): Promise<string | null> {
		const folderPath = this.plugin.settings.historySettings.defaultFolder;
		const folder = await this.ensureFolderExists();
		if (!folder) {
			return null;
		}

		const createdAt = new Date(record.createdAt);
		const dateStr = `${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, "0")}${String(
			createdAt.getDate(),
		).padStart(2, "0")}`;
		const timeStr = `${String(createdAt.getHours()).padStart(2, "0")}${String(
			createdAt.getMinutes(),
		).padStart(2, "0")}${String(createdAt.getSeconds()).padStart(2, "0")}`;
		const fileName = `chat_${dateStr}_${timeStr}_${record.chatId}.json`;

		return `${folderPath}/${fileName}`;
	}
}

function serializeMessages(messages: ChatMessage[]): SerializedChatMessage[] {
	return messages.map((message) => ({
		...message,
		timestamp: message.timestamp.toISOString(),
	}));
}

function deriveChatTitle(messages: ChatMessage[]): string | undefined {
	const firstUser = messages.find((message) => message.role === "user");
	if (!firstUser) {
		return undefined;
	}
	for (const content of firstUser.content) {
		if (content.type === "text" || content.type === "text_with_context") {
			const text = content.text.trim();
			if (text.length === 0) {
				continue;
			}
			return text.length > 80 ? `${text.slice(0, 77)}...` : text;
		}
	}
	return undefined;
}

export function deserializeMessages(
	messages: SerializedChatMessage[],
): ChatMessage[] {
	return messages.map((message) => ({
		...message,
		timestamp: new Date(message.timestamp),
	}));
}
