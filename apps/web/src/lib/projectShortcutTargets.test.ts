import { ProjectId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveNewThreadTarget } from "./projectShortcutTargets";

const CURRENT_PROJECT_ID = ProjectId.makeUnsafe("current-project");
const LATEST_PROJECT_ID = ProjectId.makeUnsafe("latest-project");

describe("resolveNewThreadTarget", () => {
  it("prefers the current project and inherits its context", () => {
    expect(
      resolveNewThreadTarget({
        currentProjectId: CURRENT_PROJECT_ID,
        latestUsableProjectId: LATEST_PROJECT_ID,
      }),
    ).toEqual({ projectId: CURRENT_PROJECT_ID, inheritContext: true });
  });

  it("falls back to the latest usable project without inheriting context", () => {
    expect(
      resolveNewThreadTarget({
        currentProjectId: null,
        latestUsableProjectId: LATEST_PROJECT_ID,
      }),
    ).toEqual({ projectId: LATEST_PROJECT_ID, inheritContext: false });
  });

  it("returns no target when neither project is usable", () => {
    expect(
      resolveNewThreadTarget({ currentProjectId: null, latestUsableProjectId: null }),
    ).toBeNull();
  });
});
