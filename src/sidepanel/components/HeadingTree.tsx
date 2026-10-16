/**
 * Headings rendered as an indented outline tree, matching how the levels nest
 * on the page. Each row shows the level, the heading text, and its issue tags.
 */
import { HEADING_COLORS } from "../../shared/config";
import type { HeadingsScan } from "../../shared/types";
import { Badge, ClickableRow, EmptyNote, Tag } from "./ui";

export function countHeadingIssues(scan: HeadingsScan): number {
  return (
    scan.items.reduce((total, item) => total + item.issues.length, 0) +
    (scan.missingH1 ? 1 : 0) +
    (scan.h1Count > 1 ? 1 : 0)
  );
}

export function HeadingTree({
  scan,
  onSelect,
}: {
  scan: HeadingsScan;
  onSelect: (id: string) => void;
}) {
  if (scan.items.length === 0) {
    return <EmptyNote>No headings found on this page.</EmptyNote>;
  }

  return (
    <div className="py-1">
      {(scan.missingH1 || scan.h1Count > 1) && (
        <div className="mx-2 my-1.5 flex flex-wrap gap-1">
          {scan.missingH1 && <Tag tone="error">No H1 on the page</Tag>}
          {scan.h1Count > 1 && <Tag tone="error">{scan.h1Count} H1s</Tag>}
        </div>
      )}

      <ul>
        {scan.items.map((item) => (
          <li key={item.id}>
            <ClickableRow
              onClick={() => onSelect(item.id)}
              title={item.text || "(empty heading)"}
              className="flex items-start gap-1.5"
              // Indentation mirrors the level, so a skipped level shows up as a
              // visible jump in the tree.
              style={{ paddingLeft: `${6 + (item.level - 1) * 10}px` }}
            >
              <span
                aria-hidden="true"
                className="mt-px shrink-0 rounded-sm px-1 font-mono text-[10px] font-bold text-white"
                style={{ backgroundColor: HEADING_COLORS[item.level - 1] }}
              >
                H{item.level}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[11px]">
                  {item.text || <em className="text-neutral-400">empty heading</em>}
                </span>
                {item.issues.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {item.issues.map((issue) => (
                      <Badge key={issue} tone="warn">
                        {issue === "empty" ? "empty" : "skipped level"}
                      </Badge>
                    ))}
                  </span>
                )}
              </span>
            </ClickableRow>
          </li>
        ))}
      </ul>
    </div>
  );
}
