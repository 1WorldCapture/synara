import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { WsCanvasReadDrawingRpc } from "./rpc";

describe("Canvas RPC contracts", () => {
  it.effect("preserves scene JSON values through the RPC JSON codec", () =>
    Effect.gen(function* () {
      const codec = Schema.toCodecJson(Rpc.exitSchema(WsCanvasReadDrawingRpc));
      const snapshot = {
        relativePath: "drawings/drawing-1.excalidraw",
        revision: "revision-1",
        scene: {
          type: "excalidraw" as const,
          version: 2,
          source: "https://synara.app",
          elements: [
            {
              id: "box-1",
              type: "rectangle",
              x: 120,
              locked: false,
              points: [
                [0, 0],
                [80, 40],
              ],
              customData: { generatedBy: "agent", confidence: 0.9 },
              link: null,
            },
          ],
          appState: {
            viewBackgroundColor: "#ffffff",
            zoom: { value: 1 },
          },
          files: {
            "file-1": { id: "file-1", mimeType: "image/png" },
          },
        },
      };

      const wire = yield* Schema.encodeEffect(codec)(Exit.succeed(snapshot));
      assert.deepStrictEqual(wire, { _tag: "Success", value: snapshot });

      const decoded = yield* Schema.decodeUnknownEffect(codec)(wire);
      assert.strictEqual(decoded._tag, "Success");
      assert.deepStrictEqual(decoded.value, snapshot);
    }),
  );
});
