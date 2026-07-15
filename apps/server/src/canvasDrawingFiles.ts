import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  CanvasDrawingDeleteResult,
  CanvasDrawingRef,
  CanvasDrawingSaveInput,
  CanvasDrawingSnapshot,
} from "@synara/contracts";
import {
  EMPTY_CANVAS_SCENE,
  InvalidCanvasSceneError,
  MAX_CANVAS_SCENE_BYTES,
  parseCanvasScene,
  serializeCanvasScene,
} from "@synara/shared/excalidrawScene";

const SAFE_CANVAS_THREAD_ID = /^[A-Za-z0-9._:-]+$/;
const DEFAULT_DRAWING_DIRECTORY_SEGMENTS = ["drawings"] as const;
const drawingMutationTails = new Map<string, Promise<void>>();

type CanvasDrawingFileSaveInput = CanvasDrawingSaveInput & CanvasDrawingRef;

export class CanvasDrawingPathError extends Error {
  readonly name = "CanvasDrawingPathError";
}

export class CanvasDrawingConflictError extends Error {
  readonly name = "CanvasDrawingConflictError";
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string,
  ) {
    super("Canvas revision conflict: the drawing changed since it was loaded. Reload before saving again.");
  }
}

function revisionOf(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function withDrawingMutation<A>(
  input: CanvasDrawingRef,
  operation: () => Promise<A>,
): Promise<A> {
  const key = `${input.cwd}\0${drawingDirectorySegments(input).join("/")}\0${input.threadId}`;
  const previous = drawingMutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  drawingMutationTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (drawingMutationTails.get(key) === tail) {
      drawingMutationTails.delete(key);
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function drawingDirectorySegments(input: CanvasDrawingRef): readonly string[] {
  const segments = input.directorySegments ?? DEFAULT_DRAWING_DIRECTORY_SEGMENTS;
  if (segments.length === 0) {
    throw new CanvasDrawingPathError("Canvas drawing directory cannot be empty.");
  }
  return segments;
}

async function safeDirectory(
  cwd: string,
  segments: readonly string[],
  options?: { readonly createMissing?: boolean },
): Promise<{
  readonly root: string;
  readonly directory: string;
}> {
  const root = await realpath(cwd);
  let directory = root;
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\")
    ) {
      throw new CanvasDrawingPathError("Canvas directory contains an unsafe path segment.");
    }
    const candidate = path.join(directory, segment);
    let stat =
      options?.createMissing === false
        ? await lstat(candidate)
        : await lstat(candidate).catch((cause: NodeJS.ErrnoException) => {
            if (cause.code === "ENOENT") return null;
            throw cause;
          });
    if (!stat) {
      await mkdir(candidate);
      stat = await lstat(candidate);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new CanvasDrawingPathError("Canvas directories cannot contain symbolic links.");
    }
    directory = await realpath(candidate);
    if (!isWithin(root, directory)) {
      throw new CanvasDrawingPathError("Canvas directory resolves outside the project.");
    }
  }
  return { root, directory };
}

function assertSafeThreadId(threadId: string): void {
  if (!SAFE_CANVAS_THREAD_ID.test(threadId)) {
    throw new CanvasDrawingPathError("Drawing identity cannot be used as a safe file name.");
  }
}

async function drawingPath(
  input: CanvasDrawingRef,
  options?: { readonly createDirectories?: boolean },
): Promise<{
  readonly root: string;
  readonly filePath: string;
  readonly relativePath: string;
  readonly size: number | null;
}> {
  assertSafeThreadId(input.threadId);
  const { root, directory } = await safeDirectory(input.cwd, drawingDirectorySegments(input), {
    createMissing: options?.createDirectories !== false,
  });
  const fileName = `${input.threadId}.excalidraw`;
  const filePath = path.join(directory, fileName);
  if (!isWithin(root, filePath)) {
    throw new CanvasDrawingPathError("Drawing path resolves outside the storage root.");
  }
  const stat = await lstat(filePath).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (stat?.isSymbolicLink()) {
    throw new CanvasDrawingPathError("Drawing files cannot be symbolic links.");
  }
  return { root, filePath, relativePath: path.relative(root, filePath), size: stat?.size ?? null };
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function importLegacyDrawingIfPresent(
  input: CanvasDrawingRef,
  destinationPath: string,
): Promise<boolean> {
  if (!input.legacyCwd || input.legacyCwd === input.cwd) return false;
  const legacyInput: CanvasDrawingRef = {
    cwd: input.legacyCwd,
    directorySegments: DEFAULT_DRAWING_DIRECTORY_SEGMENTS,
    threadId: input.threadId,
  };
  const legacy = await drawingPath(legacyInput, { createDirectories: false }).catch(
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return null;
      throw cause;
    },
  );
  if (!legacy) return false;
  if (legacy.size !== null && legacy.size > MAX_CANVAS_SCENE_BYTES) {
    throw new InvalidCanvasSceneError(
      `Canvas scene exceeds the ${MAX_CANVAS_SCENE_BYTES} byte limit.`,
    );
  }
  const contents = await readFile(legacy.filePath, "utf8");
  parseCanvasScene(contents);
  await atomicWrite(destinationPath, contents);
  return true;
}

async function snapshotFromFile(input: CanvasDrawingRef): Promise<CanvasDrawingSnapshot> {
  const resolved = await drawingPath(input);
  if (resolved.size !== null && resolved.size > MAX_CANVAS_SCENE_BYTES) {
    throw new InvalidCanvasSceneError(
      `Canvas scene exceeds the ${MAX_CANVAS_SCENE_BYTES} byte limit.`,
    );
  }
  let contents: string;
  try {
    contents = await readFile(resolved.filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw cause;
    const imported = await importLegacyDrawingIfPresent(input, resolved.filePath);
    if (!imported) throw cause;
    contents = await readFile(resolved.filePath, "utf8");
  }
  return {
    relativePath: resolved.relativePath,
    scene: parseCanvasScene(contents),
    revision: revisionOf(contents),
  };
}

export async function createCanvasDrawing(
  input: CanvasDrawingRef,
): Promise<CanvasDrawingSnapshot> {
  return withDrawingMutation(input, async () => {
    const resolved = await drawingPath(input);
    try {
      return await snapshotFromFile(input);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw cause;
    }
    await atomicWrite(resolved.filePath, serializeCanvasScene(EMPTY_CANVAS_SCENE));
    return snapshotFromFile(input);
  });
}

export function readCanvasDrawing(input: CanvasDrawingRef): Promise<CanvasDrawingSnapshot> {
  return withDrawingMutation(input, () => snapshotFromFile(input));
}

export async function saveCanvasDrawing(
  input: CanvasDrawingFileSaveInput,
): Promise<CanvasDrawingSnapshot> {
  return withDrawingMutation(input, async () => {
    const resolved = await drawingPath(input);
    if (resolved.size !== null && resolved.size > MAX_CANVAS_SCENE_BYTES) {
      throw new InvalidCanvasSceneError(
        `Canvas scene exceeds the ${MAX_CANVAS_SCENE_BYTES} byte limit.`,
      );
    }
    if (resolved.size === null) {
      await importLegacyDrawingIfPresent(input, resolved.filePath);
    }
    const current = await readFile(resolved.filePath, "utf8");
    const currentRevision = revisionOf(current);
    if (currentRevision !== input.expectedRevision) {
      throw new CanvasDrawingConflictError(input.expectedRevision, currentRevision);
    }
    const contents = serializeCanvasScene(input.scene);
    if (contents === current) return snapshotFromFile(input);
    await atomicWrite(resolved.filePath, contents);
    return snapshotFromFile(input);
  });
}

export async function deleteCanvasDrawing(
  input: CanvasDrawingRef,
): Promise<CanvasDrawingDeleteResult> {
  const trashed = await trashCanvasDrawing(input);
  return { deleted: trashed !== null };
}

export interface TrashedCanvasDrawing {
  readonly originalPath: string;
  readonly trashPath: string;
}

export async function trashCanvasDrawing(
  input: CanvasDrawingRef,
): Promise<TrashedCanvasDrawing | null> {
  return withDrawingMutation(input, async () => {
    const resolved = await drawingPath(input);
    let stat = await lstat(resolved.filePath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return null;
      throw cause;
    });
    if (!stat && (await importLegacyDrawingIfPresent(input, resolved.filePath))) {
      stat = await lstat(resolved.filePath);
    }
    if (!stat) return null;
    if (stat.isSymbolicLink()) {
      throw new CanvasDrawingPathError("Drawing files cannot be symbolic links.");
    }
    const { directory: trashDirectory } = await safeDirectory(input.cwd, [
      ".synara",
      "trash",
      ...drawingDirectorySegments(input),
    ]);
    const trashPath = path.join(
      trashDirectory,
      `${input.threadId}.${new Date().toISOString().replaceAll(":", "-")}.excalidraw`,
    );
    await rename(resolved.filePath, trashPath);
    return { originalPath: resolved.filePath, trashPath };
  });
}

export async function restoreTrashedCanvasDrawing(
  trashed: TrashedCanvasDrawing | null,
): Promise<void> {
  if (!trashed) return;
  await rename(trashed.trashPath, trashed.originalPath);
}
