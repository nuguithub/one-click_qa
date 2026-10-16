/**
 * Heading structure scanner.
 *
 * Two jobs: produce the data the side panel renders, and produce the highlight
 * specs (element + colour + badge label) for the on-page layer.
 */
import { HEADING_COLORS } from "../shared/config";
import type { HeadingsScan, HeadingItem } from "../shared/types";
import type { HighlightSpec } from "./highlight";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** Visible text of an element, with collapsed whitespace and trimmed. */
export function elementText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface HeadingsScanResult {
  data: HeadingsScan;
  specs: HighlightSpec[];
}

export function scanHeadings(idFor: (element: Element) => string): HeadingsScanResult {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(HEADING_SELECTOR));

  const items: HeadingItem[] = [];
  const specs: HighlightSpec[] = [];
  let previousLevel: number | null = null;

  for (const element of elements) {
    const level = Number(element.tagName.slice(1));
    const text = elementText(element);
    const issues: HeadingItem["issues"] = [];

    if (text === "") issues.push("empty");
    // A jump of more than one level breaks the document outline, e.g. H2 -> H4.
    if (previousLevel !== null && level > previousLevel + 1) issues.push("skipped-level");
    previousLevel = level;

    const id = idFor(element);
    items.push({ id, level: level as HeadingItem["level"], text, issues });
    specs.push({
      id,
      element,
      color: HEADING_COLORS[level - 1],
      label: `H${level}`,
    });
  }

  const h1Count = items.filter((item) => item.level === 1).length;

  return {
    data: { items, missingH1: h1Count === 0, h1Count },
    specs,
  };
}
