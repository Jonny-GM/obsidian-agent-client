import { TFile } from "obsidian";
import type AgentClientPlugin from "../plugin";

export class Logger {
	private static logWriteQueue: Promise<void> = Promise.resolve();
	private static readonly logFolder = "Agent Client Logs";
	private static readonly logFileName = "agent-client-debug.log";

	constructor(private plugin: AgentClientPlugin) {}

	log(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.debug(...args);
			this.queueFileWrite("DEBUG", args);
		}
	}

	error(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.error(...args);
			this.queueFileWrite("ERROR", args);
		}
	}

	warn(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.warn(...args);
			this.queueFileWrite("WARN", args);
		}
	}

	info(...args: unknown[]): void {
		if (this.plugin.settings.debugMode) {
			console.debug(...args);
			this.queueFileWrite("INFO", args);
		}
	}

	static async flush(): Promise<void> {
		await Logger.logWriteQueue;
	}

	private queueFileWrite(level: string, args: unknown[]): void {
		const message = this.formatMessage(level, args);
		Logger.logWriteQueue = Logger.logWriteQueue
			.then(() => this.appendToLogFile(message))
			.catch((error) => {
				console.error(
					"[Agent Client] Failed to write debug log:",
					error,
				);
			});
	}

	private formatMessage(level: string, args: unknown[]): string {
		const timestamp = new Date().toISOString();
		const rendered = args
			.map((arg) => {
				if (typeof arg === "string") {
					return arg;
				}
				try {
					return JSON.stringify(arg);
				} catch (error) {
					return `[Unserializable: ${String(error)}]`;
				}
			})
			.join(" ");
		return `[${timestamp}] [${level}] ${rendered}\n`;
	}

	private async appendToLogFile(message: string): Promise<void> {
		const vault = this.plugin.app.vault;
		const folderPath = Logger.logFolder;
		const filePath = `${folderPath}/${Logger.logFileName}`;

		const existingFolder = vault.getAbstractFileByPath(folderPath);
		if (!existingFolder) {
			await vault.createFolder(folderPath);
		}

		const existingFile = vault.getAbstractFileByPath(filePath);
		if (!existingFile) {
			await vault.create(filePath, message);
			return;
		}

		if (existingFile instanceof TFile) {
			await vault.append(existingFile, message);
		}
	}
}
