// FILE: CanvasDockRevealCoordinator.tsx
// Purpose: Opens a thread's Canvas dock pane when an agent preview stream starts.
// Layer: Window-level route coordinator

import { ThreadId } from "@synara/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useDiffRouteSearch } from "~/hooks/useDiffRouteSearch";
import { resolveCanvasDockRevealDecision } from "~/lib/canvasDockReveal";
import { readNativeApi } from "~/nativeApi";
import { useRightDockStore } from "~/rightDockStore";
import { selectSplitView, useSplitViewStore } from "~/splitViewStore";

export function CanvasDockRevealCoordinator() {
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeSearch = useDiffRouteSearch();
  const splitView = useSplitViewStore(selectSplitView(routeSearch.splitViewId ?? null));
  const contextRef = useRef({ navigate, routeThreadId, splitView });
  contextRef.current = { navigate, routeThreadId, splitView };

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    return api.canvas.onAgentPreview((event) => {
      if (event.phase !== "start" || event.sequence !== 0) return;
      const { navigate: navigateCurrent, routeThreadId: routeThreadIdCurrent, splitView: splitViewCurrent } =
        contextRef.current;
      const decision = resolveCanvasDockRevealDecision({
        eventThreadId: event.threadId,
        routeThreadId: routeThreadIdCurrent,
        splitView: splitViewCurrent,
      });
      useRightDockStore.getState().openPane(decision.threadId, { kind: "canvas" });
      if (!splitViewCurrent || !decision.focusPaneId) return;
      useSplitViewStore.getState().setFocusedPane(splitViewCurrent.id, decision.focusPaneId);
      if (!decision.navigateThreadId) return;
      void navigateCurrent({
        to: "/$threadId",
        params: { threadId: decision.navigateThreadId },
        replace: true,
        search: (previous) => ({ ...previous, splitViewId: splitViewCurrent.id }),
      });
    });
  }, []);

  return null;
}
