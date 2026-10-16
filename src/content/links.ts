/**
 * Link scanner, part 1: everything that can be learned from the DOM alone.
 *
 * Colour rules from the plan:
 *   green  - opens in the same tab
 *   yellow - opens in a new tab (target="_blank")
 *   red    - broken (filled in by part 2, once the worker has a status code)
 *   grey   - nothing to check (mailto:, tel:, a bare "#", ...)
 */
import {
  GENERIC_ANCHOR_TEXT,
  UNCHECKABLE_PROTOCOLS,
  destinationLabel,
  isPlaceholderHref,
  linkColor,
} from "../shared/config";
import type { LinkItem, LinkScan, LinkTarget } from "../shared/types";
import type { HighlightSpec } from "./highlight";

export interface LinkScanResult {
  data: LinkScan;
  specs: HighlightSpec[];
}

/** Lower-cased, punctuation-stripped form used to spot filler anchor text. */
function normaliseAnchorText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/, "")
    .trim();
}

const GENERIC_TEXTS = new Set<string>(GENERIC_ANCHOR_TEXT);

/**
 * The text a screen reader would announce for the link, if any.
 *
 * The plan's rule: an anchor counts as "empty" only when it has no text, no
 * aria-label and no image alt inside it.
 */
function accessibleText(anchor: HTMLAnchorElement): { text: string; label: string } {
  const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text !== "") return { text, label: text };

  const ariaLabel = (anchor.getAttribute("aria-label") ?? "").trim();
  if (ariaLabel !== "") return { text: "", label: ariaLabel };

  // An image with alt text inside the anchor gives it an accessible name.
  const imageAlt = Array.from(anchor.querySelectorAll("img[alt]"))
    .map((image) => (image.getAttribute("alt") ?? "").trim())
    .find((alt) => alt !== "");
  if (imageAlt) return { text: "", label: imageAlt };

  return { text: "", label: "" };
}

interface HrefInfo {
  resolved: string;
  protocol: string;
  checkable: boolean;
}

function inspectHref(href: string): HrefInfo {
  const raw = href.trim();

  // A bare fragment points at the current page, so there is nothing to check.
  if (raw === "" || raw.startsWith("#")) {
    return { resolved: raw, protocol: "", checkable: false };
  }

  const uncheckable = UNCHECKABLE_PROTOCOLS.some((scheme) => raw.toLowerCase().startsWith(scheme));
  if (uncheckable) {
    const scheme = raw.slice(0, raw.indexOf(":") + 1).toLowerCase();
    return { resolved: raw, protocol: scheme, checkable: false };
  }

  try {
    // Resolves relative, protocol-relative and absolute URLs alike.
    const url = new URL(raw, location.href);
    const checkable = url.protocol === "http:" || url.protocol === "https:";
    return { resolved: url.href, protocol: url.protocol, checkable };
  } catch {
    return { resolved: raw, protocol: "", checkable: false };
  }
}

export function scanLinks(idFor: (element: Element) => string): LinkScanResult {
  // Only anchors that actually declare an href; a bare <a> is a placeholder.
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));

  const items: LinkItem[] = [];
  const specs: HighlightSpec[] = [];
  const checkableUrls = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") ?? "";
    const { text, label } = accessibleText(anchor);
    const { resolved, protocol, checkable } = inspectHref(href);

    const target: LinkTarget =
      (anchor.getAttribute("target") ?? "").trim().toLowerCase() === "_blank"
        ? "new-tab"
        : "same-tab";

    const rel = anchor.getAttribute("rel") ?? "";
    const relTokens = rel.toLowerCase().split(/\s+/);
    const nofollow = relTokens.includes("nofollow");

    const issues: LinkItem["issues"] = [];
    if (label === "") issues.push("empty-text");
    else if (GENERIC_TEXTS.has(normaliseAnchorText(label))) issues.push("generic-text");
    if (isPlaceholderHref(href)) issues.push("placeholder-href");
    if (nofollow) issues.push("nofollow");

    // A real destination, so the network pass is worth running.
    if (checkable && !isPlaceholderHref(href)) checkableUrls.add(resolved);

    const id = idFor(anchor);
    items.push({
      id,
      text,
      label,
      href,
      resolved,
      protocol,
      target,
      rel,
      checkable,
      issues,
      check: null,
    });

    specs.push({
      id,
      element: anchor,
      color: linkColor(target, checkable, null),
      // Hovering the link on the page shows where it goes.
      tooltip: destinationLabel(resolved, href),
    });
  }

  return {
    data: { items, uniqueCheckableUrls: checkableUrls.size },
    specs,
  };
}
