/**
 * Background service worker.
 *
 * Three jobs:
 *   1. Make a toolbar click open the side panel.
 *   2. Run the link checker, which needs this context because only an extension
 *      can read a cross-origin status code (CORS would block the page).
 *   3. Hold the side panel's port open so the worker is not evicted mid-run.
 */
import { LINK_CHECK_MAX_URLS } from "../shared/config";
import type { PanelToWorkerMessage, WorkerToPanelMessage } from "../shared/types";
import { runLinkCheck } from "./linkChecker";

// --- 1. One-click side panel ------------------------------------------------

/**
 * `setPanelBehavior` is the reliable way to get one-click opening.
 * `chrome.sidePanel.open()` needs a transient user-gesture token that MV3 can
 * invalidate, which makes it fail intermittently.
 */
function enableActionOpensPanel() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("[qa] setPanelBehavior failed", error));
}

chrome.runtime.onInstalled.addListener(enableActionOpensPanel);
chrome.runtime.onStartup.addListener(enableActionOpensPanel);

// Also run at top level: the worker can be revived by any event, the call is
// idempotent, and it closes the gap where the user clicks the icon before
// onStartup has fired.
enableActionOpensPanel();

// --- 2 + 3. Port, and the link check ----------------------------------------

/**
 * MV3 service workers are killed after ~30s of inactivity, and a link check on
 * a page with hundreds of links easily outlives that. The side panel's port
 * resets the idle timer, so it stays open for the whole session and doubles as
 * the transport for progress.
 */
const panelPorts = new Set<chrome.runtime.Port>();

/** The run currently in flight, so a new one can cancel the old one. */
let activeRun: AbortController | null = null;

function cancelActiveRun(reason: string): void {
  if (!activeRun) return;
  activeRun.abort();
  activeRun = null;
  for (const port of panelPorts) {
    port.postMessage({ type: "CHECK_ABORTED", reason } satisfies WorkerToPanelMessage);
  }
}

/**
 * When the last panel closes, every tab must drop its highlights and any check
 * in flight must stop.
 *
 * Driven from the background rather than a `beforeunload` handler in the panel,
 * because extension pages do not reliably fire unload handlers when the user
 * simply closes the panel.
 */
function broadcastPanelClosed(): void {
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      // Tabs without our content script reject; that is the normal case.
      void chrome.tabs.sendMessage(tab.id, { type: "PANEL_CLOSED" }).catch(() => {});
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "qa-panel") return;
  panelPorts.add(port);

  port.onMessage.addListener((message: PanelToWorkerMessage) => {
    if (message.type !== "CHECK_LINKS") return;

    // A rescan supersedes whatever was running.
    cancelActiveRun("superseded by a new scan");

    const controller = new AbortController();
    activeRun = controller;

    const skipped = Math.max(0, new Set(message.urls).size - LINK_CHECK_MAX_URLS);

    void runLinkCheck(message.urls, controller.signal, {
      onStarted: (total) => {
        port.postMessage({
          type: "CHECK_STARTED",
          total,
          skipped,
        } satisfies WorkerToPanelMessage);
      },
      onResult: (url, check) => {
        port.postMessage({ type: "CHECK_RESULT", url, check } satisfies WorkerToPanelMessage);
      },
      onProgress: (checked, total) => {
        port.postMessage({ type: "CHECK_PROGRESS", checked, total } satisfies WorkerToPanelMessage);
      },
    })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("[qa] link check failed", error);
        }
      })
      .finally(() => {
        if (activeRun === controller) activeRun = null;
      });
  });

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    if (panelPorts.size === 0) {
      cancelActiveRun("the side panel was closed");
      broadcastPanelClosed();
    }
  });

  console.debug("[qa] side panel connected");
});
