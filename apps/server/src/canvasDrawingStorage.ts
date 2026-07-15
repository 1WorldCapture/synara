// FILE: canvasDrawingStorage.ts
// Purpose: Resolves the durable, server-managed storage root for a conversation-owned Drawing.
// Layer: Server Canvas storage policy

import type { ThreadId } from "@synara/contracts";

export interface CanvasDrawingRef {
  readonly root: string;
  readonly threadId: ThreadId;
}

export function resolveCanvasDrawingRef(input: {
  readonly stateDir: string;
  readonly threadId: ThreadId;
}): CanvasDrawingRef {
  return {
    root: input.stateDir,
    threadId: input.threadId,
  };
}
