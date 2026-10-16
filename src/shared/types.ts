/**
 * Shared types and the message protocol.
 *
 * Three contexts talk to each other:
 *
 *   side panel  --chrome.tabs.sendMessage-->  content script
 *   side panel  --chrome.runtime.connect-->  background worker
 *   content     --(result reply)------------>  side panel
 *
 * Everything crossing a context boundary is defined here so both sides are
 * type-checked against the same declarations.
 */
import type { HighlightLayer } from "./config";

export type { HighlightLayer };

/** Messages the side panel sends to the content script. */
export type PanelToContentMessage =
  | { type: "PING" }
  | { type: "RUN_SCAN" }
  | { type: "SET_LAYER"; layer: HighlightLayer; visible: boolean }
  | { type: "SCROLL_TO"; id: string }
  | { type: "CLEAR_HIGHLIGHTS" }
  | { type: "APPLY_LINK_CHECKS"; checks: Record<string, LinkCheck> };

/** Side panel -> background worker, over the long-lived port. */
export type PanelToWorkerMessage = {
  /** Starts a run. Any run already in flight is aborted first. */
  type: "CHECK_LINKS";
  /** Unique http(s) URLs. The worker dedupes and caps them again. */
  urls: string[];
};

/** Background worker -> side panel, over the same port. */
export type WorkerToPanelMessage =
  /** One URL finished. May arrive up to CONCURRENCY times in a row. */
  | { type: "CHECK_RESULT"; url: string; check: LinkCheck }
  /** Throttled counter, so the panel can show "Checked 34 / 120". */
  | { type: "CHECK_PROGRESS"; checked: number; total: number }
  | { type: "CHECK_STARTED"; total: number; skipped: number }
  | { type: "CHECK_ABORTED"; reason: string };

/** Broadcast by the background worker when the last side panel closes. */
export interface PanelClosedMessage {
  type: "PANEL_CLOSED";
}

/** Everything the content script can answer with. */
export interface Handshake {
  /** location.href of the scanned page, read from the page itself. */
  url: string;
  documentTitle: string;
}

/**
 * Result of one scan. `sections` is a discriminated map so each feature can
 * grow its own payload without touching the envelope.
 */
export interface ScanResult {
  url: string;
  scannedAt: number;
  durationMs: number;
  headings: HeadingsScan;
  meta: MetaScan;
  images: ImageScan;
  links: LinkScan;
}

export type ContentReply =
  | { ok: true; kind: "handshake"; handshake: Handshake }
  | { ok: true; kind: "scan"; result: ScanResult }
  | { ok: false; kind: "error"; error: string };

// --- Headings --------------------------------------------------------------

export type HeadingIssue = "empty" | "skipped-level";

export interface HeadingItem {
  /** Stable for the lifetime of one scan; used for scroll-to. */
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** e.g. "skipped-level" when an H4 directly follows an H2. */
  issues: HeadingIssue[];
}

export interface HeadingsScan {
  items: HeadingItem[];
  /** Page-level problems, counted separately from per-heading issues. */
  missingH1: boolean;
  h1Count: number;
}

// --- Title vs H1 -----------------------------------------------------------

export interface TitleVsH1 {
  title: string | null;
  h1Texts: string[];
  /** null when either side is missing and no comparison is possible. */
  matches: boolean | null;
  note: string | null;
}

// --- Meta tags -------------------------------------------------------------

export type DescriptionStatus = "missing" | "empty" | "ok" | "short" | "long";

export interface DescriptionScan {
  /** All <meta name="description"> contents, in document order. */
  values: string[];
  charCount: number;
  status: DescriptionStatus;
  /** True when more than one description tag exists. */
  duplicated: boolean;
}

export interface KeywordsScan {
  values: string[];
  duplicated: boolean;
}

export interface CanonicalScan {
  href: string | null;
  /** href resolved against the page URL. */
  resolved: string | null;
  /** null when there is no canonical tag. */
  matchesCurrent: boolean | null;
  duplicated: boolean;
}

export interface RobotsScan {
  content: string | null;
  noindex: boolean;
  nofollow: boolean;
}

export interface MetaScan {
  titleVsH1: TitleVsH1;
  description: DescriptionScan;
  keywords: KeywordsScan;
  canonical: CanonicalScan;
  robots: RobotsScan;
}

// --- Images ----------------------------------------------------------------

export type ImageIssue = "missing-alt" | "empty-alt" | "alt-too-long";

export interface ImageItem {
  id: string;
  /** Raw src attribute, may be relative. */
  src: string;
  /**
   * Absolute URL to load a thumbnail with. Uses `currentSrc` when present so
   * that `<picture>`/srcset picks the source the browser actually chose.
   */
  absoluteSrc: string;
  /** null means the alt attribute is absent entirely. */
  alt: string | null;
  insidePicture: boolean;
  issues: ImageIssue[];
}

export interface ImageScan {
  items: ImageItem[];
  missingAltCount: number;
  emptyAltCount: number;
}

// --- Links -----------------------------------------------------------------

export type LinkIssue =
  /** No text, no aria-label and no image alt inside the anchor. */
  | "empty-text"
  /** Anchor text such as "click here" that says nothing out of context. */
  | "generic-text"
  /** `href="#"`, `href=""` or `javascript:void(0)`. */
  | "placeholder-href"
  /** The element already carries rel="nofollow". Not a bug, just worth seeing. */
  | "nofollow";

export type LinkTarget = "same-tab" | "new-tab";

/**
 * Result of a network check.
 *
 * `unchecked` and `skipped` are the pre-answer states, so the panel can show
 * them as neutral grey rather than as good or bad. Per the plan a timeout and a
 * network error are both *broken* (red) - the reason is carried in `error`, so
 * the panel can say which it was.
 */
export type LinkStatus = "unchecked" | "skipped" | "ok" | "broken";

export interface LinkCheck {
  status: LinkStatus;
  statusCode: number | null;
  /** Where the request ended up, when it was redirected. */
  finalUrl: string | null;
  /** The redirect status code, e.g. 301. */
  redirectStatus: number | null;
  redirected: boolean;
  /** "timeout" or "network error" for failures that never produced a status. */
  error: string | null;
  durationMs: number;
}

export interface LinkItem {
  id: string;
  /** Raw text content, untrimmed of nothing - kept for the empty-text check. */
  text: string;
  /** What to show in the panel when there is no text. */
  label: string;
  /** Raw href attribute. */
  href: string;
  /** Absolute URL, for display and for checking. */
  resolved: string;
  /** e.g. "https:", "mailto:", "tel:" or "" for a bare fragment. */
  protocol: string;
  target: LinkTarget;
  rel: string;
  /** Only http(s) URLs are worth a network round trip. */
  checkable: boolean;
  issues: LinkIssue[];
  /** null until the background worker has checked it. */
  check: LinkCheck | null;
}

export interface LinkScan {
  items: LinkItem[];
  /** Unique http(s) URLs, i.e. the denominator for the progress indicator. */
  uniqueCheckableUrls: number;
}
