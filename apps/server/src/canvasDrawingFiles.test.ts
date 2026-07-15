import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EMPTY_CANVAS_SCENE,
  InvalidCanvasSceneError,
  MAX_CANVAS_SCENE_BYTES,
} from "@synara/shared/excalidrawScene";
import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasDrawingConflictError,
  CanvasDrawingPathError,
  createCanvasDrawing,
  hardDeleteCanvasDrawing,
  readCanvasDrawing,
  saveCanvasDrawing,
} from "./canvasDrawingFiles";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "synara-canvas-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canvasDrawingFiles", () => {
  it("stores drawings under the managed state root", async () => {
    const root = await workspace();
    const created = await createCanvasDrawing({
      root,
      threadId: "drawing-scoped",
    });

    expect(created.relativePath).toBe(path.join("drawings", "drawing-scoped.excalidraw"));
    await expect(access(path.join(root, created.relativePath))).resolves.toBeUndefined();
  });

  it("converges concurrent ensure calls and never resets existing content", async () => {
    const root = await workspace();
    const [first, second] = await Promise.all([
      createCanvasDrawing({ root, threadId: "drawing-ensure" }),
      createCanvasDrawing({ root, threadId: "drawing-ensure" }),
    ]);
    expect(second).toEqual(first);

    const scene = {
      ...EMPTY_CANVAS_SCENE,
      elements: [{ id: "layer-1", type: "rectangle" }],
    };
    const saved = await saveCanvasDrawing({
      root,
      threadId: "drawing-ensure",
      scene,
      expectedRevision: first.revision,
    });
    expect(saved.revision).not.toBe(first.revision);
    expect(await createCanvasDrawing({ root, threadId: "drawing-ensure" })).toEqual(saved);
  });

  it("keeps thread identities isolated and supports idempotent internal hard deletion", async () => {
    const root = await workspace();
    const first = await createCanvasDrawing({ root, threadId: "thread-a" });
    const second = await createCanvasDrawing({ root, threadId: "thread-b" });
    expect(first.relativePath).not.toBe(second.relativePath);
    expect(await hardDeleteCanvasDrawing({ root, threadId: "thread-a" })).toBe(true);
    expect(await hardDeleteCanvasDrawing({ root, threadId: "thread-a" })).toBe(false);
    await expect(readCanvasDrawing({ root, threadId: "thread-a" })).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      saveCanvasDrawing({
        root,
        threadId: "thread-a",
        scene: EMPTY_CANVAS_SCENE,
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(root, first.relativePath))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readCanvasDrawing({ root, threadId: "thread-b" })).resolves.toEqual(second);
  });

  it("rejects stale revisions without overwriting the valid file", async () => {
    const root = await workspace();
    const created = await createCanvasDrawing({ root, threadId: "drawing-2" });
    await expect(
      saveCanvasDrawing({
        root,
        threadId: "drawing-2",
        scene: { ...EMPTY_CANVAS_SCENE, elements: [{ id: "new" }] },
        expectedRevision: "stale",
      }),
    ).rejects.toBeInstanceOf(CanvasDrawingConflictError);
    expect((await readCanvasDrawing({ root, threadId: "drawing-2" })).revision).toBe(
      created.revision,
    );
  });

  it("serializes concurrent saves so only one writer can consume a revision", async () => {
    const root = await workspace();
    const created = await createCanvasDrawing({ root, threadId: "drawing-concurrent" });
    const results = await Promise.allSettled(
      ["first", "second"].map((id) =>
        saveCanvasDrawing({
          root,
          threadId: "drawing-concurrent",
          scene: { ...EMPTY_CANVAS_SCENE, elements: [{ id, type: "rectangle" }] },
          expectedRevision: created.revision,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(CanvasDrawingConflictError) });
    expect((await readCanvasDrawing({ root, threadId: "drawing-concurrent" })).scene.elements)
      .toHaveLength(1);
  });

  it("rejects unsafe ids and a symlinked drawings directory", async () => {
    const root = await workspace();
    await expect(createCanvasDrawing({ root, threadId: "../escape" })).rejects.toBeInstanceOf(
      CanvasDrawingPathError,
    );

    const outside = await workspace();
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(root, "drawings"));
    await expect(createCanvasDrawing({ root, threadId: "drawing-3" })).rejects.toBeInstanceOf(
      CanvasDrawingPathError,
    );
  });

  it("rejects oversized drawing files before parsing their contents", async () => {
    const root = await workspace();
    const created = await createCanvasDrawing({ root, threadId: "drawing-too-large" });
    await writeFile(path.join(root, created.relativePath), Buffer.alloc(MAX_CANVAS_SCENE_BYTES + 1));

    await expect(
      readCanvasDrawing({ root, threadId: "drawing-too-large" }),
    ).rejects.toBeInstanceOf(InvalidCanvasSceneError);
  });

  it("keeps the previous JSON when a save payload is invalid", async () => {
    const root = await workspace();
    const created = await createCanvasDrawing({ root, threadId: "drawing-4" });
    const filePath = path.join(root, created.relativePath);
    const before = await readFile(filePath, "utf8");

    await expect(
      saveCanvasDrawing({
        root,
        threadId: "drawing-4",
        scene: {
          ...EMPTY_CANVAS_SCENE,
          elements: [{ id: null, type: "rectangle" }],
        } as never,
        expectedRevision: created.revision,
      }),
    ).rejects.toThrow();
    expect(await readFile(filePath, "utf8")).toBe(before);
  });
});
