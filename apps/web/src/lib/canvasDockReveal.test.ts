import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import type { SplitView } from "~/splitViewStore";
import { resolveCanvasDockRevealDecision } from "./canvasDockReveal";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");

const SPLIT_VIEW = {
  id: "split-1",
  sourceThreadId: THREAD_A,
  ownerProjectId: "project-1",
  focusedPaneId: "pane-a",
  root: {
    kind: "split",
    id: "split-root",
    direction: "horizontal",
    ratio: 0.5,
    first: { kind: "leaf", id: "pane-a", threadId: THREAD_A, panel: {} },
    second: { kind: "leaf", id: "pane-b", threadId: THREAD_B, panel: {} },
  },
} as unknown as SplitView;

describe("resolveCanvasDockRevealDecision", () => {
  it("opens and focuses a visible split leaf without collapsing the split", () => {
    expect(
      resolveCanvasDockRevealDecision({
        eventThreadId: THREAD_B,
        routeThreadId: THREAD_A,
        splitView: SPLIT_VIEW,
      }),
    ).toEqual({ threadId: THREAD_B, focusPaneId: "pane-b", navigateThreadId: THREAD_B });
  });

  it("opens a background thread without changing the visible route", () => {
    expect(
      resolveCanvasDockRevealDecision({
        eventThreadId: THREAD_C,
        routeThreadId: THREAD_A,
        splitView: SPLIT_VIEW,
      }),
    ).toEqual({ threadId: THREAD_C, focusPaneId: null, navigateThreadId: null });
  });

  it("does not navigate for the already visible single thread", () => {
    expect(
      resolveCanvasDockRevealDecision({
        eventThreadId: THREAD_A,
        routeThreadId: THREAD_A,
        splitView: null,
      }),
    ).toEqual({ threadId: THREAD_A, focusPaneId: null, navigateThreadId: null });
  });
});
