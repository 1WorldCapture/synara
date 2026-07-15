import { describe, expect, it } from "vitest";

import { isDedicatedWorkspaceView, parseDiffRouteSearch } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("preserves file value for repo diff selections without a turn", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
      diffFilePath: "src/app.ts",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
    });
  });

  it("preserves browser panel mode without diff state", () => {
    const parsed = parseDiffRouteSearch({
      panel: "browser",
      diffTurnId: "turn-1",
    });

    expect(parsed).toEqual({
      panel: "browser",
    });
  });

  it("preserves split route state while normalizing unrelated values", () => {
    const parsed = parseDiffRouteSearch({
      panel: "browser",
      diffTurnId: "turn-1",
      splitViewId: " split-1 ",
    });

    expect(parsed).toEqual({
      panel: "browser",
      splitViewId: "split-1",
    });
  });

  it("sanitizes the removed canvas workspace view to ordinary chat", () => {
    expect(
      parseDiffRouteSearch({
        view: "canvas",
        editorFilePath: "src/app.ts",
      }),
    ).toEqual({});
  });

  it("recognizes an explicit chat override for dedicated workspace threads", () => {
    expect(parseDiffRouteSearch({ view: "chat" })).toEqual({ view: "chat" });
  });
});

describe("isDedicatedWorkspaceView", () => {
  it("treats only the editor as a focused workspace", () => {
    expect(isDedicatedWorkspaceView("editor")).toBe(true);
    expect(isDedicatedWorkspaceView("canvas")).toBe(false);
  });

  it("keeps the global sidebar for ordinary and unknown views", () => {
    expect(isDedicatedWorkspaceView(undefined)).toBe(false);
    expect(isDedicatedWorkspaceView("chat")).toBe(false);
    expect(isDedicatedWorkspaceView("diff")).toBe(false);
  });
});
