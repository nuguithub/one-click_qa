/**
 * Scanner for the <head> metadata: title, description, keywords, canonical and
 * robots. None of these produce on-page highlights - they live in <head> and
 * have nothing to point at on the page - so this module only returns data.
 */
import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN } from "../shared/config";
import type { DescriptionStatus, MetaScan } from "../shared/types";
import { elementText } from "./headings";

/**
 * Normalises two strings before comparing them: trimmed, whitespace-collapsed
 * and lower-cased, so "Home  Page" and "home page" count as a match.
 */
function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * `name=` is matched case-insensitively because authors write
 * `<meta NAME="Description">` as often as not. The `i` flag handles that, and
 * `~=` handles `rel="canonical nofollow"` style token lists.
 */
function metaContents(selector: string): string[] {
  return Array.from(document.querySelectorAll<HTMLMetaElement>(selector)).map((meta) =>
    (meta.content ?? "").trim(),
  );
}

function descriptionStatus(count: number, present: boolean): DescriptionStatus {
  if (!present) return "missing";
  if (count === 0) return "empty";
  if (count < META_DESCRIPTION_MIN) return "short";
  if (count > META_DESCRIPTION_MAX) return "long";
  return "ok";
}

/** Ignores the hash and a trailing slash so /page and /page/ compare equal. */
function canonicalComparable(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function scanMeta(): MetaScan {
  // --- title vs H1 ---------------------------------------------------------
  const rawTitle = (document.title ?? "").trim();
  const title = rawTitle === "" ? null : rawTitle;
  const h1Texts = Array.from(document.querySelectorAll("h1")).map(elementText).filter(Boolean);

  let matches: boolean | null = null;
  let note: string | null = null;

  if (title === null) {
    note = "No title found.";
  } else if (h1Texts.length === 0) {
    note = "No H1 found.";
  } else {
    matches = normalise(title) === normalise(h1Texts[0]);
    if (h1Texts.length > 1) {
      note = `Page has ${h1Texts.length} H1s; compared against the first one.`;
    }
  }

  // --- description ---------------------------------------------------------
  const descriptionValues = metaContents('meta[name="description" i]');
  const descriptionText = descriptionValues[0] ?? "";
  const charCount = descriptionText.replace(/\s+/g, " ").trim().length;

  // --- keywords ------------------------------------------------------------
  const keywordsValues = metaContents('meta[name="keywords" i]');

  // --- canonical -----------------------------------------------------------
  const canonicalLinks = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="canonical" i]'),
  );
  const canonicalHref = canonicalLinks[0]?.getAttribute("href")?.trim() ?? "";
  let resolved: string | null = null;
  if (canonicalHref !== "") {
    try {
      resolved = new URL(canonicalHref, location.href).href;
    } catch {
      resolved = canonicalHref;
    }
  }

  // --- robots --------------------------------------------------------------
  const robotsContent = metaContents('meta[name="robots" i]')[0] ?? "";
  const robotsTokens = robotsContent.toLowerCase().split(/[\s,]+/);

  return {
    titleVsH1: { title, h1Texts, matches, note },
    description: {
      values: descriptionValues,
      charCount,
      status: descriptionStatus(charCount, descriptionValues.length > 0),
      duplicated: descriptionValues.length > 1,
    },
    keywords: {
      values: keywordsValues,
      duplicated: keywordsValues.length > 1,
    },
    canonical: {
      href: canonicalHref === "" ? null : canonicalHref,
      resolved,
      matchesCurrent:
        resolved === null ? null : canonicalComparable(resolved) === canonicalComparable(location.href),
      duplicated: canonicalLinks.length > 1,
    },
    robots: {
      content: robotsContent === "" ? null : robotsContent,
      noindex: robotsTokens.includes("noindex"),
      nofollow: robotsTokens.includes("nofollow"),
    },
  };
}
