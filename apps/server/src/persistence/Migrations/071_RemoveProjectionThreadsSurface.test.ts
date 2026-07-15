import { assert, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vitest";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const projectionThreadColumns = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('projection_threads')
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

const insertThread = (
  sql: SqlClient.SqlClient,
  input: { readonly threadId: string; readonly surface: "chat" | "canvas" },
) =>
  sql`
    INSERT INTO projection_threads (
      thread_id, project_id, surface, title, model_selection_json, created_at, updated_at
    ) VALUES (
      ${input.threadId}, 'project-1', ${input.surface}, 'Thread title',
      '{"provider":"codex","model":"gpt-5.4"}',
      '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'
    )
  `;

describe("RemoveProjectionThreadsSurface", () => {
  it.effect("drops surface while preserving ordinary thread rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 70 });
      yield* insertThread(sql, { threadId: "thread-chat", surface: "chat" });
      yield* runMigrations();

      assert.notInclude(yield* projectionThreadColumns(sql), "surface");
      const rows = yield* sql<{ readonly threadId: string; readonly title: string }>`
        SELECT thread_id AS threadId, title FROM projection_threads
      `;
      assert.deepStrictEqual(rows, [{ threadId: "thread-chat", title: "Thread title" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("fails before schema mutation when a projected Canvas thread remains", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 70 });
      yield* insertThread(sql, { threadId: "thread-canvas", surface: "canvas" });
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(yield* projectionThreadColumns(sql), "surface");
      const rows = yield* sql<{ readonly surface: string }>`
        SELECT surface FROM projection_threads WHERE thread_id = 'thread-canvas'
      `;
      assert.deepStrictEqual(rows, [{ surface: "canvas" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("also fails when the authoritative event stream contains a Canvas thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 70 });
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, sequence, event_type,
          payload_json, occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, metadata_json
        ) VALUES (
          'event-canvas-created', 'thread', 'thread-canvas-event', 1, 1, 'thread.created',
          '{"threadId":"thread-canvas-event","surface":"canvas"}',
          '2026-07-15T00:00:00.000Z', 'command-canvas-created', NULL,
          'command-canvas-created', 'user', '{}'
        )
      `;
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(yield* projectionThreadColumns(sql), "surface");
      const events = yield* sql<{ readonly eventId: string }>`
        SELECT event_id AS eventId FROM orchestration_events
      `;
      assert.deepStrictEqual(events, [{ eventId: "event-canvas-created" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
