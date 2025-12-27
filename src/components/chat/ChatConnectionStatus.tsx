import * as React from "react";

export interface ChatConnectionStatusProps {
	statusLabel: string;
	statusDetail?: string;
	statusTone: "connected" | "connecting" | "reconnecting" | "error";
	showReconnectAction: boolean;
	showCancelReconnectAction: boolean;
	onReconnect: () => void;
	onCancelReconnect: () => void;
}

export function ChatConnectionStatus({
	statusLabel,
	statusDetail,
	statusTone,
	showReconnectAction,
	showCancelReconnectAction,
	onReconnect,
	onCancelReconnect,
}: ChatConnectionStatusProps) {
	return (
		<div className="agent-client-chat-connection-status">
			<span
				className={`agent-client-chat-connection-status-pill agent-client-chat-connection-status-${statusTone}`}
			>
				{statusLabel}
			</span>
			{statusDetail && (
				<span className="agent-client-chat-connection-status-detail">
					{statusDetail}
				</span>
			)}
			{showReconnectAction && (
				<button
					type="button"
					className="agent-client-chat-connection-status-action"
					onClick={onReconnect}
				>
					Reconnect
				</button>
			)}
			{showCancelReconnectAction && (
				<button
					type="button"
					className="agent-client-chat-connection-status-action"
					onClick={onCancelReconnect}
				>
					Cancel retry
				</button>
			)}
		</div>
	);
}
