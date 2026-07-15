import "../../index.css";

import { ThreadId } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useRightDockStore } from "~/rightDockStore";
import { ThreadRightDock } from "./ThreadRightDock";

vi.mock("~/components/CanvasDockPane", () => ({
  CanvasDockPane: (props: { threadId: string; active?: boolean; visible?: boolean }) => (
    <div
      data-testid="canvas-dock-pane"
      data-thread-id={props.threadId}
      data-active={String(props.active)}
      data-visible={String(props.visible)}
    />
  ),
}));

vi.mock("~/components/BrowserPanel", () => ({
  default: () => <div data-testid="browser-dock-pane" />,
}));

const THREAD_A = ThreadId.makeUnsafe("thread-dock-a");
const THREAD_B = ThreadId.makeUnsafe("thread-dock-b");

function dock(threadId: typeof THREAD_A, composerPaneScopeId = "single") {
  return (
    <div className="flex h-[800px] w-[1400px]">
      <div className="min-w-0 flex-1" />
      <ThreadRightDock
        threadId={threadId}
        projectId={null}
        workspaceRoot={null}
        composerPaneScopeId={composerPaneScopeId}
      />
    </div>
  );
}

describe("ThreadRightDock", () => {
  beforeEach(async () => {
    await page.viewport(1_400, 900);
    localStorage.clear();
    useRightDockStore.setState({ dockStateByThreadId: {} });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the thread-scoped Canvas singleton from the add menu", async () => {
    useRightDockStore.getState().openPane(THREAD_A, { kind: "browser", paneId: "browser-a" });
    const screen = await render(dock(THREAD_A));
    try {
      await page.getByRole("button", { name: "Add panel" }).click();
      await page.getByRole("menuitem", { name: "Canvas" }).click();

      await expect.element(page.getByTestId("canvas-dock-pane")).toHaveAttribute(
        "data-thread-id",
        THREAD_A,
      );
      await expect
        .element(page.getByTestId("canvas-dock-pane"))
        .toHaveAttribute("data-active", "true");
      expect(
        useRightDockStore
          .getState()
          .dockStateByThreadId[THREAD_A]?.panes.filter((pane) => pane.kind === "canvas"),
      ).toHaveLength(1);

      useRightDockStore.getState().openPane(THREAD_A, { kind: "canvas" });
      expect(
        useRightDockStore
          .getState()
          .dockStateByThreadId[THREAD_A]?.panes.filter((pane) => pane.kind === "canvas"),
      ).toHaveLength(1);
    } finally {
      await screen.unmount();
    }
  });

  it("swaps the rendered Canvas with the focused split host while preserving both states", async () => {
    useRightDockStore.getState().openPane(THREAD_A, { kind: "canvas", paneId: "canvas-a" });
    useRightDockStore.getState().openPane(THREAD_B, { kind: "canvas", paneId: "canvas-b" });
    const screen = await render(dock(THREAD_A, "split-1:pane-a"));
    try {
      await expect.element(page.getByTestId("canvas-dock-pane")).toHaveAttribute(
        "data-thread-id",
        THREAD_A,
      );

      await screen.rerender(dock(THREAD_B, "split-1:pane-b"));
      await expect.element(page.getByTestId("canvas-dock-pane")).toHaveAttribute(
        "data-thread-id",
        THREAD_B,
      );
      expect(useRightDockStore.getState().dockStateByThreadId[THREAD_A]?.activePaneId).toBe(
        "canvas-a",
      );
      expect(useRightDockStore.getState().dockStateByThreadId[THREAD_B]?.activePaneId).toBe(
        "canvas-b",
      );
    } finally {
      await screen.unmount();
    }
  });
});
