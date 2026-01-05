import * as React from "react";
import { setIcon } from "obsidian";
import type { ChatHistoryEntry } from "../../domain/models/chat-history";

const { useMemo, useState, useEffect, useRef } = React;

export interface ChatHistoryPanelProps {
	isOpen: boolean;
	entries: ChatHistoryEntry[];
	onResume: (entry: ChatHistoryEntry) => void;
}

export function ChatHistoryPanel({
	isOpen,
	entries,
	onResume,
}: ChatHistoryPanelProps) {
	const [query, setQuery] = useState("");

	const filteredEntries = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return entries;
		}
		return entries.filter((entry) => {
			const haystack = [
				entry.title,
				entry.agentDisplayName,
				entry.agentId,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(normalized);
		});
	}, [entries, query]);

	if (!isOpen) {
		return null;
	}

	return (
		<div className="agent-client-chat-history-panel">
			<div className="agent-client-chat-history-header">
				<div>
					<h4 className="agent-client-chat-history-title">
						Chat History
					</h4>
					<p className="agent-client-chat-history-subtitle">
						Load or resume previous sessions
					</p>
				</div>
			</div>
			<div className="agent-client-chat-history-search">
				<input
					type="text"
					placeholder="Search chats..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			<div className="agent-client-chat-history-list">
				{filteredEntries.length === 0 ? (
					<div className="agent-client-chat-history-empty">
						No saved chats yet.
					</div>
				) : (
					filteredEntries.map((entry) => (
						<ChatHistoryEntryRow
							key={entry.path}
							entry={entry}
							onResume={onResume}
						/>
					))
				)}
			</div>
		</div>
	);
}

interface ChatHistoryEntryRowProps {
	entry: ChatHistoryEntry;
	onResume: (entry: ChatHistoryEntry) => void;
}

function ChatHistoryEntryRow({ entry, onResume }: ChatHistoryEntryRowProps) {
	const resumeButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (resumeButtonRef.current) {
			setIcon(resumeButtonRef.current, "arrow-right");
		}
	}, []);

	return (
		<div key={entry.path} className="agent-client-chat-history-item">
			<div className="agent-client-chat-history-item-info">
				<div className="agent-client-chat-history-item-title">
					{entry.title || "Untitled chat"}
				</div>
				<div className="agent-client-chat-history-item-meta">
					<span>{entry.agentDisplayName}</span>
					<span>•</span>
					<span>{entry.updatedAt.toLocaleString()}</span>
					<span>•</span>
					<span>{entry.messageCount} messages</span>
					{entry.isConflict && (
						<>
							<span>•</span>
							<span className="agent-client-chat-history-conflict">
								Conflict
							</span>
						</>
					)}
				</div>
			</div>
			<div className="agent-client-chat-history-item-actions">
				<button
					ref={resumeButtonRef}
					type="button"
					className="agent-client-chat-history-button agent-client-chat-history-icon-button"
					title="Resume chat"
					aria-label="Resume chat"
					onClick={() => onResume(entry)}
				/>
			</div>
		</div>
	);
}
