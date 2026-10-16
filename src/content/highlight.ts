/**
 * On-page highlight engine.
 *
 * Design constraints (from the plan):
 *   - outlines only, never `background`, so the page cannot shift
 *   - badges are small, absolutely positioned, `pointer-events: none`
 *   - injected UI lives in a Shadow DOM so page CSS cannot break it
 *   - everything must be removable when a toggle goes off or the panel closes
 *
 * How it works:
 *   1. One overlay host is appended to <html>. It holds a shadow root with the
 *      badge stylesheet, so no page stylesheet can reach our markup.
 *   2. Badges are placed in *document* coordinates (rect + scroll offset).
 *      Because those coordinates do not change while the user scrolls, badges
 *      never need repositioning during scroll - the single most important
 *      performance decision in this file.
 *   3. The outline has to be drawn on the page element itself, so we set three
 *      inline properties and remember exactly what was there before. Turning a
 *      layer off restores the original values byte for byte.
 */
import type { HighlightLayer } from "../shared/config";
import { ALL_LAYERS, DEFAULT_LAYER_VISIBILITY } from "../shared/config";

export interface HighlightSpec {
  /** Stable id from the current scan; used by SCROLL_TO. */
  id: string;
  /** Page element to outline. */
  element: HTMLElement;
  color: string;
  /** Small label rendered above the element, e.g. "H2". */
  label?: string;
  /** Text for the on-page hover tooltip, e.g. "Home" or "/about-us". */
  tooltip?: string;
}

const OUTLINE_WIDTH = "2px";
const OUTLINE_OFFSET = "2px";
const FLASH_OFFSET = "5px";
const FLASH_MS = 1100;
const RESIZE_DEBOUNCE_MS = 150;
const FLASH_COLOR = "#f97316";

/** The three inline properties we borrow from the page. */
const OUTLINE_PROPS = ["outline", "outline-offset", "outline-style"] as const;

// --- module state ----------------------------------------------------------

let host: HTMLElement | null = null;
let badgeHost: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;

/** Specs per layer. Kept across toggles so a layer can be switched back on. */
const specsByLayer = new Map<HighlightLayer, HighlightSpec[]>();
/** id -> element for the current scan, so SCROLL_TO can find its target. */
const elementsById = new Map<string, HTMLElement>();
/** element -> its inline outline values from before we touched it. */
const savedOutlines = new WeakMap<HTMLElement, { prop: string; value: string }[]>();
/** element -> active outline colour, so the flash can build on top of it. */
const activeColor = new WeakMap<HTMLElement, string>();
/** Elements currently flashed, so a rescan can cancel the restore timers. */
const flashing = new Map<HTMLElement, number>();
/** Hovered anchor -> tooltip text, rebuilt by render() from visible layers. */
const tooltipByElement = new Map<HTMLElement, string>();
/** The anchor the tooltip is currently anchored to. */
let tooltipTarget: HTMLElement | null = null;

let visibility: Record<HighlightLayer, boolean> = { ...DEFAULT_LAYER_VISIBILITY };
let resizeTimer = 0;

// --- shadow DOM ------------------------------------------------------------

const BADGE_CSS = `
.badge {
  position: absolute;
  display: block;
  box-sizing: border-box;
  padding: 1px 4px;
  border-radius: 3px;
  font: 600 10px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  text-transform: uppercase;
}

.tooltip {
  position: absolute;
  display: none;
  box-sizing: border-box;
  max-width: 320px;
  padding: 3px 7px;
  border-radius: 4px;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #fff;
  background: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
`;

/**
 * Creates the overlay if needed and returns its shadow root.
 *
 * Host styles are set inline with `!important` so they win against every
 * stylesheet rule the page might have, including its own `!important` ones.
 */
function ensureHost(): ShadowRoot | null {
  if (host?.isConnected && host.shadowRoot) return host.shadowRoot;

  host = document.createElement("div");
  host.id = "qa-highlight-root";
  const hostStyles: Record<string, string> = {
    position: "absolute",
    top: "0px",
    left: "0px",
    // A zero-size anchor point; badges are children and may overflow it.
    width: "0px",
    height: "0px",
    overflow: "visible",
    margin: "0",
    padding: "0",
    border: "0",
    "pointer-events": "none",
    "z-index": "2147483647",
  };
  for (const [prop, value] of Object.entries(hostStyles)) {
    host.style.setProperty(prop, value, "important");
  }
  host.setAttribute("aria-hidden", "true");

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BADGE_CSS;
  shadow.append(style);

  badgeHost = document.createElement("div");
  shadow.append(badgeHost);

  tooltipEl = document.createElement("span");
  tooltipEl.className = "tooltip";
  shadow.append(tooltipEl);

  // <html> rather than <body>: single-page apps routinely replace <body>, which
  // would take our overlay and every badge with it.
  document.documentElement.append(host);

  // Capture phase, so a page handler that calls stopPropagation cannot hide the
  // tooltip from the QA person. Added once, with the host, and removed in
  // destroy().
  document.addEventListener("mouseover", onDocumentMouseOver, true);
  document.addEventListener("mouseout", onDocumentMouseOut, true);

  return shadow;
}

// --- link destination tooltip ----------------------------------------------

/**
 * Shows where the link under the cursor goes. Delegated from the document
 * rather than bound per anchor, because the page can add links at any time and
 * a spec-level listener would go stale.
 */
function onDocumentMouseOver(event: MouseEvent): void {
  if (tooltipByElement.size === 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  const anchor = target.closest("a");
  if (!anchor) return;

  const text = tooltipByElement.get(anchor as HTMLElement);
  if (text) showTooltip(anchor as HTMLElement, text);
  else hideTooltip();
}

function onDocumentMouseOut(event: MouseEvent): void {
  if (!tooltipTarget) return;
  // Moving between children of the same link is not leaving it.
  const related = event.relatedTarget as Node | null;
  if (related && tooltipTarget.contains(related)) return;
  hideTooltip();
}

function showTooltip(element: HTMLElement, text: string): void {
  if (!tooltipEl) return;
  tooltipTarget = element;
  tooltipEl.textContent = text;
  tooltipEl.style.display = "block";

  const rect = element.getBoundingClientRect();
  const width = tooltipEl.offsetWidth;
  const height = tooltipEl.offsetHeight;

  // Clamp horizontally so a long URL never spills off the right edge.
  const viewportRight = window.scrollX + document.documentElement.clientWidth;
  const left = Math.max(
    window.scrollX + 4,
    Math.min(rect.left + window.scrollX, viewportRight - width - 4),
  );

  // Above the link when there is room, otherwise just below it.
  const above = rect.top > height + 6;
  const top = above
    ? rect.top + window.scrollY - height - 4
    : rect.bottom + window.scrollY + 4;

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip(): void {
  tooltipTarget = null;
  if (tooltipEl) tooltipEl.style.display = "none";
}

// --- outlines --------------------------------------------------------------

function applyOutline(element: HTMLElement, color: string): void {
  if (!savedOutlines.has(element)) {
    savedOutlines.set(
      element,
      OUTLINE_PROPS.map((prop) => ({ prop, value: element.style.getPropertyValue(prop) })),
    );
  }
  element.style.setProperty("outline", `${OUTLINE_WIDTH} solid ${color}`, "important");
  element.style.setProperty("outline-offset", OUTLINE_OFFSET, "important");
  activeColor.set(element, color);
}

/**
 * Puts the element's outline back to exactly what it was.
 *
 * When we have no record, that means we never styled the element in a way we
 * survived to remember - for example a flash on a switched-off layer, whose
 * outline was injected without ever being saved. The safe action there is still
 * to remove the properties, not to give up: leaving them set is how a flash
 * ends up stuck on the page forever.
 */
function restoreOutline(element: HTMLElement): void {
  const previous = savedOutlines.get(element);
  if (previous) {
    for (const { prop, value } of previous) {
      if (value === "") element.style.removeProperty(prop);
      else element.style.setProperty(prop, value);
    }
  } else {
    for (const prop of OUTLINE_PROPS) element.style.removeProperty(prop);
  }
  savedOutlines.delete(element);
  activeColor.delete(element);
}

// --- badges ----------------------------------------------------------------

function buildBadge(spec: HighlightSpec): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = spec.label ?? "";
  badge.style.backgroundColor = spec.color;
  // Anchor to the element's top-left corner in *document* space, so scrolling
  // moves the badge with the element for free.
  const rect = spec.element.getBoundingClientRect();
  badge.style.left = `${rect.left + window.scrollX}px`;
  badge.style.top = `${rect.top + window.scrollY}px`;
  // There is no room above an element at the very top of the document, so the
  // badge sits inside it instead of being clipped off-screen.
  badge.style.transform = rect.top < 16 ? "translateY(0)" : "translateY(-100%)";
  return badge;
}

// --- public API ------------------------------------------------------------

/** Replaces the specs for one layer. */
export function setLayerSpecs(layer: HighlightLayer, items: HighlightSpec[]): void {
  // Outlines from a previous scan are undone first, so elements that vanished
  // from the page do not keep a stale outline forever.
  for (const previous of specsByLayer.get(layer) ?? []) restoreOutline(previous.element);
  specsByLayer.set(layer, items);
}

/** Records which layers should currently be drawn. */
export function setVisibility(next: Record<HighlightLayer, boolean>): void {
  visibility = next;
}

/** Drops every spec and undoes every DOM change. */
export function reset(): void {
  for (const specs of specsByLayer.values()) {
    for (const { element } of specs) restoreOutline(element);
  }
  specsByLayer.clear();
  elementsById.clear();
  for (const [element, timer] of flashing) {
    window.clearTimeout(timer);
    restoreOutline(element);
  }
  flashing.clear();
  tooltipByElement.clear();
  hideTooltip();
  badgeHost?.replaceChildren();
}

/** Removes the overlay host from the page entirely. */
export function destroy(): void {
  reset();
  document.removeEventListener("mouseover", onDocumentMouseOver, true);
  document.removeEventListener("mouseout", onDocumentMouseOut, true);
  host?.remove();
  host = null;
  badgeHost = null;
  tooltipEl = null;
}

/**
 * Repaints every visible layer from the stored specs.
 *
 * This is a full repaint rather than an incremental patch, which keeps the code
 * honest: the DOM can never drift out of sync with the stored state.
 *
 * The id -> element map is rebuilt here, from the same specs, so it is
 * impossible for it to disagree with what is on screen. Hidden layers are
 * included, so clicking a list item for a switched-off layer still scrolls.
 */
export function render(): void {
  const shadow = ensureHost();
  if (!shadow || !badgeHost) return;

  elementsById.clear();
  tooltipByElement.clear();
  hideTooltip();
  const badges: HTMLElement[] = [];

  for (const layer of ALL_LAYERS) {
    for (const spec of specsByLayer.get(layer) ?? []) {
      elementsById.set(spec.id, spec.element);

      if (!visibility[layer]) {
        restoreOutline(spec.element);
        continue;
      }
      applyOutline(spec.element, spec.color);
      if (spec.label) badges.push(buildBadge(spec));
      if (spec.tooltip) tooltipByElement.set(spec.element, spec.tooltip);
    }
  }

  badgeHost.replaceChildren(...badges);
}

/** Scrolls to an element and flashes it. */
export function reveal(id: string): boolean {
  const element = elementsById.get(id);
  if (!element) return false;

  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

  const running = flashing.get(element);
  if (running !== undefined) window.clearTimeout(running);

  // If the element currently has no outline (its layer is switched off) the
  // flash is the only styling it gets, and must be undone when it ends.
  const color = activeColor.get(element) ?? FLASH_COLOR;

  element.style.setProperty("outline", `${OUTLINE_WIDTH} solid ${color}`, "important");
  element.style.setProperty("outline-offset", FLASH_OFFSET, "important");

  const timer = window.setTimeout(() => {
    flashing.delete(element);
    // Live state, not a captured flag: the layer may have been switched off
    // while the flash was running, in which case the flash is all that is left.
    if (activeColor.has(element)) {
      element.style.setProperty("outline-offset", OUTLINE_OFFSET, "important");
      element.style.setProperty("outline", `${OUTLINE_WIDTH} solid ${activeColor.get(element)!}`, "important");
    } else {
      restoreOutline(element);
    }
  }, FLASH_MS);

  flashing.set(element, timer);
  return true;
}

// Viewport resizing moves elements, so badges have to be re-measured. Scrolling
// deliberately does not: badges are in document coordinates.
window.addEventListener("resize", () => {
  if (specsByLayer.size === 0) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, RESIZE_DEBOUNCE_MS);
});
