import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import { startContainerCanvas } from "./startContainerCanvas";

describe("startContainerCanvas", () => {
  it("ensures the container before creating its Canvas thread", async () => {
    const projectId = ProjectId.makeUnsafe("studio-project");
    const threadId = ThreadId.makeUnsafe("studio-canvas");
    const calls: string[] = [];

    const result = await startContainerCanvas({
      ensureProjectId: async () => {
        calls.push("ensure");
        return projectId;
      },
      handleNewCanvasDrawing: async (resolvedProjectId) => {
        calls.push(`canvas:${resolvedProjectId}`);
        return threadId;
      },
      errorLabel: "Unable to prepare a new Studio Canvas.",
    });

    expect(calls).toEqual(["ensure", "canvas:studio-project"]);
    expect(result).toEqual({ ok: true, threadId });
  });

  it("does not create a Canvas thread when the container is unavailable", async () => {
    const handleNewCanvasDrawing = vi.fn();

    await expect(
      startContainerCanvas({
        ensureProjectId: async () => null,
        handleNewCanvasDrawing,
        errorLabel: "Unable to prepare a new Studio Canvas.",
      }),
    ).resolves.toEqual({ ok: false, error: "Unable to prepare a new Studio Canvas." });
    expect(handleNewCanvasDrawing).not.toHaveBeenCalled();
  });

  it("returns the container preparation error", async () => {
    await expect(
      startContainerCanvas({
        ensureProjectId: async () => {
          throw new Error("Studio folder is unavailable.");
        },
        handleNewCanvasDrawing: vi.fn(),
        errorLabel: "Unable to prepare a new Studio Canvas.",
      }),
    ).resolves.toEqual({ ok: false, error: "Studio folder is unavailable." });
  });
});
