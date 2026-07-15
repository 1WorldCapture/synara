// FILE: CanvasWorkspaceView.tsx
// Purpose: Transitional route adapter while Canvas moves into the conversation Right Dock.
// Layer: Chat route presentation

import type { ProjectId, ThreadId } from "@synara/contracts";
import type { ReactNode } from "react";

import { CanvasDockPane } from "./CanvasDockPane";

export function CanvasWorkspaceView(props: {
  threadId: ThreadId;
  projectId: ProjectId;
  projectName: string;
  chatPanel: ReactNode;
  onExitCanvasView: () => void;
}) {
  return <CanvasDockPane threadId={props.threadId} />;
}
