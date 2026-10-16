/**
 * Content script: runs inside the page, so it is the only context that can
 * read the DOM without asking anyone for permission.
 *
 * Messaging flow
 * --------------
 *   side panel  --chrome.tabs.sendMessage-->  this file
 *   this file   --sendResponse-------------->  side panel   (scan results)
 *   background  --chrome.runtime.sendMessage->  this file   (PANEL_CLOSED)
 *
 * Nothing here polls or broadcasts on a timer; the panel is always the
 * initiator and this file only answers.
 */
import { DEFAULT_LAYER_VISIBILITY, STORAGE_KEY, destinationLabel, linkColor } from "../shared/config";
import type { HighlightLayer, QaSettings } from "../shared/config";
import type {
  ContentReply,
  Handshake,
  LinkCheck,
  LinkItem,
  PanelClosedMessage,
  PanelToContentMessage,
  ScanResult,
} from "../shared/types";
import { destroy, render, reveal, reset, setLayerSpecs, setVisibility } from "./highlight";
import type { HighlightSpec } from "./highlight";
import { scanHeadings } from "./headings";
import { scanImages } from "./images";
import { scanLinks } from "./links";
import { scanMeta } from "./meta";

/**
 * Element -> scan-local id. A WeakMap means we never add a data-* attribute to
 * the page, and entries drop out on their own when elements are removed.
 */
let idCounter = 0;
const elementIds = new WeakMap<Element, string>();

function idFor(element: Element): string {
  let id = elementIds.get(element);
  if (!id) {
    id = `qa-${++idCounter}`;
    elementIds.set(element, id);
  }
  return id;
}

function handshake(): Handshake {
  return { url: location.href, documentTitle: document.title };
}

/**
 * Which layers are switched on. The side panel owns this state and persists it
 * in chrome.storage.local; the content script reads the same key so a freshly
 * loaded page already honours the user's choices.
 */
let layerVisibility: Record<HighlightLayer, boolean> = { ...DEFAULT_LAYER_VISIBILITY };

async function loadVisibility(): Promise<Record<HighlightLayer, boolean>> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const settings = stored[STORAGE_KEY] as QaSettings | undefined;
    if (!settings?.layers) return { ...DEFAULT_LAYER_VISIBILITY };
    // Merged with defaults so a layer introduced in a later version is never
    // left undefined here.
    return { ...DEFAULT_LAYER_VISIBILITY, ...settings.layers };
  } catch {
    return { ...DEFAULT_LAYER_VISIBILITY };
  }
}

/**
 * The link layer is the only one that changes after the scan finishes: the
 * background worker reports status codes, and broken links have to turn red.
 * Both maps are replaced on every scan and thrown away by reset().
 */
let linkSpecs: HighlightSpec[] = [];
let linkItems = new Map<string, LinkItem>();

/** Applies freshly arrived check results to the links layer. */
function applyLinkChecks(checks: Record<string, LinkCheck>): void {
  let changed = false;

  const updated = linkSpecs.map((spec) => {
    const item = linkItems.get(spec.id);
    if (!item) return spec;

    const check = checks[item.resolved];
    const status = check?.status ?? null;
    const color = linkColor(item.target, item.checkable, status);

    // A redirect changes where the link actually goes, so the hover tooltip
    // says so: "Home → /new-home", for example.
    const tooltip =
      check?.redirected && check.finalUrl
        ? `${destinationLabel(item.resolved, item.href)} → ${destinationLabel(check.finalUrl, check.finalUrl)}`
        : spec.tooltip;

    if (color === spec.color && tooltip === spec.tooltip) return spec;

    changed = true;
    return { ...spec, color, tooltip };
  });

  // A repaint walks every link on the page, so it is only worth doing when at
  // least one link actually changed colour. "unchecked -> ok" is not a change.
  if (!changed) return;

  linkSpecs = updated;
  setLayerSpecs("links", updated);
  render();
}

// --- scanning --------------------------------------------------------------

function runScan(): ScanResult {
  const started = performance.now();

  // Start from a clean slate so nothing from a previous scan can survive.
  reset();

  const headings = scanHeadings(idFor);
  const images = scanImages(idFor);
  const links = scanLinks(idFor);
  const meta = scanMeta();

  linkSpecs = links.specs;
  linkItems = new Map(links.data.items.map((item) => [item.id, item]));

  setLayerSpecs("headings", headings.specs);
  setLayerSpecs("images", images.specs);
  setLayerSpecs("links", links.specs);

  setVisibility(layerVisibility);
  render();

  return {
    url: location.href,
    scannedAt: Date.now(),
    durationMs: Math.round(performance.now() - started),
    headings: headings.data,
    meta,
    images: images.data,
    links: links.data,
  };
}

// --- messaging -------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: PanelToContentMessage | PanelClosedMessage,
    _sender,
    sendResponse,
  ): boolean => {
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true, kind: "handshake", handshake: handshake() } satisfies ContentReply);
        return false;

      case "RUN_SCAN":
        sendResponse({ ok: true, kind: "scan", result: runScan() } satisfies ContentReply);
        return false;

      case "SET_LAYER":
        layerVisibility = { ...layerVisibility, [message.layer]: message.visible };
        setVisibility(layerVisibility);
        render();
        return false;

      case "SCROLL_TO":
        reveal(message.id);
        return false;

      case "APPLY_LINK_CHECKS":
        applyLinkChecks(message.checks);
        return false;

      case "CLEAR_HIGHLIGHTS":
      case "PANEL_CLOSED":
        // Full teardown: drop the overlay host and every inline outline we set.
        linkSpecs = [];
        linkItems = new Map();
        destroy();
        return false;

      default:
        return false;
    }
  },
);

/**
 * Announce readiness. The panel may open long after this document loaded (the
 * user clicks the icon on an already-open page), so the panel cannot rely on
 * having seen a load-time broadcast. A rejection just means nobody is listening.
 */
void chrome.runtime
  .sendMessage({ ok: true, kind: "handshake", handshake: handshake() } satisfies ContentReply)
  .catch(() => {});

// Restore the saved layer choices before the panel's first scan arrives.
void loadVisibility().then((visibility) => {
  layerVisibility = visibility;
  setVisibility(visibility);
});
