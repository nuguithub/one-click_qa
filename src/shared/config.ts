/**
 * Central tuning knobs for the whole extension.
 *
 * Everything that a QA person might reasonably want to change lives here:
 * thresholds, colours, and the link-checker's network budget. No other file
 * should hard-code a magic number.
 */

/** Highlight layers that can be toggled from the side panel. */
export type HighlightLayer = "headings" | "links" | "images";

export const ALL_LAYERS: readonly HighlightLayer[] = ["headings", "links", "images"];

export const DEFAULT_LAYER_VISIBILITY: Record<HighlightLayer, boolean> = {
  headings: true,
  links: true,
  images: true,
};

/** Persisted in chrome.storage.local under this key. */
export const STORAGE_KEY = "qaSettings";

export interface QaSettings {
  layers: Record<HighlightLayer, boolean>;
}

// --- Meta description ------------------------------------------------------

/**
 * Google truncates descriptions around 120-160 characters. Outside that range
 * we warn; a missing or empty tag is an error.
 */
export const META_DESCRIPTION_MIN = 120;
export const META_DESCRIPTION_MAX = 160;

// --- Images ----------------------------------------------------------------

/** Long alt text is treated as stuffing and ignored by screen readers. */
export const ALT_MAX_LENGTH = 125;

// --- Links: wording issues -------------------------------------------------

/** Anchor text that tells a user nothing. Compared case-insensitively. */
export const GENERIC_ANCHOR_TEXT = [
  "click here",
  "here",
  "read more",
  "learn more",
  "more",
  "this",
  "link",
  "this page",
  "continue",
  "details",
  "download",
  "click",
] as const;

/** `href` values that are never real destinations. */
export function isPlaceholderHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  if (value === "" || value === "#") return true;
  // javascript:void(0), with or without a trailing semicolon or spacing.
  return /^javascript:\s*void\(\s*0\s*\)\s*;?$/.test(value);
}

/**
 * Human-readable destination shown in the on-page hover tooltip.
 *
 * The site root reads as "Home"; everything else as its path, e.g. "/about-us"
 * or "/location/angeles". Non-http schemes (mailto:, tel:) and bare fragments
 * are shown as they are, because there is no path to shorten.
 */
export function destinationLabel(resolved: string, href: string): string {
  const raw = (resolved || href).trim();
  if (raw === "") return "(empty href)";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;

  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  return path === "/" ? "Home" : path + url.search + url.hash;
}

/** Schemes we list but never send to the network. */
export const UNCHECKABLE_PROTOCOLS = ["mailto:", "tel:", "sms:", "data:", "javascript:"];

// --- Links: network checks -------------------------------------------------

/** Hard cap on unique URLs checked per scan. Keeps a link-heavy page polite. */
export const LINK_CHECK_MAX_URLS = 250;

/** Simultaneous in-flight requests in the background worker. */
export const LINK_CHECK_CONCURRENCY = 6;

/** Per-request abort timeout. */
export const LINK_CHECK_TIMEOUT_MS = 10_000;

/** Status codes that mean the link is broken. */
export const BROKEN_STATUS_MIN = 400;

/** Status codes that mean the link redirected. */
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// --- Colours ---------------------------------------------------------------

/**
 * Highlight colours. Used for the on-page outlines/badges AND mirrored in the
 * side panel so the two always agree.
 *
 * Index 0 = H1 ... index 5 = H6.
 */
export const HEADING_COLORS = [
  "#ef4444", // red    - H1
  "#f97316", // orange - H2
  "#eab308", // yellow - H3
  "#22c55e", // green  - H4
  "#3b82f6", // blue   - H5
  "#a855f7", // purple - H6
] as const;

export const LINK_COLORS = {
  /** Opens in the same tab. */
  sameTab: "#22c55e",
  /** Opens in a new tab (target="_blank"). */
  newTab: "#eab308",
  /** HTTP 4xx/5xx, timeout, or network error. */
  broken: "#ef4444",
  /** Queued for checking, result not known yet. */
  unchecked: "#9ca3af",
} as const;

export const IMAGE_COLORS = {
  ok: "#22c55e",
  emptyAlt: "#eab308",
  missingAlt: "#ef4444",
} as const;

/**
 * Single source of truth for link colour, used by both the on-page outline and
 * the dot in the side panel so the two can never disagree.
 *
 * Broken wins over everything, then "not checkable" (grey), then the target.
 */
export function linkColor(
  target: "same-tab" | "new-tab",
  checkable: boolean,
  status: "unchecked" | "skipped" | "ok" | "broken" | null,
): string {
  if (status === "broken") return LINK_COLORS.broken;
  if (!checkable) return LINK_COLORS.unchecked;
  return target === "new-tab" ? LINK_COLORS.newTab : LINK_COLORS.sameTab;
}
