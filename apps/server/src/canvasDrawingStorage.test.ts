import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveCanvasDrawingRef } from "./canvasDrawingStorage";

describe("resolveCanvasDrawingRef", () => {
  it("stores ordinary project drawings under the Synara state directory scoped by project id", () => {
    const threadId = ThreadId.makeUnsafe("drawing-1");

    expect(
      resolveCanvasDrawingRef({
        stateDir: "/synara/userdata",
        project: {
          id: ProjectId.makeUnsafe("project-1"),
          kind: "project",
          workspaceRoot: "/workspace/repository",
        },
        threadId,
      }),
    ).toEqual({
      cwd: "/synara/userdata",
      directorySegments: ["drawings", "project-1"],
      legacyCwd: "/workspace/repository",
      threadId,
    });
  });

  it("stores Studio drawings in the Studio workspace drawings directory", () => {
    const threadId = ThreadId.makeUnsafe("studio-drawing-1");

    expect(
      resolveCanvasDrawingRef({
        stateDir: "/synara/userdata",
        project: {
          id: ProjectId.makeUnsafe("studio-project"),
          kind: "studio",
          workspaceRoot: "/workspace/Studio",
        },
        threadId,
      }),
    ).toEqual({
      cwd: "/workspace/Studio",
      directorySegments: ["drawings"],
      threadId,
    });
  });
});
