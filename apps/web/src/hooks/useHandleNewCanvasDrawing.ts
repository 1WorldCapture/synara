// FILE: useHandleNewCanvasDrawing.ts
// Purpose: Creates a durable Canvas thread and its server-resolved Excalidraw scene as one UI action.
// Layer: Web orchestration hook

import { PROVIDER_DISPLAY_NAMES, type ProjectId, type ThreadId } from "@synara/contracts";
import { buildCanvasThreadPlaceholderTitle } from "@synara/shared/chatThreads";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  getCustomBinaryPathForProvider,
  useAppSettings,
} from "../appSettings";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveCanvasModelSelection } from "../lib/canvasModelSelection";
import { providerModelsQueryOptions } from "../lib/providerDiscoveryReactQuery";
import { newCommandId, newThreadId } from "../lib/utils";
import { mergeCursorModelVariantsWithBaseControls } from "../cursorModelVariants";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { getThreadsFromState } from "../threadDerivation";

const DRAWING_PROJECTION_CATCH_UP_ATTEMPTS = 8;
const DRAWING_PROJECTION_CATCH_UP_DELAY_MS = 50;

function waitForProjectionCatchUp(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRAWING_PROJECTION_CATCH_UP_DELAY_MS));
}

export function useHandleNewCanvasDrawing() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();

  const handleNewCanvasDrawing = useCallback(
    async (projectId: ProjectId): Promise<ThreadId | null> => {
      const api = readNativeApi();
      const state = useStore.getState();
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!api || !project) {
        toastManager.add({
          type: "error",
          title: "Unable to create drawing",
          description: "The project is not available yet.",
        });
        return null;
      }

      const siblingCount = getThreadsFromState(state).filter(
        (thread) => thread.projectId === projectId && thread.surface === "canvas",
      ).length;
      const threadId = newThreadId();
      const title = buildCanvasThreadPlaceholderTitle(siblingCount);
      let threadCreated = false;
      let drawingCreated = false;

      try {
        const composerState = useComposerDraftStore.getState();
        const modelResolution = await resolveCanvasModelSelection({
          stickyActiveProvider: composerState.stickyActiveProvider,
          stickyModelSelectionByProvider: composerState.stickyModelSelectionByProvider,
          projectModelSelection: project.defaultModelSelection,
          defaultProvider: settings.defaultProvider,
          listModels: async (provider) => {
            const result = await queryClient.fetchQuery(
              providerModelsQueryOptions({
                provider,
                binaryPath: getCustomBinaryPathForProvider(settings, provider) || null,
                apiEndpoint: provider === "cursor" ? settings.cursorApiEndpoint || null : null,
                agentDir: provider === "pi" ? settings.piAgentDir || null : null,
                cwd: project.cwd,
              }),
            );
            return provider === "cursor"
              ? mergeCursorModelVariantsWithBaseControls(result.models)
              : result.models;
          },
        });
        if (modelResolution.fallbackFromProvider) {
          toastManager.add({
            type: "info",
            title: "Canvas uses Codex for this drawing",
            description: `${PROVIDER_DISPLAY_NAMES[modelResolution.fallbackFromProvider]} does not currently support an isolated Canvas tool session.`,
          });
        }
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId,
          surface: "canvas",
          title,
          modelSelection: modelResolution.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        });
        threadCreated = true;
        for (let attempt = 0; attempt < DRAWING_PROJECTION_CATCH_UP_ATTEMPTS; attempt += 1) {
          try {
            await api.canvas.createDrawing({ threadId });
            drawingCreated = true;
            break;
          } catch (error) {
            if (attempt === DRAWING_PROJECTION_CATCH_UP_ATTEMPTS - 1) throw error;
            await waitForProjectionCatchUp();
          }
        }
        await navigate({
          to: "/$threadId",
          params: { threadId },
          search: (previous) => ({ ...previous, view: "canvas" }),
        });
        return threadId;
      } catch (error) {
        if (drawingCreated) {
          await api.canvas
            .deleteDrawing({ threadId })
            .catch(() => undefined);
        } else if (threadCreated) {
          await api.orchestration
            .dispatchCommand({
              type: "thread.delete",
              commandId: newCommandId(),
              threadId,
            })
            .catch(() => undefined);
        }
        toastManager.add({
          type: "error",
          title: "Unable to create drawing",
          description: error instanceof Error ? error.message : "The drawing could not be created.",
        });
        return null;
      }
    },
    [navigate, queryClient, settings],
  );

  return { handleNewCanvasDrawing };
}
