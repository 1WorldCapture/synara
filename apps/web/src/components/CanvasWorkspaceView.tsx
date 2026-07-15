// FILE: CanvasWorkspaceView.tsx
// Purpose: Editor-style Excalidraw workspace with project drawings and a persistent AI chat.
// Layer: Chat route presentation

import {
  type CanvasAgentCamera,
  type CanvasAgentPreviewEvent,
  type CanvasDrawingSnapshot,
  type CanvasScene,
  type ProjectId,
  type ThreadId,
  type TurnId,
} from "@synara/contracts";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  FONT_FAMILY,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { applyExcalidrawElementOperations } from "@synara/shared/excalidrawScene";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useNavigate } from "@tanstack/react-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiCrosshair, FiMessageSquare, FiPlus, FiTrash2 } from "react-icons/fi";

import { useHandleNewCanvasDrawing } from "~/hooks/useHandleNewCanvasDrawing";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useTheme } from "~/hooks/useTheme";
import { canvasAgentMutationTurnId, isCanvasAgentEditing } from "~/lib/canvasAgentState";
import { registerCanvasSaveBarrier } from "~/lib/canvasSaveCoordinator";
import {
  canvasCameraAnimationStep,
  canvasCameraTarget,
  canvasPreviewEventDecision,
  isCanvasCameraSettled,
  type CanvasPreviewCursor,
} from "~/lib/canvasAgentPreview";
import { logCanvasDiagnostic } from "~/lib/canvasDiagnostics";
import { ChatBubbleIcon, Maximize2, Minimize2 } from "~/lib/icons";
import { cn, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { createThreadSelector, createThreadShellsSelector } from "~/storeSelectors";
import { useStore } from "~/store";
import { ResizableChatPane, useResizableChatPane } from "./ResizableChatPane";
import { ChatHeaderButton, ChatHeaderIconButton } from "./chat/chatHeaderControls";
import { toastManager } from "./ui/toast";

type SaveState = "loading" | "saved" | "saving" | "conflict" | "error";
type DrawingSyncMode = "foreground" | "live" | "settled";
type PendingSceneChange =
  | { readonly kind: "serialized"; readonly scene: CanvasScene }
  | {
      readonly kind: "excalidraw";
      readonly elements: readonly unknown[];
      readonly appState: unknown;
      readonly files: unknown;
    };

const AUTOSAVE_DELAY_MS = 500;
const FINAL_SYNC_RETRY_DELAYS_MS = [100, 500, 1_500, 5_000] as const;

function waitForFinalSyncRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toCanvasScene(elements: readonly unknown[], appState: unknown, files: unknown): CanvasScene {
  const scene = JSON.parse(
    serializeAsJSON(elements as never, appState as never, files as never, "database"),
  ) as CanvasScene;
  return { ...scene, files: scene.files ?? {} };
}

function canonicalizeAgentElements(scene: CanvasScene): { scene: CanvasScene; changed: boolean } {
  const canonical: Array<Record<string, unknown>> = [];
  const shorthand: Array<Record<string, unknown>> = [];
  for (const element of scene.elements) {
    if (element.label !== undefined || element.version === undefined) {
      shorthand.push(element);
    } else {
      canonical.push(element);
    }
  }
  if (shorthand.length === 0) return { scene, changed: false };

  const converted = convertToExcalidrawElements(
    shorthand.map((element) =>
      element.label
        ? {
            ...element,
            label: { textAlign: "center", verticalAlign: "middle", ...element.label },
          }
        : element,
    ) as never,
    { regenerateIds: false },
  ).map((element) =>
    element.type === "text" ? { ...element, fontFamily: FONT_FAMILY.Excalifont } : element,
  );

  return {
    scene: toCanvasScene(
      [...canonical, ...converted],
      scene.appState,
      scene.files ?? {},
    ),
    changed: true,
  };
}

function saveStateLabel(state: SaveState): string {
  switch (state) {
    case "loading":
      return "Loading";
    case "saving":
      return "Saving…";
    case "conflict":
      return "Reload required";
    case "error":
      return "Save failed";
    case "saved":
      return "Saved locally";
  }
}

export function CanvasWorkspaceView(props: {
  threadId: ThreadId;
  projectId: ProjectId;
  projectName: string;
  chatPanel: ReactNode;
  onExitCanvasView: () => void;
}) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { handleNewCanvasDrawing } = useHandleNewCanvasDrawing();
  const chatPane = useResizableChatPane({ storageKey: "synara.canvas.chatPane" });
  const thread = useStore(
    useMemo(() => createThreadSelector(props.threadId), [props.threadId]),
  );
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const drawings = useMemo(
    () =>
      threadShells
        .filter(
          (candidate) =>
            candidate.projectId === props.projectId &&
            candidate.surface === "canvas" &&
            !candidate.archivedAt,
        )
        .toSorted((left, right) =>
          (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt),
        ),
    [props.projectId, threadShells],
  );
  const agentEditing = isCanvasAgentEditing({
    latestTurn: thread?.latestTurn ?? null,
    activities: thread?.activities ?? [],
  });
  const mutationTurnId = canvasAgentMutationTurnId({
    latestTurn: thread?.latestTurn ?? null,
    activities: thread?.activities ?? [],
  });
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const revisionRef = useRef<string | null>(null);
  const authoritativeSceneRef = useRef<CanvasScene | null>(null);
  const previewSceneRef = useRef<CanvasScene | null>(null);
  const renderedSceneJsonRef = useRef<string | null>(null);
  const pendingSceneRef = useRef<PendingSceneChange | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawingIoChainRef = useRef<Promise<void>>(Promise.resolve());
  const localSceneGenerationRef = useRef(0);
  const latestNotifiedRevisionRef = useRef<string | null>(null);
  const liveSyncQueuedRef = useRef(false);
  const applyingRemoteSceneRef = useRef(false);
  const activePreviewCursorRef = useRef<CanvasPreviewCursor | null>(null);
  const pendingPreviewRenderSceneRef = useRef<CanvasScene | null>(null);
  const previewRenderFrameRef = useRef<number | null>(null);
  const cameraAnimationFrameRef = useRef<number | null>(null);
  const lastAgentCameraRef = useRef<CanvasAgentCamera | null>(null);
  const followingAgentRef = useRef(true);
  const conflictRef = useRef(false);
  const pendingFinalReloadTurnIdRef = useRef<TurnId | null>(
    thread?.latestTurn?.state === "running" && agentEditing ? thread.latestTurn.turnId : null,
  );
  const finalSyncInFlightTurnIdRef = useRef<TurnId | null>(null);
  const finalSyncAbortControllerRef = useRef<AbortController | null>(null);
  const lastSettledMutationTurnIdRef = useRef<TurnId | null>(null);
  const [initialScene, setInitialScene] = useState<CanvasScene | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [previewActive, setPreviewActive] = useState(false);
  const [finalSyncActive, setFinalSyncActive] = useState(false);
  const [followingAgent, setFollowingAgent] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const canvasLocked = agentEditing || previewActive || finalSyncActive;

  const setAgentFollowing = useCallback((value: boolean) => {
    followingAgentRef.current = value;
    setFollowingAgent(value);
  }, []);

  const cancelCameraAnimation = useCallback(() => {
    if (cameraAnimationFrameRef.current !== null) {
      cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = null;
    }
  }, []);

  const animateAgentCamera = useCallback(
    (camera: CanvasAgentCamera) => {
      lastAgentCameraRef.current = camera;
      if (!followingAgentRef.current) return;
      const api = excalidrawApiRef.current;
      if (!api) return;
      cancelCameraAnimation();
      const appState = api.getAppState();
      const container = canvasContainerRef.current;
      const width = Number(appState.width) || container?.clientWidth || 1;
      const height = Number(appState.height) || container?.clientHeight || 1;
      const target = canvasCameraTarget(camera, { width, height });
      const current = {
        scrollX: Number(appState.scrollX) || 0,
        scrollY: Number(appState.scrollY) || 0,
        zoom: Number(appState.zoom?.value) || 1,
      };
      const durationMs = reducedMotion ? 0 : (camera.durationMs ?? 650);
      let position = current;
      let previousTime = performance.now();
      const startedAt = previousTime;
      const applyPosition = (next: typeof current) => {
        applyingRemoteSceneRef.current = true;
        api.updateScene({
          appState: {
            scrollX: next.scrollX,
            scrollY: next.scrollY,
            zoom: { value: next.zoom },
          } as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      };
      if (durationMs === 0) {
        applyPosition(target);
        requestAnimationFrame(() => {
          applyingRemoteSceneRef.current = false;
        });
        return;
      }
      const frame = (now: number) => {
        position = canvasCameraAnimationStep(position, target, now - previousTime);
        previousTime = now;
        const finished = now - startedAt >= durationMs || isCanvasCameraSettled(position, target);
        applyPosition(finished ? target : position);
        if (finished) {
          cameraAnimationFrameRef.current = null;
          requestAnimationFrame(() => {
            applyingRemoteSceneRef.current = false;
          });
          return;
        }
        cameraAnimationFrameRef.current = requestAnimationFrame(frame);
      };
      cameraAnimationFrameRef.current = requestAnimationFrame(frame);
    },
    [cancelCameraAnimation, reducedMotion],
  );

  const applyPreviewScene = useCallback((scene: CanvasScene) => {
    const displayScene = canonicalizeAgentElements(scene).scene;
    applyingRemoteSceneRef.current = true;
    const api = excalidrawApiRef.current;
    logCanvasDiagnostic("workspace.preview-rendering", {
      threadId: props.threadId,
      elementCount: displayScene.elements.length,
      apiAvailable: Boolean(api),
    });
    if (api) {
      api.updateScene({
        elements: displayScene.elements as never,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    } else {
      setInitialScene(displayScene);
    }
    requestAnimationFrame(() => {
      applyingRemoteSceneRef.current = false;
    });
  }, [props.threadId]);

  const applyPreviewOperations = useCallback(
    (operations: ReadonlyArray<Record<string, unknown>>) => {
      const current = previewSceneRef.current ?? authoritativeSceneRef.current;
      if (!current) {
        logCanvasDiagnostic("workspace.operations-skipped", {
          threadId: props.threadId,
          reason: "scene-unavailable",
          operationCount: operations.length,
        });
        return;
      }
      const next = applyExcalidrawElementOperations(current, operations);
      previewSceneRef.current = next;
      logCanvasDiagnostic("workspace.operations-applied", {
        threadId: props.threadId,
        operationCount: operations.length,
        beforeElementCount: current.elements.length,
        afterElementCount: next.elements.length,
        changed: next !== current,
      });
      if (next === current) return;
      pendingPreviewRenderSceneRef.current = next;
      previewRenderFrameRef.current ??= requestAnimationFrame(() => {
        previewRenderFrameRef.current = null;
        const pendingScene = pendingPreviewRenderSceneRef.current;
        pendingPreviewRenderSceneRef.current = null;
        if (pendingScene) applyPreviewScene(pendingScene);
      });
    },
    [applyPreviewScene, props.threadId],
  );

  const cancelPreviewRender = useCallback(() => {
    if (previewRenderFrameRef.current !== null) {
      cancelAnimationFrame(previewRenderFrameRef.current);
      previewRenderFrameRef.current = null;
    }
    pendingPreviewRenderSceneRef.current = null;
  }, []);

  const recordSnapshotMetadata = useCallback(
    (snapshot: CanvasDrawingSnapshot, renderedScene = snapshot.scene) => {
      revisionRef.current = snapshot.revision;
      renderedSceneJsonRef.current = JSON.stringify(renderedScene);
    },
    [],
  );

  const applySnapshot = useCallback(
    (
      snapshot: CanvasDrawingSnapshot,
      displayScene = snapshot.scene,
      options: { readonly preserveViewport?: boolean } = {},
    ) => {
      cancelPreviewRender();
      activePreviewCursorRef.current = null;
      authoritativeSceneRef.current = displayScene;
      previewSceneRef.current = null;
      lastAgentCameraRef.current = null;
      setPreviewActive(false);
      recordSnapshotMetadata(snapshot, displayScene);
      pendingSceneRef.current = null;
      conflictRef.current = false;
      applyingRemoteSceneRef.current = true;
      const api = excalidrawApiRef.current;
      if (api) {
        api.updateScene({
          elements: displayScene.elements as never,
          ...(options.preserveViewport ? {} : { appState: displayScene.appState as never }),
        });
        if (displayScene.files) {
          api.addFiles(Object.values(displayScene.files) as never);
        }
      } else {
        setInitialScene(displayScene);
      }
      logCanvasDiagnostic("workspace.snapshot-applied", {
        threadId: props.threadId,
        revision: snapshot.revision,
        sourceElementCount: snapshot.scene.elements.length,
        renderedElementCount: displayScene.elements.length,
        preserveViewport: options.preserveViewport === true,
        apiAvailable: Boolean(api),
      });
      requestAnimationFrame(() => {
        applyingRemoteSceneRef.current = false;
      });
      setSaveState("saved");
    },
    [cancelPreviewRender, props.threadId, recordSnapshotMetadata],
  );

  const syncDrawing = useCallback(
    (mode: DrawingSyncMode) => {
      const foreground = mode === "foreground";
      const live = mode === "live";
      const settled = mode === "settled";
      const sync = drawingIoChainRef.current.then(async () => {
        const api = readNativeApi();
        logCanvasDiagnostic("workspace.sync-started", {
          threadId: props.threadId,
          mode,
          currentRevision: revisionRef.current,
        });
        if (!api) {
          logCanvasDiagnostic("workspace.sync-skipped", {
            threadId: props.threadId,
            mode,
            reason: "native-api-unavailable",
          });
          return false;
        }
        const localSceneGeneration = localSceneGenerationRef.current;
        const localSceneChanged = () =>
          !foreground &&
          (localSceneGeneration !== localSceneGenerationRef.current ||
            pendingSceneRef.current !== null ||
            conflictRef.current);
        if (foreground) setSaveState("loading");
        try {
          let snapshot = await api.canvas.readDrawing({ threadId: props.threadId });
          logCanvasDiagnostic("workspace.sync-read", {
            threadId: props.threadId,
            mode,
            currentRevision: revisionRef.current,
            snapshotRevision: snapshot.revision,
            elementCount: snapshot.scene.elements.length,
          });
          if (localSceneChanged()) {
            logCanvasDiagnostic("workspace.sync-skipped", {
              threadId: props.threadId,
              mode,
              reason: "local-scene-changed",
            });
            return false;
          }
          if (live && snapshot.revision === revisionRef.current) {
            logCanvasDiagnostic("workspace.sync-skipped", {
              threadId: props.threadId,
              mode,
              reason: "revision-unchanged",
              snapshotRevision: snapshot.revision,
            });
            return true;
          }
          const canonicalized = canonicalizeAgentElements(snapshot.scene);
          if (canonicalized.changed) {
            if (live || settled) {
              applySnapshot(snapshot, canonicalized.scene, { preserveViewport: true });
              return true;
            }
            snapshot = await api.canvas.saveDrawing({
              threadId: props.threadId,
              scene: canonicalized.scene,
              expectedRevision: snapshot.revision,
            });
          }
          applySnapshot(snapshot, snapshot.scene, { preserveViewport: !foreground });
          logCanvasDiagnostic("workspace.sync-applied", {
            threadId: props.threadId,
            mode,
            snapshotRevision: snapshot.revision,
            elementCount: snapshot.scene.elements.length,
          });
          return true;
        } catch (error) {
          logCanvasDiagnostic("workspace.sync-failed", {
            threadId: props.threadId,
            mode,
            error: error instanceof Error ? error.message : String(error),
          });
          if (foreground) {
            setSaveState("error");
            toastManager.add({
              type: "error",
              title: "Unable to load drawing",
              description:
                error instanceof Error ? error.message : "The drawing could not be loaded.",
            });
          }
          return false;
        }
      });
      drawingIoChainRef.current = sync.then(
        () => undefined,
        () => undefined,
      );
      return sync;
    },
    [applySnapshot, props.threadId],
  );

  const reloadDrawing = useCallback(
    () => syncDrawing("foreground"),
    [syncDrawing],
  );

  useEffect(() => {
    void reloadDrawing();
  }, [reloadDrawing]);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!pendingSceneRef.current || conflictRef.current) {
      return;
    }

    drawingIoChainRef.current = drawingIoChainRef.current.then(async () => {
      const api = readNativeApi();
      const pendingScene = pendingSceneRef.current;
      const expectedRevision = revisionRef.current;
      if (!api || !pendingScene || !expectedRevision) return;
      pendingSceneRef.current = null;
      let scene: CanvasScene | null = null;
      try {
        scene =
          pendingScene.kind === "serialized"
            ? pendingScene.scene
            : toCanvasScene(pendingScene.elements, pendingScene.appState, pendingScene.files);
        const sceneJson = JSON.stringify(scene);
        if (sceneJson === renderedSceneJsonRef.current) {
          if (!pendingSceneRef.current) setSaveState("saved");
          return;
        }
        setSaveState("saving");
        const snapshot = await api.canvas.saveDrawing({
          threadId: props.threadId,
          scene,
          expectedRevision,
        });
        revisionRef.current = snapshot.revision;
        authoritativeSceneRef.current = snapshot.scene;
        renderedSceneJsonRef.current = JSON.stringify(snapshot.scene);
        if (!pendingSceneRef.current) setSaveState("saved");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let conflicted = /revision|conflict/i.test(message);
        if (!conflicted) {
          try {
            const current = await api.canvas.readDrawing({ threadId: props.threadId });
            conflicted = current.revision !== expectedRevision;
          } catch {
            // Preserve the original save failure when the conflict probe also fails.
          }
        }
        pendingSceneRef.current ??= scene ? { kind: "serialized", scene } : pendingScene;
        conflictRef.current = conflicted;
        setSaveState(conflicted ? "conflict" : "error");
      }

    });
  }, [props.threadId]);

  const handleSceneChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      if (
        applyingRemoteSceneRef.current ||
        cameraAnimationFrameRef.current !== null ||
        finalSyncInFlightTurnIdRef.current !== null ||
        canvasLocked ||
        conflictRef.current
      ) {
        return;
      }
      localSceneGenerationRef.current += 1;
      pendingSceneRef.current = { kind: "excalidraw", elements, appState, files };
      saveTimerRef.current ??= setTimeout(flushPendingSave, AUTOSAVE_DELAY_MS);
    },
    [canvasLocked, flushPendingSave],
  );

  useEffect(() => {
    if (canvasLocked) {
      flushPendingSave();
    }
  }, [canvasLocked, flushPendingSave]);

  useEffect(
    () =>
      registerCanvasSaveBarrier(props.threadId, async () => {
        flushPendingSave();
        await drawingIoChainRef.current;
        if (pendingSceneRef.current || conflictRef.current) {
          throw new Error("Save the drawing successfully before starting the agent.");
        }
      }),
    [flushPendingSave, props.threadId],
  );

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    return api.canvas.onDrawingChanged((event) => {
      const ignoredReason =
        event.threadId !== props.threadId
          ? "different-thread"
          : event.revision === revisionRef.current
            ? "revision-unchanged"
            : pendingSceneRef.current !== null
              ? "pending-local-scene"
              : conflictRef.current
                ? "save-conflict"
                : null;
      logCanvasDiagnostic("workspace.drawing-change-received", {
        threadId: props.threadId,
        eventThreadId: event.threadId,
        eventRevision: event.revision,
        currentRevision: revisionRef.current,
        ignoredReason,
      });
      if (ignoredReason) {
        return;
      }
      latestNotifiedRevisionRef.current = event.revision;
      if (liveSyncQueuedRef.current) return;
      liveSyncQueuedRef.current = true;
      void (async () => {
        try {
          let targetRevision: string | null;
          do {
            targetRevision = latestNotifiedRevisionRef.current;
            if (!(await syncDrawing("live"))) return;
          } while (
            latestNotifiedRevisionRef.current !== targetRevision &&
            latestNotifiedRevisionRef.current !== revisionRef.current
          );
        } finally {
          liveSyncQueuedRef.current = false;
        }
      })();
    });
  }, [props.threadId, syncDrawing]);

  useEffect(() => {
    if (!initialScene) return;
    const api = readNativeApi();
    if (!api) return;
    logCanvasDiagnostic("workspace.preview-listener-subscribing", {
      threadId: props.threadId,
      revision: revisionRef.current,
    });
    return api.canvas.onAgentPreview((event: CanvasAgentPreviewEvent) => {
      if (event.threadId !== props.threadId) return;
      const current = activePreviewCursorRef.current;
      const decision = canvasPreviewEventDecision({
        current,
        event,
        revision: revisionRef.current,
      });
      logCanvasDiagnostic("workspace.preview-event-evaluated", {
        threadId: props.threadId,
        streamId: event.streamId,
        sequence: event.sequence,
        phase: event.phase,
        baseRevision: event.baseRevision,
        currentRevision: revisionRef.current,
        currentStreamId: current?.streamId,
        currentSequence: current?.sequence,
        operationCount: event.operations.length,
        apply: decision.apply,
        reason: decision.reason,
      });
      if (!decision.apply) {
        return;
      }
      const newStream = !current || current.streamId !== event.streamId;
      activePreviewCursorRef.current = {
        streamId: event.streamId,
        sequence: event.sequence,
      };
      if (newStream) {
        previewSceneRef.current = authoritativeSceneRef.current;
        lastAgentCameraRef.current = null;
        setAgentFollowing(true);
      }
      applyPreviewOperations(event.operations);
      if (event.phase === "start" || event.phase === "partial") {
        setPreviewActive(true);
      } else {
        activePreviewCursorRef.current = null;
        setPreviewActive(false);
        previewSceneRef.current = null;
        lastAgentCameraRef.current = null;
        if (event.phase === "cancelled") {
          cancelPreviewRender();
          cancelCameraAnimation();
          const authoritativeScene = authoritativeSceneRef.current;
          if (authoritativeScene) applyPreviewScene(authoritativeScene);
        }
      }
      if (event.camera) animateAgentCamera(event.camera);
    });
  }, [
    animateAgentCamera,
    applyPreviewOperations,
    applyPreviewScene,
    cancelPreviewRender,
    cancelCameraAnimation,
    initialScene,
    props.threadId,
    setAgentFollowing,
  ]);

  useEffect(() => {
    const latestTurn = thread?.latestTurn ?? null;
    if (!previewActive || !latestTurn || latestTurn.state === "running") return;
    logCanvasDiagnostic("workspace.preview-reset-by-turn-state", {
      threadId: props.threadId,
      streamId: activePreviewCursorRef.current?.streamId,
      sequence: activePreviewCursorRef.current?.sequence,
      latestTurnId: latestTurn.turnId,
      latestTurnState: latestTurn.state,
      latestTurnCompletedAt: latestTurn.completedAt,
    });
    cancelPreviewRender();
    cancelCameraAnimation();
    activePreviewCursorRef.current = null;
    previewSceneRef.current = null;
    lastAgentCameraRef.current = null;
    setPreviewActive(false);
    const authoritativeScene = authoritativeSceneRef.current;
    if (authoritativeScene) applyPreviewScene(authoritativeScene);
  }, [
    applyPreviewScene,
    cancelCameraAnimation,
    cancelPreviewRender,
    previewActive,
    props.threadId,
    thread?.latestTurn,
  ]);

  useEffect(() => {
    const latestTurn = thread?.latestTurn ?? null;
    if (!latestTurn) return;
    if (latestTurn.state === "running") {
      if (agentEditing || previewActive) {
        pendingFinalReloadTurnIdRef.current = latestTurn.turnId;
      }
      return;
    }
    const finalSyncTurnId =
      pendingFinalReloadTurnIdRef.current === latestTurn.turnId
        ? latestTurn.turnId
        : mutationTurnId;
    if (!finalSyncTurnId || lastSettledMutationTurnIdRef.current === finalSyncTurnId) return;
    if (finalSyncInFlightTurnIdRef.current === finalSyncTurnId) return;
    logCanvasDiagnostic("workspace.final-sync-starting", {
      threadId: props.threadId,
      turnId: finalSyncTurnId,
      latestTurnState: latestTurn.state,
      mutationTurnId,
      pendingFinalReloadTurnId: pendingFinalReloadTurnIdRef.current,
    });
    finalSyncAbortControllerRef.current?.abort();
    finalSyncInFlightTurnIdRef.current = finalSyncTurnId;
    setFinalSyncActive(true);
    const abortController = new AbortController();
    finalSyncAbortControllerRef.current = abortController;
    void (async () => {
      try {
        flushPendingSave();
        await drawingIoChainRef.current;
        for (const delayMs of FINAL_SYNC_RETRY_DELAYS_MS) {
          if (
            abortController.signal.aborted ||
            conflictRef.current ||
            !(await waitForFinalSyncRetry(delayMs, abortController.signal))
          ) {
            return;
          }
          if (pendingSceneRef.current) {
            flushPendingSave();
            await drawingIoChainRef.current;
            if (pendingSceneRef.current || conflictRef.current) return;
          }
          if (await syncDrawing("settled")) {
            if (abortController.signal.aborted) return;
            lastSettledMutationTurnIdRef.current = finalSyncTurnId;
            logCanvasDiagnostic("workspace.final-sync-settled", {
              threadId: props.threadId,
              turnId: finalSyncTurnId,
              latestTurnState: latestTurn.state,
              revision: revisionRef.current,
            });
            if (pendingFinalReloadTurnIdRef.current === finalSyncTurnId) {
              pendingFinalReloadTurnIdRef.current = null;
            }
            return;
          }
        }
      } finally {
        if (finalSyncInFlightTurnIdRef.current === finalSyncTurnId) {
          finalSyncInFlightTurnIdRef.current = null;
          setFinalSyncActive(false);
        }
        if (finalSyncAbortControllerRef.current === abortController) {
          finalSyncAbortControllerRef.current = null;
        }
      }
    })();
  }, [
    agentEditing,
    flushPendingSave,
    mutationTurnId,
    previewActive,
    props.threadId,
    syncDrawing,
    thread?.latestTurn,
  ]);

  useEffect(
    () => () => {
      finalSyncAbortControllerRef.current?.abort();
      cancelPreviewRender();
      cancelCameraAnimation();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flushPendingSave();
    },
    [cancelCameraAnimation, cancelPreviewRender, flushPendingSave],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => excalidrawApiRef.current?.refresh());
    return () => cancelAnimationFrame(frame);
  }, [immersive]);

  useEffect(() => {
    if (!immersive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setImmersive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [immersive]);

  const suspendAgentFollowing = useCallback(() => {
    if (!canvasLocked || !followingAgentRef.current) return;
    cancelCameraAnimation();
    applyingRemoteSceneRef.current = false;
    setAgentFollowing(false);
  }, [cancelCameraAnimation, canvasLocked, setAgentFollowing]);

  const resumeAgentFollowing = useCallback(() => {
    setAgentFollowing(true);
    const camera = lastAgentCameraRef.current;
    if (camera) animateAgentCamera(camera);
  }, [animateAgentCamera, setAgentFollowing]);

  const handleTakeOver = useCallback(async () => {
    const api = readNativeApi();
    if (!api || takingOver) return;
    setTakingOver(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: props.threadId,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      setTakingOver(false);
      toastManager.add({
        type: "error",
        title: "Unable to stop the agent",
        description: error instanceof Error ? error.message : "The drawing turn could not be stopped.",
      });
    }
  }, [props.threadId, takingOver]);

  useEffect(() => {
    if (!canvasLocked) setTakingOver(false);
  }, [canvasLocked]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Delete “${thread?.title ?? "this drawing"}”?`)) return;
    const api = readNativeApi();
    if (!api) return;
    const nextDrawing = drawings.find((drawing) => drawing.id !== props.threadId) ?? null;
    try {
      await api.canvas.deleteDrawing({ threadId: props.threadId });
      if (nextDrawing) {
        await navigate({
          to: "/$threadId",
          params: { threadId: nextDrawing.id },
          search: (previous) => ({ ...previous, view: "canvas" }),
        });
      } else {
        await navigate({ to: "/" });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to delete drawing",
        description: error instanceof Error ? error.message : "The drawing could not be deleted.",
      });
    }
  }, [drawings, navigate, props.threadId, thread?.title]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full overflow-hidden",
        immersive && "fixed inset-0 z-[100] bg-background",
      )}
      data-testid="canvas-workspace"
      data-immersive={immersive ? "true" : "false"}
    >
      <aside
        className={cn(
          "flex w-56 shrink-0 flex-col border-r border-border/65 bg-[var(--color-background-surface)]",
          immersive && "hidden",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/65 px-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-muted-foreground">Project</div>
            <div className="truncate text-[12px] font-medium">{props.projectName}</div>
          </div>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="New AI drawing"
            aria-label="New AI drawing"
            onClick={() => void handleNewCanvasDrawing(props.projectId)}
          >
            <FiPlus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
            Drawings
          </div>
          {drawings.map((drawing) => {
            const active = drawing.id === props.threadId;
            return (
              <button
                key={drawing.id}
                type="button"
                className={cn(
                  "flex h-8 w-full items-center rounded-md px-2 text-left text-[12px] transition-colors",
                  active ? "bg-muted font-medium text-foreground" : "text-foreground/75 hover:bg-muted/65",
                )}
                onClick={() =>
                  void navigate({
                    to: "/$threadId",
                    params: { threadId: drawing.id },
                    search: (previous) => ({ ...previous, view: "canvas" }),
                  })
                }
              >
                <span className="truncate">{drawing.title}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/65 px-3">
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {thread?.title ?? "Drawing"}
          </div>
          {canvasLocked ? (
            <span className="rounded-full bg-amber-500/12 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              AI is drawing · pan and zoom only
            </span>
          ) : null}
          {canvasLocked && !followingAgent ? (
            <ChatHeaderButton
              type="button"
              className="gap-1.5 px-2 text-[11px]"
              onClick={resumeAgentFollowing}
            >
              <FiCrosshair className="size-3.5" />
              Follow agent
            </ChatHeaderButton>
          ) : null}
          {canvasLocked ? (
            <ChatHeaderButton
              type="button"
              className="px-2 text-[11px] disabled:cursor-wait disabled:opacity-60"
              disabled={takingOver}
              onClick={() => void handleTakeOver()}
            >
              {takingOver ? "Stopping…" : "Take over"}
            </ChatHeaderButton>
          ) : null}
          {saveState === "conflict" ? (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
              onClick={() => void reloadDrawing()}
            >
              Reload scene
            </button>
          ) : null}
          {saveState === "error" ? (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
              onClick={flushPendingSave}
            >
              Retry save
            </button>
          ) : null}
          <span className="text-[10px] text-muted-foreground">{saveStateLabel(saveState)}</span>
          <ChatHeaderIconButton
            type="button"
            label={immersive ? "Exit full screen" : "Enter full screen"}
            title={immersive ? "Exit full screen" : "Enter full screen"}
            onClick={() => setImmersive((value) => !value)}
          >
            {immersive ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </ChatHeaderIconButton>
          {!immersive ? (
            <>
              <ChatHeaderIconButton
                type="button"
                label={chatPane.visible ? "Hide chat panel" : "Show chat panel"}
                aria-pressed={chatPane.visible}
                title={chatPane.visible ? "Hide chat panel" : "Show chat panel"}
                onClick={chatPane.toggleVisible}
              >
                <FiMessageSquare className="size-3.5" />
              </ChatHeaderIconButton>
              <ChatHeaderIconButton
                type="button"
                label="Delete drawing"
                className="hover:bg-destructive/10 hover:text-destructive"
                title="Delete drawing"
                onClick={() => void handleDelete()}
              >
                <FiTrash2 className="size-3.5" />
              </ChatHeaderIconButton>
              <ChatHeaderButton
                type="button"
                tone="outline"
                aria-pressed={true}
                title="Switch to chat view"
                className="w-[5.5rem] gap-1.5"
                onClick={props.onExitCanvasView}
              >
                <ChatBubbleIcon className="size-3.5" />
                <span className="truncate font-normal">Chat</span>
              </ChatHeaderButton>
            </>
          ) : null}
        </header>
        <div
          ref={canvasContainerRef}
          className="relative min-h-0 flex-1"
          data-testid="excalidraw-canvas"
          onPointerDownCapture={suspendAgentFollowing}
          onWheelCapture={suspendAgentFollowing}
        >
          {initialScene ? (
            <Excalidraw
              initialData={initialScene as never}
              excalidrawAPI={(api) => {
                excalidrawApiRef.current = api;
              }}
              onChange={handleSceneChange as never}
              viewModeEnabled={canvasLocked}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
              UIOptions={{ canvasActions: { loadScene: false } }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading drawing…
            </div>
          )}
        </div>
      </main>

      <ResizableChatPane
        controller={chatPane}
        className={cn(
          "min-w-[20rem] max-w-[37.5rem] flex-col border-l border-border/65 bg-background",
          immersive && "hidden",
        )}
      >
        {props.chatPanel}
      </ResizableChatPane>
    </div>
  );
}
