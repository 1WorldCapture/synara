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
    if (barriers.get(threadId) !== barrier) return;

    // A dock pane can unmount immediately before the user starts a turn. Keep its
    // final flush visible to dispatch until it settles so the agent cannot read a
    // stale scene after the UI barrier has disappeared.
    const pending = Promise.resolve().then(barrier);
    const detachedBarrier = () => pending;
    barriers.set(threadId, detachedBarrier);
    void pending.then(
      () => {
        if (barriers.get(threadId) === detachedBarrier) barriers.delete(threadId);
      },
      () => {
        // Preserve the rejected barrier until the pane remounts and replaces it.
        // Otherwise a failed final save would silently allow a turn on stale data.
      },
    );
  };
}

export async function flushCanvasBeforeTurn(threadId: ThreadId): Promise<void> {
  await barriers.get(threadId)?.();
}
