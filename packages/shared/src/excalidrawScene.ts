import { CanvasScene, type CanvasScene as CanvasSceneType } from "@synara/contracts";
import { Schema } from "effect";

export const MAX_CANVAS_SCENE_BYTES = 5_000_000;
export const MAX_CANVAS_SCENE_ELEMENTS = 20_000;

const EXCALIDRAW_OPERATION_PSEUDO_TYPES = new Set([
  "cameraUpdate",
  "restoreCheckpoint",
  "replaceScene",
  "delete",
]);

interface ExcalidrawOperationsScene {
  readonly elements: ReadonlyArray<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** Applies the element-operation dialect shared by Canvas agents and live previews. */
export function applyExcalidrawElementOperations<T extends ExcalidrawOperationsScene>(
  scene: T,
  operations: ReadonlyArray<Record<string, unknown>>,
): T {
  const replacement = operations.findLast((operation) => operation.type === "replaceScene");
  const replacementElements = replacement?.elements;
  if (replacement !== undefined && !Array.isArray(replacementElements)) {
    throw new Error("replaceScene requires an elements array.");
  }
  const sourceElements = (replacementElements ?? scene.elements) as ReadonlyArray<
    Record<string, unknown>
  >;
  const additions = operations.filter(
    (operation) => !EXCALIDRAW_OPERATION_PSEUDO_TYPES.has(String(operation.type ?? "")),
  );
  const additionIds = new Set<string>();
  for (const addition of additions) {
    if (typeof addition.id !== "string" || addition.id.trim().length === 0) {
      throw new Error("Every Excalidraw element operation must have a non-empty string id.");
    }
    if (additionIds.has(addition.id)) {
      throw new Error(`Duplicate Excalidraw element id '${addition.id}'.`);
    }
    additionIds.add(addition.id);
  }
  const deleteIds = new Set<string>();
  for (const operation of operations) {
    if (operation.type !== "delete") continue;
    for (const id of String(operation.ids ?? operation.id ?? "").split(",")) {
      if (id.trim()) deleteIds.add(id.trim());
    }
  }
  if (replacement === undefined && additions.length === 0 && deleteIds.size === 0) return scene;
  const retained = sourceElements.filter(
    (element) =>
      !deleteIds.has(String(element.id ?? "")) &&
      !deleteIds.has(String(element.containerId ?? "")) &&
      !additionIds.has(String(element.id ?? "")) &&
      !additionIds.has(String(element.containerId ?? "")),
  );
  return { ...scene, elements: [...retained, ...additions] } as T;
}

export const EMPTY_CANVAS_SCENE: CanvasSceneType = {
  type: "excalidraw",
  version: 2,
  source: "https://synara.app",
  elements: [],
  appState: {},
  files: {},
};

export class InvalidCanvasSceneError extends Error {
  readonly name = "InvalidCanvasSceneError";
}

function assertElementIdentities(scene: CanvasSceneType): void {
  for (const [index, element] of scene.elements.entries()) {
    if (typeof element.id !== "string" || element.id.trim().length === 0) {
      throw new InvalidCanvasSceneError(
        `Canvas element at index ${index} must have a non-empty string id.`,
      );
    }
    if (typeof element.type !== "string" || element.type.trim().length === 0) {
      throw new InvalidCanvasSceneError(
        `Canvas element at index ${index} must have a non-empty string type.`,
      );
    }
  }
}

export function normalizeCanvasScene(value: unknown): CanvasSceneType {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? {
          type: "excalidraw",
          version: 2,
          source: "https://synara.app",
          appState: {},
          files: {},
          ...value,
        }
      : value;

  let scene: CanvasSceneType;
  try {
    scene = Schema.decodeUnknownSync(CanvasScene)(candidate);
  } catch (cause) {
    throw new InvalidCanvasSceneError(
      cause instanceof Error ? cause.message : "Invalid Excalidraw scene",
    );
  }
  if (scene.elements.length > MAX_CANVAS_SCENE_ELEMENTS) {
    throw new InvalidCanvasSceneError(
      `Canvas scene exceeds the ${MAX_CANVAS_SCENE_ELEMENTS} element limit.`,
    );
  }
  assertElementIdentities(scene);
  return scene;
}

export function serializeCanvasScene(value: unknown): string {
  const serialized = `${JSON.stringify(normalizeCanvasScene(value), null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANVAS_SCENE_BYTES) {
    throw new InvalidCanvasSceneError(
      `Canvas scene exceeds the ${MAX_CANVAS_SCENE_BYTES} byte limit.`,
    );
  }
  return serialized;
}

export function parseCanvasScene(contents: string): CanvasSceneType {
  if (new TextEncoder().encode(contents).byteLength > MAX_CANVAS_SCENE_BYTES) {
    throw new InvalidCanvasSceneError(
      `Canvas scene exceeds the ${MAX_CANVAS_SCENE_BYTES} byte limit.`,
    );
  }
  try {
    return normalizeCanvasScene(JSON.parse(contents));
  } catch (cause) {
    if (cause instanceof InvalidCanvasSceneError) throw cause;
    throw new InvalidCanvasSceneError(
      cause instanceof Error ? cause.message : "Invalid Excalidraw JSON",
    );
  }
}
