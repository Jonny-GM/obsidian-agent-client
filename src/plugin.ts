import {
	App,
	Notice,
	Platform,
	Plugin,
	PluginManifest,
	WorkspaceLeaf,
	requestUrl,
} from "obsidian";
import * as semver from "semver";
import { ChatView, VIEW_TYPE_CHAT } from "./components/chat/ChatView";
import {
	createSettingsStore,
	type SettingsStore,
} from "./adapters/obsidian/settings-store.adapter";
import { AgentClientSettingTab } from "./components/settings/AgentClientSettingTab";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
} from "./shared/settings-utils";
import { Logger } from "./shared/logger";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
} from "./domain/models/agent-config";

// Re-export for backward compatibility
export type { AgentEnvVar, CustomAgentSettings };

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

export interface AcpBridgeSettings {
	enabled: boolean;
	host: string;
	port: number;
	token: string;
}

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	customAgents: CustomAgentSettings[];
	activeAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
	debugMode: boolean;
	debugWriteToVaultLog: boolean;
	nodePath: string;
	acpBridge: {
		desktop: AcpBridgeSettings;
		mobile: AcpBridgeSettings;
	};
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
		includeImages: boolean;
		imageLocation: "obsidian" | "custom" | "base64";
		imageCustomFolder: string;
	};
	historySettings: {
		defaultFolder: string;
		autoSave: boolean;
		autoSaveDebounceMs: number;
	};
	// WSL settings (Windows only)
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	// Input behavior
	sendMessageShortcut: SendMessageShortcut;
}

type UpdateCheckResult = {
	available: boolean;
	version?: string;
	source?: "stable" | "prerelease" | "ci";
	ciRunUrl?: string;
	ciArtifactUrl?: string;
};

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	customAgents: [],
	activeAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	debugMode: false,
	debugWriteToVaultLog: false,
	nodePath: "",
	acpBridge: {
		desktop: {
			enabled: false,
			host: "127.0.0.1",
			port: 27123,
			token: "",
		},
		mobile: {
			enabled: false,
			host: "127.0.0.1",
			port: 27123,
			token: "",
		},
	},
	exportSettings: {
		defaultFolder: "Agent Client",
		filenameTemplate: "agent_client_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Client",
	},
	historySettings: {
		defaultFolder: "Agent Client/Chat History",
		autoSave: true,
		autoSaveDebounceMs: 800,
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
};

export default class AgentClientPlugin extends Plugin {
	private static instanceCounter = 0;
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;
	private logger: Logger | null = null;
	private instanceId: string;
	private instanceNumber: number;
	private onloadStartedAt: number | null = null;
	private heartbeatIntervalMs = 30000;
	private lastHeartbeatAt: number | null = null;

	// Active ACP adapter instance (shared across use cases)
	acpAdapter: import("./adapters/acp/acp.adapter").AcpAdapter | null = null;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		AgentClientPlugin.instanceCounter += 1;
		this.instanceNumber = AgentClientPlugin.instanceCounter;
		this.instanceId =
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	async onload() {
		this.onloadStartedAt = Date.now();
		console.debug("[Agent Client] onload() start", {
			instanceId: this.instanceId,
			instanceNumber: this.instanceNumber,
			manifestId: this.manifest.id,
			manifestVersion: this.manifest.version,
		});
		try {
			await this.initializePlugin();
			this.logger?.log("[Agent Client] Platform:", {
				isMobile: Platform.isMobileApp,
				isDesktop: Platform.isDesktopApp,
				isWin: Platform.isWin,
				isMacOS: Platform.isMacOS,
				isLinux: Platform.isLinux,
			});
			this.logger?.log("[Agent Client] onload() complete", {
				instanceId: this.instanceId,
				instanceNumber: this.instanceNumber,
				elapsedMs:
					this.onloadStartedAt !== null
						? Date.now() - this.onloadStartedAt
						: undefined,
			});
		} catch (error) {
			console.error(
				"[Agent Client] Failed to initialize plugin:",
				error,
			);
			console.error("[Agent Client] onload() failed", {
				instanceId: this.instanceId,
				instanceNumber: this.instanceNumber,
				elapsedMs:
					this.onloadStartedAt !== null
						? Date.now() - this.onloadStartedAt
						: undefined,
			});
			this.logger?.error(
				"[Agent Client] Failed to initialize plugin:",
				error,
			);
			new Notice(
				"[Agent Client] Failed to initialize. Check the console for details.",
			);
		}
	}

	onunload() {
		this.logger?.log("[Agent Client] onunload() invoked", {
			instanceId: this.instanceId,
			instanceNumber: this.instanceNumber,
		});
		void Logger.flush();
	}

	private async initializePlugin(): Promise<void> {
		const initializeStartedAt = Date.now();
		console.debug("[Agent Client] initializePlugin() start", {
			instanceId: this.instanceId,
			instanceNumber: this.instanceNumber,
		});
		let loadAttempt = 1;
		try {
			console.debug("[Agent Client] Loading settings (attempt 1)");
			await this.loadSettings();
			console.debug("[Agent Client] Settings loaded (attempt 1)");
		} catch (error) {
			console.error(
				"[Agent Client] Failed to load settings. Retrying after layout ready.",
				error,
			);
			await new Promise<void>((resolve) => {
				this.app.workspace.onLayoutReady(resolve);
			});
			loadAttempt = 2;
			console.debug("[Agent Client] Loading settings (attempt 2)");
			await this.loadSettings();
			console.debug("[Agent Client] Settings loaded (attempt 2)");
		}

		if (!this.settings.debugMode) {
			this.settings.debugMode = true;
			await this.saveSettings();
		}

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings, this);
		this.logger = new Logger(this);
		this.logger.log("[Agent Client] Settings snapshot:", {
			manifestVersion: this.manifest.version,
			activeAgentId: this.settings.activeAgentId,
			debugMode: this.settings.debugMode,
			debugWriteToVaultLog: this.settings.debugWriteToVaultLog,
			autoAllowPermissions: this.settings.autoAllowPermissions,
			autoMentionActiveNote: this.settings.autoMentionActiveNote,
			nodePathConfigured:
				this.settings.nodePath && this.settings.nodePath.trim().length > 0,
			acpBridge: {
				mobile: {
					enabled: this.settings.acpBridge.mobile.enabled,
					host: this.settings.acpBridge.mobile.host,
					port: this.settings.acpBridge.mobile.port,
					tokenConfigured:
						this.settings.acpBridge.mobile.token.trim().length > 0,
				},
				desktop: {
					enabled: this.settings.acpBridge.desktop.enabled,
					host: this.settings.acpBridge.desktop.host,
					port: this.settings.acpBridge.desktop.port,
					tokenConfigured:
						this.settings.acpBridge.desktop.token.trim().length > 0,
				},
			},
		});
		this.logger.log(
			`[Agent Client] Plugin initialized (settings load attempt: ${loadAttempt})`,
		);
		this.logger.log("[Agent Client] initializePlugin() continuing", {
			instanceId: this.instanceId,
			instanceNumber: this.instanceNumber,
			elapsedMs: Date.now() - initializeStartedAt,
		});

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
		this.logger.log("[Agent Client] Registered chat view");

		const ribbonIconEl = this.addRibbonIcon(
			"bot-message-square",
			"Open agent client",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("agent-client-ribbon-icon");
		this.logger.log("[Agent Client] Added ribbon icon");

		this.addCommand({
			id: "open-chat-view",
			name: "Open agent chat",
			callback: () => {
				void this.activateView();
			},
		});
		this.logger.log("[Agent Client] Registered open chat command");

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();
		this.logger.log("[Agent Client] Registered agent and permission commands");

		this.addSettingTab(new AgentClientSettingTab(this.app, this));
		this.logger.log("[Agent Client] Added settings tab");

		this.registerGlobalErrorHandlers();
		this.logger.log("[Agent Client] Registered global error handlers");
		if (this.settings.debugMode) {
			this.registerInterval(
				window.setInterval(() => {
					this.lastHeartbeatAt = Date.now();
					const activeLeaf = this.app.workspace.activeLeaf;
					const activeViewType = activeLeaf?.view?.getViewType();
					this.logger?.log("[Agent Client] heartbeat", {
						instanceId: this.instanceId,
						instanceNumber: this.instanceNumber,
						timestamp: new Date().toISOString(),
						visibilityState: document.visibilityState,
						activeViewType,
						agentClientLeaves:
							this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)
								.length,
					});
				}, this.heartbeatIntervalMs),
			);
		}
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.logger?.log("[Agent Client] workspace file-open", {
					path: file?.path ?? null,
				});
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.logger?.log(
					"[Agent Client] workspace active-leaf-change",
					{
						viewType: leaf?.view?.getViewType() ?? null,
					},
				);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				this.logger?.log("[Agent Client] workspace quit event");
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.logger?.log("[Agent Client] workspace layout ready");
		});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.logger?.log("[Agent Client] workspace layout change");
			}),
		);
		console.debug("[Agent Client] initializePlugin() complete", {
			elapsedMs: Date.now() - initializeStartedAt,
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			// Focus textarea after revealing the leaf
			const viewContainerEl = leaf.view?.containerEl;
			if (viewContainerEl) {
				window.setTimeout(() => {
					const textarea = viewContainerEl.querySelector(
						"textarea.chat-input-textarea",
					);
					if (textarea instanceof HTMLTextAreaElement) {
						textarea.focus();
					}
				}, 0);
			}
		}
	}

	/**
	 * Get all available agents (claude, codex, gemini, custom)
	 */
	private getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return [
			{
				id: this.settings.claude.id,
				displayName:
					this.settings.claude.displayName || this.settings.claude.id,
			},
			{
				id: this.settings.codex.id,
				displayName:
					this.settings.codex.displayName || this.settings.codex.id,
			},
			{
				id: this.settings.gemini.id,
				displayName:
					this.settings.gemini.displayName || this.settings.gemini.id,
			},
			...this.settings.customAgents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName || agent.id,
			})),
		];
	}

	/**
	 * Open chat view and switch to specified agent
	 */
	private async openChatWithAgent(agentId: string): Promise<void> {
		// 1. Switch agent in settings (if different from current)
		if (this.settings.activeAgentId !== agentId) {
			await this.settingsStore.updateSettings({ activeAgentId: agentId });
		}

		// 2. Activate view (create new or focus existing)
		await this.activateView();

		// Trigger new chat with specific agent
		// Pass agentId so ChatComponent knows to force new session even if empty
		this.app.workspace.trigger(
			"agent-client:new-chat-requested" as "quit",
			agentId,
		);
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		const agents = this.getAvailableAgents();

		for (const agent of agents) {
			this.addCommand({
				id: `open-chat-with-${agent.id}`,
				name: `New chat with ${agent.displayName}`,
				callback: async () => {
					await this.openChatWithAgent(agent.id);
				},
			});
		}
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger(
					"agent-client:approve-active-permission",
				);
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger(
					"agent-client:reject-active-permission",
				);
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger("agent-client:toggle-auto-mention");
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			callback: () => {
				this.app.workspace.trigger("agent-client:cancel-message");
			},
		});
	}

	private registerGlobalErrorHandlers(): void {
		this.registerDomEvent(window, "focus", () => {
			this.logger?.log("[Agent Client] window focus");
		});

		this.registerDomEvent(window, "blur", () => {
			this.logger?.log("[Agent Client] window blur");
		});

		this.registerDomEvent(window, "beforeunload", () => {
			this.logger?.log("[Agent Client] window beforeunload");
		});

		this.registerDomEvent(window, "unload", () => {
			this.logger?.log("[Agent Client] window unload");
		});

		this.registerDomEvent(window, "pagehide", (event) => {
			this.logger?.log("[Agent Client] window pagehide", {
				persisted:
					"persisted" in event
						? (event as PageTransitionEvent).persisted
						: undefined,
			});
		});

		this.registerDomEvent(window, "pageshow", (event) => {
			this.logger?.log("[Agent Client] window pageshow", {
				persisted:
					"persisted" in event
						? (event as PageTransitionEvent).persisted
						: undefined,
			});
		});

		this.registerDomEvent(document, "visibilitychange", () => {
			this.logger?.log("[Agent Client] document visibilitychange", {
				visibilityState: document.visibilityState,
				lastHeartbeatAt: this.lastHeartbeatAt,
			});
		});

		const maybeProcess = globalThis.process as NodeJS.Process | undefined;
		if (maybeProcess?.on) {
			const handleProcessExit = (event: string, detail?: unknown) => {
				this.logger?.log(`[Agent Client] process ${event}`, detail);
			};
			maybeProcess.on("exit", (code) =>
				handleProcessExit("exit", { code }),
			);
			maybeProcess.on("beforeExit", (code) =>
				handleProcessExit("beforeExit", { code }),
			);
			maybeProcess.on("uncaughtException", (error) =>
				handleProcessExit("uncaughtException", {
					message: error.message,
					stack: error.stack,
				}),
			);
		}

		this.registerDomEvent(window, "error", (event) => {
			const errorEvent = event as ErrorEvent;
			const errorInfo =
				errorEvent.error instanceof Error
					? errorEvent.error
					: errorEvent.message;
			this.logger?.error("[Agent Client] Window error:", {
				message: errorEvent.message,
				filename: errorEvent.filename,
				lineno: errorEvent.lineno,
				colno: errorEvent.colno,
				error:
					errorEvent.error instanceof Error
						? {
								name: errorEvent.error.name,
								message: errorEvent.error.message,
								stack: errorEvent.error.stack,
							}
						: errorInfo,
			});
		});

		this.registerDomEvent(window, "unhandledrejection", (event) => {
			const rejectionEvent = event as PromiseRejectionEvent;
			this.logger?.error(
				"[Agent Client] Unhandled rejection:",
				rejectionEvent.reason instanceof Error
					? {
							name: rejectionEvent.reason.name,
							message: rejectionEvent.reason.message,
							stack: rejectionEvent.reason.stack,
						}
					: rejectionEvent.reason,
			);
		});
	}

	async loadSettings() {
		const rawSettings = ((await this.loadData()) ?? {}) as Record<
			string,
			unknown
		>;

		const claudeFromRaw =
			typeof rawSettings.claude === "object" &&
			rawSettings.claude !== null
				? (rawSettings.claude as Record<string, unknown>)
				: {};
		const codexFromRaw =
			typeof rawSettings.codex === "object" && rawSettings.codex !== null
				? (rawSettings.codex as Record<string, unknown>)
				: {};
		const geminiFromRaw =
			typeof rawSettings.gemini === "object" &&
			rawSettings.gemini !== null
				? (rawSettings.gemini as Record<string, unknown>)
				: {};

		const resolvedClaudeArgs = sanitizeArgs(claudeFromRaw.args);
		const resolvedClaudeEnv = normalizeEnvVars(claudeFromRaw.env);
		const resolvedCodexArgs = sanitizeArgs(codexFromRaw.args);
		const resolvedCodexEnv = normalizeEnvVars(codexFromRaw.env);
		const resolvedGeminiArgs = sanitizeArgs(geminiFromRaw.args);
		const resolvedGeminiEnv = normalizeEnvVars(geminiFromRaw.env);
		const customAgents = Array.isArray(rawSettings.customAgents)
			? ensureUniqueCustomAgentIds(
					rawSettings.customAgents.map((agent: unknown) => {
						const agentObj =
							typeof agent === "object" && agent !== null
								? (agent as Record<string, unknown>)
								: {};
						return normalizeCustomAgent(agentObj);
					}),
				)
			: [];

		const availableAgentIds = [
			DEFAULT_SETTINGS.claude.id,
			DEFAULT_SETTINGS.codex.id,
			DEFAULT_SETTINGS.gemini.id,
			...customAgents.map((agent) => agent.id),
		];
		const rawActiveId =
			typeof rawSettings.activeAgentId === "string"
				? rawSettings.activeAgentId.trim()
				: "";
		const fallbackActiveId =
			availableAgentIds.find((id) => id.length > 0) ||
			DEFAULT_SETTINGS.claude.id;
		const activeAgentId =
			availableAgentIds.includes(rawActiveId) && rawActiveId.length > 0
				? rawActiveId
				: fallbackActiveId;
		const resolveBridgeSettings = (
			value: unknown,
			fallback: AcpBridgeSettings,
		): AcpBridgeSettings => {
			const record =
				value && typeof value === "object"
					? (value as Record<string, unknown>)
					: {};
			const rawPort =
				typeof record.port === "number"
					? record.port
					: typeof record.port === "string"
						? Number.parseInt(record.port, 10)
						: NaN;
			return {
				enabled:
					typeof record.enabled === "boolean"
						? record.enabled
						: fallback.enabled,
				host:
					typeof record.host === "string" &&
					record.host.trim().length > 0
						? record.host.trim()
						: fallback.host,
				port:
					Number.isFinite(rawPort) && rawPort > 0
						? rawPort
						: fallback.port,
				token:
					typeof record.token === "string"
						? record.token
						: fallback.token,
			};
		};
		const rawBridge =
			rawSettings.acpBridge &&
			typeof rawSettings.acpBridge === "object"
				? (rawSettings.acpBridge as Record<string, unknown>)
				: {};

		this.settings = {
			claude: {
				id: DEFAULT_SETTINGS.claude.id,
				displayName:
					typeof claudeFromRaw.displayName === "string" &&
					claudeFromRaw.displayName.trim().length > 0
						? claudeFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.claude.displayName,
				apiKey:
					typeof claudeFromRaw.apiKey === "string"
						? claudeFromRaw.apiKey
						: DEFAULT_SETTINGS.claude.apiKey,
				command:
					typeof claudeFromRaw.command === "string" &&
					claudeFromRaw.command.trim().length > 0
						? claudeFromRaw.command.trim()
						: typeof rawSettings.claudeCodeAcpCommandPath ===
									"string" &&
							  rawSettings.claudeCodeAcpCommandPath.trim()
									.length > 0
							? rawSettings.claudeCodeAcpCommandPath.trim()
							: DEFAULT_SETTINGS.claude.command,
				args: resolvedClaudeArgs.length > 0 ? resolvedClaudeArgs : [],
				env: resolvedClaudeEnv.length > 0 ? resolvedClaudeEnv : [],
			},
			codex: {
				id: DEFAULT_SETTINGS.codex.id,
				displayName:
					typeof codexFromRaw.displayName === "string" &&
					codexFromRaw.displayName.trim().length > 0
						? codexFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.codex.displayName,
				apiKey:
					typeof codexFromRaw.apiKey === "string"
						? codexFromRaw.apiKey
						: DEFAULT_SETTINGS.codex.apiKey,
				command:
					typeof codexFromRaw.command === "string" &&
					codexFromRaw.command.trim().length > 0
						? codexFromRaw.command.trim()
						: DEFAULT_SETTINGS.codex.command,
				args: resolvedCodexArgs.length > 0 ? resolvedCodexArgs : [],
				env: resolvedCodexEnv.length > 0 ? resolvedCodexEnv : [],
			},
			gemini: {
				id: DEFAULT_SETTINGS.gemini.id,
				displayName:
					typeof geminiFromRaw.displayName === "string" &&
					geminiFromRaw.displayName.trim().length > 0
						? geminiFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.gemini.displayName,
				apiKey:
					typeof geminiFromRaw.apiKey === "string"
						? geminiFromRaw.apiKey
						: DEFAULT_SETTINGS.gemini.apiKey,
				command:
					typeof geminiFromRaw.command === "string" &&
					geminiFromRaw.command.trim().length > 0
						? geminiFromRaw.command.trim()
						: typeof rawSettings.geminiCommandPath === "string" &&
							  rawSettings.geminiCommandPath.trim().length > 0
							? rawSettings.geminiCommandPath.trim()
							: DEFAULT_SETTINGS.gemini.command,
				args:
					resolvedGeminiArgs.length > 0
						? resolvedGeminiArgs
						: DEFAULT_SETTINGS.gemini.args,
				env: resolvedGeminiEnv.length > 0 ? resolvedGeminiEnv : [],
			},
			customAgents: customAgents,
			activeAgentId,
			autoAllowPermissions:
				typeof rawSettings.autoAllowPermissions === "boolean"
					? rawSettings.autoAllowPermissions
					: DEFAULT_SETTINGS.autoAllowPermissions,
			autoMentionActiveNote:
				typeof rawSettings.autoMentionActiveNote === "boolean"
					? rawSettings.autoMentionActiveNote
					: DEFAULT_SETTINGS.autoMentionActiveNote,
			debugMode:
				typeof rawSettings.debugMode === "boolean"
					? rawSettings.debugMode
					: DEFAULT_SETTINGS.debugMode,
			debugWriteToVaultLog:
				typeof rawSettings.debugWriteToVaultLog === "boolean"
					? rawSettings.debugWriteToVaultLog
					: DEFAULT_SETTINGS.debugWriteToVaultLog,
			nodePath:
				typeof rawSettings.nodePath === "string"
					? rawSettings.nodePath.trim()
					: DEFAULT_SETTINGS.nodePath,
			acpBridge: {
				desktop: resolveBridgeSettings(
					rawBridge.desktop,
					DEFAULT_SETTINGS.acpBridge.desktop,
				),
				mobile: resolveBridgeSettings(
					rawBridge.mobile,
					DEFAULT_SETTINGS.acpBridge.mobile,
				),
			},
			exportSettings: (() => {
				const rawExport = rawSettings.exportSettings as
					| Record<string, unknown>
					| null
					| undefined;
				if (rawExport && typeof rawExport === "object") {
					return {
						defaultFolder:
							typeof rawExport.defaultFolder === "string"
								? rawExport.defaultFolder
								: DEFAULT_SETTINGS.exportSettings.defaultFolder,
						filenameTemplate:
							typeof rawExport.filenameTemplate === "string"
								? rawExport.filenameTemplate
								: DEFAULT_SETTINGS.exportSettings
										.filenameTemplate,
						autoExportOnNewChat:
							typeof rawExport.autoExportOnNewChat === "boolean"
								? rawExport.autoExportOnNewChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnNewChat,
						autoExportOnCloseChat:
							typeof rawExport.autoExportOnCloseChat === "boolean"
								? rawExport.autoExportOnCloseChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnCloseChat,
						openFileAfterExport:
							typeof rawExport.openFileAfterExport === "boolean"
								? rawExport.openFileAfterExport
								: DEFAULT_SETTINGS.exportSettings
										.openFileAfterExport,
						includeImages:
							typeof rawExport.includeImages === "boolean"
								? rawExport.includeImages
								: DEFAULT_SETTINGS.exportSettings.includeImages,
						imageLocation:
							rawExport.imageLocation === "obsidian" ||
							rawExport.imageLocation === "custom" ||
							rawExport.imageLocation === "base64"
								? rawExport.imageLocation
								: DEFAULT_SETTINGS.exportSettings.imageLocation,
						imageCustomFolder:
							typeof rawExport.imageCustomFolder === "string"
								? rawExport.imageCustomFolder
								: DEFAULT_SETTINGS.exportSettings
										.imageCustomFolder,
					};
				}
				return DEFAULT_SETTINGS.exportSettings;
			})(),
			historySettings: (() => {
				const rawHistory = rawSettings.historySettings as
					| Record<string, unknown>
					| null
					| undefined;
				if (rawHistory && typeof rawHistory === "object") {
					return {
						defaultFolder:
							typeof rawHistory.defaultFolder === "string"
								? rawHistory.defaultFolder
								: DEFAULT_SETTINGS.historySettings.defaultFolder,
						autoSave:
							typeof rawHistory.autoSave === "boolean"
								? rawHistory.autoSave
								: DEFAULT_SETTINGS.historySettings.autoSave,
						autoSaveDebounceMs:
							typeof rawHistory.autoSaveDebounceMs === "number"
								? rawHistory.autoSaveDebounceMs
								: DEFAULT_SETTINGS.historySettings
										.autoSaveDebounceMs,
					};
				}
				return DEFAULT_SETTINGS.historySettings;
			})(),
			windowsWslMode:
				typeof rawSettings.windowsWslMode === "boolean"
					? rawSettings.windowsWslMode
					: DEFAULT_SETTINGS.windowsWslMode,
			windowsWslDistribution:
				typeof rawSettings.windowsWslDistribution === "string"
					? rawSettings.windowsWslDistribution
					: DEFAULT_SETTINGS.windowsWslDistribution,
			sendMessageShortcut:
				rawSettings.sendMessageShortcut === "enter" ||
				rawSettings.sendMessageShortcut === "cmd-enter"
					? rawSettings.sendMessageShortcut
					: DEFAULT_SETTINGS.sendMessageShortcut,
		};

		this.ensureActiveAgentId();
		this.logger?.log("[Agent Client] Settings loaded", {
			activeAgentId: this.settings.activeAgentId,
			debugMode: this.settings.debugMode,
			debugWriteToVaultLog: this.settings.debugWriteToVaultLog,
			vaultName: this.app.vault.getName(),
			workspaceLeaves: this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)
				.length,
		});
	}

	async saveSettings() {
		this.logger?.log("[Agent Client] saveSettings() invoked");
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		this.logger?.log("[Agent Client] saveSettingsAndNotify() invoked", {
			activeAgentId: nextSettings.activeAgentId,
			debugMode: nextSettings.debugMode,
		});
		this.settings = nextSettings;
		await this.saveData(this.settings);
		this.settingsStore.set(this.settings);
	}

	/**
	 * Fetch the latest stable release version from GitHub.
	 */
	private async fetchLatestStable(): Promise<string | null> {
		const { owner, repo } = this.getUpdateRepo();
		const response = await requestUrl({
			url: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
		});
		const data = response.json as { tag_name?: string };
		return data.tag_name ? semver.clean(data.tag_name) : null;
	}

	/**
	 * Fetch the latest prerelease version from GitHub.
	 */
	private async fetchLatestPrerelease(): Promise<string | null> {
		const { owner, repo } = this.getUpdateRepo();
		const response = await requestUrl({
			url: `https://api.github.com/repos/${owner}/${repo}/releases`,
		});
		const releases = response.json as Array<{
			tag_name: string;
			prerelease: boolean;
		}>;

		// Find the first prerelease (releases are sorted by date descending)
		const latestPrerelease = releases.find((r) => r.prerelease);
		return latestPrerelease
			? semver.clean(latestPrerelease.tag_name)
			: null;
	}

	private async fetchLatestCiBuild(): Promise<{
		version: string;
		runUrl: string;
		artifactUrl: string;
	} | null> {
		const { owner, repo } = this.getUpdateRepo();
		const branches = await this.fetchUpdateBranches(owner, repo);
		const workflowResponse = await requestUrl({
			url: `https://api.github.com/repos/${owner}/${repo}/actions/workflows/push-release.yaml/runs?per_page=20&status=success`,
		});
		const workflowData = workflowResponse.json as {
			workflow_runs?: Array<{
				id: number;
				head_sha: string;
				head_branch: string;
				html_url: string;
				created_at: string;
			}>;
		};

		const candidateRuns = (workflowData.workflow_runs ?? [])
			.filter((run) => branches.includes(run.head_branch))
			.sort(
				(a, b) =>
					new Date(b.created_at).getTime() -
					new Date(a.created_at).getTime(),
			);
		const latestRun = candidateRuns[0];
		if (!latestRun?.head_sha || !latestRun.id) {
			return null;
		}

		const artifactUrl = await this.fetchLatestArtifactUrl(
			owner,
			repo,
			latestRun.id,
		);
		if (!artifactUrl) {
			return null;
		}

		const manifestResponse = await requestUrl({
			url: `https://raw.githubusercontent.com/${owner}/${repo}/${latestRun.head_sha}/manifest.json`,
		});
		const manifestData = manifestResponse.json as { version?: string };
		const version = manifestData.version
			? semver.clean(manifestData.version)
			: null;
		if (!version) {
			return null;
		}

		return {
			version,
			runUrl: latestRun.html_url,
			artifactUrl,
		};
	}

	private async fetchUpdateBranches(
		owner: string,
		repo: string,
	): Promise<string[]> {
		const response = await requestUrl({
			url: `https://api.github.com/repos/${owner}/${repo}`,
		});
		const data = response.json as { default_branch?: string };
		const branches = new Set<string>();
		if (data.default_branch) {
			branches.add(data.default_branch);
		}
		branches.add("dev");
		return Array.from(branches);
	}

	private async fetchLatestArtifactUrl(
		owner: string,
		repo: string,
		runId: number,
	): Promise<string | null> {
		const response = await requestUrl({
			url: `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
		});
		const data = response.json as {
			artifacts?: Array<{
				name: string;
				archive_download_url: string;
			}>;
		};
		const artifact = data.artifacts?.find(
			(item) => item.name === "obsidian-agent-client",
		);
		return artifact?.archive_download_url ?? null;
	}

	private getUpdateRepo(): { owner: string; repo: string } {
		const fallbackOwner = "RAIT-09";
		const fallbackRepo = "obsidian-agent-client";
		const authorUrl = this.manifest.authorUrl;
		if (!authorUrl) {
			return { owner: fallbackOwner, repo: fallbackRepo };
		}

		try {
			const url = new URL(authorUrl);
			const owner = url.pathname.replace(/^\/+/, "").split("/")[0];
			if (owner) {
				return { owner, repo: fallbackRepo };
			}
		} catch (error) {
			this.logger?.error(
				"[Agent Client] Failed to parse authorUrl for update repo:",
				error,
			);
		}

		return { owner: fallbackOwner, repo: fallbackRepo };
	}

	/**
	 * Check for plugin updates.
	 * - Stable version users: compare with latest stable release
	 * - Prerelease users: compare with both latest stable and latest prerelease
	 */
	async checkForUpdates(): Promise<UpdateCheckResult> {
		const currentVersion =
			semver.clean(this.manifest.version) || this.manifest.version;
		const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;

		if (isCurrentPrerelease) {
			// Prerelease user: check both stable and prerelease
			const [latestStable, latestPrerelease] = await Promise.all([
				this.fetchLatestStable(),
				this.fetchLatestPrerelease(),
			]);

			const hasNewerStable =
				latestStable && semver.gt(latestStable, currentVersion);
			const hasNewerPrerelease =
				latestPrerelease && semver.gt(latestPrerelease, currentVersion);

			if (hasNewerStable || hasNewerPrerelease) {
				// Prefer stable version notification if available
				const newestVersion = hasNewerStable
					? latestStable
					: latestPrerelease;
				new Notice(
					`[Agent Client] Update available: v${newestVersion}`,
				);
				return {
					available: true,
					version: newestVersion ?? undefined,
					source: hasNewerStable ? "stable" : "prerelease",
				};
			}

			const latestCiBuild = await this.fetchLatestCiBuild();
			if (
				latestCiBuild &&
				semver.gt(latestCiBuild.version, currentVersion)
			) {
				new Notice(
					`[Agent Client] CI build available: v${latestCiBuild.version} (Artifacts: ${latestCiBuild.artifactUrl})`,
				);
				return {
					available: true,
					version: latestCiBuild.version,
					source: "ci",
					ciRunUrl: latestCiBuild.runUrl,
					ciArtifactUrl: latestCiBuild.artifactUrl,
				};
			}
		} else {
			// Stable version user: check stable only
			const latestStable = await this.fetchLatestStable();
			if (latestStable && semver.gt(latestStable, currentVersion)) {
				new Notice(`[Agent Client] Update available: v${latestStable}`);
				return {
					available: true,
					version: latestStable,
					source: "stable",
				};
			}

			const latestCiBuild = await this.fetchLatestCiBuild();
			if (
				latestCiBuild &&
				semver.gt(latestCiBuild.version, currentVersion)
			) {
				new Notice(
					`[Agent Client] CI build available: v${latestCiBuild.version} (Artifacts: ${latestCiBuild.artifactUrl})`,
				);
				return {
					available: true,
					version: latestCiBuild.version,
					source: "ci",
					ciRunUrl: latestCiBuild.runUrl,
					ciArtifactUrl: latestCiBuild.artifactUrl,
				};
			}
		}

		return { available: false };
	}

	ensureActiveAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (availableIds.length === 0) {
			this.settings.activeAgentId = DEFAULT_SETTINGS.claude.id;
			return;
		}
		if (!availableIds.includes(this.settings.activeAgentId)) {
			this.settings.activeAgentId = availableIds[0];
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		ids.add(this.settings.claude.id);
		ids.add(this.settings.codex.id);
		ids.add(this.settings.gemini.id);
		for (const agent of this.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
