import type { CanvasAgentPreviewEvent, NativeApi } from "@synara/contracts";
import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useRightDockStore } from "~/rightDockStore";
import { useSplitViewStore, type SplitView } from "~/splitViewStore";
import { CanvasDockRevealCoordinator } from "./CanvasDockRevealCoordinator";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: (options: { select: (params: { threadId: string }) => unknown }) =>
      options.select({ threadId: "thread-reveal-a" }),
  };
});
vi.mock("~/hooks/useDiffRouteSearch", () => ({
  useDiffRouteSearch: () => ({ splitViewId: "split-reveal" }),
}));

const THREAD_A = ThreadId.makeUnsafe("thread-reveal-a");
const THREAD_B = ThreadId.makeUnsafe("thread-reveal-b");
const THREAD_C = ThreadId.makeUnsafe("thread-reveal-c");

const PANEL_STATE = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
} as const;

const SPLIT_VIEW: SplitView = {
  id: "split-reveal",
  sourceThreadId: THREAD_A,
  ownerProjectId: ProjectId.makeUnsafe("project-reveal"),
  focusedPaneId: "pane-a",
  root: {
    kind: "split",
    id: "split-root",
    direction: "horizontal",
    ratio: 0.5,
    first: { kind: "leaf", id: "pane-a", threadId: THREAD_A, panel: PANEL_STATE },
    second: { kind: "leaf", id: "pane-b", threadId: THREAD_B, panel: PANEL_STATE },
  },
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

function preview(threadId: typeof THREAD_A, streamId: string): CanvasAgentPreviewEvent {
  return {
    threadId,
    streamId,
    sequence: 0,
    phase: "start",
    baseRevision: "revision-1",
    operations: [],
  };
}

describe("CanvasDockRevealCoordinator", () => {
  let previousNativeApi: NativeApi | undefined;
  let previewListener: ((event: CanvasAgentPreviewEvent) => void) | undefined;

  beforeEach(() => {
    previousNativeApi = window.nativeApi;
    previewListener = undefined;
    navigateMock.mockReset();
    navigateMock.mockResolvedValue(undefined);
    localStorage.clear();
    useRightDockStore.setState({ dockStateByThreadId: {} });
    useSplitViewStore.setState({
      hasHydrated: true,
      splitViewsById: { [SPLIT_VIEW.id]: SPLIT_VIEW },
      splitViewIdBySourceThreadId: { [THREAD_A]: SPLIT_VIEW.id },
    });
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        canvas: {
          onAgentPreview: (listener: (event: CanvasAgentPreviewEvent) => void) => {
            previewListener = listener;
            return () => {
              previewListener = undefined;
            };
          },
        },
      } as NativeApi,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: previousNativeApi,
    });
  });

  it("focuses a visible split preview but only persists a background preview", async () => {
    const screen = await render(<CanvasDockRevealCoordinator />);
    try {
      expect(previewListener).toBeDefined();
      previewListener?.(preview(THREAD_B, "stream-b"));

      expect(useRightDockStore.getState().dockStateByThreadId[THREAD_B]).toMatchObject({
        open: true,
        panes: [expect.objectContaining({ kind: "canvas" })],
      });
      expect(useSplitViewStore.getState().splitViewsById[SPLIT_VIEW.id]?.focusedPaneId).toBe(
        "pane-b",
      );
      expect(navigateMock).toHaveBeenCalledOnce();

      previewListener?.(preview(THREAD_C, "stream-c"));
      expect(useRightDockStore.getState().dockStateByThreadId[THREAD_C]).toMatchObject({
        open: true,
        panes: [expect.objectContaining({ kind: "canvas" })],
      });
      expect(useSplitViewStore.getState().splitViewsById[SPLIT_VIEW.id]?.focusedPaneId).toBe(
        "pane-b",
      );
      expect(navigateMock).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
    }
  });
});
