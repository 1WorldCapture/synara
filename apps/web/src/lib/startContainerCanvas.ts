// FILE: startContainerCanvas.ts
// Purpose: Shared "ensure a hidden container, then create its durable Canvas thread" flow.
// Layer: Web orchestration helper

import type { ProjectId, ThreadId } from "@synara/contracts";
import {
  startContainerThread,
  type StartContainerThreadResult,
} from "./startContainerChat";

export type StartContainerCanvasResult = StartContainerThreadResult;

export async function startContainerCanvas(input: {
  readonly ensureProjectId: () => Promise<ProjectId | null>;
  readonly handleNewCanvasDrawing: (projectId: ProjectId) => Promise<ThreadId | null>;
  readonly errorLabel: string;
}): Promise<StartContainerCanvasResult> {
  return startContainerThread({
    ensureProjectId: input.ensureProjectId,
    startThread: input.handleNewCanvasDrawing,
    errorLabel: input.errorLabel,
  });
}
