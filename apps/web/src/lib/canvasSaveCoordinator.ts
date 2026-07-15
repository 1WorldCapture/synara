// FILE: canvasSaveCoordinator.ts
// Purpose: Flushes pending Canvas edits before a new agent turn can read the drawing.
// Layer: Web orchestration boundary

import type { ThreadId } from "@synara/contracts";

type CanvasSaveBarrier = () => Promise<void>;

const barriers = new Map<ThreadId, CanvasSaveBarrier>();

export function registerCanvasSaveBarrier(
  threadId: ThreadId,
  barrier: CanvasSaveBarrier,
): () => void {
  barriers.set(threadId, barrier);
  return () => {
    if (barriers.get(threadId) === barrier) barriers.delete(threadId);
  };
}

export async function flushCanvasBeforeTurn(threadId: ThreadId): Promise<void> {
  await barriers.get(threadId)?.();
}
