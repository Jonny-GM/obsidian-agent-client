import * as React from "react";
import type { ChatHistoryEntry } from "../../domain/models/chat-history";

const { useMemo, useState } = React;

export interface ChatHistoryPanelProps {
	isOpen: boolean;
	entries: ChatHistoryEntry[];
	onClose: () => void;
	onRefresh: () => void;
	onLoad: (entry: ChatHistoryEntry) => void;
	onResume: (entry: ChatHistoryEntry) => void;
}

export function ChatHistoryPanel({
	isOpen,
	entries,
	onClose,
	onRefresh,
	onLoad,
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
				<div className="agent-client-chat-history-header-actions">
					<button
						type="button"
						className="agent-client-chat-history-button"
						onClick={onRefresh}
					>
						Refresh
					</button>
					<button
						type="button"
						className="agent-client-chat-history-button agent-client-chat-history-button-muted"
						onClick={onClose}
					>
						Close
					</button>
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
						<div
							key={entry.path}
							className="agent-client-chat-history-item"
						>
							<div className="agent-client-chat-history-item-info">
								<div className="agent-client-chat-history-item-title">
									{entry.title || "Untitled chat"}
								</div>
								<div className="agent-client-chat-history-item-meta">
									<span>{entry.agentDisplayName}</span>
									<span>•</span>
									<span>
										{entry.updatedAt.toLocaleString()}
									</span>
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
									type="button"
									className="agent-client-chat-history-button"
									onClick={() => onLoad(entry)}
								>
									Load
								</button>
								<button
									type="button"
									className="agent-client-chat-history-button"
									onClick={() => onResume(entry)}
								>
									Resume
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
