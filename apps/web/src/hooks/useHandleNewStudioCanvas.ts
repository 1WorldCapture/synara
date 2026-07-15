// FILE: useHandleNewStudioCanvas.ts
// Purpose: Creates durable AI Canvas threads inside the hidden Studio project container.
// Layer: Web hook

import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { startContainerCanvas } from "../lib/startContainerCanvas";
import { ensureStudioProject } from "../lib/studioProjects";
import { useWorkspaceStore } from "../workspaceStore";
import { useHandleNewCanvasDrawing } from "./useHandleNewCanvasDrawing";

const STUDIO_CANVAS_ERROR_LABEL = "Unable to prepare a new Studio Canvas.";

export function useHandleNewStudioCanvas() {
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);
  const { handleNewCanvasDrawing } = useHandleNewCanvasDrawing();

  const handleNewStudioCanvas = useCallback(async () => {
    const result = await startContainerCanvas({
      ensureProjectId: () =>
        ensureStudioProject({ homeDir, chatWorkspaceRoot, studioWorkspaceRoot }),
      handleNewCanvasDrawing,
      errorLabel: STUDIO_CANVAS_ERROR_LABEL,
    });
    if (!result.ok) {
      toastManager.add({
        type: "error",
        title: "Unable to create Studio Canvas",
        description: result.error,
      });
      return null;
    }
    return result.threadId;
  }, [chatWorkspaceRoot, handleNewCanvasDrawing, homeDir, studioWorkspaceRoot]);

  return { handleNewStudioCanvas };
}
