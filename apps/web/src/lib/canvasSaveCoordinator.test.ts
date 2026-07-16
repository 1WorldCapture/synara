import { ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  flushCanvasBeforeTurn,
  registerCanvasSaveBarrier,
} from "./canvasSaveCoordinator";

describe("canvasSaveCoordinator", () => {
  it("keeps an unmounted pane's final flush in the turn barrier until it settles", async () => {
    const threadId = ThreadId.makeUnsafe("thread-detached-save");
    let finishSave!: () => void;
    const finalSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const barrier = vi.fn(() => finalSave);
    const unregister = registerCanvasSaveBarrier(threadId, barrier);

    unregister();
    const turnFlush = flushCanvasBeforeTurn(threadId);
    let settled = false;
    void turnFlush.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(barrier).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishSave();
    await turnFlush;
    expect(settled).toBe(true);
  });

  it("keeps a failed detached save blocking turns until a pane registers a replacement", async () => {
    const threadId = ThreadId.makeUnsafe("thread-detached-save-failure");
    const saveError = new Error("save failed");
    const unregister = registerCanvasSaveBarrier(threadId, async () => {
      throw saveError;
    });

    unregister();
    await expect(flushCanvasBeforeTurn(threadId)).rejects.toBe(saveError);

    const replacement = vi.fn(async () => undefined);
    const unregisterReplacement = registerCanvasSaveBarrier(threadId, replacement);
    await expect(flushCanvasBeforeTurn(threadId)).resolves.toBeUndefined();
    expect(replacement).toHaveBeenCalledOnce();
    unregisterReplacement();
  });
});
