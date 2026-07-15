const CANVAS_CONTEXT_VERSION = 2;

export function wrapCanvasAgentContext(input: {
  readonly threadId: string;
  readonly messageText: string;
}): string {
  return `<canvas_context version="${CANVAS_CONTEXT_VERSION}" drawing_id="${input.threadId}">
You are collaborating on the current editable Excalidraw Drawing. Call read_me before your first drawing operation in this conversation, then call read_scene before modifying an existing scene. If a choice changes factual structure, ask exactly one focused clarification question before drawing; choose sensible defaults for visual-only choices. For non-trivial drawings, use begin_view, several small append_view batches with cameraUpdate guidance, and one commit_view. Use create_view only for small edits. Preserve unrelated elements and stable ids, cancel an unfinished preview, and summarize the completed change briefly. Do not access or select another Drawing.
</canvas_context>

<latest_user_message>
${input.messageText}
</latest_user_message>`;
}
