import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveCanvasDrawingRef } from "./canvasDrawingStorage";

describe("resolveCanvasDrawingRef", () => {
  it("stores every conversation Drawing under the Synara state directory", () => {
    const threadId = ThreadId.makeUnsafe("drawing-1");

    expect(
      resolveCanvasDrawingRef({
        stateDir: "/synara/userdata",
        threadId,
      }),
    ).toEqual({
      root: "/synara/userdata",
      threadId,
    });
  });

  it("uses the same managed root for Studio conversation Drawings", () => {
    const threadId = ThreadId.makeUnsafe("studio-drawing-1");

    expect(
      resolveCanvasDrawingRef({
        stateDir: "/synara/userdata",
        threadId,
      }),
    ).toEqual({
      root: "/synara/userdata",
      threadId,
    });
  });
});
