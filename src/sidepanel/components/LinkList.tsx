/**
 * Link list: anchor text, destination, target behaviour, wording issues and
 * network results, with the filter chips the plan calls for.
 */
import { useState } from "react";
import { linkColor } from "../../shared/config";
import type { LinkCheck, LinkItem, LinkScan } from "../../shared/types";
import { ChipRow } from "./Chips";
import type { Chip } from "./Chips";
import { ClickableRow, EmptyNote, Tag } from "./ui";

type Filter = "all" | "same-tab" | "new-tab" | "broken" | "redirects" | "issues";

/** A link with a failed check. Per the plan, a timeout counts as broken. */
function isBroken(item: LinkItem): boolean {
  return item.check?.status === "broken";
}

function isRedirect(item: LinkItem): boolean {
  return item.check?.redirected === true;
}

/** Wording problems only. `nofollow` is informational, so it is excluded. */
export function countItemIssues(item: LinkItem): number {
  return item.issues.filter((issue) => issue !== "nofollow").length;
}

/**
 * The section badge counts both kinds of finding: wording problems from the
 * DOM scan and broken links from the network pass.
 */
export function countLinkIssues(scan: LinkScan): number {
  return scan.items.reduce(
    (total, item) => total + countItemIssues(item) + (isBroken(item) ? 1 : 0),
    0,
  );
}

const STATUS_TONE = {
  ok: "ok",
  broken: "error",
  unchecked: "muted",
  skipped: "muted",
} as const;

function StatusPill({ check }: { check: LinkCheck | null }) {
  if (!check) return null;
  if (check.status === "unchecked" || check.status === "skipped") return null;

  // The reason is shown instead of a code when the request never got one.
  const label = check.error ?? (check.statusCode === null ? "broken" : String(check.statusCode));

  return <Tag tone={STATUS_TONE[check.status]}>{label}</Tag>;
}

function IssueTags({ item }: { item: LinkItem }) {
  if (item.issues.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {item.issues.includes("empty-text") && <Tag tone="error">empty text</Tag>}
      {item.issues.includes("generic-text") && <Tag tone="warn">generic text</Tag>}
      {item.issues.includes("placeholder-href") && <Tag tone="error">placeholder href</Tag>}
      {item.issues.includes("nofollow") && <Tag tone="muted">nofollow</Tag>}
    </span>
  );
}

function LinkRow({ item, onSelect }: { item: LinkItem; onSelect: (id: string) => void }) {
  return (
    <ClickableRow onClick={() => onSelect(item.id)} title={item.resolved || item.href}>
      <span className="flex items-start gap-1.5">
        <span
          aria-hidden="true"
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: linkColor(item.target, item.checkable, item.check?.status ?? null),
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-medium">
              {item.label || <em className="text-red-600 dark:text-red-400">no text</em>}
            </span>
            <StatusPill check={item.check} />
            {isRedirect(item) && <Tag tone="muted">{item.check?.redirectStatus}</Tag>}
          </span>

          <span className="mt-0.5 block font-mono text-[10px] break-all text-neutral-500 dark:text-neutral-400">
            {item.resolved || item.href || "(empty href)"}
          </span>

          {/* The redirect destination, when the link went somewhere else. */}
          {isRedirect(item) && item.check?.finalUrl && (
            <span className="mt-0.5 block font-mono text-[10px] break-all text-neutral-400 dark:text-neutral-500">
              &rarr; {item.check.finalUrl}
            </span>
          )}

          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <Tag tone={item.target === "new-tab" ? "warn" : "muted"}>
              {item.target === "new-tab" ? "new tab" : "same tab"}
            </Tag>
            {!item.checkable && <Tag tone="muted">not checked</Tag>}
          </span>

          <IssueTags item={item} />
        </span>
      </span>
    </ClickableRow>
  );
}

export function LinkList({
  scan,
  onSelect,
}: {
  scan: LinkScan;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  if (scan.items.length === 0) return <EmptyNote>No links found on this page.</EmptyNote>;

  const items = scan.items;
  const chips: Chip<Filter>[] = [
    { id: "all", label: "All", count: items.length },
    { id: "same-tab", label: "Same tab", count: items.filter((i) => i.target === "same-tab").length },
    { id: "new-tab", label: "New tab", count: items.filter((i) => i.target === "new-tab").length },
    { id: "broken", label: "Broken", count: items.filter(isBroken).length },
    { id: "redirects", label: "Redirects", count: items.filter(isRedirect).length },
    { id: "issues", label: "Issues", count: items.filter((i) => countItemIssues(i) > 0).length },
  ];

  const visible = items.filter((item) => {
    switch (filter) {
      case "same-tab":
        return item.target === "same-tab";
      case "new-tab":
        return item.target === "new-tab";
      case "broken":
        return isBroken(item);
      case "redirects":
        return isRedirect(item);
      case "issues":
        return countItemIssues(item) > 0;
      default:
        return true;
    }
  });

  return (
    <>
      <ChipRow chips={chips} value={filter} onChange={setFilter} label="Filter links" />
      {visible.length === 0 ? (
        <EmptyNote>No links match this filter.</EmptyNote>
      ) : (
        <ul className="py-1">
          {visible.map((item) => (
            <li key={item.id}>
              <LinkRow item={item} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
