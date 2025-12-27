import * as React from "react";
import { HeaderButton } from "./HeaderButton";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Connection status label */
	connectionStatus: string;
	/** Connection status style */
	connectionStatusVariant: "connected" | "connecting" | "disconnected" | "error";
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
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
	connectionStatus,
	connectionStatusVariant,
	isUpdateAvailable,
	onNewChat,
	onExportChat,
	onOpenSettings,
}: ChatHeaderProps) {
	return (
		<div className="chat-view-header">
			<div className="chat-view-header-left">
				<h3 className="chat-view-header-title">{agentLabel}</h3>
				<span
					className={`chat-view-header-status status-${connectionStatusVariant}`}
				>
					{connectionStatus}
				</span>
			</div>
			{isUpdateAvailable && (
				<p className="chat-view-header-update">Update available!</p>
			)}
			<div className="chat-view-header-actions">
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
	);
}
