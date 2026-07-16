import "../index.css";

import {
  type CanvasDrawingSaveInput,
  type CanvasDrawingSnapshot,
  type NativeApi,
  type OrchestrationEvent,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  WsCanvasSaveDrawingRpc,
} from "@synara/contracts";
import { EMPTY_CANVAS_SCENE } from "@synara/shared/excalidrawScene";
import { Schema } from "effect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { resetWsNativeApiForTest } from "../wsNativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { CanvasDockPane } from "./CanvasDockPane";

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
      props.excalidrawAPI?.({
        addFiles: addFilesMock,
        updateScene: updateSceneMock,
        getAppState: () => ({
          width: 1200,
          height: 800,
          scrollX: 0,
          scrollY: 0,
          zoom: { value: 1 },
        }),
        refresh: vi.fn(),
      });
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

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("CanvasDockPane", () => {
  let previousNativeApi: NativeApi | undefined;

  beforeEach(() => {
    previousNativeApi = window.nativeApi;
    addFilesMock.mockReset();
    excalidrawOnChangeRef.current = undefined;
    updateSceneMock.mockReset();
    resetWsNativeApiForTest();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      stickyActiveProvider: null,
      stickyModelSelectionByProvider: {},
    });
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
      threadSessionById: {},
      threadTurnStateById: {},
      messageIdsByThreadId: {},
      messageByThreadId: {},
      activityIdsByThreadId: {},
      activityByThreadId: {},
      threadsHydrated: true,
    });

    const snapshot = makeSnapshot();
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        canvas: {
          readDrawing: vi.fn(async () => snapshot),
          saveDrawing: vi.fn(async () => snapshot),
          createDrawing: vi.fn(async () => snapshot),
          onDrawingChanged: vi.fn(() => () => undefined),
          onAgentPreview: vi.fn(() => () => undefined),
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

  it("ensures lazily, clears through save, and reuses the Drawing after remount", async () => {
    useStore.setState((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === THREAD_ID
          ? { ...thread, modelSelection: { provider: "pi", model: "pi-runtime-model" } }
          : thread,
      ),
    }));
    let snapshot: CanvasDrawingSnapshot = {
      ...makeSnapshot(),
      scene: {
        ...EMPTY_CANVAS_SCENE,
        elements: [{ id: "existing", type: "rectangle", version: 1 }],
      },
    };
    const createDrawing = vi.fn(async () => snapshot);
    const readDrawing = vi.fn(async () => snapshot);
    const dispatchCommand = vi.fn(async () => ({ sequence: 1 }));
    const saveDrawing = vi.fn(async (input: CanvasDrawingSaveInput) => {
      snapshot = {
        relativePath: snapshot.relativePath,
        scene: input.scene,
        revision: `revision-${saveDrawing.mock.calls.length + 1}`,
      };
      return snapshot;
    });
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing,
          readDrawing,
          saveDrawing,
        },
        orchestration: { dispatchCommand },
      } as NativeApi,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    const dormantMount = await renderWithQueryClient(
      <CanvasDockPane threadId={THREAD_ID} active={false} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createDrawing).not.toHaveBeenCalled();
    await dormantMount.unmount();

    const firstMount = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );
    let firstMountActive = true;

    try {
      await expect.element(page.getByTestId("canvas-dock-pane")).toBeInTheDocument();
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(createDrawing).toHaveBeenCalledOnce();
      expect(readDrawing).not.toHaveBeenCalled();

      await page.getByRole("button", { name: "Clear" }).click();
      await vi.waitFor(() => expect(saveDrawing).toHaveBeenCalledOnce());
      expect(saveDrawing).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: THREAD_ID,
          expectedRevision: "revision-1",
          scene: expect.objectContaining({ elements: [] }),
        }),
      );
      expect(createDrawing).toHaveBeenCalledOnce();

      await firstMount.unmount();
      firstMountActive = false;
      const secondMount = await renderWithQueryClient(
        <div style={{ width: "1440px", height: "900px" }}>
          <CanvasDockPane threadId={THREAD_ID} />
        </div>,
      );
      try {
        await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
        expect(createDrawing).toHaveBeenCalledTimes(2);
        expect(readDrawing).not.toHaveBeenCalled();

        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        excalidrawOnChangeRef.current?.(
          [{ id: "local-after-remount", type: "ellipse" }],
          {},
          {},
        );
      } finally {
        await secondMount.unmount();
      }
      await vi.waitFor(() => expect(saveDrawing).toHaveBeenCalledTimes(2));
      expect(dispatchCommand).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
      if (firstMountActive) await firstMount.unmount();
    }
  });

  it("renders ephemeral preview batches and yields camera control", async () => {
    const snapshot = makeSnapshot();
    const turnId = TurnId.makeUnsafe("cancelled-preview-turn");
    const activityId = EventId.makeUnsafe("cancelled-preview-activity");
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
            summary: "mcp__canvas__begin",
            payload: { title: "MCP tool call", data: { toolName: "mcp__canvas__begin" } },
            turnId,
            createdAt: NOW_ISO,
          },
        },
      },
    }));
    const readDrawing = vi.fn(async () => snapshot);
    const saveDrawing = vi.fn(async () => snapshot);
    const dispatchCommand = vi.fn(async () => ({ sequence: 2 }));
    let previewListener: Parameters<NativeApi["canvas"]["onAgentPreview"]>[0] | undefined;
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing: readDrawing,
          readDrawing,
          saveDrawing,
          onAgentPreview: (listener) => {
            previewListener = listener;
            return () => {
              previewListener = undefined;
            };
          },
        },
        orchestration: { dispatchCommand },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(previewListener).toBeDefined();
      const callsBeforePreview = updateSceneMock.mock.calls.length;
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-1",
        sequence: 0,
        phase: "start",
        baseRevision: "revision-1",
        operations: [],
      });
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-1",
        sequence: 1,
        phase: "partial",
        baseRevision: "revision-1",
        operations: [
          {
            id: "preview-box",
            type: "rectangle",
            x: 100,
            y: 120,
            width: 300,
            height: 160,
            label: { text: "Streaming" },
          },
        ],
        camera: { x: 60, y: 80, width: 640, height: 480, durationMs: 0 },
      });
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-1",
        sequence: 2,
        phase: "partial",
        baseRevision: "revision-1",
        operations: [
          { id: "preview-detail", type: "ellipse", x: 440, y: 140, width: 80, height: 80 },
        ],
      });

      await expect.element(page.getByText("AI is drawing")).toBeInTheDocument();
      await vi.waitFor(() =>
        expect(
          updateSceneMock.mock.calls
            .slice(callsBeforePreview)
            .filter(([update]) => update?.captureUpdate === "NEVER" && update.elements),
        ).toHaveLength(2),
      );
      const previewRenderCalls = updateSceneMock.mock.calls
        .slice(callsBeforePreview)
        .filter(([update]) => update?.captureUpdate === "NEVER" && update.elements);
      expect(previewRenderCalls[0]?.[0]).toEqual({
        elements: expect.arrayContaining([expect.objectContaining({ id: "preview-box" })]),
        captureUpdate: "NEVER",
      });
      expect(previewRenderCalls[0]?.[0]?.elements).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "preview-detail" })]),
      );
      expect(previewRenderCalls[1]?.[0]).toEqual({
        elements: expect.arrayContaining([
          expect.objectContaining({ id: "preview-box" }),
          expect.objectContaining({ id: "preview-detail" }),
        ]),
        captureUpdate: "NEVER",
      });
      expect(saveDrawing).not.toHaveBeenCalled();

      document.querySelector('[data-testid="excalidraw-canvas"]')?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await expect.element(page.getByRole("button", { name: "Follow agent" })).toBeInTheDocument();
      await page.getByRole("button", { name: "Take over" }).click();
      expect(dispatchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "thread.turn.interrupt",
          threadId: THREAD_ID,
        }),
      );

      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-1",
        sequence: 3,
        phase: "cancelled",
        baseRevision: "revision-1",
        operations: [],
      });
      await expect
        .element(page.getByText("AI is drawing"))
        .not.toBeInTheDocument();
      expect(updateSceneMock).toHaveBeenLastCalledWith({
        elements: [],
        captureUpdate: "NEVER",
      });

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
      }));
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(readDrawing).toHaveBeenCalledOnce();
      expect(saveDrawing).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps preview batches active across a non-streaming interim assistant message", async () => {
    const turnId = TurnId.makeUnsafe("canvas-interim-commentary-turn");
    const session = {
      provider: "grok" as const,
      status: "running" as const,
      orchestrationStatus: "running" as const,
      activeTurnId: turnId,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };
    const latestTurn = {
      turnId,
      state: "running" as const,
      requestedAt: NOW_ISO,
      startedAt: NOW_ISO,
      completedAt: null,
      assistantMessageId: null,
    };
    useStore.setState((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === THREAD_ID ? { ...thread, session, latestTurn } : thread,
      ),
      threadSessionById: {
        ...state.threadSessionById,
        [THREAD_ID]: session,
      },
      threadTurnStateById: {
        ...state.threadTurnStateById,
        [THREAD_ID]: { latestTurn },
      },
    }));

    const readDrawing = vi.fn(async () => makeSnapshot());
    let previewListener: Parameters<NativeApi["canvas"]["onAgentPreview"]>[0] | undefined;
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing: readDrawing,
          readDrawing,
          onAgentPreview: (listener) => {
            previewListener = listener;
            return () => {
              previewListener = undefined;
            };
          },
        },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(readDrawing).toHaveBeenCalledOnce();
      expect(previewListener).toBeDefined();

      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-with-interim-commentary",
        sequence: 0,
        phase: "start",
        baseRevision: "revision-1",
        operations: [],
      });
      await expect.element(page.getByText("AI is drawing")).toBeInTheDocument();

      useStore.getState().applyOrchestrationEvents([
        {
          type: "thread.message-sent",
          sequence: 1,
          eventId: EventId.makeUnsafe("interim-commentary-event"),
          aggregateKind: "thread",
          aggregateId: THREAD_ID,
          occurredAt: "2026-07-14T00:00:01.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            threadId: THREAD_ID,
            messageId: MessageId.makeUnsafe("interim-commentary-message"),
            role: "assistant",
            text: "I will now append the next drawing batch.",
            turnId,
            streaming: false,
            createdAt: "2026-07-14T00:00:01.000Z",
            updatedAt: "2026-07-14T00:00:01.000Z",
            attachments: [],
            source: "native",
          },
        } satisfies Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
      ]);

      await vi.waitFor(() =>
        expect(useStore.getState().threadTurnStateById?.[THREAD_ID]?.latestTurn).toMatchObject({
          turnId,
          state: "running",
          completedAt: null,
        }),
      );
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "stream-with-interim-commentary",
        sequence: 1,
        phase: "partial",
        baseRevision: "revision-1",
        operations: [
          {
            id: "preview-after-commentary",
            type: "rectangle",
            x: 100,
            y: 120,
            width: 300,
            height: 160,
            label: { text: "Still streaming" },
          },
        ],
      });

      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
          elements: expect.arrayContaining([
            expect.objectContaining({ id: "preview-after-commentary" }),
          ]),
          captureUpdate: "NEVER",
        }),
      );
      await expect.element(page.getByText("AI is drawing")).toBeInTheDocument();
      expect(readDrawing).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
    }
  });

  it("binds a preview-only stream to its running turn for settled final sync", async () => {
    const turnId = TurnId.makeUnsafe("preview-only-turn");
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
    }));

    let snapshot = makeSnapshot();
    const readDrawing = vi.fn(async () => snapshot);
    const saveDrawing = vi.fn(async () => snapshot);
    let previewListener: Parameters<NativeApi["canvas"]["onAgentPreview"]>[0] | undefined;
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing: readDrawing,
          readDrawing,
          saveDrawing,
          onAgentPreview: (listener) => {
            previewListener = listener;
            return () => {
              previewListener = undefined;
            };
          },
        },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      expect(readDrawing).toHaveBeenCalledOnce();
      expect(previewListener).toBeDefined();

      previewListener?.({
        threadId: THREAD_ID,
        streamId: "preview-only-stream",
        sequence: 0,
        phase: "start",
        baseRevision: "revision-1",
        operations: [],
      });
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "preview-only-stream",
        sequence: 1,
        phase: "complete",
        baseRevision: "revision-1",
        operations: [],
      });
      snapshot = { ...snapshot, revision: "revision-2" };
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
      }));

      await vi.waitFor(() => expect(readDrawing.mock.calls.length).toBeGreaterThan(1), {
        timeout: 2_500,
      });
      expect(saveDrawing).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("rolls back an unterminated preview when its owning turn settles", async () => {
    const turnId = TurnId.makeUnsafe("abandoned-preview-turn");
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
    }));

    const snapshot: CanvasDrawingSnapshot = {
      ...makeSnapshot(),
      scene: {
        ...EMPTY_CANVAS_SCENE,
        elements: [{ id: "authoritative", type: "rectangle", version: 1 }],
      },
    };
    const readDrawing = vi.fn(async () => snapshot);
    const saveDrawing = vi.fn(async () => snapshot);
    let previewListener: Parameters<NativeApi["canvas"]["onAgentPreview"]>[0] | undefined;
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing: readDrawing,
          readDrawing,
          saveDrawing,
          onAgentPreview: (listener) => {
            previewListener = listener;
            return () => {
              previewListener = undefined;
            };
          },
        },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "abandoned-preview-stream",
        sequence: 0,
        phase: "start",
        baseRevision: "revision-1",
        operations: [],
      });
      previewListener?.({
        threadId: THREAD_ID,
        streamId: "abandoned-preview-stream",
        sequence: 1,
        phase: "partial",
        baseRevision: "revision-1",
        operations: [
          { id: "preview-only", type: "ellipse", x: 80, y: 80, width: 120, height: 80 },
        ],
      });
      await expect.element(page.getByText("AI is drawing")).toBeInTheDocument();
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
          elements: expect.arrayContaining([expect.objectContaining({ id: "preview-only" })]),
          captureUpdate: "NEVER",
        }),
      );

      useStore.setState((state) => ({
        threadTurnStateById: {
          ...state.threadTurnStateById,
          [THREAD_ID]: {
            latestTurn: {
              ...latestTurn,
              state: "interrupted",
              completedAt: "2026-07-14T00:00:01.000Z",
            },
          },
        },
      }));

      await expect.element(page.getByText("AI is drawing")).not.toBeInTheDocument();
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenLastCalledWith({
          elements: expect.arrayContaining([expect.objectContaining({ id: "authoritative" })]),
          captureUpdate: "NEVER",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(readDrawing).toHaveBeenCalledOnce();
      expect(saveDrawing).not.toHaveBeenCalled();
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
    const readDrawing = vi.fn(async () => snapshot);
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...window.nativeApi,
        canvas: {
          ...window.nativeApi?.canvas,
          createDrawing: readDrawing,
          readDrawing,
          saveDrawing,
        },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
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
          createDrawing: readDrawing,
          readDrawing,
          saveDrawing,
        },
      } as NativeApi,
    });

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
      </div>,
    );

    try {
      await expect.element(page.getByText("Saved locally")).toBeInTheDocument();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
          createDrawing: readDrawing,
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

    const screen = await renderWithQueryClient(
      <div style={{ width: "1440px", height: "900px" }}>
        <CanvasDockPane threadId={THREAD_ID} />
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
              summary: "mcp__canvas__begin",
              payload: { title: "MCP tool call", data: { toolName: "mcp__canvas__begin" } },
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
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
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
      await vi.waitFor(
        () => expect(readDrawing.mock.calls.length).toBeGreaterThanOrEqual(liveReadCount + 2),
        { timeout: 2_500 },
      );
      expect(saveDrawing).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(updateSceneMock).toHaveBeenCalledWith({
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
              summary: "mcp__canvas__commit",
              payload: { title: "MCP tool call", data: { toolName: "mcp__canvas__commit" } },
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
