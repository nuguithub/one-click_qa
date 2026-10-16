/**
 * Owns the link-check run from the panel's side.
 *
 * The worker does the network work; this hook only collects unique URLs, feeds
 * them to the worker, and throttles the incoming results into React state.
 *
 * Throttling matters: a page with 250 links produces 250 results. Committing
 * each one separately would re-render the whole list 250 times. Results are
 * buffered and flushed on a short interval instead, which keeps the counter
 * visibly moving while React does maybe one render every 150 ms.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LINK_CHECK_MAX_URLS } from "../../shared/config";
import type { LinkCheck, WorkerToPanelMessage } from "../../shared/types";

const FLUSH_INTERVAL_MS = 150;

export interface LinkCheckState {
  /** URL -> check, for the current run. */
  checks: Map<string, LinkCheck>;
  checked: number;
  total: number;
  /** True between CHECK_STARTED and the last CHECK_PROGRESS. */
  running: boolean;
  /** Set when the worker had to stop early. */
  aborted: string | null;
  /** How many URLs were dropped by the cap. */
  skipped: number;
}

const EMPTY: LinkCheckState = {
  checks: new Map(),
  checked: 0,
  total: 0,
  running: false,
  aborted: null,
  skipped: 0,
};

export function useLinkChecker(port: chrome.runtime.Port | null) {
  const [state, setState] = useState<LinkCheckState>(EMPTY);

  /** Buffered results, flushed on an interval. */
  const bufferRef = useRef(new Map<string, LinkCheck>());
  const flushTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (bufferRef.current.size === 0) return;
    const incoming = bufferRef.current;
    bufferRef.current = new Map();
    setState((current) => {
      const checks = new Map(current.checks);
      for (const [url, check] of incoming) checks.set(url, check);
      return { ...current, checks };
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  useEffect(() => {
    if (!port) return;

    const onMessage = (message: WorkerToPanelMessage) => {
      switch (message.type) {
        case "CHECK_STARTED":
          setState({
            checks: new Map(),
            checked: 0,
            total: message.total,
            running: message.total > 0,
            aborted: null,
            skipped: message.skipped,
          });
          break;

        case "CHECK_RESULT":
          bufferRef.current.set(message.url, message.check);
          scheduleFlush();
          break;

        case "CHECK_PROGRESS":
          setState((current) => ({
            ...current,
            checked: message.checked,
            total: message.total,
            running: message.checked < message.total,
          }));
          break;

        case "CHECK_ABORTED":
          flush();
          setState((current) => ({ ...current, running: false, aborted: message.reason }));
          break;
      }
    };

    port.onMessage.addListener(onMessage);
    return () => {
      port.onMessage.removeListener(onMessage);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    };
  }, [port, flush, scheduleFlush]);

  /**
   * Starts a run. Called automatically after every scan, per the chosen
   * behaviour: one click means one full report.
   */
  const start = useCallback(
    (urls: string[]) => {
      if (!port) return;
      bufferRef.current = new Map();
      port.postMessage({ type: "CHECK_LINKS", urls });
      setState({
        checks: new Map(),
        checked: 0,
        total: 0,
        running: true,
        aborted: null,
        skipped: 0,
      });
    },
    [port],
  );

  return { state, start, cap: LINK_CHECK_MAX_URLS };
}
