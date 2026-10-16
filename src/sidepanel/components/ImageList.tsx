/** Image alt-text list: thumbnail, source, alt state, with filter chips. */
import { useState } from "react";
import { ALT_MAX_LENGTH } from "../../shared/config";
import type { ImageItem, ImageScan } from "../../shared/types";
import { ChipRow } from "./Chips";
import type { Chip } from "./Chips";
import { ClickableRow, EmptyNote, Tag } from "./ui";

type Filter = "all" | "missing-alt" | "empty-alt";

export function countImageIssues(scan: ImageScan): number {
  return scan.items.reduce((total, item) => total + item.issues.length, 0);
}

/** Shortens a URL for display: keeps the tail, which is the informative part. */
function shorten(url: string, max = 52): string {
  if (url.length <= max) return url;
  return `${url.slice(0, 18)}...${url.slice(-(max - 21))}`;
}

function ImageRow({ item, onSelect }: { item: ImageItem; onSelect: (id: string) => void }) {
  const state = item.alt === null ? "missing-alt" : item.alt.trim() === "" ? "empty-alt" : "ok";

  return (
    <ClickableRow onClick={() => onSelect(item.id)} title={item.absoluteSrc || item.src}>
      <div className="flex items-start gap-2">
        <span className="mt-px h-9 w-9 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
          {item.absoluteSrc !== "" && (
            <img src={item.absoluteSrc} alt="" className="h-full w-full object-contain" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] break-all text-neutral-500 dark:text-neutral-400">
            {shorten(item.absoluteSrc || item.src || "(no src)")}
          </span>

          <span className="mt-0.5 block text-[11px]">
            {state === "missing-alt" ? (
              <span className="text-red-600 dark:text-red-400">No alt attribute</span>
            ) : state === "empty-alt" ? (
              <span className="text-amber-600 dark:text-amber-400">Empty alt</span>
            ) : (
              <span className="line-clamp-2">{item.alt}</span>
            )}
          </span>

          {item.issues.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {item.issues.includes("alt-too-long") && (
                <Tag tone="warn">alt over {ALT_MAX_LENGTH} chars</Tag>
              )}
              {item.insidePicture && <Tag tone="muted">picture</Tag>}
            </span>
          )}
        </span>
      </div>
    </ClickableRow>
  );
}

export function ImageList({
  scan,
  onSelect,
}: {
  scan: ImageScan;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  if (scan.items.length === 0) return <EmptyNote>No images found on this page.</EmptyNote>;

  const chips: Chip<Filter>[] = [
    { id: "all", label: "All", count: scan.items.length },
    { id: "missing-alt", label: "Missing alt", count: scan.missingAltCount },
    { id: "empty-alt", label: "Empty alt", count: scan.emptyAltCount },
  ];

  const visible = scan.items.filter((item) =>
    filter === "missing-alt"
      ? item.alt === null
      : filter === "empty-alt"
        ? item.alt !== null && item.alt.trim() === ""
        : true,
  );

  return (
    <>
      <ChipRow chips={chips} value={filter} onChange={setFilter} label="Filter images" />
      {visible.length === 0 ? (
        <EmptyNote>No images match this filter.</EmptyNote>
      ) : (
        <ul className="py-1">
          {visible.map((item) => (
            <li key={item.id}>
              <ImageRow item={item} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
