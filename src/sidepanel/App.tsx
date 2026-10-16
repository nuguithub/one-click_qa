/**
 * Side panel React app.
 *
 * Owns five pieces of state:
 *   - the active tab (so we know where to send messages)
 *   - the latest scan result
 *   - which highlight layers are visible (persisted)
 *   - the long-lived port to the background worker
 *   - link check results, which arrive asynchronously
 *
 * The panel never touches the page itself; everything goes through a message.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeadingTree, countHeadingIssues } from "./components/HeadingTree";
import { ImageList, countImageIssues } from "./components/ImageList";
import { LinkList, countLinkIssues } from "./components/LinkList";
import {
  CanonicalAndRobots,
  MetaDescription,
  MetaKeywords,
  TitleVsH1,
  countCanonicalIssues,
  countDescriptionIssues,
  countKeywordsIssues,
  countTitleIssues,
} from "./components/MetaSections";
import { Section } from "./components/Section";
import { useLayerVisibility } from "./hooks/useLayerVisibility";
import { useLinkChecker } from "./hooks/useLinkChecker";
import type { HighlightLayer } from "../shared/config";
import type {
  ContentReply,
  LinkCheck,
  LinkItem,
  PanelToContentMessage,
  ScanResult,
} from "../shared/types";

type Status = "scanning" | "ready" | "error" | "stale";

/**
 * Resolves the tab the panel belongs to.
 *
 * `currentWindow` is correct for a side panel because panels are per-window;
 * `lastFocusedWindow` covers the moment before the browser settles the
 * association.
 */
async function findActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) return tab.id;
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback?.id;
}

function sendToTab(tabId: number, message: PanelToContentMessage): Promise<ContentReply> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<ContentReply>;
}

export default function App() {
  const [status, setStatus] = useState<Status>("scanning");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  /**
   * Bumped on every completed scan. The auto-start effect below keys on this
   * rather than on the URL list, because rescanning an unchanged page produces
   * an identical URL list and the check would silently never re-run.
   */
  const [scanId, setScanId] = useState(0);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const tabIdRef = useRef<number | undefined>(undefined);
  /** URL the current report belongs to, so we can spot a navigation. */
  const scannedUrlRef = useRef<string | undefined>(undefined);
  /** Set when the report was dropped because the tab moved to a new page. */
  const [staleUrl, setStaleUrl] = useState<string | null>(null);
  const { layers, toggle } = useLayerVisibility();
  const { state: linkChecks, start: startLinkCheck } = useLinkChecker(port);

  /**
   * This port does two jobs: it keeps the MV3 service worker alive during long
   * link checks, and its final disconnect is the background's signal to clear
   * every page's highlights.
   */
  useEffect(() => {
    const next = chrome.runtime.connect({ name: "qa-panel" });
    setPort(next);
    return () => next.disconnect();
  }, []);

  const toContent = useCallback(async (message: PanelToContentMessage) => {
    const tabId = tabIdRef.current ?? (await findActiveTabId());
    tabIdRef.current = tabId;
    if (tabId === undefined) throw new Error("Could not find the active tab.");
    return sendToTab(tabId, message);
  }, []);

  const scan = useCallback(async () => {
    setStatus("scanning");
    setError(null);
    setStaleUrl(null);
    try {
      const reply = await toContent({ type: "RUN_SCAN" });
      if (!reply.ok || reply.kind !== "scan") throw new Error("The page did not return a scan result.");
      setResult(reply.result);
      scannedUrlRef.current = reply.result.url;
      setScanId((value) => value + 1);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [toContent]);

  // Opening the panel *is* the user's one click, so scan immediately.
  useEffect(() => {
    void scan();
  }, [scan]);

  /**
   * The user can switch tabs while the panel stays open. The cached tab id has
   * to be dropped first, or the rescan would be sent to the tab we were just
   * on.
   */
  useEffect(() => {
    const onActivated = ({ tabId }: chrome.tabs.OnActivatedInfo) => {
      tabIdRef.current = tabId;
      scannedUrlRef.current = undefined;
      void scan();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, [scan]);

  /**
   * A navigation in the tab invalidates the report. We drop it and ask for a
   * Rescan rather than re-scanning automatically, because an automatic scan
   * would fire up to 250 HTTP requests on every page you happen to visit while
   * the panel is open.
   */
  useEffect(() => {
    const onUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tabId !== tabIdRef.current) return;

      // Only a URL change matters; load-state and favicon updates do not.
      const newUrl = changeInfo.url ?? (changeInfo.status === "complete" ? tab.url : undefined);
      if (!newUrl || newUrl === scannedUrlRef.current) return;

      setResult(null);
      setStaleUrl(newUrl);
      setStatus("stale");
      // Highlights described the old document, so they go too.
      void toContent({ type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => chrome.tabs.onUpdated.removeListener(onUpdated);
  }, [toContent]);

  /** Unique http(s) URLs on the page, which is what the worker will check. */
  const checkableUrls = useMemo(() => {
    if (!result) return [];
    const urls = result.links.items
      .filter((item) => item.checkable && !item.issues.includes("placeholder-href"))
      .map((item) => item.resolved);
    return Array.from(new Set(urls));
  }, [result]);

  /**
   * Auto-check on every scan, as chosen.
   *
   * Keyed on scanId rather than on the URL list, so pressing Rescan on an
   * unchanged page still restarts the network check.
   */
  useEffect(() => {
    if (status !== "ready" || checkableUrls.length === 0) return;
    startLinkCheck(checkableUrls);
    // checkableUrls is derived from `result`; scanId changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, status, startLinkCheck]);

  /**
   * Push completed checks to the page so broken outlines turn red. Only the
   * results, not the counters - the page has no use for those.
   *
   * This fires whenever the result set changes, which the content script
   * throttles internally: it only repaints when a link's colour actually
   * changes, and a link only changes colour once.
   */
  const lastPushedRef = useRef(0);
  useEffect(() => {
    if (linkChecks.checks.size === 0 || linkChecks.checks.size === lastPushedRef.current) return;
    lastPushedRef.current = linkChecks.checks.size;

    // The map is rebuilt from a plain object for structured cloning over
    // chrome.runtime messaging.
    const payload: Record<string, LinkCheck> = {};
    for (const [url, check] of linkChecks.checks) payload[url] = check;
    void toContent({ type: "APPLY_LINK_CHECKS", checks: payload }).catch(() => {});
  }, [linkChecks.checks, toContent]);

  // The scan is re-run from scratch, so previous checks no longer apply.
  useEffect(() => {
    lastPushedRef.current = 0;
  }, [result]);

  const links = useMemo<LinkItem[] | null>(() => {
    if (!result) return null;
    return result.links.items.map((item) => ({
      ...item,
      check: linkChecks.checks.get(item.resolved) ?? null,
    }));
  }, [result, linkChecks.checks]);

  const onToggleLayer = useCallback(
    (layer: HighlightLayer) => (visible: boolean) => {
      toggle(layer, visible);
      void toContent({ type: "SET_LAYER", layer, visible }).catch(() => {});
    },
    [toggle, toContent],
  );

  const onSelect = useCallback(
    (id: string) => {
      void toContent({ type: "SCROLL_TO", id }).catch(() => {});
    },
    [toContent],
  );

  const url = result?.url ?? "";
  const linkScan = result && links ? { ...result.links, items: links } : null;

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="flex items-start justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">One-Click QA</h1>
            <p
              className="truncate text-xs text-neutral-500 dark:text-neutral-400"
              title={(staleUrl ?? url) || undefined}
            >
              {staleUrl ?? url ?? "No page detected"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={status === "scanning"}
            className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "scanning" ? "Scanning" : "Rescan"}
          </button>
        </div>

        {result && (
          <p className="border-t border-neutral-100 px-3 py-1 text-[10px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Scanned in {result.durationMs} ms &middot;{" "}
            {new Date(result.scannedAt).toLocaleTimeString()}
          </p>
        )}
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto p-2">
        {status === "stale" && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-semibold">The page changed</p>
            <p className="mt-1 break-all opacity-90">{staleUrl}</p>
            <p className="mt-2 text-[11px] opacity-80">
              The report below was for the previous page, so it has been cleared. Press Rescan to
              scan this page.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            <p className="font-semibold">Cannot scan this page</p>
            <p className="mt-1 break-words">{error}</p>
            <p className="mt-2 text-[11px] opacity-80">
              Only regular <code>http</code>/<code>https</code> pages can be scanned. Chrome
              internal pages, the Web Store and PDF viewers are excluded by the browser.
            </p>
          </div>
        )}

        {result && linkScan && (
          // `key` is derived from the scan, so a rescan resets the filter chips
          // and collapsed sections instead of leaving last page's view showing.
          <div key={result.scannedAt} className="space-y-2">
            <Section
              title="Headings"
              issueCount={countHeadingIssues(result.headings)}
              tone={result.headings.missingH1 || result.headings.h1Count > 1 ? "error" : "warn"}
              layer="headings"
              layerVisible={layers.headings}
              onToggleLayer={onToggleLayer("headings")}
            >
              <HeadingTree scan={result.headings} onSelect={onSelect} />
            </Section>

            <Section title="Title vs H1" issueCount={countTitleIssues(result.meta)} tone="error">
              <TitleVsH1 meta={result.meta} />
            </Section>

            <Section
              title="Meta Description"
              issueCount={countDescriptionIssues(result.meta)}
              tone={result.meta.description.status === "missing" ? "error" : "warn"}
            >
              <MetaDescription meta={result.meta} />
            </Section>

            <Section title="Meta Keywords" issueCount={countKeywordsIssues(result.meta)} tone="warn">
              <MetaKeywords meta={result.meta} />
            </Section>

            <Section
              title="Links"
              issueCount={countLinkIssues(linkScan)}
              tone="warn"
              layer="links"
              layerVisible={layers.links}
              onToggleLayer={onToggleLayer("links")}
            >
              <LinkProgress
                checked={linkChecks.checked}
                total={linkChecks.total}
                running={linkChecks.running}
                skipped={linkChecks.skipped}
                aborted={linkChecks.aborted}
              />
              <LinkList scan={linkScan} onSelect={onSelect} />
            </Section>

            <Section
              title="Images"
              issueCount={countImageIssues(result.images)}
              tone={result.images.missingAltCount > 0 ? "error" : "warn"}
              layer="images"
              layerVisible={layers.images}
              onToggleLayer={onToggleLayer("images")}
            >
              <ImageList scan={result.images} onSelect={onSelect} />
            </Section>

            <Section
              title="Canonical and Robots"
              issueCount={countCanonicalIssues(result.meta)}
              tone="error"
            >
              <CanonicalAndRobots meta={result.meta} pageUrl={url} />
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}

/** "Checked 34 / 120" with a progress bar, per the plan. */
function LinkProgress({
  checked,
  total,
  running,
  skipped,
  aborted,
}: {
  checked: number;
  total: number;
  running: boolean;
  skipped: number;
  aborted: string | null;
}) {
  if (total === 0 && !running) return null;

  const percent = total === 0 ? 0 : Math.round((checked / total) * 100);

  return (
    <div className="border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
      <div className="flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400">
        <span>
          {running ? "Checking" : "Checked"} {checked} / {total}
        </span>
        {skipped > 0 && <span className="text-amber-600 dark:text-amber-400">capped, +{skipped} skipped</span>}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-full transition-[width] duration-150 ${running ? "bg-blue-500" : "bg-emerald-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {aborted && (
        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">Stopped: {aborted}</p>
      )}
    </div>
  );
}
