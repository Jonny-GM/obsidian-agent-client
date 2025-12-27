import * as React from "react";
import { HeaderButton } from "./HeaderButton";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Connection status label */
	connectionStatusLabel: string;
	/** Optional connection status detail */
	connectionStatusDetail?: string;
	/** Connection status style */
	connectionStatusTone: "connected" | "connecting" | "reconnecting" | "error";
	/** Whether to show a reconnect action */
	showReconnectAction: boolean;
	/** Whether to show a cancel reconnect action */
	showCancelReconnectAction: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
	/** Callback to reconnect */
	onReconnect: () => void;
	/** Callback to cancel reconnect */
	onCancelReconnect: () => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Update notification (if available)
 * - Action buttons (new chat, export, settings)
 */
export function ChatHeader({
	agentLabel,
	isUpdateAvailable,
	connectionStatusLabel,
	connectionStatusDetail,
	connectionStatusTone,
	showReconnectAction,
	showCancelReconnectAction,
	onNewChat,
	onExportChat,
	onOpenSettings,
	onReconnect,
	onCancelReconnect,
}: ChatHeaderProps) {
	return (
		<div className="agent-client-chat-view-header">
			<div className="agent-client-chat-view-header-info">
				<h3 className="agent-client-chat-view-header-title">
					{agentLabel}
				</h3>
				<div className="agent-client-chat-view-header-status">
					<span
						className={`agent-client-chat-view-header-status-pill agent-client-chat-view-header-status-${connectionStatusTone}`}
					>
						{connectionStatusLabel}
					</span>
					{connectionStatusDetail && (
						<span className="agent-client-chat-view-header-status-detail">
							{connectionStatusDetail}
						</span>
					)}
					{showReconnectAction && (
						<button
							type="button"
							className="agent-client-chat-view-header-status-action"
							onClick={onReconnect}
						>
							Reconnect
						</button>
					)}
					{showCancelReconnectAction && (
						<button
							type="button"
							className="agent-client-chat-view-header-status-action"
							onClick={onCancelReconnect}
						>
							Cancel retry
						</button>
					)}
				</div>
			</div>
			<div className="agent-client-chat-view-header-meta">
				{isUpdateAvailable && (
					<p className="agent-client-chat-view-header-update">
						Update available!
					</p>
				)}
				<div className="agent-client-chat-view-header-actions">
					<HeaderButton
						iconName="plus"
						tooltip="New chat"
						onClick={onNewChat}
					/>
					<HeaderButton
						iconName="save"
						tooltip="Export chat to Markdown"
						onClick={onExportChat}
					/>
					<HeaderButton
						iconName="settings"
						tooltip="Settings"
						onClick={onOpenSettings}
					/>
				</div>
			</div>
		</div>
	);
}
