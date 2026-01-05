import * as React from "react";
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { ToolCallRenderer } from "./ToolCallRenderer";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	messageRole?: "user" | "assistant";
	acpClient?: IAcpClient;
	isStreaming?: boolean;
	isLatestMessage?: boolean;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export function MessageContentRenderer({
	content,
	plugin,
	messageId,
	messageRole,
	acpClient,
	isStreaming = false,
	isLatestMessage = false,
	onApprovePermission,
}: MessageContentRendererProps) {
	const shouldAutoExpandThoughts =
		isStreaming && isLatestMessage && messageRole === "assistant";

	switch (content.type) {
		case "text":
			// User messages: render with mention support
			// Assistant messages: render as markdown
			if (messageRole === "user") {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return (
				<MarkdownTextRenderer text={content.text} app={plugin.app} />
			);

		case "text_with_context":
			// User messages with auto-mention context
			return (
				<TextWithMentions
					text={content.text}
					autoMentionContext={content.autoMentionContext}
					plugin={plugin}
				/>
			);

		case "agent_thought":
			return (
				<CollapsibleThought
					text={content.text}
					plugin={plugin}
					isStreaming={isStreaming}
					autoExpand={shouldAutoExpandThoughts}
				/>
			);

		case "tool_call":
			return (
				<ToolCallRenderer
					content={content}
					plugin={plugin}
					acpClient={acpClient}
					onApprovePermission={onApprovePermission}
				/>
			);

		case "plan":
			return (
				<div className="agent-client-message-plan">
					<div className="agent-client-message-plan-title">
						📋 Plan
					</div>
					{content.entries.map((entry, idx) => (
						<div
							key={idx}
							className="agent-client-message-plan-entry"
						>
							<span
								className={`agent-client-message-plan-entry-icon agent-client-status-${entry.status}`}
							>
								{entry.status === "completed"
									? "✓"
									: entry.status === "in_progress"
										? "⏳"
										: "⭕"}
							</span>{" "}
							{entry.content}
						</div>
					))}
				</div>
			);

		case "terminal":
			return (
				<TerminalRenderer
					terminalId={content.terminalId}
					acpClient={acpClient || null}
					plugin={plugin}
				/>
			);

		case "image":
			return (
				<div className="agent-client-message-image">
					<img
						src={`data:${content.mimeType};base64,${content.data}`}
						alt="Attached image"
						className="agent-client-message-image-thumbnail"
					/>
				</div>
			);

		default:
			return <span>Unsupported content type</span>;
	}
}
