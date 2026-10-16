/**
 * Image alt-text scanner.
 *
 * Three states, per the plan:
 *   green  - non-empty alt text
 *   yellow - alt="" (present but empty; may be an intentional decorative image)
 *   red    - no alt attribute at all
 */
import { ALT_MAX_LENGTH, IMAGE_COLORS } from "../shared/config";
import type { ImageItem, ImageScan } from "../shared/types";
import type { HighlightSpec } from "./highlight";

export interface ImageScanResult {
  data: ImageScan;
  specs: HighlightSpec[];
}

export function scanImages(idFor: (element: Element) => string): ImageScanResult {
  // querySelectorAll already reaches <img> inside <picture>; we only record
  // that fact so the panel can show it.
  const elements = Array.from(document.querySelectorAll<HTMLImageElement>("img"));

  const items: ImageItem[] = [];
  const specs: HighlightSpec[] = [];
  let missingAltCount = 0;
  let emptyAltCount = 0;

  for (const image of elements) {
    // null and "" are meaningfully different: one is a bug, one may be a
    // deliberate decorative image.
    const alt = image.hasAttribute("alt") ? (image.getAttribute("alt") ?? "") : null;
    const issues: ImageItem["issues"] = [];

    let color: string;
    if (alt === null) {
      issues.push("missing-alt");
      missingAltCount += 1;
      color = IMAGE_COLORS.missingAlt;
    } else if (alt.trim() === "") {
      issues.push("empty-alt");
      emptyAltCount += 1;
      color = IMAGE_COLORS.emptyAlt;
    } else {
      color = IMAGE_COLORS.ok;
      if (alt.trim().length > ALT_MAX_LENGTH) issues.push("alt-too-long");
    }

    const src = image.getAttribute("src") ?? "";
    // currentSrc reflects the <source> the browser actually picked, which is
    // what the panel thumbnail should show.
    const absoluteSrc = image.currentSrc || absoluteUrl(src);

    const id = idFor(image);
    items.push({
      id,
      src,
      absoluteSrc,
      alt,
      insidePicture: image.closest("picture") !== null,
      issues,
    });
    specs.push({ id, element: image, color, label: "" });
  }

  return { data: { items, missingAltCount, emptyAltCount }, specs };
}

function absoluteUrl(src: string): string {
  if (src === "") return "";
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}
