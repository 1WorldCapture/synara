// FILE: 071_RemoveProjectionThreadsSurface.ts
// Purpose: Remove the obsolete chat/canvas thread discriminator after verifying the clean-break
//          precondition across both the read model and authoritative event stream.
// Layer: Server persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

const LEGACY_CANVAS_DATA_MESSAGE =
  "Cannot remove projection_threads.surface while legacy Canvas sessions remain. " +
  "Delete the legacy Canvas sessions and purge their archived data with the previous Synara " +
  "version, then retry this upgrade.";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_threads", "surface"))) {
    return;
  }

  const [legacyCanvasData] = yield* sql<{ readonly count: number }>`
    SELECT (
      SELECT COUNT(*)
      FROM projection_threads
      WHERE surface = 'canvas'
    ) + (
      SELECT COUNT(*)
      FROM orchestration_events
      WHERE event_type = 'thread.created'
        AND json_extract(payload_json, '$.surface') = 'canvas'
    ) AS count
  `;

  if ((legacyCanvasData?.count ?? 0) > 0) {
    return yield* Effect.fail(new Error(LEGACY_CANVAS_DATA_MESSAGE));
  }

  yield* sql`ALTER TABLE projection_threads DROP COLUMN surface`;
});
