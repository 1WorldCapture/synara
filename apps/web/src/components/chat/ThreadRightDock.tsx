// FILE: ThreadRightDock.tsx
// Purpose: Window-level right-dock controller shared by single and split chat surfaces.
// Layer: Chat route UI

import type { ProjectId, ThreadId } from "@synara/contracts";
import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo } from "react";

import ChatView from "~/components/ChatView";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { useDockPaneRuntimeActivation } from "~/hooks/useDockPaneRuntimeActivation";
import { useStore } from "~/store";
import { createSidebarThreadSummariesSelector } from "~/storeSelectors";
import { useRightDockStore, selectRightDockState } from "~/rightDockStore";
import {
  resolveActivePane,
  type RightDockPane,
  type RightDockPaneKind,
} from "~/rightDockStore.logic";
import { basenameOfPath } from "~/file-icons";
import { canComposerHandlePanelWidth } from "~/lib/panelResize";
import {
  addChatFileComment,
  appendChatFileReference,
  appendComposerPromptText,
  buildWhyLinesPrompt,
} from "~/lib/chatReferences";
import { getSidechatCreator } from "~/lib/sidechatCreatorRegistry";
import { dockSidechatPaneScopeId } from "~/lib/chatPaneScope";
import { toastManager } from "~/components/ui/toast";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import type { SplitViewPanePanelState } from "~/splitViewStore";
import {
  pullRequestDetailInputFromPane,
  pullRequestPaneTabLabel,
} from "~/components/pullRequest/pullRequestDetail.logic";
import { usePullRequestPaneStateIcon } from "~/components/pullRequest/usePullRequestPaneStateIcon";
import { RightDock } from "./RightDock";
import { PanelStateMessage } from "./PanelStateMessage";
import { RIGHT_DOCK_ADD_MENU_KINDS, getRightDockPaneMeta } from "./rightDockPaneMeta";

const BrowserPanel = lazy(() => import("~/components/BrowserPanel"));
const DiffPanel = lazy(() => import("~/components/DiffPanel"));
const CanvasDockPane = lazy(() =>
  import("~/components/CanvasDockPane").then((module) => ({ default: module.CanvasDockPane })),
);
const PullRequestDockPane = lazy(
  () => import("~/components/pullRequest/PullRequestDockPane"),
);
const DockTerminalPane = lazy(() => import("./DockTerminalPane"));
const GitPanel = lazy(() => import("./GitPanel"));
const DockExplorerPane = lazy(() =>
  import("./DockExplorerPane").then((module) => ({ default: module.DockExplorerPane })),
);
const DockFilePane = lazy(() =>
  import("./DockFilePane").then((module) => ({ default: module.DockFilePane })),
);

const DOCK_DEFAULT_WIDTH = "max(28rem, calc(50vw - 8rem))";
const DOCK_MIN_WIDTH = 26 * 16;
const noop = () => {};

const DOCK_EMBEDDED_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

function RightDockPanePlaceholder(props: { kind: RightDockPaneKind }) {
  const { label } = getRightDockPaneMeta(props.kind);
  return <PanelStateMessage>{label} panel is coming soon.</PanelStateMessage>;
}

export interface ThreadRightDockProps {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  composerPaneScopeId: string;
}

export function ThreadRightDock(props: ThreadRightDockProps) {
  const dockState = useRightDockStore(selectRightDockState(props.threadId));
  const openPane = useRightDockStore((store) => store.openPane);
  const closePane = useRightDockStore((store) => store.closePane);
  const toggleSingletonPane = useRightDockStore((store) => store.toggleSingletonPane);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const updatePane = useRightDockStore((store) => store.updatePane);
  const activePane = resolveActivePane(dockState);
  const {
    activePaneRuntimeMode,
    requestActivePaneLive,
    requestImmediateHydration,
  } = useDockPaneRuntimeActivation({ threadId: props.threadId, activePane });
  const threadSummaries = useStore(useMemo(() => createSidebarThreadSummariesSelector(), []));

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") return;
    return onMenuAction((action) => {
      if (action !== "toggle-browser") return;
      requestImmediateHydration("browser");
      toggleSingletonPane(props.threadId, { kind: "browser" });
    });
  }, [props.threadId, requestImmediateHydration, toggleSingletonPane]);

  useEffect(() => {
    const onOpenBrowserPanelRequest = window.desktopBridge?.browser.onBrowserUseOpenPanelRequest;
    if (typeof onOpenBrowserPanelRequest !== "function") return;
    return onOpenBrowserPanelRequest(() => {
      requestImmediateHydration("browser");
      openPane(props.threadId, { kind: "browser" });
    });
  }, [openPane, props.threadId, requestImmediateHydration]);

  const paneLabelOverrides = useMemo(() => {
    const titleByThreadId = new Map(threadSummaries.map((summary) => [summary.id, summary.title]));
    const overrides: Record<string, string | undefined> = {};
    for (const pane of dockState.panes) {
      if (pane.kind === "sidechat" && pane.threadId) {
        overrides[pane.id] = titleByThreadId.get(pane.threadId) || "Side";
      } else if (pane.kind === "file" && pane.filePath) {
        overrides[pane.id] = basenameOfPath(pane.filePath);
      } else if (pane.kind === "pullRequest" && pane.pullRequestNumber !== null) {
        overrides[pane.id] = pullRequestPaneTabLabel(pane.pullRequestNumber);
      }
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [dockState.panes, threadSummaries]);

  const pullRequestPane = dockState.panes.find(
    (pane) => pane.kind === "pullRequest" && pullRequestDetailInputFromPane(pane) !== null,
  );
  const pullRequestPaneStateIcon = usePullRequestPaneStateIcon(
    pullRequestPane ? pullRequestDetailInputFromPane(pullRequestPane) : null,
  );
  const paneIconOverrides =
    pullRequestPane && pullRequestPaneStateIcon
      ? { [pullRequestPane.id]: pullRequestPaneStateIcon }
      : undefined;

  const shouldAcceptDockWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      return canComposerHandlePanelWidth({
        nextWidth,
        paneScopeId: props.composerPaneScopeId,
        applyWidth: (width) => wrapper.style.setProperty("--sidebar-width", `${width}px`),
        resetWidth: () => {
          if (previousSidebarWidth) {
            wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
          } else {
            wrapper.style.removeProperty("--sidebar-width");
          }
        },
      });
    },
    [props.composerPaneScopeId],
  );

  const handleAddPane = useCallback(
    (kind: RightDockPaneKind) => {
      requestImmediateHydration(kind);
      if (kind === "sidechat") {
        const createSidechat = getSidechatCreator(props.threadId);
        if (!createSidechat) {
          toastManager.add({
            type: "warning",
            title: "Side is unavailable",
            description: "Open a server-backed main thread before starting Side.",
          });
          return;
        }
        void createSidechat().catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not start Side",
            description:
              error instanceof Error ? error.message : "An error occurred while creating Side.",
          });
        });
        return;
      }
      openPane(props.threadId, { kind });
    },
    [openPane, props.threadId, requestImmediateHydration],
  );

  const handleSelectPane = useCallback(
    (paneId: string) => {
      requestImmediateHydration(dockState.panes.find((pane) => pane.id === paneId)?.kind);
      setActivePane(props.threadId, paneId);
    },
    [dockState.panes, props.threadId, requestImmediateHydration, setActivePane],
  );

  const renderPane = useCallback(
    (
      pane: RightDockPane,
      context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean; isVisible: boolean },
    ): ReactNode => {
      switch (pane.kind) {
        case "browser":
          return (
            <Suspense fallback={<PanelStateMessage>Loading browser...</PanelStateMessage>}>
              <BrowserPanel
                mode="sidebar"
                threadId={props.threadId}
                onClosePanel={() => closePane(props.threadId, pane.id)}
                runtimeMode={context.runtimeMode}
                onRequestLive={requestActivePaneLive}
              />
            </Suspense>
          );
        case "canvas":
          return (
            <Suspense fallback={<PanelStateMessage>Loading Canvas...</PanelStateMessage>}>
              <CanvasDockPane
                threadId={props.threadId}
                active={context.isActive && dockState.open}
                visible={context.isActive && dockState.open}
                onClose={() => closePane(props.threadId, pane.id)}
                onFocus={() => setActivePane(props.threadId, pane.id)}
              />
            </Suspense>
          );
        case "pullRequest":
          return (
            <Suspense fallback={<PanelStateMessage>Loading pull request...</PanelStateMessage>}>
              <PullRequestDockPane
                pane={pane}
                pollingEnabled={context.isVisible}
                onClose={() => closePane(props.threadId, pane.id)}
              />
            </Suspense>
          );
        case "diff":
          return (
            <DiffWorkerPoolProvider>
              <Suspense fallback={<PanelStateMessage>Loading diff viewer...</PanelStateMessage>}>
                <DiffPanel
                  mode="sidebar"
                  threadId={props.threadId}
                  panelState={{
                    panel: "diff",
                    diffTurnId: pane.diffTurnId,
                    diffFilePath: pane.diffFilePath,
                  }}
                  onUpdatePanelState={(patch) =>
                    updatePane(props.threadId, pane.id, {
                      diffTurnId: patch.diffTurnId ?? null,
                      diffFilePath: patch.diffFilePath ?? null,
                    })
                  }
                  onClosePanel={() => closePane(props.threadId, pane.id)}
                  liveRefreshEnabled={context.isActive && dockState.open}
                  queriesEnabled={context.isActive && dockState.open}
                />
              </Suspense>
            </DiffWorkerPoolProvider>
          );
        case "terminal":
          if (context.runtimeMode === "preview") {
            return <PanelStateMessage>Terminal is sleeping. Restoring shortly.</PanelStateMessage>;
          }
          return (
            <Suspense fallback={<PanelStateMessage>Loading terminal...</PanelStateMessage>}>
              <DockTerminalPane
                hostThreadId={props.threadId}
                projectId={props.projectId}
                isActive={context.isActive && dockState.open}
              />
            </Suspense>
          );
        case "git":
          return (
            <Suspense fallback={<PanelStateMessage>Loading Git...</PanelStateMessage>}>
              <GitPanel
                hostThreadId={props.threadId}
                projectId={props.projectId}
                onClose={() => closePane(props.threadId, pane.id)}
              />
            </Suspense>
          );
        case "explorer":
          return (
            <Suspense fallback={<PanelStateMessage>Loading explorer...</PanelStateMessage>}>
              <DockExplorerPane
                workspaceRoot={props.workspaceRoot}
                onReferenceInChat={(reference) => appendChatFileReference(props.threadId, reference)}
                onAskWhyInChat={(reference) =>
                  appendComposerPromptText(props.threadId, buildWhyLinesPrompt(reference))
                }
                onCommentInChat={(comment) => addChatFileComment(props.threadId, comment)}
              />
            </Suspense>
          );
        case "file":
          return (
            <Suspense fallback={<PanelStateMessage>Loading file...</PanelStateMessage>}>
              <DockFilePane
                workspaceRoot={props.workspaceRoot}
                filePath={pane.filePath}
                onReferenceInChat={(reference) => appendChatFileReference(props.threadId, reference)}
                onAskWhyInChat={(reference) =>
                  appendComposerPromptText(props.threadId, buildWhyLinesPrompt(reference))
                }
                onCommentInChat={(comment) => addChatFileComment(props.threadId, comment)}
              />
            </Suspense>
          );
        case "sidechat":
          if (!pane.threadId) return <RightDockPanePlaceholder kind="sidechat" />;
          if (context.runtimeMode === "preview") return null;
          return (
            <ChatView
              key={dockSidechatPaneScopeId(pane.id)}
              threadId={pane.threadId}
              paneScopeId={dockSidechatPaneScopeId(pane.id)}
              surfaceMode="split"
              isFocusedPane={false}
              panelState={DOCK_EMBEDDED_PANEL_STATE}
              onToggleDiffPanel={noop}
              onToggleBrowserPanel={noop}
              onOpenBrowserUrl={noop}
              onOpenTurnDiffPanel={noop}
              onCloseThreadPane={() => closePane(props.threadId, pane.id)}
            />
          );
        default:
          return <RightDockPanePlaceholder kind={pane.kind} />;
      }
    },
    [
      closePane,
      dockState.open,
      props.projectId,
      props.threadId,
      props.workspaceRoot,
      requestActivePaneLive,
      setActivePane,
      updatePane,
    ],
  );

  return (
    <RightDock
      state={dockState}
      minWidth={DOCK_MIN_WIDTH}
      defaultWidth={DOCK_DEFAULT_WIDTH}
      shouldAcceptWidth={shouldAcceptDockWidth}
      addMenuKinds={RIGHT_DOCK_ADD_MENU_KINDS}
      motionKey={props.threadId}
      activePaneRuntimeMode={activePaneRuntimeMode}
      {...(paneLabelOverrides ? { paneLabelOverrides } : {})}
      {...(paneIconOverrides ? { paneIconOverrides } : {})}
      onSelectPane={handleSelectPane}
      onClosePane={(paneId) => closePane(props.threadId, paneId)}
      onCollapse={() => setDockOpen(props.threadId, false)}
      onOpenChange={(open) => setDockOpen(props.threadId, open)}
      onAddPane={handleAddPane}
      renderPane={renderPane}
    />
  );
}
