/**
 * A collapsible report section.
 *
 * The highlight toggle only appears when the section actually draws something
 * on the page - the four <head> sections have no target to highlight, so a
 * switch there would be a dead control.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "./ui";
import { Toggle } from "./Toggle";

export function Section({
  title,
  issueCount,
  tone,
  layer,
  layerVisible,
  onToggleLayer,
  defaultOpen = true,
  children,
}: {
  title: string;
  issueCount?: number;
  tone?: "ok" | "warn" | "error";
  /** When set, the section renders a switch that shows/hides its highlights. */
  layer?: string;
  layerVisible?: boolean;
  onToggleLayer?: (visible: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <span
            aria-hidden="true"
            className={`text-[9px] text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            &#9656;
          </span>
          <span className="truncate text-[12px] font-semibold">{title}</span>
          {issueCount !== undefined && issueCount > 0 && (
            <Badge tone={tone ?? "warn"}>
              {issueCount} {issueCount === 1 ? "issue" : "issues"}
            </Badge>
          )}
        </button>

        {layer && onToggleLayer && (
          <Toggle
            checked={layerVisible ?? false}
            onChange={onToggleLayer}
            label={`Show ${title} highlights on the page`}
          />
        )}
      </div>

      {open && (
        <div id={panelId} className="border-t border-neutral-200 dark:border-neutral-800">
          {children}
        </div>
      )}
    </section>
  );
}
