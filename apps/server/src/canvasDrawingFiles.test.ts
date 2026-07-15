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
  deleteCanvasDrawing,
  readCanvasDrawing,
  restoreTrashedCanvasDrawing,
  saveCanvasDrawing,
  trashCanvasDrawing,
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
  it("stores drawings under caller-provided safe directory segments", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({
      cwd,
      directorySegments: ["drawings", "project-1"],
      threadId: "drawing-scoped",
    });

    expect(created.relativePath).toBe(path.join("drawings", "project-1", "drawing-scoped.excalidraw"));
    await expect(
      access(path.join(cwd, "drawings", "project-1", "drawing-scoped.excalidraw")),
    ).resolves.toBeUndefined();
  });

  it("imports a legacy project-local drawing into scoped storage without deleting the source", async () => {
    const cwd = await workspace();
    const legacyCwd = await workspace();
    const legacyCreated = await createCanvasDrawing({
      cwd: legacyCwd,
      threadId: "drawing-legacy",
    });
    const legacyScene = {
      ...EMPTY_CANVAS_SCENE,
      elements: [{ id: "legacy-layer", type: "rectangle" }],
    };
    await saveCanvasDrawing({
      cwd: legacyCwd,
      threadId: "drawing-legacy",
      scene: legacyScene,
      expectedRevision: legacyCreated.revision,
    });

    const imported = await readCanvasDrawing({
      cwd,
      directorySegments: ["drawings", "project-1"],
      legacyCwd,
      threadId: "drawing-legacy",
    });

    expect(imported.scene).toEqual(legacyScene);
    await expect(
      access(path.join(cwd, "drawings", "project-1", "drawing-legacy.excalidraw")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(legacyCwd, "drawings", "drawing-legacy.excalidraw")),
    ).resolves.toBeUndefined();
  });

  it("creates, saves, reads, and moves a drawing to trash", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({ cwd, threadId: "drawing-1" });
    expect(created.scene).toEqual(EMPTY_CANVAS_SCENE);

    const scene = {
      ...EMPTY_CANVAS_SCENE,
      elements: [{ id: "layer-1", type: "rectangle" }],
    };
    const saved = await saveCanvasDrawing({
      cwd,
      threadId: "drawing-1",
      scene,
      expectedRevision: created.revision,
    });
    expect(saved.revision).not.toBe(created.revision);
    expect((await readCanvasDrawing({ cwd, threadId: "drawing-1" })).scene).toEqual(scene);

    expect(await deleteCanvasDrawing({ cwd, threadId: "drawing-1" })).toEqual({ deleted: true });
    await expect(readCanvasDrawing({ cwd, threadId: "drawing-1" })).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects stale revisions without overwriting the valid file", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({ cwd, threadId: "drawing-2" });
    await expect(
      saveCanvasDrawing({
        cwd,
        threadId: "drawing-2",
        scene: { ...EMPTY_CANVAS_SCENE, elements: [{ id: "new" }] },
        expectedRevision: "stale",
      }),
    ).rejects.toBeInstanceOf(CanvasDrawingConflictError);
    expect((await readCanvasDrawing({ cwd, threadId: "drawing-2" })).revision).toBe(
      created.revision,
    );
  });

  it("serializes concurrent saves so only one writer can consume a revision", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({ cwd, threadId: "drawing-concurrent" });
    const results = await Promise.allSettled(
      ["first", "second"].map((id) =>
        saveCanvasDrawing({
          cwd,
          threadId: "drawing-concurrent",
          scene: { ...EMPTY_CANVAS_SCENE, elements: [{ id, type: "rectangle" }] },
          expectedRevision: created.revision,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(CanvasDrawingConflictError) });
    expect((await readCanvasDrawing({ cwd, threadId: "drawing-concurrent" })).scene.elements)
      .toHaveLength(1);
  });

  it("rejects unsafe ids and a symlinked drawings directory", async () => {
    const cwd = await workspace();
    await expect(createCanvasDrawing({ cwd, threadId: "../escape" })).rejects.toBeInstanceOf(
      CanvasDrawingPathError,
    );

    const outside = await workspace();
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(cwd, "drawings"));
    await expect(createCanvasDrawing({ cwd, threadId: "drawing-3" })).rejects.toBeInstanceOf(
      CanvasDrawingPathError,
    );
  });

  it("rejects a symlinked trash ancestor before creating outside directories", async () => {
    const cwd = await workspace();
    const outside = await workspace();
    await createCanvasDrawing({ cwd, threadId: "drawing-trash-symlink" });
    await symlink(outside, path.join(cwd, ".synara"));

    await expect(
      trashCanvasDrawing({ cwd, threadId: "drawing-trash-symlink" }),
    ).rejects.toBeInstanceOf(CanvasDrawingPathError);
    await expect(access(path.join(outside, "trash"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized drawing files before parsing their contents", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({ cwd, threadId: "drawing-too-large" });
    await writeFile(path.join(cwd, created.relativePath), Buffer.alloc(MAX_CANVAS_SCENE_BYTES + 1));

    await expect(
      readCanvasDrawing({ cwd, threadId: "drawing-too-large" }),
    ).rejects.toBeInstanceOf(InvalidCanvasSceneError);
  });

  it("keeps the previous JSON when a save payload is invalid", async () => {
    const cwd = await workspace();
    const created = await createCanvasDrawing({ cwd, threadId: "drawing-4" });
    const filePath = path.join(cwd, created.relativePath);
    const before = await readFile(filePath, "utf8");

    await expect(
      saveCanvasDrawing({
        cwd,
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

  it("can compensate a trashed drawing when its thread deletion fails", async () => {
    const cwd = await workspace();
    await createCanvasDrawing({ cwd, threadId: "drawing-5" });
    const trashed = await trashCanvasDrawing({ cwd, threadId: "drawing-5" });
    await expect(readCanvasDrawing({ cwd, threadId: "drawing-5" })).rejects.toMatchObject({
      code: "ENOENT",
    });
    await restoreTrashedCanvasDrawing(trashed);
    expect((await readCanvasDrawing({ cwd, threadId: "drawing-5" })).scene).toEqual(
      EMPTY_CANVAS_SCENE,
    );
  });
});
