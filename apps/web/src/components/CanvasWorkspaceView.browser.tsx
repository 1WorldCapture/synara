import "../index.css";

import {
  type CanvasDrawingSaveInput,
  type CanvasDrawingSnapshot,
  type NativeApi,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  WsCanvasSaveDrawingRpc,
} from "@synara/contracts";
import { EMPTY_CANVAS_SCENE } from "@synara/shared/excalidrawScene";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { resetWsNativeApiForTest } from "../wsNativeApi";
import { useStore } from "../store";
import { CanvasWorkspaceView } from "./CanvasWorkspaceView";

const { addFilesMock, excalidrawOnChangeRef, updateSceneMock } = vi.hoisted(() => ({
  addFilesMock: vi.fn(),
  excalidrawOnChangeRef: {
    current: undefined as
      | ((elements: readonly unknown[], appState: unknown, files: unknown) => void)
      | undefined,
  },
  updateSceneMock: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@excalidraw/excalidraw")>();
  return {
    ...actual,
    Excalidraw: (props: {
      excalidrawAPI?: (api: unknown) => void;
      onChange?: (elements: readonly unknown[], appState: unknown, files: unknown) => void;
    }) => {
      excalidrawOnChangeRef.current = props.onChange;
      props.excalidrawAPI?.({ addFiles: addFilesMock, updateScene: updateSceneMock });
      return <div data-testid="excalidraw-test-double" />;
    },
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(async () => undefined),
  };
});

const PROJECT_ID = ProjectId.makeUnsafe("project-canvas-browser");
const THREAD_ID = ThreadId.makeUnsafe("thread-canvas-browser");
const NOW_ISO = "2026-07-14T00:00:00.000Z";

function makeSnapshot(): CanvasDrawingSnapshot {
  return {
    relativePath: "drawings/thread-canvas-browser.excalidraw",
    scene: EMPTY_CANVAS_SCENE,
    revision: "revision-1",
  };
}

describe("CanvasWorkspaceView", () => {
  let previousNativeApi: NativeApi | undefined;

  beforeEach(() => {
    previousNativeApi = window.nativeApi;
    addFilesMock.mockReset();
    excalidrawOnChangeRef.current = undefined;
    updateSceneMock.mockReset();
    resetWsNativeApiForTest();
    localStorage.clear();
    document.body.innerHTML = "";
    useStore.setState({
      projects: [
        {
          id: PROJECT_ID,
          kind: "local",
          name: "Canvas Project",
          remoteName: "Canvas Project",
          folderName: "canvas-project",
          localName: null,
          cwd: "/repo/canvas-project",
          defaultModelSelection: { provider: "grok", model: "grok-4" },
          expanded: true,
          scripts: [],
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      ],
      threads: [
        {
          id: THREAD_ID,
          codexThreadId: null,
          projectId: PROJECT_ID,
          surface: "canvas",
          title: "Canvas Thread",
          modelSelection: { provider: "grok", model: "grok-4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          session: null,
          messages: [],
          proposedPlans: [],
          error: null,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          latestTurn: null,
          turnDiffSummaries: [],
          activities: [],
          branch: null,
          worktreePath: null,
        },
      ],
      threadIds: [THREAD_ID],
      threadShellById: {
        [THREAD_ID]: {
          id: THREAD_ID,
          codexThreadId: null,
          projectId: PROJECT_ID,
          surface: "canvas",
          title: "Canvas Thread",
          modelSelection: { provider: "grok", model: "grok-4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          error: null,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          branch: null,
          worktreePath: null,
        },
      },
      sidebarThreadSummaryById: {},
      threadsHydrated: true,
    });

    const snapshot = makeSnapshot();
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        canvas: {
          readDrawing: vi.fn(async () => snapshot),
          saveDrawing: vi.fn(async () => snapshot),
          deleteDrawing: vi.fn(async () => ({ deleted: true })),
          createDrawing: vi.fn(async () => snapshot),
          onDrawingChanged: vi.fn(() => () => undefined),
        },
        orchestration: {
          dispatchCommand: vi.fn(async () => ({ sequence: 1 })),
        },
      } satisfies Partial<NativeApi>,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: previousNativeApi,
    });
    resetWsNativeApiForTest();
    document.body.innerHTML = "";
  });

  it("renders the canvas shell and toggles the persistent chat pane", async () => {
    const onExitCanvasView = vi.fn();
    const screen = await render(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasWorkspaceView
          threadId={THREAD_ID}
          projectId={PROJECT_ID}
          projectName="Canvas Project"
          chatPanel={<div>Persistent Chat</div>}
          onExitCanvasView={onExitCanvasView}
        />
      </div>,
    );

    try {
      await expect.element(page.getByText("Canvas Project")).toBeInTheDocument();
      await expect.element(
        page.getByRole("button", { name: "Canvas Thread" }),
      ).toBeInTheDocument();
      await expect.element(
        page.getByRole("main").getByText("Canvas Thread"),
      ).toBeInTheDocument();
      await expect.element(page.getByText("Persistent Chat")).toBeInTheDocument();
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();

      const generatedTitle = "J2EE onion architecture";
      useStore.setState((state) => ({
        threads: state.threads.map((candidate) =>
          candidate.id === THREAD_ID ? { ...candidate, title: generatedTitle } : candidate,
        ),
        threadShellById: {
          ...state.threadShellById,
          [THREAD_ID]: { ...state.threadShellById[THREAD_ID]!, title: generatedTitle },
        },
      }));
      await expect.element(
        page.getByRole("button", { name: generatedTitle }),
      ).toBeInTheDocument();
      await expect.element(
        page.getByRole("main").getByText(generatedTitle),
      ).toBeInTheDocument();

      await page.getByRole("button", { name: "Chat", exact: true }).click();
      expect(onExitCanvasView).toHaveBeenCalledOnce();

      await page.getByRole("button", { name: "Hide chat panel" }).click();
      await expect.element(page.getByText("Persistent Chat")).not.toBeVisible();

      await page.getByRole("button", { name: "Show chat panel" }).click();
      await expect.element(page.getByText("Persistent Chat")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("canonicalizes agent elements into a stable RPC save payload", async () => {
    const snapshot: CanvasDrawingSnapshot = {
      ...makeSnapshot(),
      scene: {
        ...EMPTY_CANVAS_SCENE,
        elements: [
          {
            id: "layer-1",
            type: "rectangle",
            x: 120,
            y: 140,
            width: 420,
            height: 100,
            label: { text: "Application layer", fontSize: 18 },
          },
        ],
      },
    };
    const saveDrawing = vi.fn(async (input: CanvasDrawingSaveInput) => ({
      ...snapshot,
      scene: input.scene,
      revision: "revision-2",
    }));
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          readDrawing: vi.fn(async () => snapshot),
          saveDrawing,
        },
      } as NativeApi,
    });

    const screen = await render(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasWorkspaceView
          threadId={THREAD_ID}
          projectId={PROJECT_ID}
          projectName="Canvas Project"
          chatPanel={<div>Persistent Chat</div>}
          onExitCanvasView={vi.fn()}
        />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(saveDrawing).toHaveBeenCalledOnce();
      const input = saveDrawing.mock.calls[0]?.[0];
      expect(input).toBeDefined();
      expect(input?.scene.files).toEqual({});
      expect(() =>
        Schema.encodeSync(Schema.toCodecJson(WsCanvasSaveDrawingRpc.payloadSchema))(input),
      ).not.toThrow();
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      const settledSaveCount = saveDrawing.mock.calls.length;
      expect(settledSaveCount).toBeLessThanOrEqual(2);
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      expect(saveDrawing).toHaveBeenCalledTimes(settledSaveCount);
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("detects a revision conflict when the RPC error message is opaque", async () => {
    let snapshot = makeSnapshot();
    const readDrawing = vi.fn(async () => snapshot);
    const saveDrawing = vi.fn(async () => {
      throw new Error("An error occurred in Effect.tryPromise");
    });
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          readDrawing,
          saveDrawing,
        },
      } as NativeApi,
    });

    const screen = await render(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasWorkspaceView
          threadId={THREAD_ID}
          projectId={PROJECT_ID}
          projectName="Canvas Project"
          chatPanel={<div>Persistent Chat</div>}
          onExitCanvasView={vi.fn()}
        />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      excalidrawOnChangeRef.current?.([], { zoom: { value: 2 } }, {});
      snapshot = { ...snapshot, revision: "revision-2" };

      await expect.element(page.getByText("Reload required")).toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Reload scene" })).toBeInTheDocument();
      expect(saveDrawing).toHaveBeenCalledOnce();
      expect(readDrawing).toHaveBeenCalledTimes(2);
    } finally {
      await screen.unmount();
    }
  });

  it("applies drawing-change events and performs a final turn sync", async () => {
    updateSceneMock.mockImplementation(
      ({ appState, elements }: { appState: unknown; elements: readonly unknown[] }) => {
        setTimeout(() => excalidrawOnChangeRef.current?.(elements, appState, {}), 50);
      },
    );
    let snapshot = makeSnapshot();
    let readFailuresRemaining = 0;
    const readDrawing = vi.fn(async () => {
      if (readFailuresRemaining > 0) {
        readFailuresRemaining -= 1;
        throw new Error("transient read failure");
      }
      return snapshot;
    });
    const saveDrawing = vi.fn(async (input: CanvasDrawingSaveInput) => {
      snapshot = { ...snapshot, scene: input.scene, revision: "revision-2-canonical" };
      return snapshot;
    });
    let drawingChangedListener:
      | Parameters<NativeApi["canvas"]["onDrawingChanged"]>[0]
      | undefined;
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          readDrawing,
          saveDrawing,
          onDrawingChanged: (listener) => {
            drawingChangedListener = listener;
            return () => {
              drawingChangedListener = undefined;
            };
          },
        },
      } as NativeApi,
    });

    const screen = await render(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasWorkspaceView
          threadId={THREAD_ID}
          projectId={PROJECT_ID}
          projectName="Canvas Project"
          chatPanel={<div>Persistent Chat</div>}
          onExitCanvasView={vi.fn()}
        />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(readDrawing).toHaveBeenCalledOnce();

      snapshot = {
        ...snapshot,
        revision: "revision-4",
        scene: {
          ...snapshot.scene,
          elements: [
            {
              id: "agent-element",
              type: "rectangle",
              x: 100,
              y: 100,
              width: 240,
              height: 120,
              label: { text: "Agent update" },
            },
          ],
        },
      };
      const turnId = TurnId.makeUnsafe("agent-turn");
      const activityId = EventId.makeUnsafe("create-view-started");
      const latestTurn = {
        turnId,
        state: "running" as const,
        requestedAt: NOW_ISO,
        startedAt: NOW_ISO,
        completedAt: null,
        assistantMessageId: null,
      };
      useStore.setState((state) => ({
        threadTurnStateById: {
          ...state.threadTurnStateById,
          [THREAD_ID]: { latestTurn },
        },
        activityIdsByThreadId: {
          ...state.activityIdsByThreadId,
          [THREAD_ID]: [activityId],
        },
        activityByThreadId: {
          ...state.activityByThreadId,
          [THREAD_ID]: {
            [activityId]: {
              id: activityId,
              tone: "tool",
              kind: "tool.started",
              summary: "create_view started",
              payload: { title: "create_view" },
              turnId,
              createdAt: NOW_ISO,
            },
          },
        },
      }));

      expect(drawingChangedListener).toBeDefined();
      drawingChangedListener?.({ threadId: THREAD_ID, revision: "revision-2" });
      drawingChangedListener?.({ threadId: THREAD_ID, revision: "revision-3" });
      drawingChangedListener?.({ threadId: THREAD_ID, revision: "revision-4" });
      await vi.waitFor(() => expect(readDrawing.mock.calls.length).toBeGreaterThan(1));
      expect(saveDrawing).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
          appState: expect.any(Object),
          elements: expect.arrayContaining([
            expect.objectContaining({ id: "agent-element" }),
          ]),
        }),
      );
      expect(readDrawing).toHaveBeenCalledTimes(2);

      const liveReadCount = readDrawing.mock.calls.length;
      readFailuresRemaining = 1;
      snapshot = {
        ...snapshot,
        revision: "revision-5",
        scene: {
          ...snapshot.scene,
          elements: [
            ...snapshot.scene.elements,
            {
              id: "final-agent-element",
              type: "ellipse",
              x: 400,
              y: 100,
              width: 120,
              height: 120,
              label: { text: "Final update" },
            },
          ],
        },
      };
      useStore.setState((state) => ({
        threadTurnStateById: {
          ...state.threadTurnStateById,
          [THREAD_ID]: {
            latestTurn: {
              ...latestTurn,
              state: "completed",
              completedAt: "2026-07-14T00:00:01.000Z",
            },
          },
        },
        activityIdsByThreadId: {
          ...state.activityIdsByThreadId,
          [THREAD_ID]: [],
        },
        activityByThreadId: {
          ...state.activityByThreadId,
          [THREAD_ID]: {},
        },
      }));
      await vi.waitFor(() =>
        expect(readDrawing.mock.calls.length).toBeGreaterThanOrEqual(liveReadCount + 2),
      );
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
          appState: expect.any(Object),
          elements: expect.arrayContaining([
            expect.objectContaining({ id: "final-agent-element" }),
          ]),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(saveDrawing).not.toHaveBeenCalled();

      const reconnectReadCount = readDrawing.mock.calls.length;
      const reconnectTurnId = TurnId.makeUnsafe("reconnected-agent-turn");
      const reconnectActivityId = EventId.makeUnsafe("reconnected-create-view");
      snapshot = { ...snapshot, revision: "revision-6" };
      useStore.setState((state) => ({
        threadTurnStateById: {
          ...state.threadTurnStateById,
          [THREAD_ID]: {
            latestTurn: {
              turnId: reconnectTurnId,
              state: "completed",
              requestedAt: NOW_ISO,
              startedAt: NOW_ISO,
              completedAt: "2026-07-14T00:00:02.000Z",
              assistantMessageId: null,
            },
          },
        },
        activityIdsByThreadId: {
          ...state.activityIdsByThreadId,
          [THREAD_ID]: [reconnectActivityId],
        },
        activityByThreadId: {
          ...state.activityByThreadId,
          [THREAD_ID]: {
            [reconnectActivityId]: {
              id: reconnectActivityId,
              tone: "tool",
              kind: "tool.completed",
              summary: "create_view completed",
              payload: { title: "create_view" },
              turnId: reconnectTurnId,
              createdAt: NOW_ISO,
            },
          },
        },
      }));
      await vi.waitFor(() =>
        expect(readDrawing.mock.calls.length).toBeGreaterThan(reconnectReadCount),
      );
    } finally {
      await screen.unmount();
    }
  });
});
