import { TFile, TFolder, prepareFuzzySearch } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import { Logger } from "../../shared/logger";

type Mentionable = TFile | TFolder;

// Note mention service for @-mention functionality
export class NoteMentionService {
	private files: TFile[] = [];
	private folders: TFolder[] = [];
	private lastBuild = 0;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	private eventRefs: ReturnType<typeof this.plugin.app.vault.on>[] = [];

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
		this.logger = new Logger(plugin);
		this.rebuildIndex();

		// Listen for vault changes to keep index up to date
		this.eventRefs.push(
			this.plugin.app.vault.on("create", (file) => {
				if (
					(file instanceof TFile && file.extension === "md") ||
					file instanceof TFolder
				) {
					this.rebuildIndex();
				}
			}),
		);
		this.eventRefs.push(
			this.plugin.app.vault.on("delete", () => this.rebuildIndex()),
		);
		this.eventRefs.push(
			this.plugin.app.vault.on("rename", (file) => {
				if (
					(file instanceof TFile && file.extension === "md") ||
					file instanceof TFolder
				) {
					this.rebuildIndex();
				}
			}),
		);
	}

	/**
	 * Clean up event listeners. Call this when the service is no longer needed.
	 */
	destroy(): void {
		for (const ref of this.eventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.eventRefs = [];
	}

	private rebuildIndex() {
		this.files = this.plugin.app.vault.getMarkdownFiles();
		this.folders = this.plugin.app.vault
			.getAllLoadedFiles()
			.filter(
				(file): file is TFolder =>
					file instanceof TFolder && file.path.length > 0,
			);
		this.lastBuild = Date.now();
		this.logger.log(
			`[NoteMentionService] Rebuilt index with ${this.files.length} files and ${this.folders.length} folders`,
		);
	}

	searchNotes(query: string): Mentionable[] {
		this.logger.log(
			"[DEBUG] NoteMentionService.searchNotes called with:",
			query,
		);
		this.logger.log("[DEBUG] Total files indexed:", this.files.length);
		this.logger.log("[DEBUG] Total folders indexed:", this.folders.length);

		if (!query.trim()) {
			this.logger.log(
				"[DEBUG] Empty query, returning recent files and folders",
			);
			const recentFiles = this.files
				.slice()
				.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
				.slice(0, 10);
			const recentFolders = this.folders
				.slice()
				.sort((a, b) => a.path.localeCompare(b.path))
				.slice(0, 10);
			const combined = [...recentFolders, ...recentFiles];
			const unique = combined.filter(
				(item, index, array) =>
					array.findIndex((candidate) => candidate.path === item.path) ===
					index,
			);
			this.logger.log(
				"[DEBUG] Recent mentionables:",
				unique.map((item) => item.path),
			);
			return unique.slice(0, 20);
		}

		this.logger.log("[DEBUG] Preparing fuzzy search for:", query.trim());
		const fuzzySearch = prepareFuzzySearch(query.trim());

		// Score each file based on multiple fields
		const mentionables = [...this.files, ...this.folders];
		const scored: Array<{ item: Mentionable; score: number }> =
			mentionables.map((item) => {
				const isFile = item instanceof TFile;
				const path = item.path;

				// Get aliases from frontmatter
				const aliasArray: string[] = [];

				if (isFile) {
					const fileCache = this.plugin.app.metadataCache.getFileCache(
						item,
					);
					const aliases = fileCache?.frontmatter?.aliases as
						| string[]
						| string
						| undefined;
					aliasArray.push(
						...(Array.isArray(aliases)
							? aliases
							: aliases
								? [aliases]
								: []),
					);
				}

				const name = isFile ? item.basename : item.name;

				// Search in name, path, and aliases
				const searchFields = [name, path, ...aliasArray];
				let bestScore = -Infinity;

				for (const field of searchFields) {
					const match = fuzzySearch(field);
					if (match && match.score > bestScore) {
						bestScore = match.score;
					}
				}

				return { item, score: bestScore };
			},
		);

		return scored
			.filter((item) => item.score > -Infinity)
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.map((item) => item.item);
	}

	getAllFiles(): TFile[] {
		return this.files;
	}

	getAllFolders(): TFolder[] {
		return this.folders;
	}

	getFileByPath(path: string): TFile | null {
		return this.files.find((file) => file.path === path) || null;
	}
}
