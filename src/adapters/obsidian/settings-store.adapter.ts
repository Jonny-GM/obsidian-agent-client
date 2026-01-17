/**
 * Settings Store Adapter
 *
 * Reactive settings store implementing ISettingAccess port.
 * Manages plugin settings state with observer pattern for React integration
 * via useSyncExternalStore, and handles persistence to Obsidian's data.json.
 */

import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type {
	ChatMessage,
	MessageContent,
} from "../../domain/models/chat-message";
import type { SessionInfo } from "../../domain/models/session-info";

/** Listener callback invoked when settings change */
type Listener = () => void;

/**
 * Serialized format for session message files.
 *
 * Used for type-safe JSON parsing of session history files.
 */
interface SessionMessagesFile {
	version: number;
	sessionId: string;
	agentId: string;
	cwd?: string;
	messages: Array<{
		id: string;
		role: "user" | "assistant";
		content: MessageContent[];
		timestamp: string;
	}>;
	savedAt: string;
}

/**
 * Observable store for plugin settings implementing ISettingsAccess port.
 *
 * Manages plugin settings state and notifies subscribers of changes.
 * Designed to work with React's useSyncExternalStore hook for
 * automatic re-rendering when settings update.
 *
 * Pattern: Observer/Publisher-Subscriber
 */
export class SettingsStore implements ISettingsAccess {
	/** Current settings state */
	private state: AgentClientPluginSettings;

	/** Set of registered listeners */
	private listeners = new Set<Listener>();

	/** Plugin instance for persistence */
	private plugin: AgentClientPlugin;

	/**
	 * Create a new settings store.
	 *
	 * @param initial - Initial settings state
	 * @param plugin - Plugin instance for saving settings
	 */
	constructor(initial: AgentClientPluginSettings, plugin: AgentClientPlugin) {
		this.state = initial;
		this.plugin = plugin;
	}

	/**
	 * Get current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot = (): AgentClientPluginSettings => this.state;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings, notifies subscribers,
	 * and persists changes to disk.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	async updateSettings(
		updates: Partial<AgentClientPluginSettings>,
	): Promise<void> {
		if (this.plugin.settings.debugMode) {
			console.debug("[Agent Client] SettingsStore updateSettings", {
				updates: Object.keys(updates),
			});
		}
		const next = { ...this.state, ...updates };
		this.state = next;
		this.plugin.settings = next;

		// Sync with plugin.settings (required for saveSettings to persist correctly)
		this.plugin.settings = next;

		// Notify all subscribers
		for (const listener of this.listeners) {
			listener();
		}

		// Persist to disk
		await this.plugin.saveSettings();
	}

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated via updateSettings().
	 * Used by React's useSyncExternalStore to detect changes.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Set entire settings object (legacy method).
	 *
	 * For backward compatibility with existing code.
	 * Delegates to updateSettings() for async persistence.
	 *
	 * @param next - New settings object
	 */
	set(next: AgentClientPluginSettings): void {
		// Delegate to async updateSettings
		// Note: Fire-and-forget - callers don't expect this to be async
		void this.updateSettings(next);
	}

	// ============================================================
	// Session Storage Methods
	// ============================================================

	/**
	 * Delete a session by sessionId.
	 *
	 * @param sessionId - ID of session to delete
	 * @returns Promise that resolves when session is deleted
	 */
	async deleteSession(sessionId: string): Promise<void> {
		await this.deleteSessionMessages(sessionId);
	}

	/**
	 * List sessions derived from per-session message files.
	 *
	 * @param agentId - Optional filter by agent ID
	 * @param cwd - Optional filter by working directory
	 * @returns Array of session metadata
	 */
	async listSessionFiles(
		agentId?: string,
		cwd?: string,
	): Promise<SessionInfo[]> {
		const adapter = this.plugin.app.vault.adapter;
		const sessionsDir = this.getSessionsDir();
		if (!(await adapter.exists(sessionsDir))) {
			return [];
		}

		const listResult = await adapter.list(sessionsDir);
		const sessionFiles = listResult.files.filter((file) =>
			file.endsWith(".json"),
		);

		const sessionsById = new Map<string, SessionInfo>();

		for (const filePath of sessionFiles) {
			const parsed = await this.parseSessionFile(filePath);
			if (!parsed) {
				continue;
			}

			if (agentId && parsed.agentId !== agentId) {
				continue;
			}

			if (cwd && parsed.cwd && parsed.cwd !== cwd) {
				continue;
			}

			const sessionInfo: SessionInfo = {
				sessionId: parsed.sessionId,
				cwd: parsed.cwd ?? cwd ?? "",
				title: parsed.title,
				updatedAt: parsed.updatedAt,
			};

			const existing = sessionsById.get(parsed.sessionId);
			if (
				!existing ||
				this.getTimestamp(parsed.updatedAt) >
					this.getTimestamp(existing.updatedAt)
			) {
				sessionsById.set(parsed.sessionId, sessionInfo);
			}
		}

		return Array.from(sessionsById.values()).sort(
			(a, b) =>
				this.getTimestamp(b.updatedAt) -
				this.getTimestamp(a.updatedAt),
		);
	}

	// ============================================================
	// Session Message History Methods
	// ============================================================

	/**
	 * Get the sessions directory path.
	 *
	 * Uses Vault#configDir to respect user's custom config folder.
	 *
	 * @returns Path to sessions directory
	 */
	private getSessionsDir(): string {
		return `${this.plugin.app.vault.configDir}/plugins/agent-client/sessions`;
	}

	/**
	 * Ensure the sessions directory exists.
	 *
	 * Creates the directory if it doesn't exist.
	 */
	private async ensureSessionsDir(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const sessionsDir = this.getSessionsDir();
		if (!(await adapter.exists(sessionsDir))) {
			await adapter.mkdir(sessionsDir);
		}
	}

	/**
	 * Get the file path for a session's message history.
	 *
	 * Sanitizes sessionId to ensure safe file names.
	 *
	 * @param sessionId - Session ID
	 * @returns File path for the session's messages
	 */
	private getSessionFilePath(sessionId: string): string {
		// Sanitize sessionId for safe file names (replace unsafe chars with _)
		const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
		return `${this.getSessionsDir()}/${safeId}.json`;
	}

	private getTimestamp(value?: string): number {
		if (!value) {
			return 0;
		}
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	private extractTitleFromMessages(
		messages: SessionMessagesFile["messages"],
	): string | undefined {
		const firstUserMessage = messages.find((message) => message.role === "user");
		if (!firstUserMessage) {
			return undefined;
		}

		for (const content of firstUserMessage.content) {
			if (content.type === "text" || content.type === "text_with_context") {
				const trimmed = content.text.trim();
				if (!trimmed) {
					return undefined;
				}
				if (trimmed.length > 50) {
					return `${trimmed.substring(0, 50)}...`;
				}
				return trimmed;
			}
		}

		return undefined;
	}

	private async parseSessionFile(filePath: string): Promise<{
		sessionId: string;
		agentId: string;
		cwd?: string;
		title?: string;
		updatedAt?: string;
	} | null> {
		const adapter = this.plugin.app.vault.adapter;

		try {
			const content = await adapter.read(filePath);
			const data = JSON.parse(content) as SessionMessagesFile;

			if (
				typeof data.version !== "number" ||
				typeof data.sessionId !== "string" ||
				typeof data.agentId !== "string" ||
				!Array.isArray(data.messages)
			) {
				return null;
			}

			if (data.version !== 1) {
				return null;
			}

			const updatedAt =
				data.messages.length > 0
					? data.messages[data.messages.length - 1].timestamp
					: data.savedAt;

			return {
				sessionId: data.sessionId,
				agentId: data.agentId,
				cwd: data.cwd,
				title: this.extractTitleFromMessages(data.messages),
				updatedAt,
			};
		} catch (error) {
			console.warn(
				`[SettingsStore] Failed to parse session file ${filePath}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Save message history for a session.
	 *
	 * Saves the full ChatMessage[] to a separate file.
	 * Overwrites existing file if present.
	 *
	 * @param sessionId - Session ID
	 * @param agentId - Agent ID for validation
	 * @param cwd - Working directory for the session
	 * @param messages - Chat messages to save
	 */
	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		cwd: string,
		messages: ChatMessage[],
	): Promise<void> {
		await this.ensureSessionsDir();

		// Serialize ChatMessage[] (convert timestamp: Date → string)
		const serialized = messages.map((msg) => ({
			...msg,
			timestamp: msg.timestamp.toISOString(),
		}));

		const data = {
			version: 1,
			sessionId,
			agentId,
			cwd,
			messages: serialized,
			savedAt: new Date().toISOString(),
		};

		const filePath = this.getSessionFilePath(sessionId);
		await this.plugin.app.vault.adapter.write(
			filePath,
			JSON.stringify(data, null, 2),
		);
	}

	/**
	 * Load message history for a session.
	 *
	 * Reads from sessions/{sessionId}.json file.
	 * Returns null if file doesn't exist or on error.
	 *
	 * @param sessionId - Session ID
	 * @returns Chat messages or null if not found
	 */
	async loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (!(await adapter.exists(filePath))) {
			return null;
		}

		try {
			const content = await adapter.read(filePath);
			const data = JSON.parse(content) as SessionMessagesFile;

			// Validate structure
			if (
				typeof data.version !== "number" ||
				!Array.isArray(data.messages)
			) {
				console.warn(
					`[SettingsStore] Invalid session file structure: ${filePath}`,
				);
				return null;
			}

			// Version check for future compatibility
			if (data.version !== 1) {
				console.warn(
					`[SettingsStore] Unknown session file version: ${data.version}`,
				);
				return null;
			}

			// Deserialize (convert timestamp: string → Date)
			return data.messages.map((msg) => ({
				...msg,
				timestamp: new Date(msg.timestamp),
			}));
		} catch (error) {
			console.error(
				`[SettingsStore] Failed to load session messages: ${error}`,
			);
			return null;
		}
	}

	/**
	 * Delete message history file for a session.
	 *
	 * Silently succeeds if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 */
	async deleteSessionMessages(sessionId: string): Promise<void> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (await adapter.exists(filePath)) {
			await adapter.remove(filePath);
		}
	}
}

/**
 * Create a new settings store instance.
 *
 * Factory function for creating settings stores with initial state.
 *
 * @param initial - Initial plugin settings
 * @param plugin - Plugin instance for persistence
 * @returns New SettingsStore instance
 */
export const createSettingsStore = (
	initial: AgentClientPluginSettings,
	plugin: AgentClientPlugin,
) => new SettingsStore(initial, plugin);
