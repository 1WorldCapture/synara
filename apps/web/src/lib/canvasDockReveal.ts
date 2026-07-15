// FILE: canvasDockReveal.ts
// Purpose: Decide whether an agent Canvas preview should focus a visible split leaf.
// Layer: Pure route coordination logic

import type { ThreadId } from "@synara/contracts";

import { resolveSplitViewPaneIdForThread, type PaneId, type SplitView } from "~/splitViewStore";

export interface CanvasDockRevealDecision {
  readonly threadId: ThreadId;
  readonly focusPaneId: PaneId | null;
  readonly navigateThreadId: ThreadId | null;
}
export function resolveCanvasDockRevealDecision(input: {
  eventThreadId: ThreadId;
  routeThreadId: ThreadId | null;
  splitView: SplitView | null;
}): CanvasDockRevealDecision {
  const focusPaneId = input.splitView
    ? resolveSplitViewPaneIdForThread(input.splitView, input.eventThreadId)
    : null;
  return {
    threadId: input.eventThreadId,
    focusPaneId,
    navigateThreadId:
      focusPaneId && input.routeThreadId !== input.eventThreadId ? input.eventThreadId : null,
  };
}
