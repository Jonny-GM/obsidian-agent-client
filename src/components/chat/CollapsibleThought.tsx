import * as React from "react";
const { useState, useEffect, useRef } = React;
import type AgentClientPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
	isStreaming?: boolean;
	autoExpand?: boolean;
}

export function CollapsibleThought({
	text,
	plugin,
	isStreaming = false,
	autoExpand = false,
}: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(
		autoExpand && isStreaming,
	);
	const hasUserToggled = useRef(false);

	useEffect(() => {
		if (hasUserToggled.current) {
			return;
		}
		if (autoExpand && isStreaming) {
			setIsExpanded(true);
			return;
		}
		setIsExpanded(false);
	}, [autoExpand, isStreaming]);

	return (
		<div
			className="agent-client-collapsible-thought"
			onClick={() => {
				hasUserToggled.current = true;
				setIsExpanded(!isExpanded);
			}}
		>
			<div className="agent-client-collapsible-thought-header">
				<span>💡 Thinking</span>
				{isStreaming && (
					<span className="agent-client-collapsible-thought-live">
						Live
					</span>
				)}
				<span className="agent-client-collapsible-thought-icon">
					{isExpanded ? "▼" : "▶"}
				</span>
			</div>
			{isExpanded && (
				<div className="agent-client-collapsible-thought-content">
					<MarkdownTextRenderer text={text} app={plugin.app} />
				</div>
			)}
		</div>
	);
}
