import * as React from "react";
import type { SessionState } from "../../domain/models/chat-session";
import type { ReconnectStatus } from "../../hooks/useAgentSession";
import { HeaderButton } from "./HeaderButton";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Current session state */
	sessionState: SessionState;
	/** Current reconnect status */
	reconnectStatus: ReconnectStatus;
	/** Whether ACP bridge is enabled */
	isBridgeEnabled: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
	/** Callback to reconnect immediately */
	onReconnectNow: () => void;
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
	sessionState,
	reconnectStatus,
	isBridgeEnabled,
	onNewChat,
	onExportChat,
	onOpenSettings,
	onReconnectNow,
	onCancelReconnect,
}: ChatHeaderProps) {
	const statusTone = (() => {
		if (sessionState === "ready" || sessionState === "busy") {
			return "success";
		}
		if (sessionState === "initializing" || sessionState === "authenticating") {
			return "info";
		}
		if (sessionState === "error") {
			return "error";
		}
		return "muted";
	})();

	const statusLabel = (() => {
		const baseLabel = (() => {
			switch (sessionState) {
				case "ready":
					return "Connected";
				case "busy":
					return "Connected";
				case "initializing":
					return "Connecting";
				case "authenticating":
					return "Authenticating";
				case "error":
					return "Disconnected";
				case "disconnected":
				default:
					return "Disconnected";
			}
		})();
		return isBridgeEnabled ? `Bridge ${baseLabel}` : baseLabel;
	})();

	const statusDetail = (() => {
		if (reconnectStatus.state === "scheduled") {
			return `Retrying in ${reconnectStatus.secondsRemaining}s (attempt ${reconnectStatus.attempt})`;
		}
		if (reconnectStatus.state === "connecting") {
			return `Reconnecting (attempt ${reconnectStatus.attempt})`;
		}
		return null;
	})();

	const showReconnectNow =
		isBridgeEnabled &&
		(sessionState === "error" || reconnectStatus.state === "scheduled");
	const showCancelRetry =
		isBridgeEnabled && reconnectStatus.state === "scheduled";

	return (
		<div className="agent-client-chat-view-header">
			<div className="agent-client-chat-view-header-info">
				<h3 className="agent-client-chat-view-header-title">
					{agentLabel}
				</h3>
				<span
					className={`agent-client-chat-view-header-status agent-client-chat-view-header-status-${statusTone}`}
				>
					{statusLabel}
				</span>
				{statusDetail && (
					<span className="agent-client-chat-view-header-status-detail">
						{statusDetail}
					</span>
				)}
				{showReconnectNow && (
					<button
						type="button"
						className="agent-client-chat-view-header-status-action"
						onClick={onReconnectNow}
					>
						Reconnect
					</button>
				)}
				{showCancelRetry && (
					<button
						type="button"
						className="agent-client-chat-view-header-status-action agent-client-chat-view-header-status-action-muted"
						onClick={onCancelReconnect}
					>
						Cancel retry
					</button>
				)}
				{isUpdateAvailable && (
					<p className="agent-client-chat-view-header-update">
						Update available!
					</p>
				)}
			</div>
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
	);
}
