// FILE: canvasDrawingStorage.ts
// Purpose: Resolves the durable storage location for a Canvas thread without coupling callers
//          to whether its project is a managed Studio container or an external workspace.
// Layer: Server Canvas storage policy

import type {
  CanvasDrawingRef,
  OrchestrationProjectShell,
  ThreadId,
} from "@synara/contracts";

export function resolveCanvasDrawingRef(input: {
  readonly stateDir: string;
  readonly project: Pick<OrchestrationProjectShell, "id" | "kind" | "workspaceRoot">;
  readonly threadId: ThreadId;
}): CanvasDrawingRef {
  if (input.project.kind === "studio") {
    return {
      cwd: input.project.workspaceRoot,
      directorySegments: ["drawings"],
      threadId: input.threadId,
    };
  }

  return {
    cwd: input.stateDir,
    directorySegments: ["drawings", input.project.id],
    legacyCwd: input.project.workspaceRoot,
    threadId: input.threadId,
  };
}
